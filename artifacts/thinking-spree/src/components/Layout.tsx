import { Link, useLocation } from "wouter";
import { useLogout, useGetMe } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  LayoutDashboard, Rocket, Flag, Users, Shield, Compass, Mail, Radar,
  LogOut, Menu, X, Bell, CircleHelp, ChevronDown,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import logoPath from "@assets/thinkingspree_logo_1778683092464.jpg";
import { GlobalSearch } from "./GlobalSearch";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Top-level IA is the sprint LIFECYCLE. Everything is either before a sprint
 * or after it. Post-Sprint, Sales and Admin own their sub-pages via in-page
 * tabs (see each page), so the sidebar stays a flat, fast 5-item list.
 *
 *   Dashboard
 *   Pre-Sprint                     → /pre-sprint
 *   Post-Sprint  (Summaries · Builder · Growth Report · Companies · Tracking)
 *   Sales        (Leads · LinkedIn · Proposals)
 *   Admin        (Import · Roles · Team · Reset)
 */
type Leaf = {
  href: string;
  label: string;
  icon?: React.ElementType;
  badge?: string;
  disabled?: boolean;          // shown but not navigable (e.g. under maintenance)
  match?: string[];            // extra path prefixes that keep it highlighted
};
type NavEntry =
  | { kind: "leaf"; adminOnly?: boolean; needsSales?: boolean } & Leaf
  | { kind: "group"; label: string; icon: React.ElementType; children: Leaf[]; adminOnly?: boolean; needsSales?: boolean };

