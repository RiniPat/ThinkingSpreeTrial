import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import { Linkedin, Sparkles, Copy, Loader2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Output = {
  connectionRequest: string;
  firstMessage: string;
  subjectLineIfEmail: string;
};

export default function LinkedInOutreachPage() {
  const { toast } = useToast();
  const [form, setForm] = useState({
    prospectName: "", prospectRole: "", prospectCompany: "",
    reasonForReach: "", mutualConnection: "", tone: "warm" as "warm" | "formal" | "playful",
  });
  const [output, setOutput] = useState<Output | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/sales/linkedin-outreach`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Generation failed");
      return (await res.json()) as Output;
    },
    onSuccess: (o) => setOutput(o),
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copied` });
  }

  const canGenerate = !!(form.prospectName.trim() && form.prospectRole.trim() && form.prospectCompany.trim() && form.reasonForReach.trim());

  return (
    <Layout>
      <main className="flex-1 space-y-6 px-6 py-8 lg:px-10 max-w-[1400px] mx-auto">
        <section>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Workspace</div>
          <h1 className="mt-2 font-serif text-4xl text-foreground">LinkedIn Outreach</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI-drafted connection request + first message for cold LinkedIn outreach.
          </p>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Inputs */}
          <section className="rounded-xl border border-border bg-card p-5 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="rounded-md bg-blue-50 p-2 text-blue-700"><Linkedin className="h-4 w-4" /></div>
              <h2 className="font-serif text-xl text-foreground">Prospect Details</h2>
            </div>
            {[
              { name: "prospectName",    label: "Prospect Name",      req: true,  placeholder: "e.g. Anjali Sharma" },
              { name: "prospectRole",    label: "Their Role",         req: true,  placeholder: "e.g. VP Growth" },
              { name: "prospectCompany", label: "Their Company",      req: true,  placeholder: "e.g. Acme Tech" },
              { name: "mutualConnection",label: "Mutual Connection",  req: false, placeholder: "Optional — names a shared contact" },
            ].map(f => (
              <div key={f.name}>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {f.label}{f.req && <span className="text-destructive ml-0.5">*</span>}
                </label>
                <input
                  type="text"
                  value={(form as any)[f.name]}
                  onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                  placeholder={f.placeholder}
                  className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring"
                />
              </div>
            ))}
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Reason for Reach Out<span className="text-destructive ml-0.5">*</span>
              </label>
              <textarea
                value={form.reasonForReach}
                onChange={(e) => setForm({ ...form, reasonForReach: e.target.value })}
                rows={4}
                placeholder="What's the angle? E.g. 'They just announced a Series B; we offer growth consulting for Series A/B startups.'"
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Tone</label>
              <select
                value={form.tone}
                onChange={(e) => setForm({ ...form, tone: e.target.value as any })}
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm"
              >
                <option value="warm">Warm</option>
                <option value="formal">Formal</option>
                <option value="playful">Playful</option>
              </select>
            </div>
            <button
              onClick={() => mut.mutate()}
              disabled={!canGenerate || mut.isPending}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {mut.isPending ? "Drafting…" : "Generate Outreach"}
            </button>
          </section>

          {/* Output */}
          <section className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h2 className="font-serif text-xl text-foreground">Drafts</h2>
            {!output ? (
              <p className="text-sm text-muted-foreground py-12 text-center">
                Fill the form and click Generate to draft connection messages.
              </p>
            ) : (
              <>
                <DraftBlock label="Connection Request" subtitle={`${output.connectionRequest.length} chars (LinkedIn limit: 300)`} text={output.connectionRequest} onCopy={() => copy(output.connectionRequest, "Connection request")} />
                <DraftBlock label="First Message (after they accept)" text={output.firstMessage} onCopy={() => copy(output.firstMessage, "First message")} multiline />
                <DraftBlock label="Email Subject (if reaching out by email)" text={output.subjectLineIfEmail} onCopy={() => copy(output.subjectLineIfEmail, "Subject")} />
              </>
            )}
          </section>
        </div>

        <footer className="pt-2 text-center text-xs text-muted-foreground">Thinking Spree · Consultant Suite v5.0</footer>
      </main>
    </Layout>
  );
}

function DraftBlock({ label, subtitle, text, onCopy, multiline }: {
  label: string; subtitle?: string; text: string; onCopy: () => void; multiline?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border p-3 bg-background/60">
      <div className="flex items-center justify-between mb-1.5">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
          {subtitle && <div className="text-[10px] text-muted-foreground">{subtitle}</div>}
        </div>
        <button onClick={onCopy} className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
          <Copy className="h-3 w-3" /> Copy
        </button>
      </div>
      <p className={"text-sm text-foreground leading-relaxed " + (multiline ? "whitespace-pre-wrap" : "")}>
        {text}
      </p>
    </div>
  );
}
