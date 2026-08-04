/**
 * Follow-up reply-scan scheduler (in-process).
 *
 * Two ways to run the auto-scan — use EITHER, not both:
 *
 *  A) External cron (recommended on Render): a Render Cron Job hits
 *     POST /api/sales/followups/cron-scan with header `x-cron-secret: $CRON_SECRET`
 *     every 15 min. Survives web-service restarts, no double-run risk.
 *
 *  B) This in-process scheduler: call `startFollowupScanScheduler()` once at
 *     server boot. Simpler (no extra service) but only fires while the web
 *     service is awake, and would double-run if you ever scale to >1 instance.
 *
 * Controlled by env:
 *   FOLLOWUP_SCAN_ENABLED=true          (off unless explicitly enabled)
 *   FOLLOWUP_SCAN_INTERVAL_MIN=15       (minutes; default 15, min 5)
 */
import { logger } from "./logger";
import { scanAllPendingReplies } from "../routes/salesFollowups";

let timer: NodeJS.Timeout | null = null;

export function startFollowupScanScheduler(): void {
  if (process.env.FOLLOWUP_SCAN_ENABLED !== "true") {
    logger.info("Follow-up scan scheduler disabled (set FOLLOWUP_SCAN_ENABLED=true to enable).");
    return;
  }
  if (timer) return; // idempotent

  const min = Math.max(5, Number(process.env.FOLLOWUP_SCAN_INTERVAL_MIN ?? 15) || 15);
  const intervalMs = min * 60_000;

  const run = async () => {
    try {
      const out = await scanAllPendingReplies();
      logger.info({ ...out }, "follow-up reply scan complete");
    } catch (err) {
      logger.error({ err }, "follow-up reply scan failed");
    }
  };

  // Kick off shortly after boot, then on the interval. `unref` so the timer
  // never keeps the process alive on its own during shutdown.
  const first = setTimeout(run, 30_000);
  first.unref?.();
  timer = setInterval(run, intervalMs);
  timer.unref?.();
  logger.info({ intervalMin: min }, "Follow-up scan scheduler started");
}

export function stopFollowupScanScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
