# Architecture And Implementation Plan

## Product Goal

Build a compact full-stack application that demonstrates:

- a polished multi-turn chat experience
- instrumentation around every model invocation
- a clean ingestion boundary for inference events
- enough operational visibility to reason about quality, latency, and failure modes

## Implemented Shape

### Frontend

- Conversation list with resume behavior
- Active thread view with streamed assistant output
- Provider selector per request
- Enter-to-send plus Shift+Enter newline handling
- Cancellation control for in-flight requests
- Inline metrics and dashboard panels

### Backend

- Route handlers for conversations, streaming, cancellation, ingestion, runtime info, and metrics
- Provider wrapper supporting OpenAI, Anthropic, and local fallback execution
- Event normalization, validation, and persistence
- Dashboard queries backed by normalized inference logs

### Persistence

- `conversations`
- `messages`
- `inference_events`
- `inference_logs`

## Implementation Priorities

1. Keep the user path reliable first: create thread, send message, stream response, cancel response, resume thread.
2. Keep instrumentation behind one provider wrapper so telemetry cannot drift across routes.
3. Keep storage queryable for dashboards instead of burying core fields in JSON.
4. Keep local startup simple enough that a reviewer can run it quickly.

## Why This Plan Was Chosen

- A single Next.js application keeps the repo compact and easy to evaluate.
- PostgreSQL gives realistic persistence and analytics behavior without adding unnecessary infrastructure.
- NDJSON streaming provides responsive UX with low implementation complexity.
- An outbox-style event table makes the ingestion boundary explicit without overbuilding the system.

## Next Steps Beyond This Submission

- Move cancellation state to Redis or another shared control plane
- Run event processing in a dedicated worker deployment
- Add integration coverage for streaming, cancellation, and event replay paths
- Add auth, tenant isolation, and stronger privacy policy controls
