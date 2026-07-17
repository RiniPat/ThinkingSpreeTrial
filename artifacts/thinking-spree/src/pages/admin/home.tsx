import { Link, Redirect } from "wouter";
import { Layout } from "@/components/Layout";
import { useGetMe } from "@workspace/api-client-react";
import {
  ShieldCheck, Users, SlidersHorizontal, Database, ArrowRight,
} from "lucide-react";

/**
 * Admin home. The old default landing was /admin/import, which dropped the
 * consultant straight onto a noisy import screen. Admin now opens on the three
 * things admins actually manage — Roles, Team and Settings — with data import
 * kept reachable as a secondary utility rather than the front door.
 */
const CARDS = [
  { href: "/admin/roles", label: "Roles", icon: ShieldCheck, desc: "Grant or revoke access — who can see Sales, Research and Admin." },
  { href: "/admin/team", label: "Team", icon: Users, desc: "The 10-consultant roster — invites, names and current roles." },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal, desc: "Workspace preferences, Google connection and account controls." },
];

export default function AdminHomePage() {
  const { data: user, isLoading } = useGetMe();
  if (isLoading) return <Layout><div className="p-6">Loading…</div></Layout>;
  if (!(user as any)?.isAdmin) return <Redirect to="/dashboard" />;

  return (
    <Layout>
      <div className="p-6 lg:p-8">
        <div className="mb-6">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Administration
          </div>
          <h1 className="font-serif text-4xl leading-tight text-foreground">Admin</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Manage roles, your team and workspace settings.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {CARDS.map(({ href, label, icon: Icon, desc }) => (
            <Link key={href} href={href}>
              <a className="group flex flex-col rounded-xl border border-border bg-card p-5 transition-all hover:border-foreground/20 hover:shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: "hsl(36 65% 94%)" }}>
                    <Icon size={20} style={{ color: "hsl(30 55% 40%)" }} />
                  </div>
                  <ArrowRight size={16} className="text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <div className="mt-3 font-serif text-xl text-foreground">{label}</div>
                <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
              </a>
            </Link>
          ))}
        </div>

        {/* Data import is a rare, deliberate action — kept reachable but out of
            the way so Admin no longer opens on a wall of imported rows. */}
        <div className="mt-6 flex flex-col gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card">
              <Database size={16} className="text-muted-foreground" />
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">Data import</div>
              <p className="text-xs text-muted-foreground">Bring in summary or tracking sheets. Rarely needed day-to-day.</p>
            </div>
          </div>
          <Link href="/admin/import">
            <a className="inline-flex items-center gap-1.5 self-start rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:border-foreground/20">
              Open import <ArrowRight size={13} />
            </a>
          </Link>
        </div>
      </div>
    </Layout>
  );
}
