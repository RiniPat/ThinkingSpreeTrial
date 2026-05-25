import { Link, useLocation } from "wouter";
import { useLogout, useGetMe } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Briefcase,
  Zap,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
  Activity,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import logoPath from "@assets/thinkingspree_logo_1778683092464.jpg";

type NavItem = { href: string; label: string; icon: any; adminOnly?: boolean };

const navItems: NavItem[] = [
  { href: "/dashboard",       label: "Dashboard",       icon: LayoutDashboard },
  { href: "/ventures",        label: "Ventures",        icon: Briefcase },
  { href: "/sprints",         label: "T-Sprints",       icon: Zap },
  { href: "/summary",         label: "Summary Sheet",   icon: BarChart3 },
  { href: "/sprint-tracking", label: "Sprint Tracking", icon: Activity },
  { href: "/admin/import",    label: "Import Data",     icon: Upload, adminOnly: true },
  { href: "/settings",        label: "Settings",        icon: Settings },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const queryClient = useQueryClient();
  const logoutMutation = useLogout();
  const { data: user } = useGetMe();

  function handleLogout() {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear();
        window.location.href = "/login";
      },
    });
  }

  // Initials from the user's name — drives the gold avatar disc.
  const initials = (user?.name ?? "U")
    .split(/\s+/)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase())
    .join("");

  const Sidebar = ({ mobile = false }) => (
    <div className={cn(
      "flex flex-col h-full bg-sidebar text-sidebar-foreground",
      mobile ? "w-full" : "w-64 fixed top-0 left-0 bottom-0 z-30"
    )}>
      {/* Brand — logo gets a white card so the dark-on-dark logo stays readable
          on the navy sidebar (no .invert needed anymore). */}
      <div className="flex flex-col items-start gap-3 border-b border-sidebar-border px-6 py-6">
        <div className="rounded-md bg-white p-2.5 shadow-sm">
          <img src={logoPath} alt="Thinking Spree" className="h-10 w-auto" />
        </div>
        <div className="leading-tight">
          <div className="font-serif text-lg text-white">Thinking Spree</div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-sidebar-foreground/60">
            Consultant Suite
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-5 space-y-0.5 overflow-y-auto">
        <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-sidebar-foreground/40">
          Workspace
        </div>
        {navItems
          .filter(item => !item.adminOnly || (user as any)?.isAdmin)
          .map(({ href, label, icon: Icon }) => {
          const active = location === href || (href !== "/dashboard" && location.startsWith(href));
          return (
            <Link key={href} href={href}>
              <a
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors duration-150",
                  active
                    ? "bg-sidebar-accent text-white"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-white"
                )}
              >
                <Icon size={16} />
                <span>{label}</span>
                {active && (
                  <span
                    className="ml-auto h-1.5 w-1.5 rounded-full"
                    style={{ background: "var(--gold)" }}
                  />
                )}
              </a>
            </Link>
          );
        })}
      </nav>

      {/* User card — gold avatar disc + sign-out icon. */}
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 rounded-md bg-sidebar-accent/50 px-3 py-2.5">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full font-serif text-sm shrink-0"
            style={{ background: "var(--gold)", color: "hsl(222 38% 15%)" }}
          >
            {initials || "U"}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-sm font-medium truncate text-white">{user?.name ?? "Consultant"}</p>
            <p className="text-[11px] truncate text-sidebar-foreground/60">{user?.role ?? "Consultant"}</p>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            aria-label="Sign out"
            className="rounded-md p-1.5 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-white"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* Mobile top bar — logo in white card so it stays legible on navy. */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 bg-sidebar border-b border-sidebar-border sticky top-0 z-40">
        <div className="rounded-md bg-white p-1.5">
          <img src={logoPath} alt="Thinking Spree" className="h-6 w-auto" />
        </div>
        <button onClick={() => setMobileOpen(!mobileOpen)} className="text-sidebar-foreground">
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-30 bg-black/60" onClick={() => setMobileOpen(false)}>
          <div className="w-72 h-full" onClick={e => e.stopPropagation()}>
            <Sidebar mobile />
          </div>
        </div>
      )}

      <main className="md:ml-64 min-h-screen">
        {children}
      </main>
    </div>
  );
}
