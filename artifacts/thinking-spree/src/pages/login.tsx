import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { loginRequest } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Lock, Mail, Loader2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ────────────────────────────────────────────────────────────────────────
   Thinking Spree — sign-in (editorial rebrand).
   Warm ivory canvas · charcoal ink · Newsreader serif · Archivo display.
   The layout mirrors the approved design; all auth wiring (email/password,
   Google OAuth, redirects) is unchanged from the previous page.
   ──────────────────────────────────────────────────────────────────────── */

const HANDS = `${BASE}/ts-hands.png`;

// Palette lifted straight from the design spec.
const C = {
  page: "#F5F2EC", leftBg: "#FAF8F3", leftBorder: "#E7E2D8",
  ink: "#26262B", ink2: "#111827", muted: "#6C685E", faint: "#A19C90",
  footFaint: "#A8A398", cardBorder: "#E5E7EB", inputBorder: "#D1D5DB",
  label: "#111827", sub: "#4B5563", grey: "#6B7280", submit: "#22222A",
};
const SANS = "'Archivo', ui-sans-serif, system-ui, sans-serif";
const SERIF = "'Newsreader', Georgia, 'Times New Roman', serif";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("google");
    if (flag === "error") {
      const reason = params.get("reason") ?? "Try again.";
      toast({
        title: "Google sign-in failed",
        description: reason === "wrong_domain" ? "Only @thinkingspree.com accounts are allowed." : reason,
        variant: "destructive",
      });
      window.history.replaceState({}, "", "/login");
    }
  }, [toast]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await loginRequest(email, password);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      setLocation("/dashboard");
    } catch (err: unknown) {
      toast({
        title: "Login failed",
        description: err instanceof Error ? err.message : "Invalid credentials",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    try {
      const res = await customFetch<{ url: string }>(`${BASE}/api/auth/google/start`, { credentials: "include" });
      window.location.href = res.url;
    } catch (err: any) {
      toast({
        title: "Couldn't start Google sign-in",
        description: err?.message ?? "Is Google OAuth configured on the server?",
        variant: "destructive",
      });
      setGoogleLoading(false);
    }
  }

  const wordmark = (fontSize: number) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontFamily: SANS, fontWeight: 900, fontStyle: "italic", fontSize, lineHeight: 0.9, letterSpacing: "-0.03em", color: C.ink, textTransform: "uppercase" }}>
        Thinking<br />Spree
      </div>
      <div style={{ fontFamily: SANS, fontSize: 11.5, fontWeight: 800, letterSpacing: "0.32em", color: C.faint }}>
        CONSULTANT SUITE
      </div>
    </div>
  );

  return (
    <div className="tsl-root" style={{ display: "flex", minHeight: "100vh", width: "100%", background: C.page, fontFamily: SANS }}>
      {/* ───────────────── LEFT · ivory hands panel ───────────────── */}
      <div className="tsl-left" style={{ flex: "1.05", minWidth: 0, position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "60px 60px 44px", background: C.leftBg, borderRight: `1px solid ${C.leftBorder}` }}>
        <div className="tsl-dots" style={{ position: "absolute", inset: 0, backgroundImage: `radial-gradient(${C.ink} 0.6px, transparent 0.6px)`, backgroundSize: "30px 30px", opacity: 0.04, pointerEvents: "none" }} />

        <div style={{ position: "relative" }}>{wordmark(58)}</div>

        <div style={{ position: "relative", display: "flex", justifyContent: "center", alignItems: "center", margin: "8px 0" }}>
          <div style={{ position: "relative", width: "100%", maxWidth: 600 }}>
            <img src={HANDS} alt="Michelangelo's Creation of Adam, cropped to the two reaching hands"
                 style={{ display: "block", width: "100%", height: "auto" }}
                 onError={(e: any) => { e.currentTarget.style.display = "none"; }} />
          </div>
        </div>

        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 14, maxWidth: 540 }}>
          <h1 style={{ margin: 0, fontFamily: SERIF, fontWeight: 500, fontSize: 46, lineHeight: 1.04, letterSpacing: "-0.015em", color: C.ink }}>
            A calmer command center for every sprint.
          </h1>
          <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.6, color: C.muted, fontWeight: 500, maxWidth: 460 }}>
            Sync companies, schedule work, generate outreach, and keep outcomes moving from one focused workspace.
          </p>
          <div style={{ marginTop: 14, fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: C.footFaint }}>
            Internal workspace access only
          </div>
        </div>
      </div>

      {/* ───────────────── RIGHT · sign-in form ───────────────── */}
      <div className="tsl-right" style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 48, background: "#FFFFFF" }}>
        <div style={{ width: "100%", maxWidth: 452 }}>
          {/* Compact wordmark for narrow screens where the left panel is hidden */}
          <div className="tsl-mobilebrand" style={{ display: "none", marginBottom: 28 }}>{wordmark(40)}</div>

          <form onSubmit={handleSubmit} style={{ background: "#FFFFFF", border: `1px solid ${C.cardBorder}`, borderRadius: 20, padding: "44px 44px 36px", boxShadow: "0 30px 70px -34px rgba(17,24,39,0.18)" }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.22em", color: C.grey }}>WELCOME BACK</div>
            <h2 style={{ margin: "10px 0 8px", fontFamily: SERIF, fontWeight: 500, fontSize: 38, lineHeight: 1.05, letterSpacing: "-0.01em", color: C.ink2 }}>Sign in to continue</h2>
            <p style={{ margin: "0 0 26px", fontSize: 15, color: C.sub, fontWeight: 500 }}>Use your Thinking Spree workspace account.</p>

            {/* Google */}
            <button type="button" onClick={handleGoogle} disabled={googleLoading}
              className="tsl-google"
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: 15, background: "#FFFFFF", border: `1px solid ${C.inputBorder}`, borderRadius: 12, fontFamily: SANS, fontSize: 15.5, fontWeight: 700, color: C.ink2, cursor: googleLoading ? "wait" : "pointer" }}>
              {googleLoading ? <Loader2 size={19} className="tsl-spin" /> : (
                <svg width="19" height="19" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"></path><path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"></path><path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"></path><path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"></path></svg>
              )}
              {googleLoading ? "Redirecting…" : "Continue with Google"}
            </button>

            {/* divider */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "26px 0" }}>
              <div style={{ flex: 1, height: 1, background: C.cardBorder }} />
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.18em", color: C.grey }}>OR WITH EMAIL</span>
              <div style={{ flex: 1, height: 1, background: C.cardBorder }} />
            </div>

            {/* email */}
            <label htmlFor="email" style={{ display: "block", fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", color: C.label, marginBottom: 9 }}>WORK EMAIL</label>
            <div className="tsl-field" style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 14px", border: `1px solid ${C.inputBorder}`, borderRadius: 12, background: "#FFFFFF", marginBottom: 20 }}>
              <Mail size={18} style={{ color: C.grey, flexShrink: 0 }} />
              <input id="email" data-testid="input-email" type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="you@thinkingspree.com" autoComplete="username"
                style={{ flex: 1, border: "none", background: "transparent", padding: "15px 0", fontFamily: SANS, fontSize: 15, fontWeight: 500, color: C.ink2, outline: "none" }} />
            </div>

            {/* password */}
            <label htmlFor="password" style={{ display: "block", fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", color: C.label, marginBottom: 9 }}>PASSWORD</label>
            <div className="tsl-field" style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 14px", border: `1px solid ${C.inputBorder}`, borderRadius: 12, background: "#FFFFFF" }}>
              <Lock size={18} style={{ color: C.grey, flexShrink: 0 }} />
              <input id="password" data-testid="input-password" type={showPassword ? "text" : "password"} required value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" autoComplete="current-password"
                style={{ flex: 1, border: "none", background: "transparent", padding: "15px 0", fontFamily: SANS, fontSize: 15, fontWeight: 500, color: C.ink2, outline: "none" }} />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 4, background: "none", border: "none", cursor: "pointer", color: C.grey }}>
                {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>

            {/* submit */}
            <button type="submit" data-testid="button-submit" disabled={loading}
              className="tsl-submit"
              style={{ width: "100%", marginTop: 22, padding: 17, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10, background: C.submit, border: "none", borderRadius: 12, fontFamily: SANS, fontSize: 16, fontWeight: 800, color: "#FBFAF6", cursor: loading ? "wait" : "pointer", letterSpacing: "0.01em", opacity: loading ? 0.85 : 1 }}>
              {loading && <Loader2 size={17} className="tsl-spin" />}
              {loading ? "Signing in…" : "Sign in with password"}
            </button>

            <p style={{ margin: "22px 0 0", textAlign: "center", fontSize: 13.5, lineHeight: 1.6, color: C.grey, fontWeight: 500 }}>
              Access restricted to <b style={{ color: "#374151" }}>@thinkingspree.com</b> accounts. New here?<br />
              <Link href="/signup" style={{ fontWeight: 800, color: C.ink2, textDecoration: "underline", textUnderlineOffset: 2 }}>Create an account</Link>
            </p>
          </form>
        </div>
      </div>

      <style>{`
        .tsl-root input::placeholder { color: #A7A296; }
        .tsl-field:focus-within { border-color: #9CA3AF; }
        .tsl-google:hover:not(:disabled) { background: #F3F4F6; border-color: #9CA3AF; }
        .tsl-submit:hover:not(:disabled) { background: #111117; }
        .tsl-spin { animation: tslspin 1s linear infinite; }
        @keyframes tslspin { to { transform: rotate(360deg); } }
        @media (max-width: 900px) {
          .tsl-left { display: none !important; }
          .tsl-right { padding: 32px 20px !important; }
          .tsl-mobilebrand { display: block !important; }
        }
      `}</style>
    </div>
  );
}
