/**
 * Workflow stages for a company in the consultant's pipeline.
 *
 * The stages are intentionally a simple TEXT enum (no DB CHECK constraint)
 * so consultants can freely move between them — including going backwards —
 * without the DB rejecting the transition. The UI is the authority on what
 * transitions are reasonable.
 *
 * Stage progression (the "happy path"):
 *
 *   pre_sprint        — uploaded, pre-email not sent yet (default on ingest)
 *   scheduled         — sprint date booked in calendar; pre-email may or may
 *                       not be sent
 *   pre_email_sent    — pre-sprint email sent via Gmail (auto)
 *   sprint_done       — sprint session happened; consultant fills the
 *                       Sprint Data tabs (SWOT, SMART, Funding...)
 *   post_email_sent   — completed; auto-set when post-sprint email goes out
 *
 * Manual control: consultants may set ANY stage at ANY time via the
 * Workflow Stage dropdown on the company detail page. The system only
 * "auto-advances" on positive events (email sent → next stage), never
 * regresses automatically.
 */

export type WorkflowStage =
  | "pre_sprint"
  | "scheduled"
  | "pre_email_sent"
  | "sprint_done"
  | "post_email_sent";

export const WORKFLOW_STAGES: { value: WorkflowStage; label: string; description: string }[] = [
  { value: "pre_sprint",      label: "Pre-Sprint",       description: "Uploaded, nothing sent yet" },
  { value: "scheduled",       label: "Scheduled",         description: "Sprint date booked in calendar" },
  { value: "pre_email_sent",  label: "Pre-Email Sent",    description: "Pre-sprint email sent to founder" },
  { value: "sprint_done",     label: "Sprint Done",       description: "Session happened, awaiting post-email" },
  { value: "post_email_sent", label: "Completed",         description: "Post-sprint email sent, closed out" },
];

export const WORKFLOW_STAGE_VALUES: WorkflowStage[] = WORKFLOW_STAGES.map(s => s.value);

export function isValidWorkflowStage(s: unknown): s is WorkflowStage {
  return typeof s === "string" && WORKFLOW_STAGE_VALUES.includes(s as WorkflowStage);
}
