import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { loginRequest } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Lock, Mail, Loader2, ShieldCheck, CalendarClock, Files } from "lucide-react";
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
    <div className="grid min-h-screen bg-background lg:grid-cols-[1.05fr_0.95fr]">
      <section className="app-auth-visual relative hidden overflow-hidden p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="app-auth-pattern absolute inset-0" />
        <div className="relative flex items-center gap-3">
          <div className="rounded-md bg-white p-2 shadow-sm">
            <img src={logoPath} alt="Thinking Spree" className="h-10 w-auto" />
          </div>
          <div>
            <div className="font-serif text-2xl">Thinking Spree</div>
            <div className="text-xs uppercase tracking-[0.22em] text-white/55">Consultant Suite</div>
          </div>
        </div>

        <div className="relative max-w-xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-white/80">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--gold)" }} />
            Sprint workflow automation
          </div>
          <h1 className="font-serif text-5xl leading-tight">A calmer command center for every sprint.</h1>
          <p className="mt-4 max-w-lg text-sm leading-6 text-white/68">
            Sync companies, schedule work, generate outreach, and keep outcomes moving from one focused workspace.
          </p>
          <div className="mt-8 grid max-w-lg grid-cols-3 gap-3">
            {[
              { icon: CalendarClock, label: "Calendar aware" },
              { icon: Files, label: "Sheet driven" },
              { icon: ShieldCheck, label: "Team gated" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="rounded-md border border-white/10 bg-white/[0.07] p-3">
                <Icon className="h-4 w-4 text-white/75" />
                <div className="mt-3 text-xs font-medium text-white/80">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative text-xs text-white/45">Internal workspace access only</div>
      </section>

      <section className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-md">
          <div className="app-card rounded-xl bg-card p-7 sm:p-8">
            <div className="mb-7 text-center lg:hidden">
              <div className="mx-auto inline-flex rounded-md bg-white p-2 shadow-sm ring-1 ring-border">
                <img src={logoPath} alt="Thinking Spree" className="h-10 w-auto" />
              </div>
              <h1 className="mt-4 font-serif text-3xl text-foreground">Thinking Spree</h1>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Consultant Suite</p>
            </div>

            <div className="mb-6">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Welcome back</div>
              <h2 className="mt-2 font-serif text-3xl text-foreground">Sign in to continue</h2>
              <p className="mt-1 text-sm text-muted-foreground">Use your Thinking Spree workspace account.</p>
            </div>

            <button
              type="button"
              onClick={handleGoogle}
              disabled={googleLoading}
              className="flex w-full items-center justify-center gap-3 rounded-md border border-border bg-white px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
            >
              {googleLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                  <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
                  <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853" />
                  <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
                  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335" />
                </svg>
              )}
              <span>{googleLoading ? "Redirecting..." : "Continue with Google"}</span>
            </button>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">or with email</span>
              <div className="h-px flex-1 bg-border" />
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
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@thinkingspree.com"
                    required
                    className="app-input w-full rounded-md border py-2.5 pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
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
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    className="app-input w-full rounded-md border py-2.5 pl-9 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground transition hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <button
                data-testid="button-submit"
                type="submit"
                disabled={loading}
                className="app-button-primary mt-2 w-full rounded-md px-4 py-2.5 text-sm font-semibold text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Signing in..." : "Sign in with password"}
              </button>
            </form>

            <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
              Access restricted to @thinkingspree.com accounts. New here?{" "}
              <Link href="/signup" className="font-medium text-primary hover:underline">
                Create an account
              </Link>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
