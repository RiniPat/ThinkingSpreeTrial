import app from "./app";
import { logger } from "./lib/logger";
import { startFollowupScanScheduler } from "./lib/followupScan";

// Render provides PORT automatically. Locally, default to 5000.
const port = Number(process.env.PORT ?? 5000);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env.PORT}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  startFollowupScanScheduler();
});
