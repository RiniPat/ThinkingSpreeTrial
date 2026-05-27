import { useState } from "react";
import {
  useListIncubators, useGetIncubator, useCreateIncubator, useDeleteIncubator,
  getListIncubatorsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart3, Plus, Building2, Zap, CheckCircle, Clock, X,
  ChevronRight, ExternalLink, Users, FileText, Mail, ArrowLeft,
  TrendingUp, Activity, Trash2,
} from "lucide-react";

// ─── Add Incubator Modal ──────────────────────────────────────────────────────
function AddIncubatorModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createIncubator = useCreateIncubator();
  // Restricted to the two approved program types per product decision.
  const [form, setForm] = useState({ name: "", type: "isb", sheetUrl: "", description: "" });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createIncubator.mutate({ data: form }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListIncubatorsQueryKey() });
        toast({ title: "Incubator added" });
        onClose();
      },
      onError: () => toast({ title: "Error", variant: "destructive" }),
    });
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-card-border rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-start justify-between p-6 border-b border-border">
          <div>
            <h2 className="font-serif text-2xl text-foreground">Add Incubator</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Track a new program on the Summary page.</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground rounded-md p-1.5 hover:bg-muted transition-colors">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Name <span className="text-destructive">*</span>
            </label>
            <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. ISB Summary Sheet"
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring text-foreground transition" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Type <span className="text-destructive">*</span>
            </label>
            {/* Typeable combobox: pick from suggestions or type a new one.
                We use a <datalist> + plain <input> so existing form state
                handling keeps working — no extra deps needed. */}
            <input
              list="incubator-type-suggestions"
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              placeholder="e.g. ISB, JU, Wadhwani, Ashoka, or any new program"
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition"
            />
            <datalist id="incubator-type-suggestions">
              <option value="isb">ISB</option>
              <option value="ju">JU</option>
              <option value="wadhwani">Wadhwani</option>
              <option value="ashoka">Ashoka</option>
            </datalist>
            <p className="text-[11px] text-muted-foreground mt-1">
              Pick a suggestion or type any incubator name. Lowercase is recommended for consistency.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Sheet URL
            </label>
            <input value={form.sheetUrl} onChange={e => setForm(f => ({ ...f, sheetUrl: e.target.value }))}
              placeholder="https://docs.google.com/..."
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Description
            </label>
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Short description..."
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition" />
          </div>
          <div className="flex gap-3 pt-2 border-t border-border">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 mt-3 border border-border rounded-md text-sm font-medium text-foreground hover:bg-muted transition">Cancel</button>
            <button type="submit" disabled={createIncubator.isPending}
              className="flex-1 py-2 mt-3 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
              {createIncubator.isPending ? "Adding..." : "Add Incubator"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Venture Detail Modal ─────────────────────────────────────────────────────
type FullVenture = {
  id: number; name: string; companyName: string; email: string;
  contact?: string | null;
  sector?: string | null; industry?: string | null;
  stage?: string | null; description?: string | null;
  partnerName?: string | null;
  // Rich summary fields
  goalSetting?: string | null;
  revenueLast12Months?: string | null;
  revenueLastMonthMrr?: string | null;
  teamSize?: number | null;
  keyStrength?: string | null;
  gap?: string | null;
  conceptAndSessions?: string | null;
  mentorRecommendation?: string | null;
  marketAccess?: string | null;
  idealCustomerList?: string | null;
  observationsTs?: string | null;
  recommendationForVc?: string | null;
  previousFundraiseInr?: string | number | null;
  previousFundraiseOrgs?: string | null;
  currentBurn?: string | null;
  fundAskCr?: string | number | null;
  fundraiseCommitments?: string | null;
  fundraiseNotes?: string | null;
  fathomLink?: string | null;
  currentProblem?: string | null;
  suggestedNextStep?: string | null;
  nextFiveSprints?: string | null;
  caseStudyWorthy?: boolean | null;
  caseStudyTheme?: string | null;
  trainingWorthy?: boolean | null;
  trainingTheme?: string | null;
  level?: string | null;
  tSprintIntervention?: string | null;
  tasks?: string | null;
  // Counts
  sprintCount: number; completedSprints: number;
  lastSprintDate?: string | null; lastSprintStatus?: string | null;
  sprints?: Array<{
    id: number; scheduledDate: string; status: string; consultantName: string;
    sprintHost?: string | null; coHost?: string | null;
    strengths?: string | null; gaps?: string | null; nextGoal?: string | null;
    actionableSteps?: string | null; preEmailSentAt?: string | null; postEmailSentAt?: string | null;
  }>;
};

function VentureDetailModal({ venture, onClose }: { venture: FullVenture; onClose: () => void }) {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<"overview" | "fundraising" | "sprints" | "casestudy">("overview");

  const Field = ({ label, value, fullWidth = false }: { label: string; value: any; fullWidth?: boolean }) => {
    if (value === null || value === undefined || value === "" || value === "NA") return null;
    return (
      <div className={fullWidth ? "col-span-2" : ""}>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
        <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{String(value)}</p>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-card border border-card-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-6 border-b border-border flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h2 className="text-xl font-bold text-foreground truncate">{venture.companyName}</h2>
                {venture.stage && <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full">{venture.stage}</span>}
                {venture.industry && <span className="text-xs px-2 py-0.5 bg-secondary text-secondary-foreground rounded-full">{venture.industry}</span>}
                {venture.level && <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded-full">Level: {venture.level}</span>}
              </div>
              <p className="text-sm text-muted-foreground">{venture.name} · {venture.email}</p>
              {venture.contact && <p className="text-xs text-muted-foreground mt-0.5">📞 {venture.contact}</p>}
              {venture.description && <p className="text-sm text-muted-foreground mt-1 italic">{venture.description}</p>}
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground flex-shrink-0"><X size={20} /></button>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-3 mt-4">
            <div className="text-center p-3 bg-background rounded-lg">
              <p className="text-2xl font-bold text-foreground tabular-nums">{venture.sprintCount}</p>
              <p className="text-xs text-muted-foreground">Sprints</p>
            </div>
            <div className="text-center p-3 bg-background rounded-lg">
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{venture.completedSprints}</p>
              <p className="text-xs text-muted-foreground">Completed</p>
            </div>
            <div className="text-center p-3 bg-background rounded-lg">
              <p className="text-2xl font-bold text-violet-600 dark:text-violet-400 tabular-nums">{venture.teamSize ?? "—"}</p>
              <p className="text-xs text-muted-foreground">Team Size</p>
            </div>
            <div className="text-center p-3 bg-background rounded-lg">
              <p className="text-2xl font-bold text-primary tabular-nums">{venture.fundAskCr != null ? `₹${venture.fundAskCr}Cr` : "—"}</p>
              <p className="text-xs text-muted-foreground">Fund Ask</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-4 border-b border-border -mb-px">
            {([
              ["overview", "Overview"], ["fundraising", "Fundraising"],
              ["sprints", "Sprint History"], ["casestudy", "Case & Training"],
            ] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                  tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Content area */}
        <div className="p-6 overflow-y-auto flex-1">
          {tab === "overview" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Goal Setting" value={venture.goalSetting} fullWidth />
              <Field label="Key Strength" value={venture.keyStrength} fullWidth />
              <Field label="Gaps (What needs to be built)" value={venture.gap} fullWidth />
              <Field label="Revenue — Last 12 months" value={venture.revenueLast12Months} />
              <Field label="MRR — Last month" value={venture.revenueLastMonthMrr} />
              <Field label="Market Access" value={venture.marketAccess} fullWidth />
              <Field label="Ideal Customer List" value={venture.idealCustomerList} fullWidth />
              <Field label="Mentor / 1:1 Recommendation" value={venture.mentorRecommendation} fullWidth />
              <Field label="Observations by TS" value={venture.observationsTs} fullWidth />
              <Field label="Current Problem / Pain Points" value={venture.currentProblem} fullWidth />
              <Field label="Suggested Next Step" value={venture.suggestedNextStep} fullWidth />
              <Field label="Next 5 Sprints" value={venture.nextFiveSprints} fullWidth />
              <Field label="T-Sprint Intervention" value={venture.tSprintIntervention} fullWidth />
              <Field label="Tasks" value={venture.tasks} fullWidth />
              <Field label="Partner" value={venture.partnerName} />
              {venture.fathomLink && (
                <div className="col-span-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Fathom</p>
                  <a href={venture.fathomLink} target="_blank" rel="noreferrer"
                    className="text-sm text-primary hover:underline break-all">{venture.fathomLink}</a>
                </div>
              )}
            </div>
          )}

          {tab === "fundraising" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Fund Ask (Cr)" value={venture.fundAskCr} />
              <Field label="Current Burn" value={venture.currentBurn} />
              <Field label="Previous Fundraise (INR)" value={venture.previousFundraiseInr} />
              <Field label="Previous Fundraise Orgs" value={venture.previousFundraiseOrgs} fullWidth />
              <Field label="Commitments / Ongoing" value={venture.fundraiseCommitments} fullWidth />
              <Field label="Fundraise Notes" value={venture.fundraiseNotes} fullWidth />
              <Field label="VC Recommendation" value={venture.recommendationForVc} fullWidth />
              {!venture.fundAskCr && !venture.currentBurn && !venture.previousFundraiseInr && !venture.fundraiseNotes && (
                <div className="col-span-2 text-center py-8 text-muted-foreground text-sm">No fundraising info on file yet.</div>
              )}
            </div>
          )}

          {tab === "casestudy" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Case study worthy?" value={venture.caseStudyWorthy == null ? null : (venture.caseStudyWorthy ? "Yes" : "No")} />
              <Field label="Case study theme" value={venture.caseStudyTheme} />
              <Field label="Training worthy?" value={venture.trainingWorthy == null ? null : (venture.trainingWorthy ? "Yes" : "No")} />
              <Field label="Training theme" value={venture.trainingTheme} />
              <Field label="Concept & Sessions" value={venture.conceptAndSessions} fullWidth />
              <Field label="Level" value={venture.level} />
            </div>
          )}

          {tab === "sprints" && (
            !venture.sprints || venture.sprints.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">No sprints recorded yet</div>
            ) : (
              <div className="space-y-3">
                {venture.sprints.map((sprint, i) => {
                  const isCompleted = sprint.status === "completed";
                  const isCancelled = sprint.status === "cancelled";
                  return (
                    <div key={sprint.id}
                      onClick={() => { setLocation(`/sprints/${sprint.id}`); onClose(); }}
                      className="relative flex gap-4 cursor-pointer group">
                      {i < (venture.sprints?.length ?? 0) - 1 && (
                        <div className="absolute left-[19px] top-10 bottom-0 w-px bg-border" />
                      )}
                      <div className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center border-2 z-10 ${
                        isCompleted ? "bg-emerald-100 border-emerald-300 dark:bg-emerald-900/30 dark:border-emerald-700" :
                        isCancelled ? "bg-red-100 border-red-300 dark:bg-red-900/30 dark:border-red-700" :
                        "bg-blue-100 border-blue-300 dark:bg-blue-900/30 dark:border-blue-700"
                      }`}>
                        {isCompleted ? <CheckCircle size={16} className="text-emerald-600 dark:text-emerald-400" /> :
                          isCancelled ? <X size={16} className="text-red-600" /> :
                          <Clock size={16} className="text-blue-600 dark:text-blue-400" />}
                      </div>
                      <div className="flex-1 bg-background rounded-xl p-4 group-hover:border-primary/30 border border-border transition-colors mb-1">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="text-sm font-medium text-foreground">Sprint #{sprint.id}</p>
                            <p className="text-xs text-muted-foreground">
                              {sprint.scheduledDate} · Host: {sprint.sprintHost ?? sprint.consultantName}
                              {sprint.coHost && <> · Co-host: {sprint.coHost}</>}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {(sprint.preEmailSentAt || sprint.postEmailSentAt) && (
                              <span className="flex items-center gap-1 text-xs text-primary">
                                <Mail size={10} />{[sprint.preEmailSentAt, sprint.postEmailSentAt].filter(Boolean).length}/2
                              </span>
                            )}
                            <ChevronRight size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
                          </div>
                        </div>
                        {sprint.strengths && (
                          <div className="mb-2">
                            <p className="text-xs font-medium text-muted-foreground mb-0.5">Strengths</p>
                            <p className="text-xs text-foreground line-clamp-2">{sprint.strengths}</p>
                          </div>
                        )}
                        {sprint.nextGoal && (
                          <div className="flex items-start gap-1.5">
                            <TrendingUp size={11} className="text-primary mt-0.5 flex-shrink-0" />
                            <p className="text-xs text-foreground line-clamp-1">{sprint.nextGoal}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Incubator Detail View ────────────────────────────────────────────────────
function IncubatorDetailView({ id, onBack }: { id: number; onBack: () => void }) {
  const { data, isLoading } = useGetIncubator(id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteIncubator = useDeleteIncubator();
  // Using `any` for flexibility — the runtime payload includes all the rich summary
  // fields (see routes/incubators.ts), but the generated IncubatorVenture type
  // may lag behind the API until the OpenAPI client is regenerated.
  const [selectedVenture, setSelectedVenture] = useState<any | null>(null);

  if (isLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-48" />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
      </div>
    </div>
  );

  if (!data) return <div className="text-muted-foreground">Not found</div>;

  const completionRate = data.ventures.length > 0
    ? Math.round(data.ventures.reduce((sum, v) => sum + v.completedSprints, 0) /
      Math.max(data.ventures.reduce((sum, v) => sum + v.sprintCount, 0), 1) * 100)
    : 0;

  return (
    <>
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition">
              <ArrowLeft size={18} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-foreground">{data.name}</h2>
                <span className="text-xs px-2 py-0.5 bg-secondary text-secondary-foreground rounded-full capitalize">{data.type}</span>
              </div>
              {data.description && <p className="text-sm text-muted-foreground mt-0.5">{data.description}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data.sheetUrl && (
              <a href={data.sheetUrl} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/10 transition">
                <ExternalLink size={12} />Open Sheet
              </a>
            )}
            <button onClick={() => {
              if (!confirm(`Delete ${data.name}?`)) return;
              deleteIncubator.mutate({ id }, {
                onSuccess: () => {
                  queryClient.invalidateQueries({ queryKey: getListIncubatorsQueryKey() });
                  toast({ title: "Incubator deleted" });
                  onBack();
                },
              });
            }} className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition">
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Ventures", value: data.ventures.length, icon: Users, color: "text-violet-600 dark:text-violet-400" },
            { label: "Total Sprints", value: data.ventures.reduce((s, v) => s + v.sprintCount, 0), icon: Zap, color: "text-primary" },
            { label: "Completed", value: data.ventures.reduce((s, v) => s + v.completedSprints, 0), icon: CheckCircle, color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Completion Rate", value: `${completionRate}%`, icon: Activity, color: "text-amber-600 dark:text-amber-400" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-card border border-card-border rounded-xl p-4 text-center">
              <Icon size={18} className={`mx-auto mb-2 ${color}`} />
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Venture cards */}
        {data.ventures.length === 0 ? (
          <div className="text-center py-16 bg-card border border-card-border rounded-xl">
            <Building2 size={40} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground font-medium">No ventures in this program yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Add ventures from the Ventures tab and assign them here</p>
          </div>
        ) : (
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
              Startups ({data.ventures.length})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.ventures.map(venture => {
                const hasAnalysis = venture.sprints?.some(s => s.strengths || s.gaps || s.nextGoal);
                const lastStatus = venture.lastSprintStatus;
                const statusColor = lastStatus === "completed" ? "text-emerald-600 dark:text-emerald-400" :
                  lastStatus === "cancelled" ? "text-red-600 dark:text-red-400" :
                  lastStatus ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground";

                return (
                  <button key={venture.id} onClick={() => setSelectedVenture(venture)}
                    className="bg-card border border-card-border rounded-xl p-5 text-left hover:border-primary/40 hover:shadow-md transition-all group w-full">
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center flex-shrink-0">
                        <Building2 size={18} className="text-primary" />
                      </div>
                      <ChevronRight size={14} className="text-muted-foreground group-hover:text-primary transition-colors mt-1" />
                    </div>

                    <h4 className="font-semibold text-foreground mb-0.5">{venture.companyName}</h4>
                    <p className="text-xs text-muted-foreground mb-1">{venture.name}</p>
                    {venture.sector && <span className="text-xs text-muted-foreground/80 bg-secondary px-1.5 py-0.5 rounded">{venture.sector}</span>}

                    <div className="mt-3 pt-3 border-t border-border space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground flex items-center gap-1"><Zap size={11} />Sprints</span>
                        <span className="font-medium text-foreground">{venture.sprintCount}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground flex items-center gap-1"><CheckCircle size={11} />Completed</span>
                        <span className={`font-medium ${statusColor}`}>{venture.completedSprints}</span>
                      </div>
                      {venture.lastSprintDate && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground flex items-center gap-1"><Clock size={11} />Last Sprint</span>
                          <span className="text-foreground">{venture.lastSprintDate}</span>
                        </div>
                      )}
                      {hasAnalysis && (
                        <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                          <FileText size={11} /><span>Analysis available</span>
                        </div>
                      )}
                    </div>

                    {/* Progress bar */}
                    {venture.sprintCount > 0 && (
                      <div className="mt-3">
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${Math.round(venture.completedSprints / venture.sprintCount * 100)}%` }} />
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {selectedVenture && (
        <VentureDetailModal venture={selectedVenture} onClose={() => setSelectedVenture(null)} />
      )}
    </>
  );
}

// ─── Main Summary Page ────────────────────────────────────────────────────────
export default function SummaryPage() {
  const { data: incubators, isLoading } = useListIncubators();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showAddIncubator, setShowAddIncubator] = useState(false);

  const typeColors: Record<string, string> = {
    isb:  "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
    ju:   "bg-blue-100   text-blue-700   dark:bg-blue-900/30   dark:text-blue-400",
  };
  const typeLabels: Record<string, string> = { isb: "ISB", ju: "JU" };

  return (
    <Layout>
      <div className="p-6 max-w-6xl mx-auto">
        {selectedId !== null ? (
          <IncubatorDetailView id={selectedId} onBack={() => setSelectedId(null)} />
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-foreground">Summary Sheet</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {incubators?.length ?? 0} programs · {incubators?.reduce((s, i) => s + i.ventureCount, 0) ?? 0} ventures
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowAddIncubator(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition">
                  <Plus size={15} />Add Incubator
                </button>
              </div>
            </div>

            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
              </div>
            ) : incubators?.length === 0 ? (
              <div className="text-center py-20 bg-card border border-card-border rounded-xl">
                <BarChart3 size={48} className="mx-auto text-muted-foreground/20 mb-4" />
                <p className="text-foreground font-semibold">No programs yet</p>
                <p className="text-sm text-muted-foreground mt-1 mb-5">Add your first incubator or program to get started</p>
                <button onClick={() => setShowAddIncubator(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition">
                  <Plus size={15} />Add Incubator
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {incubators?.map(inc => {
                  const completionRate = inc.sprintCount > 0 ? Math.round(inc.ventureCount / Math.max(inc.sprintCount, 1) * 100) : 0;
                  const color = typeColors[inc.type] ?? typeColors.isb;

                  return (
                    <button key={inc.id} onClick={() => setSelectedId(inc.id)}
                      className="bg-card border border-card-border rounded-2xl p-6 text-left hover:border-primary/40 hover:shadow-lg transition-all group w-full">
                      {/* Top row */}
                      <div className="flex items-start justify-between mb-4">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                          <Building2 size={22} className="text-primary" />
                        </div>
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${color}`}>
                          {typeLabels[inc.type] ?? inc.type}
                        </span>
                      </div>

                      <h3 className="font-bold text-foreground text-lg leading-tight mb-1 group-hover:text-primary transition-colors">
                        {inc.name}
                      </h3>
                      {inc.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-4">{inc.description}</p>
                      )}

                      {/* Stats */}
                      <div className="grid grid-cols-2 gap-2 mb-4">
                        <div className="bg-background rounded-lg p-3 text-center">
                          <p className="text-xl font-bold text-foreground">{inc.ventureCount}</p>
                          <p className="text-xs text-muted-foreground">Ventures</p>
                        </div>
                        <div className="bg-background rounded-lg p-3 text-center">
                          <p className="text-xl font-bold text-primary">{inc.sprintCount}</p>
                          <p className="text-xs text-muted-foreground">Sprints</p>
                        </div>
                      </div>

                      {/* Footer */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {inc.sheetUrl ? (
                            <span className="flex items-center gap-1 text-primary">
                              <ExternalLink size={11} />Sheet linked
                            </span>
                          ) : (
                            <span>No sheet linked</span>
                          )}
                        </div>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground group-hover:text-primary transition-colors">
                          View details <ChevronRight size={13} />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {showAddIncubator && <AddIncubatorModal onClose={() => setShowAddIncubator(false)} />}
    </Layout>
  );
}
