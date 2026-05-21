# Ollive Full Stack Assignment

Production-minded inference logging and ingestion system for an LLM application.

## What This Repo Delivers

- Multi-turn chat UI with conversation history, resume flow, and request cancellation
- Streaming assistant responses over NDJSON
- Provider routing with `OpenAI`, `Anthropic`, `Mock`, or `Auto`
- Normalized inference logging with latency, token usage, status, and provider metadata
- Event-first ingestion with an outbox-style `inference_events` table plus normalized `inference_logs`
- Redaction of common sensitive data patterns before log previews are stored
- Operational dashboard for throughput, status mix, latency buckets, and provider/model mix
- Local startup via Docker Compose and self-hosted deployment manifests for Kubernetes

## Stack

- Next.js 16
- React 19
- TypeScript
- PostgreSQL
- `pg`
- Tailwind CSS 4
- Zod

## Runtime Requirements

- Node `20+`
- npm `10+`
- Docker Desktop for the containerized path

## Quick Start

### Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000)

### Local Node + local Postgres

```bash
npm install
cp .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

The development script intentionally defaults to webpack because it has been more reliable than Turbopack for this repo on macOS file watchers.

## Provider Configuration

- `OPENAI_API_KEY` enables OpenAI requests
- `ANTHROPIC_API_KEY` enables Anthropic requests
- `DEFAULT_PROVIDER` can pin `auto`, `openai`, `anthropic`, or `mock`
- When no external provider is configured, the local fallback provider keeps chat, streaming, logging, and dashboards operational

The fallback path is an explicit product decision: it keeps the application usable in development and review environments while exercising the exact same persistence, telemetry, and dashboard pipeline.

## Core Endpoints

- `GET /api/conversations`
- `POST /api/conversations`
- `GET /api/conversations/:id/messages`
- `POST /api/conversations/:id/messages`
- `POST /api/conversations/:id/stream`
- `POST /api/conversations/:id/cancel`
- `POST /api/ingest/inference`
- `POST /api/ingest/process-pending`
- `GET /api/metrics/overview`
- `GET /api/metrics/dashboard`
- `GET /api/runtime-info`

## Architecture Summary

### Request path

1. The UI creates a user message and assistant placeholder.
2. The stream route calls the provider wrapper through one instrumentation boundary.
3. Provider deltas stream back to the UI while the full response is accumulated server-side.
4. Completion emits a normalized inference event.
5. The ingestion path persists the raw event to `inference_events` and processes it into `inference_logs`.
6. The assistant message is finalized and the dashboard becomes queryable immediately.

### Storage model

- `conversations` stores thread metadata and active request state
- `messages` stores ordered user and assistant messages
- `inference_events` stores raw normalized events for asynchronous processing or replay
- `inference_logs` stores query-friendly operational fields for dashboards and debugging

### Redaction strategy

The system stores full chat content in `messages`, but only redacted previews in inference logs. That preserves product functionality while reducing exposure of emails, phones, SSNs, common API key formats, and likely payment card numbers inside operational telemetry.

## Deliberate Tradeoffs

- PostgreSQL is the default store because it is portable, familiar, and realistic for deployment and analytics.
- Schema bootstrap runs on first database access to reduce local setup friction and keep the repo easy to evaluate.
- Streaming is implemented over NDJSON because it is simple to reason about in route handlers and easy to parse incrementally in the browser.
- Ingestion uses an outbox-style event table inside the same database instead of a separate broker. That keeps the architecture small while still making the event boundary explicit and replayable.
- Cancellation is handled through an in-memory generation registry. This keeps the control path straightforward, but it intentionally constrains the write path to a single active app replica until cancellation state is externalized.
- The compatibility route at `/messages` remains available for buffered execution, while the primary UI path uses `/stream`.

## Bonus Features Included

- Multi-provider routing
- Streaming responses
- Telemetry dashboard
- Docker Compose local environment
- Event-first ingestion with replayable pending events
- PII-aware log preview redaction
- Self-hosted Kubernetes manifests under [k8s/README.md](/Users/aamaan/Documents/New%20project%203/k8s/README.md)

## Verification

```bash
npm run lint
npm run build
```

Both commands pass in this repo.

## Deployment Notes

- Docker Compose is the fastest way to run the full stack on any machine with Docker.
- Kubernetes manifests are provided for self-hosted environments with in-cluster Postgres and app deployment wiring.
- For horizontally scaled app replicas, move cancellation state out of process and place event processing behind a dedicated worker or queue consumer.

## What I Would Improve With More Time

- Add integration tests that cover streaming, cancellation, ingestion retries, and multi-provider routing end to end.
- Move cancellation state and event processing onto shared infrastructure so the app can scale beyond a single active replica.
- Add authentication, tenant boundaries, and stronger policy-driven redaction for production environments.
- Extend dashboarding with percentile latency, provider cost tracking, and alert-oriented operational views.
- Split event processing into a dedicated worker deployment once traffic justifies a stronger async boundary.

## Additional Notes

See [ARCHITECTURE_NOTES.md](/Users/aamaan/Documents/New%20project%203/ARCHITECTURE_NOTES.md), [ARCHITECTURE_AND_IMPLEMENTATION_PLAN.md](/Users/aamaan/Documents/New%20project%203/ARCHITECTURE_AND_IMPLEMENTATION_PLAN.md), and [k8s/README.md](/Users/aamaan/Documents/New%20project%203/k8s/README.md).
