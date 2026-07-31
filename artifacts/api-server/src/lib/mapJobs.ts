/**
 * mapJobs.ts — tiny async job runner for the heavy Competitive Mapping stages
 * (Fencing, Breakdown, Inspiration).
 *
 * Deliberately dependency-free: no Redis / BullMQ. A job is a row in `map_jobs`;
 * the route enqueues it, fires the work in the background (not awaited), and
 * returns the jobId immediately. The UI polls GET /competitive-maps/jobs/:id and
 * renders a progress bar. The Google Sheet fills in live as the work proceeds.
 *
 * Trade-off (acceptable for v1, and what "build fast" asked for): if the web
 * process restarts mid-job the job stalls in `running`. Jobs are idempotent to
 * re-run, and a stalled job can simply be re-triggered from the UI.
 */
import { db, mapJobsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type JobKind = "fence" | "breakdown" | "inspiration";

export async function createJob(mapId: number, kind: JobKind, total = 0): Promise<number> {
  const [row] = await db
    .insert(mapJobsTable)
    .values({ mapId, kind, status: "queued", progress: 0, total, message: "Queued…" })
    .returning({ id: mapJobsTable.id });
  return row.id;
}

export async function startJob(jobId: number, message = "Working…") {
  await db.update(mapJobsTable)
    .set({ status: "running", message, updatedAt: new Date() })
    .where(eq(mapJobsTable.id, jobId));
}

export async function setProgress(jobId: number, progress: number, message?: string) {
  await db.update(mapJobsTable)
    .set({ progress, ...(message ? { message } : {}), updatedAt: new Date() })
    .where(eq(mapJobsTable.id, jobId));
}

export async function finishJob(jobId: number, message = "Done") {
  await db.update(mapJobsTable)
    .set({ status: "done", message, updatedAt: new Date() })
    .where(eq(mapJobsTable.id, jobId));
}

export async function failJob(jobId: number, error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  await db.update(mapJobsTable)
    .set({ status: "error", error: msg.slice(0, 500), message: "Failed", updatedAt: new Date() })
    .where(eq(mapJobsTable.id, jobId));
}

export async function getJob(jobId: number) {
  const [row] = await db.select().from(mapJobsTable).where(eq(mapJobsTable.id, jobId)).limit(1);
  return row ?? null;
}

/**
 * Run `work` in the background, marking the job started/finished/failed around
 * it. Returns immediately — the caller should already have the jobId to hand
 * back to the client. Never rejects to the caller.
 */
export function runInBackground(jobId: number, work: () => Promise<void>): void {
  void (async () => {
    try {
      await startJob(jobId);
      await work();
      await finishJob(jobId);
    } catch (err) {
      console.error(`[mapJobs] job ${jobId} failed:`, err);
      await failJob(jobId, err).catch(() => {});
    }
  })();
}
