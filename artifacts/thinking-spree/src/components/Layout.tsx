import { Link, useLocation } from "wouter";
import { useLogout, useGetMe } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  LayoutDashboard,
  Briefcase,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
  Activity,
  Upload,
  Sparkles,
  Linkedin,
  FileText,
  FileEdit,
  Users,
  Shield,
  TrendingUp,
  Bell,
  CircleHelp,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import logoPath from "@assets/thinkingspree_logo_1778683092464.jpg";
import { GlobalSearch } from "./GlobalSearch";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  adminOnly?: boolean;
  needsResearch?: boolean;
  needsSales?: boolean;
  group?: string;
};

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Workspace" },
  { href: "/companies", label: "Companies", icon: Briefcase },
  { href: "/summary", label: "Summary Sheet", icon: BarChart3 },
  { href: "/builder", label: "Builder", icon: FileEdit, needsResearch: true },
  { href: "/sprint-tracking", label: "Sprint Tracking", icon: Activity },
  { href: "/reports/outcomes", label: "Outcomes Report", icon: TrendingUp, needsResearch: true },
  { href: "/research", label: "Research", icon: Sparkles, needsResearch: true, group: "Research" },
  { href: "/sales/leads", label: "Sales Leads", icon: Users, needsSales: true, group: "Sales" },
  { href: "/sales/linkedin", label: "LinkedIn Outreach", icon: Linkedin, needsSales: true },
  { href: "/sales/proposals", label: "Proposals", icon: FileText, needsSales: true },
  { href: "/admin/import", label: "Import Data", icon: Upload, adminOnly: true, group: "Admin" },
  { href: "/admin/roles", label: "User Roles", icon: Shield, adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, group: "" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const queryClient = useQueryClient();
  const logoutMutation = useLogout();
  const { data: user } = useGetMe();
  const { data: perms } = useQuery<{
    role: string;
    canAccessResearch: boolean;
    canAccessSales: boolean;
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
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
  const displayRole = String((user as any)?.role ?? "Consultant").replace(/_/g, " ");

  const Sidebar = ({ mobile = false }) => {
    const isAdmin = perms?.role === "admin" || (user as any)?.isAdmin;
    const canResearch = perms?.canAccessResearch ?? false;
    const canSales = perms?.canAccessSales ?? false;
    const visible = navItems.filter((item) => {
      if (item.adminOnly && !isAdmin) return false;
      if (item.needsResearch && !canResearch) return false;
      if (item.needsSales && !canSales) return false;
      return true;
    });

    let lastGroup: string | undefined = undefined;

    return (
      <div
        className={cn(
          "app-sidebar flex h-full flex-col text-sidebar-foreground",
          mobile ? "w-full" : "fixed bottom-0 left-0 top-0 z-30 w-[280px]",
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

          <div className="mt-4 grid grid-cols-3 gap-2 rounded-md border border-white/10 bg-white/[0.04] p-2 text-center">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/45">Role</div>
              <div className="truncate text-xs font-medium capitalize text-white">{displayRole}</div>
            </div>
            <div className="border-x border-white/10">
              <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/45">Mode</div>
              <div className="text-xs font-medium text-white">Live</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/45">Sync</div>
              <div className="text-xs font-medium text-white">On</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
          {visible.map((item, i) => {
            const { href, label, icon: Icon, group } = item;
            const active = location === href || (href !== "/dashboard" && location.startsWith(href));
            const showHeader = group !== undefined && group !== lastGroup;
            if (group !== undefined) lastGroup = group;

            return (
              <div key={href}>
                {showHeader && group && (
                  <div
                    className={cn(
                      "px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-sidebar-foreground/45",
                      i > 0 && "pt-3",
                    )}
                  >
                    {group}
                  </div>
                )}
                <Link href={href}>
                  <a
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-150",
                      active
                        ? "bg-white/[0.11] text-white shadow-sm ring-1 ring-white/10"
                        : "text-sidebar-foreground/72 hover:bg-white/[0.07] hover:text-white",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                        active
                          ? "bg-white/10 text-white"
                          : "bg-white/[0.04] text-sidebar-foreground/65 group-hover:text-white",
                      )}
                    >
                      <Icon size={15} />
                    </span>
                    <span className="truncate">{label}</span>
                    {active && (
                      <span
                        className="ml-auto h-1.5 w-1.5 rounded-full"
                        style={{ background: "var(--gold)" }}
                      />
                    )}
                  </a>
                </Link>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.06] px-3 py-2.5">
            {(user as any)?.avatarUrl ? (
              <img
                src={(user as any).avatarUrl}
                alt={user?.name ?? "Profile photo"}
                className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/20"
              />
            ) : (
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-serif text-sm"
                style={{ background: "var(--gold)", color: "hsl(222 38% 15%)" }}
              >
                {initials || "U"}
              </div>
            )}
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium text-white">{user?.name ?? "Consultant"}</p>
              <p className="truncate text-[11px] capitalize text-sidebar-foreground/60">{displayRole}</p>
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              aria-label="Sign out"
              className="rounded-md p-1.5 text-sidebar-foreground/60 transition-colors hover:bg-white/10 hover:text-white"
            >
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
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="rounded-md p-2 text-sidebar-foreground hover:bg-white/10"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
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

      <main className="min-h-screen md:ml-[280px]">
        <div className="app-topbar sticky top-0 z-20 hidden items-center gap-4 px-6 py-3 backdrop-blur md:flex lg:px-10">
          <div className="min-w-0 flex-1">
            <GlobalSearch />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              title="Help"
              aria-label="Help"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
            >
              <CircleHelp size={16} />
            </button>
            <button
              type="button"
              title="Notifications"
              aria-label="Notifications"
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
            >
              <Bell size={16} />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full" style={{ background: "var(--gold)" }} />
            </button>
            <div className="ml-2 hidden items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 lg:flex">
              <span className="h-2 w-2 rounded-full" style={{ background: "var(--success)" }} />
              <span className="text-xs font-medium text-foreground">Workspace healthy</span>
            </div>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
