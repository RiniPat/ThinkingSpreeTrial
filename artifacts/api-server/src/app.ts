import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";

// Process-level crash handlers. When the server dies without these, Render
// just shows "service restarted" with no clue why. Logging the error to
// stderr ensures it lands in the Render logs before the process exits.
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaughtException — process will exit");
});
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "unhandledRejection — request likely failed silently");
});

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// On Render the app sits behind a TLS-terminating proxy. Trust it so that
// `secure: true` cookies still get marked secure correctly.
app.set("trust proxy", 1);

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Postgres-backed session store ────────────────────────────────────────
// Render's free tier puts the web service to sleep after 15 min idle; in-memory
// sessions would be lost on every wake-up. PG sessions persist across restarts.
//
// IMPORTANT: When deployed behind Render (or any TLS-terminating reverse proxy)
// the app receives HTTP, not HTTPS, but with X-Forwarded-Proto: https. Without
// trust proxy, express-session sees `req.secure === false` and refuses to send
// a Set-Cookie header for `cookie.secure: true`, which silently breaks login.
// Render uses a single proxy hop.
app.set("trust proxy", 1);

const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "user_sessions",
      // creates the table on first run if missing
      createTableIfMissing: true,
    }),
    name: "ts.sid",
    secret: process.env.SESSION_SECRET ?? "thinking-spree-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // Secure cookies in prod (Render terminates TLS); plain cookies in dev.
      // `trust proxy` above means req.secure reflects X-Forwarded-Proto.
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  }),
);

app.use("/api", router);

// ─── Serve the React frontend ─────────────────────────────────────────────
// In production the Vite build output is bundled next to the API dist folder.
// Render runs a single web service that serves both API + static assets on
// the same port.
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PUBLIC_DIR = process.env.PUBLIC_DIR
  ?? path.resolve(__dirname, "../../thinking-spree/dist/public");

if (fs.existsSync(PUBLIC_DIR)) {
  logger.info({ PUBLIC_DIR }, "Serving frontend assets");
  app.use(express.static(PUBLIC_DIR, { maxAge: "1h", index: false }));
  // SPA fallback: any unknown non-API route serves index.html so client-side routing works.
  app.get(/^(?!\/api).*/, (_req, res, next) => {
    const indexFile = path.join(PUBLIC_DIR, "index.html");
    if (!fs.existsSync(indexFile)) return next();
    res.sendFile(indexFile);
  });
} else {
  logger.warn({ PUBLIC_DIR }, "Frontend dist folder not found — API only");
}

export default app;
