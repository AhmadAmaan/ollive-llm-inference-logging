import { randomUUID } from "node:crypto";

import { query, queryOne } from "@/lib/db";
import type { InferenceEventInput } from "@/lib/validators";

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

async function enqueueInferenceEvent(event: InferenceEventInput) {
  const eventRowId = randomUUID();

  const inserted = await queryOne<{ id: string }>(
    `
      INSERT INTO inference_events (
        id,
        event_id,
        event_type,
        payload,
        status,
        error_message,
        created_at,
        processed_at
      ) VALUES ($1, $2, 'INFERENCE_LOGGED', $3::jsonb, 'PENDING', NULL, $4, NULL)
      ON CONFLICT (event_id) DO NOTHING
      RETURNING id
    `,
    [eventRowId, event.eventId, JSON.stringify(event), new Date().toISOString()],
  );

  if (inserted?.id) {
    return inserted.id;
  }

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM inference_events WHERE event_id = $1`,
    [event.eventId],
  );

  return existing?.id ?? null;
}

async function processInferenceEventById(eventRowId: string) {
  const eventRow = await queryOne<{
    id: string;
    payload: InferenceEventInput;
    status: string;
  }>(
    `
      SELECT id, payload, status
      FROM inference_events
      WHERE id = $1
    `,
    [eventRowId],
  );

  if (!eventRow) {
    return { inferenceLogId: null, processed: false };
  }

  if (eventRow.status === "PROCESSED") {
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM inference_logs WHERE event_id = $1`,
      [eventRow.payload.eventId],
    );

    return {
      inferenceLogId: existing?.id ?? null,
      processed: false,
    };
  }

  try {
    const inferenceLogId = await upsertInferenceLog(eventRow.payload);

    await query(
      `
        UPDATE inference_events
        SET
          status = 'PROCESSED',
          processed_at = $1,
          error_message = NULL
        WHERE id = $2
      `,
      [new Date().toISOString(), eventRowId],
    );

    return {
      inferenceLogId,
      processed: true,
    };
  } catch (error) {
    await query(
      `
        UPDATE inference_events
        SET
          status = 'FAILED',
          error_message = $1
        WHERE id = $2
      `,
      [error instanceof Error ? error.message : "Unknown event processing failure.", eventRowId],
    );
    throw error;
  }
}

export async function processPendingInferenceEvents(limit = 50) {
  const pending = await query<{ id: string }>(
    `
      SELECT id
      FROM inference_events
      WHERE status = 'PENDING'
      ORDER BY created_at ASC
      LIMIT $1
    `,
    [limit],
  );

  let processed = 0;

  for (const eventRow of pending.rows) {
    const result = await processInferenceEventById(eventRow.id);
    if (result.processed) {
      processed += 1;
    }
  }

  return {
    processed,
    pending: pending.rows.length,
  };
}

export async function persistInferenceEvent(event: InferenceEventInput) {
  const eventRowId = await enqueueInferenceEvent(event);
  if (!eventRowId) {
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM inference_logs WHERE event_id = $1`,
      [event.eventId],
    );

    return { id: existing?.id ?? null };
  }

  const result = await processInferenceEventById(eventRowId);
  return { id: result.inferenceLogId };
}
