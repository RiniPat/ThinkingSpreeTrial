import { Router } from "express";
import crypto from "node:crypto";
import {
  isGoogleOAuthConfigured, buildAuthUrl, exchangeCodeAndStore,
  getStoredTokens, getAuthedClient, disconnect,
  testCalendar, testGmail, testDrive, testSheets,
  SCOPE_GROUPS,
} from "../lib/google";

const router = Router();

declare module "express-session" {
  interface SessionData {
    googleOauthState?: string;
  }
}

router.get("/google/status", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const row = await getStoredTokens(userId);
    res.json({
      configured: isGoogleOAuthConfigured(),
      connected: Boolean(row?.refreshToken),
      googleEmail: row?.googleEmail ?? null,
      scope: row?.scope ?? null,
      services: {
        calendar: row?.hasCalendar === "yes",
        gmail:    row?.hasGmail === "yes",
        drive:    row?.hasDrive === "yes",
        sheets:   row?.hasSheets === "yes",
      },
      expiresAt: row?.expiryDate?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching Google status");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/google/oauth/start", (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!isGoogleOAuthConfigured()) {
    res.status(503).json({ error: "Google OAuth is not configured on the server. See GOOGLE_INTEGRATION_SETUP.md." });
    return;
  }
  // optional `services=` to request subset, default = all
  const requested = String(req.query.services ?? "calendar,gmail,drive,sheets").split(",").map(s => s.trim());
  const scopes = [
    ...SCOPE_GROUPS.profile,
    ...(requested.includes("calendar") ? SCOPE_GROUPS.calendar : []),
    ...(requested.includes("gmail")    ? SCOPE_GROUPS.gmail    : []),
    ...(requested.includes("drive")    ? SCOPE_GROUPS.drive    : []),
    ...(requested.includes("sheets")   ? SCOPE_GROUPS.sheets   : []),
  ];

  const state = crypto.randomBytes(16).toString("hex");
  req.session!.googleOauthState = state;
  const url = buildAuthUrl(state, scopes);
  res.json({ url });
});

router.get("/google/oauth/callback", async (req, res) => {
  const userId = req.session?.userId;
  const { code, state, error: oauthErr } = req.query as Record<string, string | undefined>;
  const appBase = process.env.APP_BASE_URL ?? "/";
  if (oauthErr) {
    res.redirect(`${appBase}/settings?google=error&reason=${encodeURIComponent(oauthErr)}`);
    return;
  }
  if (!userId || !code || !state || state !== req.session?.googleOauthState) {
    res.redirect(`${appBase}/settings?google=error&reason=state_mismatch`);
    return;
  }
  try {
    delete req.session!.googleOauthState;
    await exchangeCodeAndStore(userId, code);
    res.redirect(`${appBase}/settings?google=connected`);
  } catch (err) {
    req.log.error({ err }, "Google OAuth callback failed");
    res.redirect(`${appBase}/settings?google=error&reason=token_exchange`);
  }
});

router.post("/google/disconnect", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    await disconnect(userId);
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Google disconnect failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Connection-test endpoint — Settings → Integrations "Run test" button.
 * Runs one cheap read against each enabled service so the user knows
 * which scopes work end-to-end.
 */
router.post("/google/test", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const client = await getAuthedClient(userId);
    if (!client) { res.status(400).json({ error: "Not connected to Google" }); return; }

    const results: Record<string, { ok: boolean; detail?: string; error?: string }> = {};
    const tests = [
      ["calendar", testCalendar],
      ["gmail",    testGmail],
      ["drive",    testDrive],
      ["sheets",   testSheets],
    ] as const;

    for (const [name, fn] of tests) {
      try {
        results[name] = await fn(client);
      } catch (err: any) {
        const msg = err?.errors?.[0]?.message ?? err?.message ?? "Unknown error";
        results[name] = { ok: false, error: msg };
      }
    }

    res.json({ ranAt: new Date().toISOString(), results });
  } catch (err) {
    req.log.error({ err }, "Google test failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
