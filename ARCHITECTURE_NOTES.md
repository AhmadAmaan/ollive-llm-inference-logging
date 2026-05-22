# Architecture Notes

## End-to-End Flow

1. An application call enters the SDK through an explicit wrapper or optional fetch monkey-patch.
2. In the demo app, `POST /api/conversations/:id/stream` persists the message pair and opens an NDJSON stream.
3. The provider execution path streams deltas from OpenAI, Anthropic, or the local fallback provider.
4. The SDK captures timestamps, latency, token usage, status, provider metadata, and redacted previews independently of the UI.
5. On completion or failure, the SDK emits a normalized inference event to `/api/ingest/inference` asynchronously.
6. The ingestion endpoint validates the payload, enqueues it into `inference_events`, and returns immediately.
7. A background worker claims pending events and materializes them into `inference_logs`.
8. The application flow completes without waiting for telemetry persistence, and dashboard queries read from `inference_logs`.

## Why The Design Is Split This Way

- The chat route owns product behavior and message state.
- The SDK owns timing, redaction, event normalization, and optional instrumentation hooks.
- The provider layer owns provider-specific request and streaming behavior.
- The ingestion layer owns validation and persistence of telemetry.
- The database keeps chat records and operational telemetry queryable without coupling one concern to the other.

That separation keeps the code understandable in a small repo while preserving clean boundaries for future extraction into independent services.

## Event-First Ingestion

`inference_events` acts as a lightweight outbox. The event is stored first and then materialized into `inference_logs` by a background worker.

This choice adds two useful properties without introducing Kafka or another external broker:

- Failed or pending event processing can be retried through `POST /api/ingest/process-pending`
- Raw normalized events remain available for replay or backfill work

The tradeoff is that event durability, background processing, and operational analytics currently still share the same PostgreSQL instance and application runtime.

## Logging Strategy

- Every provider call passes through one instrumentation boundary in the SDK, either through explicit wrapping or optional fetch monkey-patching.
- The wrapper captures normalized metadata including provider, model, timestamps, latency, token usage, request status, conversation identifiers, and input/output previews.
- Normalized events are sent to the ingestion endpoint in near real time, stored first in `inference_events`, and then materialized asynchronously into query-friendly rows in `inference_logs`.
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

This is intentionally lightweight but more policy-oriented than regex alone. The current pipeline combines structured field redaction, sensitive-document suppression, and pattern matching. A production system would still layer on tenant-specific rules, stronger classifiers, and policy enforcement.

## Scaling Notes

- PostgreSQL is the primary persistence layer because it fits the relational access patterns and deployment goals.
- The app can be deployed cleanly through Docker Compose or Kubernetes.
- SDK emission is asynchronous, and ingestion materialization now happens in a background worker, which removes telemetry persistence from the direct request critical path.
- The current cancellation registry is in memory, so the write path should remain a single active app replica unless that state is externalized.
- The next scaling step would be moving the in-process worker onto a dedicated queue-backed worker service plus Redis or another shared control plane for cancellation.

## Operational Failure Handling

- Provider failures still result in persisted failed assistant messages and inference telemetry.
- Cancellation is best-effort and produces a terminal cancelled assistant message.
- If event materialization fails after the provider call returns, the user-facing chat flow still completes and the raw event remains available for retry from the outbox.