// Nested IA: top topics with sub-pages tucked inside collapsible groups.
const navTree: NavEntry[] = [
  { kind: "leaf", href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  {
    kind: "group", label: "Sprint", icon: Rocket, children: [
      { href: "/pre-sprint", label: "Pre-Sprint" },
      { href: "/emails", label: "Emails", icon: Mail },
      { href: "/post-sprint", label: "Post-Sprint", match: ["/summary", "/builder", "/reports/outcomes", "/sprint-tracking"] },
    ],
  },
  {
    kind: "group", label: "Research", icon: Compass, children: [
      { href: "/research", label: "Inspiration Journey" },
      { href: "/competitive-mapping", label: "Competitive Mapping", icon: Radar },
    ],
  },
  {
    kind: "group", label: "Sales", icon: Users, needsSales: true, children: [
      { href: "/sales", label: "Retargeting", match: ["/sales"] },
      { href: "/cold-outreach", label: "Cold Outreach", disabled: true, badge: "Soon" },
    ],
  },
  { kind: "leaf", href: "/admin", label: "Admin", icon: Shield, adminOnly: true, match: ["/admin/"] },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const queryClient = useQueryClient();
  const logoutMutation = useLogout();
  const { data: user } = useGetMe();
  const { data: perms } = useQuery<{
    role: string;
    canAccessResearch: boolean;
    canAccessSales: boolean;
    canAccessInboxCrm: boolean;
    canManageRoles: boolean;
  }>({
    queryKey: ["/api/me/permissions", (user as any)?.id],
    queryFn: () => customFetch(`${BASE}/api/me/permissions`, { credentials: "include" }),
    enabled: !!user,
    staleTime: 60_000,
  });

  function handleLogout() {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear();
        window.location.href = "/login";
      },
    });
  }

  const initials = (user?.name ?? "U")
    .split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
  const displayRole = String((user as any)?.role ?? "Consultant").replace(/_/g, " ");

  const Sidebar = ({ mobile = false }) => {
    const isAdmin = perms?.role === "admin" || (user as any)?.isAdmin;
    const canSales = perms?.canAccessSales ?? false;
    const canInboxCrm = perms?.canAccessInboxCrm ?? false;
    void canInboxCrm;
    const gate = (e: { adminOnly?: boolean; needsSales?: boolean }) =>
      (!e.adminOnly || isAdmin) && (!e.needsSales || canSales);
    const visible = navTree.filter(gate);

    const pathActive = (l: { href: string; match?: string[] }) => {
      if (location === l.href) return true;
      if (l.href !== "/dashboard" && location.startsWith(l.href)) return true;
      return (l.match ?? []).some((m) => location === m || location.startsWith(m));
    };

    const renderLeaf = (l: Leaf, nested: boolean) => {
      const active = !l.disabled && pathActive(l);
      const Icon = l.icon;
      const inner = (
        <a
          onClick={() => !l.disabled && setMobileOpen(false)}
          className={cn(
            "group flex items-center gap-3 rounded-md text-sm font-medium transition-all duration-150",
            nested ? "py-2 pl-3 pr-3" : "px-3 py-2.5",
            l.disabled
              ? "cursor-not-allowed text-sidebar-foreground/35"
              : active
                ? "bg-white/[0.11] text-white shadow-sm ring-1 ring-white/10"
                : "text-sidebar-foreground/72 hover:bg-white/[0.07] hover:text-white",
          )}
        >
          {Icon ? (
            <span className={cn("flex h-7 w-7 items-center justify-center rounded-md transition-colors", active ? "bg-white/10 text-white" : "bg-white/[0.04] text-sidebar-foreground/65 group-hover:text-white")}>
              <Icon size={15} />
            </span>
          ) : (
            <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: active ? "var(--gold)" : "rgba(255,255,255,0.28)" }} />
          )}
          <span className="flex-1 truncate">{l.label}</span>
          {l.badge && (
            <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: "var(--gold)", color: "hsl(222 38% 15%)" }}>{l.badge}</span>
          )}
          {active && !l.badge && <span className="ml-auto h-1.5 w-1.5 rounded-full" style={{ background: "var(--gold)" }} />}
        </a>
      );
      if (l.disabled) return <div key={l.href} title="Under maintenance — coming soon">{inner}</div>;
      return <Link key={l.href} href={l.href}>{inner}</Link>;
    };

    return (
      <div
        className={cn(
          "app-sidebar flex h-full flex-col text-sidebar-foreground",
          mobile ? "w-full" : "fixed bottom-0 left-0 top-0 z-30 w-[264px]",
        )}
      >
        <div className="border-b border-white/10 px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-white p-2 shadow-sm ring-1 ring-white/10">
              <img src={logoPath} alt="Thinking Spree" className="h-10 w-auto" />
            </div>
            <div className="min-w-0 leading-tight">
              <div className="truncate font-serif text-xl text-white">Thinking Spree</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-sidebar-foreground/60">
                Consultant Suite
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
          <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-sidebar-foreground/45">
            Workspace
          </div>
          {visible.map((e) => {
            if (e.kind === "leaf") return renderLeaf(e, false);
            const GIcon = e.icon;
            const anyChildActive = e.children.some((c) => !c.disabled && pathActive(c));
            const open = (openGroups[e.label] ?? true) || anyChildActive;
            return (
              <div key={e.label}>
                <button
                  onClick={() => setOpenGroups((s) => ({ ...s, [e.label]: !(s[e.label] ?? true) }))}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                    anyChildActive ? "text-white" : "text-sidebar-foreground/72 hover:bg-white/[0.07] hover:text-white",
                  )}
                >
                  <span className={cn("flex h-7 w-7 items-center justify-center rounded-md transition-colors", anyChildActive ? "bg-white/10 text-white" : "bg-white/[0.04] text-sidebar-foreground/65 group-hover:text-white")}>
                    <GIcon size={15} />
                  </span>
                  <span className="flex-1 truncate text-left">{e.label}</span>
                  <ChevronDown size={14} className={cn("shrink-0 transition-transform", open ? "" : "-rotate-90")} />
                </button>
                {open && (
                  <div className="mb-1 mt-0.5 space-y-0.5 border-l border-white/10 pl-3">
                    {e.children.map((c) => renderLeaf(c, true))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.06] px-3 py-2.5">
            {(user as any)?.avatarUrl ? (
              <img src={(user as any).avatarUrl} alt={user?.name ?? "Profile photo"} className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/20" />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-serif text-sm" style={{ background: "var(--gold)", color: "hsl(222 38% 15%)" }}>
                {initials || "U"}
              </div>
            )}
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium text-white">{user?.name ?? "Consultant"}</p>
              <p className="truncate text-[11px] capitalize text-sidebar-foreground/60">{displayRole}</p>
            </div>
            <button onClick={handleLogout} title="Sign out" aria-label="Sign out" className="rounded-md p-1.5 text-sidebar-foreground/60 transition-colors hover:bg-white/10 hover:text-white">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="app-surface min-h-screen">
      <div className="hidden md:block">
        <Sidebar />
      </div>

      <div className="app-sidebar sticky top-0 z-40 flex items-center justify-between border-b border-white/10 px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-white p-1.5">
            <img src={logoPath} alt="Thinking Spree" className="h-6 w-auto" />
          </div>
          <div className="font-serif text-lg text-white">Thinking Spree</div>
        </div>
        <button onClick={() => setMobileOpen(!mobileOpen)} className="rounded-md p-2 text-sidebar-foreground hover:bg-white/10" aria-label={mobileOpen ? "Close menu" : "Open menu"}>
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setMobileOpen(false)}>
          <div className="h-full w-72" onClick={(e) => e.stopPropagation()}>
            <Sidebar mobile />
          </div>
        </div>
      )}

      <main className="min-h-screen md:ml-[264px]">
        <div className="app-topbar sticky top-0 z-20 hidden items-center gap-4 px-6 py-3 backdrop-blur md:flex lg:px-10">
          <div className="min-w-0 flex-1">
            <GlobalSearch />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" title="Help" aria-label="Help" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-foreground">
              <CircleHelp size={16} />
            </button>
            <button type="button" title="Notifications" aria-label="Notifications" className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-foreground">
              <Bell size={16} />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full" style={{ background: "var(--gold)" }} />
            </button>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
