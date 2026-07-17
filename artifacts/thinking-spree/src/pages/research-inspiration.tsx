import { Layout } from "@/components/Layout";
import InspirationTab from "./InspirationTab";
import { Compass } from "lucide-react";

/**
 * Research (between Pre-Sprint and Post-Sprint) — the Inspiration Research
 * workbench: grounded, sourced comparables and growth playbooks.
 */
export default function InspirationResearchPage() {
  return (
    <Layout>
      <div className="p-6 lg:p-8">
        <div className="mb-6">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Sprint lifecycle · between prep & delivery
          </div>
          <h1 className="font-serif text-4xl leading-tight text-foreground">Research</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Compass size={15} style={{ color: "var(--gold)" }} />
            Inspiration Research — real comparables, quantified playbooks, sourced.
          </p>
        </div>
        <InspirationTab />
      </div>
    </Layout>
  );
}
