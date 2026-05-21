# Architecture Notes

## End-to-End Flow

1. The UI creates an optimistic user message and assistant placeholder.
2. `POST /api/conversations/:id/stream` persists the real message pair and opens an NDJSON stream.
3. The provider wrapper streams deltas from OpenAI, Anthropic, or the local fallback provider.
4. The wrapper measures timestamps, latency, token usage, status, and provider metadata.
5. On completion or failure, it emits a normalized inference event to `/api/ingest/inference`.
6. Ingestion writes the event to `inference_events` and processes it into `inference_logs`.
7. The conversation message is finalized and dashboard queries read from `inference_logs`.

## Why The Design Is Split This Way

- The chat route owns product behavior and message state.
- The LLM wrapper owns provider differences, timing, and event normalization.
- The ingestion layer owns validation and persistence of telemetry.
- The database keeps chat records and operational telemetry queryable without coupling one concern to the other.

That separation keeps the code understandable in a small repo while preserving clean boundaries for future extraction into independent services.

## Event-First Ingestion

`inference_events` acts as a lightweight outbox. The event is stored first and then materialized into `inference_logs`.

This choice adds two useful properties without introducing Kafka or another external broker:

- Failed event processing can be retried through `POST /api/ingest/process-pending`
- Raw normalized events remain available for replay or backfill work

The tradeoff is that event durability and operational analytics currently share the same PostgreSQL instance.

## Logging Strategy

- Every provider call passes through one instrumentation boundary in the LLM wrapper.
- The wrapper captures normalized metadata including provider, model, timestamps, latency, token usage, request status, conversation identifiers, and input/output previews.
- Normalized events are sent to the ingestion endpoint in near real time, stored first in `inference_events`, and then materialized into query-friendly rows in `inference_logs`.
- Full chat content remains in `messages`, while inference logs store redacted previews so operational debugging remains useful without duplicating raw sensitive content in telemetry records.

## Streaming Transport

The UI uses NDJSON over a regular HTTP response instead of SSE-specific abstractions or WebSockets.

Why:

- It keeps the route handler implementation compact
- It works naturally with server-side persistence steps
- It is easy to inspect during debugging

The tradeoff is that richer bi-directional real-time coordination would be better served by WebSockets or a dedicated streaming protocol.

## Privacy Posture

Full chat content lives in `messages` because product functionality depends on it. Inference telemetry stores only redacted previews.

Current redaction covers common high-signal patterns:

- email addresses
- phone numbers
- SSNs
- likely payment card numbers
- common API key formats

This is intentionally lightweight and explainable. A production system would layer on tenant-specific rules, structured classification, and stronger policy enforcement.

## Scaling Notes

- PostgreSQL is the primary persistence layer because it fits the relational access patterns and deployment goals.
- The app can be deployed cleanly through Docker Compose or Kubernetes.
- The current cancellation registry is in memory, so the write path should remain a single active app replica unless that state is externalized.
- The next scaling step would be a dedicated worker for pending event processing plus Redis or another shared control plane for cancellation.

## Operational Failure Handling

- Provider failures still result in persisted failed assistant messages and inference telemetry.
- Cancellation is best-effort and produces a terminal cancelled assistant message.
- If event materialization fails after the provider call returns, the user-facing chat flow still completes and the raw event remains available for retry.
