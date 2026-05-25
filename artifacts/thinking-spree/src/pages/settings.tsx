import { useEffect, useState } from "react";
import { useGetMe, customFetch } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import {
  Settings, User, Mail, Shield, Calendar as CalendarIcon,
  HardDrive, FileSpreadsheet, CheckCircle2, XCircle, Loader2,
  Link2, ExternalLink, AlertCircle, RefreshCw, Unlink, Sparkles,
  Users, Upload,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type GoogleStatus = {
  configured: boolean;
  connected: boolean;
  googleEmail: string | null;
  scope: string | null;
  services: { calendar: boolean; gmail: boolean; drive: boolean; sheets: boolean };
  expiresAt: string | null;
};

type TestResults = {
  ranAt: string;
  results: Record<string, { ok: boolean; detail?: string; error?: string }>;
};

const SERVICE_META = {
  calendar: { label: "Google Calendar", icon: CalendarIcon, desc: "Pull today's schedule into the dashboard" },
  gmail:    { label: "Gmail",            icon: Mail,         desc: "Send pre & post sprint emails to founders" },
  drive:    { label: "Google Drive",     icon: HardDrive,    desc: "Attach session notes and resources" },
  sheets:   { label: "Google Sheets",    icon: FileSpreadsheet, desc: "Sync Summary Sheets two-way" },
} as const;

export default function SettingsPage() {
  const { data: user } = useGetMe();
  const { toast } = useToast();
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<TestResults | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  async function fetchStatus() {
    setStatusLoading(true);
    try {
      const data = await customFetch<GoogleStatus>(`${BASE}/api/google/status`, { credentials: "include" });
      setStatus(data);
    } catch (err: any) {
      toast({ title: "Couldn't load Google status", description: err?.message, variant: "destructive" });
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus();
    // Handle ?google=connected | ?google=error returned by the OAuth callback
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("google");
    if (flag === "connected") {
      toast({ title: "Google connected", description: "You can now run the connection test." });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (flag === "error") {
      toast({ title: "Connection failed", description: params.get("reason") ?? "Try again.", variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnect() {
    setConnecting(true);
    try {
      const { url } = await customFetch<{ url: string }>(`${BASE}/api/google/oauth/start`, { credentials: "include" });
      window.location.href = url;
    } catch (err: any) {
      toast({ title: "Couldn't start OAuth", description: err?.message ?? "Is Google OAuth configured?", variant: "destructive" });
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect from Google? You'll need to re-authorize to sync again.")) return;
    setDisconnecting(true);
    try {
      await customFetch(`${BASE}/api/google/disconnect`, { method: "POST", credentials: "include" });
      toast({ title: "Disconnected" });
      setTestResults(null);
      await fetchStatus();
    } catch (err: any) {
      toast({ title: "Failed to disconnect", description: err?.message, variant: "destructive" });
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResults(null);
    try {
      const data = await customFetch<TestResults>(`${BASE}/api/google/test`, { method: "POST", credentials: "include" });
      setTestResults(data);
      const failed = Object.entries(data.results).filter(([_, r]) => !r.ok);
      if (failed.length === 0) {
        toast({ title: "All services OK", description: "Your Google integrations are working." });
      } else {
        toast({
          title: `${failed.length} service(s) failed`,
          description: failed.map(([n]) => n).join(", "),
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({ title: "Test failed", description: err?.message, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Layout>
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Account, integrations, and workspace configuration</p>
        </div>

        <div className="space-y-4">
          {/* ─── Profile ─────────────────────────────────── */}
          <div className="bg-card border border-card-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <User size={16} className="text-primary" />
              <h2 className="font-semibold text-foreground">Profile</h2>
            </div>
            <div className="flex items-center gap-4 mb-5">
              <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-2xl font-bold">
                {user?.name?.charAt(0).toUpperCase() ?? "U"}
              </div>
              <div>
                <p data-testid="text-username" className="font-semibold text-foreground text-lg">{user?.name ?? "—"}</p>
                <p data-testid="text-role" className="text-sm text-muted-foreground capitalize">{user?.role ?? "Consultant"}</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-background rounded-lg border border-border">
                <Mail size={14} className="text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Work Email</p>
                  <p data-testid="text-email" className="text-sm text-foreground font-medium">{user?.email ?? "—"}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-background rounded-lg border border-border">
                <Shield size={14} className="text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Access Level</p>
                  <p className="text-sm text-foreground font-medium capitalize">{user?.role ?? "Consultant"}</p>
                </div>
              </div>
            </div>
          </div>

          {/* ─── Google Integrations ─────────────────────── */}
          <div className="bg-card border border-card-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Link2 size={16} className="text-primary" />
                <h2 className="font-semibold text-foreground">Google Integrations</h2>
              </div>
              {status?.connected && (
                <button onClick={fetchStatus} title="Refresh status"
                  className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition">
                  <RefreshCw size={13} className={statusLoading ? "animate-spin" : ""} />
                </button>
              )}
            </div>

            {/* OAuth-not-configured warning */}
            {status && !status.configured && (
              <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-2">
                <AlertCircle size={14} className="text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Google OAuth not configured</p>
                  <p className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-0.5">
                    Set <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">GOOGLE_CLIENT_ID</code>,
                    {" "}<code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">GOOGLE_CLIENT_SECRET</code>,
                    {" "}and <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">GOOGLE_REDIRECT_URI</code> environment variables on the server. See <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">GOOGLE_INTEGRATION_SETUP.md</code> in the repo.
                  </p>
                </div>
              </div>
            )}

            {/* Connection state */}
            {statusLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
                <Loader2 size={13} className="animate-spin" />Loading status…
              </div>
            ) : status?.connected ? (
              <div className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Connected to Google</p>
                    <p className="text-xs text-emerald-600/80 dark:text-emerald-400/80 truncate">{status.googleEmail ?? "—"}</p>
                  </div>
                </div>
                <button onClick={handleDisconnect} disabled={disconnecting}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 rounded-md transition disabled:opacity-50 flex-shrink-0">
                  {disconnecting ? <Loader2 size={11} className="animate-spin" /> : <Unlink size={11} />}
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="mb-4 p-4 bg-background rounded-lg border border-dashed border-border text-center">
                <Sparkles size={20} className="mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm font-medium text-foreground">Not connected to Google</p>
                <p className="text-xs text-muted-foreground mt-0.5 mb-3">Authorize Thinking Spree to access your Calendar, Gmail, Drive and Sheets.</p>
                <button onClick={handleConnect} disabled={!status?.configured || connecting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
                  {connecting ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                  {connecting ? "Redirecting…" : "Connect Google account"}
                </button>
                {!status?.configured && (
                  <p className="text-[11px] text-muted-foreground/70 mt-2">(Server-side OAuth not configured — see notice above)</p>
                )}
              </div>
            )}

            {/* Per-service grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-4">
              {Object.entries(SERVICE_META).map(([key, meta]) => {
                const enabled = status?.services[key as keyof typeof SERVICE_META] ?? false;
                const Icon = meta.icon;
                const testResult = testResults?.results[key];
                return (
                  <div key={key} className="p-3 bg-background rounded-lg border border-border">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0">
                        <Icon size={15} className={enabled ? "text-primary mt-0.5" : "text-muted-foreground/40 mt-0.5"} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">{meta.label}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{meta.desc}</p>
                        </div>
                      </div>
                      {enabled ? (
                        <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                      ) : (
                        <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">Off</span>
                      )}
                    </div>
                    {testResult && (
                      <div className={`mt-2 p-2 text-[11px] rounded ${
                        testResult.ok
                          ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                          : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
                      }`}>
                        {testResult.ok ? (
                          <span className="flex items-start gap-1"><CheckCircle2 size={10} className="mt-0.5 flex-shrink-0" />{testResult.detail}</span>
                        ) : (
                          <span className="flex items-start gap-1"><XCircle size={10} className="mt-0.5 flex-shrink-0" />{testResult.error}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Connection test */}
            {status?.connected && (
              <div className="flex items-center justify-between p-3 bg-background rounded-lg border border-border">
                <div>
                  <p className="text-sm font-medium text-foreground">Connection test</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {testResults
                      ? `Last run: ${new Date(testResults.ranAt).toLocaleString()}`
                      : "Verify that each scope works end-to-end."}
                  </p>
                </div>
                <button onClick={handleTest} disabled={testing}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:opacity-90 transition disabled:opacity-50">
                  {testing ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                  {testing ? "Running…" : "Run test"}
                </button>
              </div>
            )}
          </div>

          {/* ─── Admin tools (only visible if user is admin) ─── */}
          {(user as any)?.isAdmin && (
            <div className="bg-card border border-card-border rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Shield size={16} className="text-primary" />
                <h2 className="font-semibold text-foreground">Admin Tools</h2>
              </div>
              <div className="space-y-2">
                <a href="/admin/team"
                  className="flex items-center justify-between p-3 bg-background rounded-lg border border-border hover:border-primary/30 transition-colors group">
                  <div className="flex items-center gap-3">
                    <Users size={15} className="text-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Team Management</p>
                      <p className="text-xs text-muted-foreground">Promote consultants to admin or back</p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground group-hover:text-primary">→</span>
                </a>
                <a href="/admin/import"
                  className="flex items-center justify-between p-3 bg-background rounded-lg border border-border hover:border-primary/30 transition-colors group">
                  <div className="flex items-center gap-3">
                    <Upload size={15} className="text-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Import Data</p>
                      <p className="text-xs text-muted-foreground">Upload ISB / JU summary sheets or Sheet Tracking</p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground group-hover:text-primary">→</span>
                </a>
              </div>
            </div>
          )}

          {/* ─── Platform info ───────────────────────────── */}
          <div className="bg-card border border-card-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Settings size={16} className="text-primary" />
              <h2 className="font-semibold text-foreground">Platform</h2>
            </div>
            <div className="space-y-3 text-sm text-muted-foreground">
              <div className="flex justify-between items-center py-2 border-b border-border">
                <span>Email Domain Restriction</span>
                <span className="text-foreground font-medium">@thinkingspree.com</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-border">
                <span>Calendar Integration</span>
                <span className="text-foreground font-medium">
                  {status?.services.calendar ? "Google Calendar (live)" : "Sprint-based (fallback)"}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span>Email Delivery</span>
                <span className="text-foreground font-medium">
                  {status?.services.gmail ? "Gmail (live send)" : "Logged-only"}
                </span>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-border">
              <a href="https://github.com" target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                See setup guide <ExternalLink size={10} />
              </a>
              <span className="text-xs text-muted-foreground ml-2">— follow GOOGLE_INTEGRATION_SETUP.md in the repo.</span>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
