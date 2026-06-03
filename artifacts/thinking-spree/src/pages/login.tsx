import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { loginRequest } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Lock, Mail, Loader2 } from "lucide-react";
import logoPath from "@assets/thinkingspree_logo_1778683092464.jpg";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Surface OAuth callback errors via toast (carries over from the original page).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("google");
    if (flag === "error") {
      const reason = params.get("reason") ?? "Try again.";
      toast({
        title: "Google sign-in failed",
        description: reason === "wrong_domain"
          ? "Only @thinkingspree.com accounts are allowed."
          : reason,
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
      const res = await customFetch<{ url: string }>(`${BASE}/api/auth/google/start`, {
        credentials: "include",
      });
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

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      {/* Soft blurred orbs in the background — primary on one corner, gold on the other.
          Pure decoration, sits behind the card. */}
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-32 -left-32 h-96 w-96 rounded-full opacity-20 blur-3xl"
          style={{ background: "hsl(var(--primary))" }}
        />
        <div
          className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full opacity-30 blur-3xl"
          style={{ background: "var(--gold)" }}
        />
      </div>

      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-card-border bg-card p-8 shadow-xl">
          {/* Brand — logo in a small ring + serif wordmark */}
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="rounded-md bg-white p-3 shadow-sm ring-1 ring-border">
              <img src={logoPath} alt="Thinking Spree" className="h-12 w-auto" />
            </div>
            <h1 className="mt-5 font-serif text-3xl text-foreground">Thinking Spree</h1>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Consultant Suite
            </p>
          </div>

          <div className="mb-6 border-t border-border" />

          <h2 className="text-center font-serif text-xl text-foreground">Sign in to continue</h2>
          <p className="mt-1 text-center text-xs text-muted-foreground">
            Use your Thinking Spree workspace account.
          </p>

          {/* Google sign-in — primary path, white pill with branded G logo. */}
          <button
            type="button"
            onClick={handleGoogle}
            disabled={googleLoading}
            className="mt-6 flex w-full items-center justify-center gap-3 rounded-md border border-border bg-white px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            {googleLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
            )}
            <span>{googleLoading ? "Redirecting…" : "Continue with Google"}</span>
          </button>

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">or with email</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Work Email
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="email"
                  data-testid="input-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@thinkingspree.com"
                  required
                  className="w-full pl-9 pr-4 py-2.5 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Password
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="password"
                  data-testid="input-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full pl-9 pr-10 py-2.5 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <button
              data-testid="button-submit"
              type="submit"
              disabled={loading}
              className="mt-2 w-full py-2.5 bg-primary text-primary-foreground rounded-md text-sm font-semibold hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Signing in..." : "Sign In with Password"}
            </button>
          </form>

          <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
            Access restricted to @thinkingspree.com accounts.<br />
            New here? <Link href="/signup" className="text-primary hover:underline">Create an account</Link>
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Thinking Spree · Consultant Suite v4.1
        </p>
      </div>
    </div>
  );
}
