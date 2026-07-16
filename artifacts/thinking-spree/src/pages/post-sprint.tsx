import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import InspirationTab from "./InspirationTab";
import { Compass, BarChart3, FileEdit, TrendingUp, Building2, Activity } from "lucide-react";

/**
 * Post-Sprint.
 *
 * Primary content is the Inspiration Research workbench, relocated from the
 * old standalone Research tab (per the latest brief). The other post-sprint
 * pages — Summaries, Builder, Growth Report, Companies, Sprint Tracking —
 * remain first-class and are reachable from the quick-links row so a
 * Pre-Sprint company still shows up in Companies / Sprint Tracking.
 */
const LINKS = [
  { href: "/summary", label: "Summaries", icon: BarChart3 },
  { href: "/builder", label: "Builder", icon: FileEdit },
  { href: "/reports/outcomes", label: "Growth Report", icon: TrendingUp },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/sprint-tracking", label: "Sprint Tracking", icon: Activity },
];

export default function PostSprintPage() {
  return (
    <Layout>
      <div className="p-6 lg:p-8">
        <div className="mb-6">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Sprint lifecycle · Step 2
          </div>
          <h1 className="font-serif text-4xl leading-tight text-foreground">Post-Sprint</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Compass size={15} style={{ color: "var(--gold)" }} />
            Inspiration Research — grounded, sourced comparables and playbooks.
          </p>
        </div>

        {/* quick-links to the operational post-sprint pages */}
        <div className="mb-6 flex flex-wrap gap-2">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}>
              <a className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:border-foreground/20">
                <Icon size={14} className="text-muted-foreground" />
                {label}
              </a>
            </Link>
          ))}
        </div>

        <InspirationTab />
      </div>
    </Layout>
  );
}
