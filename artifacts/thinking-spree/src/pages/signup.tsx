import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { signupRequest } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Lock, Mail, User, CheckCircle2 } from "lucide-react";
import logoPath from "@assets/thinkingspree_logo_1778683092464.jpg";

export default function SignupPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await signupRequest(email, password, name);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      toast({ title: "Account created", description: "Welcome to Thinking Spree." });
      setLocation("/dashboard");
    } catch (err: unknown) {
      toast({
        title: "Signup failed",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[0.95fr_1.05fr]">
      <section className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-md">
          <div className="app-card rounded-xl bg-card p-7 sm:p-8">
            <div className="mb-7">
              <div className="inline-flex rounded-md bg-white p-2 shadow-sm ring-1 ring-border">
                <img src={logoPath} alt="Thinking Spree" className="h-10 w-auto" />
              </div>
              <div className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Team access
              </div>
              <h1 className="mt-2 font-serif text-3xl text-foreground">Create your account</h1>
              <p className="mt-1 text-sm text-muted-foreground">Use your Thinking Spree work email.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="name" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Full Name
                </label>
                <div className="relative">
                  <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    required
                    className="app-input w-full rounded-md border py-2.5 pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
                <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                  Must match how you appear in summary sheets, for example "Vani Agarwal".
                </p>
              </div>

              <div>
                <label htmlFor="email" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Work Email
                </label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="email"
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
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    required
                    minLength={8}
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
                type="submit"
                disabled={loading}
                className="app-button-primary w-full rounded-md px-4 py-2.5 text-sm font-semibold text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Creating..." : "Create account"}
              </button>
            </form>

            <p className="mt-6 text-center text-xs text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </section>

      <section className="app-auth-visual relative hidden overflow-hidden p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="app-auth-pattern absolute inset-0" />
        <div className="relative">
          <div className="font-serif text-3xl">Thinking Spree</div>
          <div className="mt-1 text-xs uppercase tracking-[0.22em] text-white/55">Consultant Suite</div>
        </div>
        <div className="relative max-w-xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-white/80">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Setup takes less than a minute
          </div>
          <h2 className="font-serif text-5xl leading-tight">Join the sprint workspace with the right context from day one.</h2>
          <div className="mt-8 grid max-w-lg gap-3">
            {["Google Sheets imports stay unchanged.", "Calendar and email workflows continue through the same APIs.", "Roles decide what each teammate sees."].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.07] px-4 py-3 text-sm text-white/75">
                <span className="h-2 w-2 rounded-full" style={{ background: "var(--gold)" }} />
                {item}
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-xs text-white/45">Internal workspace access only</div>
      </section>
    </div>
  );
}
