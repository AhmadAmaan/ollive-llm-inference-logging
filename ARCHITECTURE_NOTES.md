# Architecture Notes

## End-to-End Flow

1. A UI app request or any external app call enters the SDK through an explicit wrapper or optional fetch monkey-patch.
2. In the reference UI app, `POST /api/conversations/:id/stream` persists the message pair and opens an NDJSON stream.
3. The provider execution path streams deltas from OpenAI, Anthropic, or the local fallback provider.
4. The SDK captures timestamps, latency, token usage, status, provider metadata, and classifier-driven redacted previews independently of the UI.
5. On completion or failure, the SDK emits a normalized inference event to `/api/ingest/inference` asynchronously.
6. The ingestion endpoint validates the payload, stores it in `inference_events`, publishes the `eventId` to Redis, and returns immediately.
7. A dedicated worker consumes queue jobs and materializes events into `inference_logs`.
8. The UI app flow completes without waiting for telemetry persistence, and dashboard queries read from `inference_logs`.

## Why The Design Is Split This Way

- The UI app owns product behavior and message state.
- The SDK owns timing, classification/redaction, event normalization, and optional instrumentation hooks.
- The provider layer owns provider-specific request and streaming behavior.
- The ingestion layer owns validation and persistence of telemetry.
- The database keeps chat records and operational telemetry queryable without coupling one concern to the other.

## Feedback-Driven Changes

- The SDK is no longer coupled to the reference UI app. The UI app calls into the same reusable SDK surface that any other app could import.
- The primary integration mode is wrapper-based instrumentation so an external app can wrap its own inference function directly.
- Monkey-patching is available as a secondary adoption path:
  - `instrumentFetch(...)` for provider-agnostic HTTP interception
  - `instrumentOpenAIClient(...)` for common OpenAI client methods
  - `instrumentAnthropicClient(...)` for common Anthropic client methods
- Redaction moved from pattern-only masking to a staged pipeline that combines classification, structured field redaction, and pattern/entity masking.
- Ingestion moved from in-process async handling to a queue-backed worker model with separate runtime execution.

## Event-First Ingestion

`inference_events` acts as a lightweight relational outbox. The event is stored first, then the `eventId` is pushed onto a Redis queue for worker-side materialization into `inference_logs`.

This choice adds two useful properties while keeping the queueing layer lighter than Kafka or another heavier broker:

- A dedicated worker can process ingestion traffic independently of the web app runtime
- Raw normalized events remain available for replay, reconciliation, or backfill work

The tradeoff is that Redis becomes an additional dependency, while the durable source of truth still remains PostgreSQL.

## Logging Strategy

- Every provider call passes through one instrumentation boundary in the SDK, either through explicit wrapping, provider-client monkey-patching, or optional fetch monkey-patching.
- The wrapper captures normalized metadata including provider, model, timestamps, latency, token usage, request status, conversation identifiers, and input/output previews.
- Normalized events are sent to the ingestion endpoint in near real time, stored first in `inference_events`, then queued into Redis and materialized asynchronously into query-friendly rows in `inference_logs`.
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

Current redaction is a staged pipeline that combines:

- domain classification for health, finance, identity, legal, and secrets
- confidence-based full-document suppression for higher-risk content
- structured-field redaction for sensitive keys such as name, email, phone, address, token, diagnosis, passport, and patient identifiers
- pattern/entity masking for email addresses, phone numbers, SSNs, likely payment card numbers, common API key formats, IBANs, and some passport-like identifiers

This is intentionally lightweight compared with a production policy engine, but it is broader than regex masking alone. A production system would still layer on tenant-specific policies, stronger external classifiers, and policy enforcement.

## Deployment Topology

- The SDK is a library and is not deployed as its own service or pod.
- The UI app runtime serves the UI, chat APIs, and ingestion receipt endpoint.
- The worker runtime consumes Redis queue jobs and materializes inference logs.
- PostgreSQL stores both product data and the ingestion outbox.
- Redis carries transient queue delivery for the active ingestion path.

With the current implementation, the correct runtime split is UI app pod plus worker pod plus Postgres plus Redis. The SDK remains embedded in whichever app imports it.

## Scaling Notes

- PostgreSQL is the primary persistence layer because it fits the relational access patterns and deployment goals.
- The app can be deployed cleanly through Docker Compose or Kubernetes.
- SDK emission is asynchronous, and ingestion materialization now happens in a dedicated worker, which removes telemetry persistence from the direct request critical path.
- The current cancellation registry is in memory, so the write path should remain a single active app replica unless that state is externalized.
- The next scaling step would be dead-letter handling, autoscaling workers against queue depth, and moving cancellation state onto shared infrastructure.

## Operational Failure Handling

- Provider failures still result in persisted failed assistant messages and inference telemetry.
- Cancellation is best-effort and produces a terminal cancelled assistant message.
- Queue processing uses BullMQ retries with exponential backoff for the active delivery path.
- If queue publication fails after the provider call returns, the user-facing chat flow still completes, the raw event remains in `inference_events`, and the worker reconciliation loop or `POST /api/ingest/process-pending` can recover it.
- The current reconciliation path can continue retrying failed outbox rows beyond the queue's bounded job-attempt policy. That is a conscious durability-first tradeoff for now, but a production version should add a bounded reconciliation policy plus dead-letter handling.
