import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { google } from "googleapis";
import { db, usersTable } from "@workspace/db";
import { eq, count as sqlCount } from "drizzle-orm";
import {
  isGoogleOAuthConfigured, makeOAuthClient, ALL_SCOPES, SCOPE_GROUPS,
  exchangeCodeAndStore,
} from "../lib/google";

const router = Router();

declare module "express-session" {
  interface SessionData {
    userId: number;
    googleAuthState?: string;
    /** "login" means we should sign the user in after callback; "link" means just connect */
    googleAuthMode?: "login" | "link";
  }
}

const ALLOWED_DOMAIN = "@thinkingspree.com";

/** Wraps res.json in req.session.save so the session row is durable
 *  before the client receives the response. Fixes a race condition that
 *  caused intermittent 401s on the very next request. */
function respondWithSession(req: any, res: any, status: number, payload: any) {
  req.session.save((err: any) => {
    if (err) {
      req.log.error({ err }, "Failed to persist session");
      res.status(500).json({ error: "Session save failed" });
      return;
    }
    res.status(status).json(payload);
  });
}

function userPayload(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    avatarUrl: user.avatarUrl,
    isAdmin: user.role === "admin",
    hasGoogleAccount: Boolean(user.googleSub),
  };
}

// ─── /auth/me ─────────────────────────────────────────────────────────────
router.get("/auth/me", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(401).json({ error: "User not found" }); return; }
    res.json(userPayload(user));
  } catch (err) {
    req.log.error({ err }, "Error fetching user");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── /auth/login (email + password) ───────────────────────────────────────
router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  if (!email.endsWith(ALLOWED_DOMAIN)) {
    res.status(403).json({ error: `Only ${ALLOWED_DOMAIN} email addresses are allowed` });
    return;
  }
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    req.session.userId = user.id;
    respondWithSession(req, res, 200, userPayload(user));
  } catch (err) {
    req.log.error({ err }, "Error during login");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── /auth/logout ─────────────────────────────────────────────────────────
router.post("/auth/logout", (req, res) => {
  req.session?.destroy(() => res.json({ success: true }));
});

// ─── /auth/signup (email + password) ──────────────────────────────────────
router.post("/auth/signup", async (req, res) => {
  const { email, password, name } = req.body as { email: string; password: string; name: string };
  if (!email || !password || !name) {
    res.status(400).json({ error: "email, password, and name are all required" });
    return;
  }
  if (!email.endsWith(ALLOWED_DOMAIN)) {
    res.status(403).json({ error: `Only ${ALLOWED_DOMAIN} emails are allowed to register` });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    // First user becomes admin automatically
    const countResult = await db.select({ count: sqlCount() }).from(usersTable);
    const userCount = Number(countResult[0]?.count ?? 0);
    const isFirstUser = userCount === 0;
    const [user] = await db.insert(usersTable).values({
      email, name, passwordHash,
      role: isFirstUser ? "admin" : "consultant",
    }).returning();
    req.session.userId = user.id;
    respondWithSession(req, res, 201, userPayload(user));
  } catch (err) {
    req.log.error({ err }, "Error during signup");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── /auth/google/start — kick off Google OAuth for sign-in ───────────────
router.get("/auth/google/start", (req, res) => {
  if (!isGoogleOAuthConfigured()) {
    res.status(503).json({ error: "Google OAuth is not configured on the server." });
    return;
  }
  const state = crypto.randomBytes(16).toString("hex");
  req.session.googleAuthState = state;
  req.session.googleAuthMode = "login";

  const oAuth2 = makeOAuthClient();
  const url = oAuth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ALL_SCOPES,
    state,
    include_granted_scopes: true,
    // Restrict the chooser to the thinkingspree.com Workspace domain
    hd: "thinkingspree.com",
  });
  res.json({ url });
});

// ─── /auth/google/callback — Google sign-in callback ──────────────────────
router.get("/auth/google/callback", async (req, res) => {
  const { code, state, error: oauthErr } = req.query as Record<string, string | undefined>;
  const appBase = process.env.APP_BASE_URL ?? "";
  if (oauthErr || !code || !state || state !== req.session.googleAuthState) {
    res.redirect(`${appBase}/login?google=error&reason=${encodeURIComponent(oauthErr || "state_mismatch")}`);
    return;
  }
  try {
    const oAuth2 = makeOAuthClient();
    const { tokens } = await oAuth2.getToken(code);
    oAuth2.setCredentials(tokens);
    const { data: profile } = await google.oauth2({ auth: oAuth2, version: "v2" }).userinfo.get();
    if (!profile.email || !profile.email.endsWith(ALLOWED_DOMAIN)) {
      res.redirect(`${appBase}/login?google=error&reason=wrong_domain`);
      return;
    }
    // Find or create user
    let [user] = await db.select().from(usersTable).where(eq(usersTable.email, profile.email)).limit(1);
    if (!user) {
      // First user becomes admin automatically
      const existing = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
      const isFirstUser = existing.length === 0;
      [user] = await db.insert(usersTable).values({
        email: profile.email,
        name: profile.name ?? profile.email.split("@")[0],
        passwordHash: null,
        avatarUrl: profile.picture ?? null,
        googleSub: profile.id ?? null,
        role: isFirstUser ? "admin" : "consultant",
      }).returning();
    } else if (!user.googleSub && profile.id) {
      // Link existing email/password user to Google
      [user] = await db.update(usersTable).set({
        googleSub: profile.id,
        avatarUrl: user.avatarUrl ?? profile.picture ?? null,
      }).where(eq(usersTable.id, user.id)).returning();
    }

    // Persist Google tokens for the user
    await exchangeCodeAndStoreFromTokens(user.id, tokens, profile);

    delete req.session.googleAuthState;
    delete req.session.googleAuthMode;
    req.session.userId = user.id;
    req.session.save((err) => {
      if (err) req.log.error({ err }, "Failed to persist session after Google login");
      res.redirect(`${appBase}/dashboard?google=connected`);
    });
  } catch (err) {
    req.log.error({ err }, "Google OAuth callback failed");
    res.redirect(`${appBase}/login?google=error&reason=token_exchange`);
  }
});

/** Mirror of lib/google.ts exchangeCodeAndStore but takes already-fetched tokens. */
async function exchangeCodeAndStoreFromTokens(
  userId: number,
  tokens: any,
  profile: any,
) {
  const { googleTokensTable } = await import("@workspace/db");
  const scopeStr = tokens.scope ?? "";
  const expiryDate = tokens.expiry_date ? new Date(tokens.expiry_date) : null;
  const flags = {
    hasCalendar: SCOPE_GROUPS.calendar.some(s => scopeStr.includes(s)) ? "yes" : null,
    hasGmail:    SCOPE_GROUPS.gmail.some(s => scopeStr.includes(s)) ? "yes" : null,
    hasDrive:    SCOPE_GROUPS.drive.some(s => scopeStr.includes(s)) ? "yes" : null,
    hasSheets:   SCOPE_GROUPS.sheets.some(s => scopeStr.includes(s)) ? "yes" : null,
  };

  const existing = await db.select().from(googleTokensTable).where(eq(googleTokensTable.userId, userId)).limit(1);
  if (existing.length > 0) {
    await db.update(googleTokensTable).set({
      accessToken:  tokens.access_token  ?? existing[0].accessToken,
      refreshToken: tokens.refresh_token ?? existing[0].refreshToken,
      scope: scopeStr || existing[0].scope,
      tokenType: tokens.token_type ?? existing[0].tokenType,
      expiryDate: expiryDate ?? existing[0].expiryDate,
      ...flags,
      googleEmail: profile.email ?? existing[0].googleEmail,
      googleProfile: profile ?? existing[0].googleProfile,
      updatedAt: new Date(),
    }).where(eq(googleTokensTable.userId, userId));
  } else {
    await db.insert(googleTokensTable).values({
      userId,
      accessToken:  tokens.access_token  ?? null,
      refreshToken: tokens.refresh_token ?? null,
      scope: scopeStr,
      tokenType: tokens.token_type ?? null,
      expiryDate,
      ...flags,
      googleEmail: profile.email ?? null,
      googleProfile: profile ?? null,
    });
  }
}

// ─── Admin: list all users ────────────────────────────────────────────────
router.get("/auth/users", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const [me] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!me || me.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
    const all = await db.select().from(usersTable).orderBy(usersTable.createdAt);
    res.json(all.map(userPayload));
  } catch (err) {
    req.log.error({ err }, "Error listing users");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Admin: change a user's role ──────────────────────────────────────────
router.patch("/auth/users/:id/role", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const targetId = parseInt(req.params.id);
  const { role } = req.body as { role: "admin" | "consultant" };
  if (!["admin", "consultant"].includes(role)) {
    res.status(400).json({ error: "Role must be admin or consultant" });
    return;
  }
  try {
    const [me] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!me || me.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
    if (me.id === targetId && role === "consultant") {
      // Don't allow the last admin to demote themselves
      const others = await db.select().from(usersTable).where(eq(usersTable.role, "admin"));
      if (others.length <= 1) {
        res.status(400).json({ error: "Cannot demote the last admin" });
        return;
      }
    }
    const [updated] = await db.update(usersTable).set({ role })
      .where(eq(usersTable.id, targetId)).returning();
    if (!updated) { res.status(404).json({ error: "User not found" }); return; }
    res.json(userPayload(updated));
  } catch (err) {
    req.log.error({ err }, "Error updating user role");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
