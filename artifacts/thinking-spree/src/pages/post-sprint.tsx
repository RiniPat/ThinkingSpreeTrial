import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { BarChart3, FileEdit, TrendingUp, Building2, Activity, ArrowRight } from "lucide-react";

/**
 * Post-Sprint — everything after the sprint session. Inspiration Research now
 * lives under its own "Research" tab, so Post-Sprint is the operational home:
 * Summaries, Builder, Growth Report, Companies, Sprint Tracking.
 */
const CARDS = [
  { href: "/summary", label: "Summaries", icon: BarChart3, desc: "Client summary sheets — auto-updated as sprints complete." },
  { href: "/builder", label: "Builder", icon: FileEdit, desc: "Assemble the client-facing deliverable from sprint data." },
  { href: "/reports/outcomes", label: "Growth Report", icon: TrendingUp, desc: "AI-drafted growth narrative + metrics, export-ready." },
  { href: "/companies", label: "Companies", icon: Building2, desc: "Master list — every company, at every lifecycle stage." },
  { href: "/sprint-tracking", label: "Sprint Tracking", icon: Activity, desc: "Live workflow board; new companies land here automatically." },
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
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Summaries, builder, growth reports, companies and tracking — one home.
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
      </div>
    </Layout>
  );
}
