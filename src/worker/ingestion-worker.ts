import process from "node:process";

import { Worker } from "bullmq";

import { closePool } from "@/lib/db";
import {
  closeInferenceQueueResources,
  createRedisConnection,
  getIngestionQueueConcurrency,
  getIngestionQueueName,
  getIngestionReconciliationIntervalMs,
} from "@/lib/server/ingestion-queue";
import {
  processInferenceEventById,
  processPendingInferenceEvents,
} from "@/lib/server/ingestion";

let reconciliationTimer: NodeJS.Timeout | null = null;

async function reconcilePendingEvents(reason: string) {
  let totalClaimed = 0;
  let totalProcessed = 0;
  let totalFailed = 0;

  while (true) {
    const batch = await processPendingInferenceEvents();
    totalClaimed += batch.claimed;
    totalProcessed += batch.processed;
    totalFailed += batch.failed;

    if (batch.claimed === 0) {
      break;
    }
  }

  if (totalClaimed > 0 || totalFailed > 0) {
    console.info(
      `[ingestion-worker] reconciliation(${reason}) claimed=${totalClaimed} processed=${totalProcessed} failed=${totalFailed}`,
    );
  }
}

async function main() {
  const worker = new Worker<{ eventId: string }>(
    getIngestionQueueName(),
    async (job) => {
      const result = await processInferenceEventById(job.data.eventId);
      if (!result.claimed) {
        return {
          skipped: true,
        };
      }

      return {
        skipped: false,
      };
    },
    {
      connection: createRedisConnection(),
      concurrency: getIngestionQueueConcurrency(),
    },
  );

  worker.on("completed", (job) => {
    console.info(`[ingestion-worker] completed job=${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[ingestion-worker] failed job=${job?.id ?? "unknown"}`, error);
  });

  await reconcilePendingEvents("startup");

  reconciliationTimer = setInterval(() => {
    void reconcilePendingEvents("interval").catch((error) => {
      console.error("[ingestion-worker] reconciliation failed", error);
    });
  }, getIngestionReconciliationIntervalMs());
  reconciliationTimer.unref();

  console.info(
    `[ingestion-worker] listening on queue=${getIngestionQueueName()} concurrency=${getIngestionQueueConcurrency()}`,
  );

  async function shutdown(signal: NodeJS.Signals) {
    console.info(`[ingestion-worker] shutting down on ${signal}`);

    if (reconciliationTimer) {
      clearInterval(reconciliationTimer);
      reconciliationTimer = null;
    }

    await worker.close();
    await closeInferenceQueueResources();
    await closePool();
    process.exit(0);
  }

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void main().catch(async (error) => {
  console.error("[ingestion-worker] fatal startup failure", error);
  await closeInferenceQueueResources().catch(() => undefined);
  await closePool().catch(() => undefined);
  process.exit(1);
});
