import { randomUUID } from "node:crypto";

import { query, queryOne, withTransaction } from "@/lib/db";
import type { InferenceEventInput } from "@/lib/validators";

const PROCESSING_STALE_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 25;

const globalIngestionState = globalThis as typeof globalThis & {
  __olliveIngestionWorkerScheduled?: boolean;
  __olliveIngestionWorkerRunning?: boolean;
};

type ClaimedEventRow = {
  id: string;
  payload: InferenceEventInput;
  attempt_count: number;
};

function mapStatus(status: InferenceEventInput["status"]) {
  switch (status) {
    case "success":
      return "SUCCESS";
    case "cancelled":
      return "CANCELLED";
    default:
      return "ERROR";
  }
}

async function upsertInferenceLog(event: InferenceEventInput) {
  const inserted = await queryOne<{ id: string }>(
    `
      INSERT INTO inference_logs (
        id,
        event_id,
        provider,
        model,
        operation,
        source_type,
        session_id,
        status,
        conversation_id,
        request_message_id,
        response_message_id,
        request_preview,
        response_preview,
        input_tokens,
        output_tokens,
        total_tokens,
        latency_ms,
        started_at,
        completed_at,
        error_code,
        error_message,
        raw_metadata,
        created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22::jsonb, $23
      )
      ON CONFLICT (event_id) DO NOTHING
      RETURNING id
    `,
    [
      randomUUID(),
      event.eventId,
      event.provider,
      event.model,
      event.operation,
      event.sourceType ?? null,
      event.sessionId ?? null,
      mapStatus(event.status),
      event.conversationId ?? null,
      event.requestMessageId ?? null,
      event.responseMessageId ?? null,
      event.requestPreview ?? null,
      event.responsePreview ?? null,
      event.usage?.inputTokens ?? null,
      event.usage?.outputTokens ?? null,
      event.usage?.totalTokens ?? null,
      event.latencyMs ?? null,
      event.startedAt,
      event.completedAt ?? null,
      event.error?.code ?? null,
      event.error?.message ?? null,
      event.metadata ? JSON.stringify(event.metadata) : null,
      new Date().toISOString(),
    ],
  );

  if (inserted?.id) {
    return inserted.id;
  }

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM inference_logs WHERE event_id = $1`,
    [event.eventId],
  );

  return existing?.id ?? null;
}

export async function enqueueInferenceEvent(event: InferenceEventInput) {
  const eventRowId = randomUUID();

  const inserted = await queryOne<{ id: string; event_id: string }>(
    `
      INSERT INTO inference_events (
        id,
        event_id,
        event_type,
        payload,
        status,
        attempt_count,
        error_message,
        created_at,
        processing_started_at,
        processed_at
      ) VALUES ($1, $2, 'INFERENCE_LOGGED', $3::jsonb, 'PENDING', 0, NULL, $4, NULL, NULL)
      ON CONFLICT (event_id) DO NOTHING
      RETURNING id, event_id
    `,
    [eventRowId, event.eventId, JSON.stringify(event), new Date().toISOString()],
  );

  if (inserted?.id) {
    return {
      id: inserted.id,
      eventId: inserted.event_id,
      enqueued: true,
    };
  }

  const existing = await queryOne<{ id: string; event_id: string }>(
    `SELECT id, event_id FROM inference_events WHERE event_id = $1`,
    [event.eventId],
  );

  return {
    id: existing?.id ?? null,
    eventId: existing?.event_id ?? event.eventId,
    enqueued: false,
  };
}

async function claimPendingInferenceEvents(limit = DEFAULT_BATCH_SIZE) {
  const staleBefore = new Date(Date.now() - PROCESSING_STALE_AFTER_MS).toISOString();
  const claimed = await withTransaction(async (client) => {
    const result = await client.query<ClaimedEventRow>(
      `
        WITH next_events AS (
          SELECT id
          FROM inference_events
          WHERE status = 'PENDING'
             OR (status = 'PROCESSING' AND processing_started_at < $2)
          ORDER BY created_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE inference_events AS events
        SET
          status = 'PROCESSING',
          processing_started_at = $3,
          attempt_count = COALESCE(attempt_count, 0) + 1,
          error_message = NULL
        FROM next_events
        WHERE events.id = next_events.id
        RETURNING events.id, events.payload, events.attempt_count
      `,
      [limit, staleBefore, new Date().toISOString()],
    );

    return result.rows;
  });

  return claimed;
}

async function markInferenceEventProcessed(eventRowId: string) {
  await query(
    `
      UPDATE inference_events
      SET
        status = 'PROCESSED',
        processed_at = $1,
        processing_started_at = NULL,
        error_message = NULL
      WHERE id = $2
    `,
    [new Date().toISOString(), eventRowId],
  );
}

async function markInferenceEventFailed(eventRowId: string, message: string) {
  await query(
    `
      UPDATE inference_events
      SET
        status = 'FAILED',
        error_message = $1,
        processing_started_at = NULL
      WHERE id = $2
    `,
    [message, eventRowId],
  );
}

async function processClaimedInferenceEvent(eventRow: ClaimedEventRow) {
  try {
    await upsertInferenceLog(eventRow.payload);
    await markInferenceEventProcessed(eventRow.id);
    return { processed: true };
  } catch (error) {
    await markInferenceEventFailed(
      eventRow.id,
      error instanceof Error ? error.message : "Unknown event processing failure.",
    );
    return { processed: false };
  }
}

export async function processPendingInferenceEvents(limit = DEFAULT_BATCH_SIZE) {
  const claimed = await claimPendingInferenceEvents(limit);
  let processed = 0;
  let failed = 0;

  for (const eventRow of claimed) {
    const result = await processClaimedInferenceEvent(eventRow);
    if (result.processed) {
      processed += 1;
    } else {
      failed += 1;
    }
  }

  return {
    claimed: claimed.length,
    processed,
    failed,
  };
}

async function drainInferenceEventQueue() {
  if (globalIngestionState.__olliveIngestionWorkerRunning) {
    return;
  }

  globalIngestionState.__olliveIngestionWorkerRunning = true;

  try {
    while (true) {
      const batch = await processPendingInferenceEvents();
      if (batch.claimed === 0) {
        break;
      }
    }
  } finally {
    globalIngestionState.__olliveIngestionWorkerRunning = false;
  }
}

export function scheduleInferenceEventProcessing() {
  if (globalIngestionState.__olliveIngestionWorkerScheduled) {
    return;
  }

  globalIngestionState.__olliveIngestionWorkerScheduled = true;

  setTimeout(() => {
    globalIngestionState.__olliveIngestionWorkerScheduled = false;

    void drainInferenceEventQueue().catch((error) => {
      console.error("Background inference event worker failed.", error);
    });
  }, 0);
}
