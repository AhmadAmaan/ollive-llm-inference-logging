# Ollive Full Stack Assignment

Production-minded inference logging and ingestion system for an LLM application.

## What This Repo Delivers

- Multi-turn chat UI with conversation history, resume flow, and request cancellation
- Reusable provider-agnostic SDK primitives under `src/lib/sdk`
- Explicit wrapper-based instrumentation for arbitrary inference functions
- Optional monkey-patching via `fetch` instrumentation for low-friction HTTP integrations
- Streaming assistant responses over NDJSON
- Provider routing with `OpenAI`, `Anthropic`, `Mock`, or `Auto`
- Normalized inference logging with latency, token usage, status, and provider metadata
- Event-first ingestion with an outbox-style `inference_events` table plus normalized `inference_logs`
- End-to-end asynchronous ingestion using enqueue-only receipt plus background event processing
- Policy-based redaction that combines structured field redaction, sensitive-document suppression, and pattern matching
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

## SDK Surface

The demo chat application is only one consumer of the SDK. The reusable SDK lives under `src/lib/sdk` and supports two integration styles:

- explicit wrapping through `createInferenceSdk(...).wrap(...)`
- optional monkey-patching through `instrumentFetch(...)`

Example wrapper usage:

```ts
const sdk = createInferenceSdk({
  transport: createHttpEventTransport("http://localhost:3000/api/ingest/inference"),
});

const result = await sdk.wrap({
  context: {
    provider: "openai",
    model: "gpt-4.1-mini",
    operation: "support-ticket-summary",
    sessionId: "ticket-123",
  },
  input: requestPayload,
  execute: () => openai.responses.create(requestPayload),
});
```

## Architecture Summary

### Request path

1. An application call enters the SDK through an explicit wrapper or optional fetch monkey-patch.
2. The SDK captures timing, provider metadata, identifiers, previews, and error state independently of any UI.
3. The demo chat application uses that same SDK while streaming provider output back to the browser.
4. The SDK emits a normalized inference event asynchronously.
5. The ingestion endpoint validates and enqueues the raw event into `inference_events` and returns immediately.
6. A background worker claims pending events and materializes them into `inference_logs`.
7. The application flow completes without blocking on telemetry persistence.

### Storage model

- `conversations` stores thread metadata and active request state
- `messages` stores ordered user and assistant messages
- `inference_events` stores raw normalized events for asynchronous processing or replay
- `inference_logs` stores query-friendly operational fields for dashboards and debugging

### Redaction strategy

The system stores full chat content in `messages`, but only redacted previews in inference logs. The SDK redaction pipeline combines structured field redaction, sensitive-document suppression for higher-risk payloads such as health records, and baseline pattern matching for secrets and common identifiers.

## Deliberate Tradeoffs

- PostgreSQL is the default store because it is portable, familiar, and realistic for deployment and analytics.
- Schema bootstrap runs on first database access to reduce local setup friction and keep the repo easy to evaluate.
- The SDK is designed wrapper-first because explicit instrumentation is more predictable and stable across providers and client versions.
- Monkey-patching is supported as an optional convenience layer because it lowers adoption friction for existing HTTP-based integrations, but it is intentionally not the primary integration mode.
- Streaming is implemented over NDJSON because it is simple to reason about in route handlers and easy to parse incrementally in the browser.
- SDK event emission is asynchronous so inference execution is not blocked on logging persistence.
- Ingestion uses an outbox-style event table plus an in-process background worker instead of introducing an external queue immediately. That keeps the architecture small while still making the pipeline asynchronous end to end.
- Cancellation is handled through an in-memory generation registry. This keeps the control path straightforward, but it intentionally constrains the write path to a single active app replica until cancellation state is externalized.
- The compatibility route at `/messages` remains available for buffered execution, while the primary UI path uses `/stream`.

## Bonus Features Included

- Multi-provider routing
- Streaming responses
- Telemetry dashboard
- Docker Compose local environment
- Event-first ingestion with replayable pending events
- Fully asynchronous ingestion from SDK emission through background materialization
- PII-aware log preview redaction
- Self-hosted Kubernetes manifests under [k8s/README.md](./k8s/README.md)

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
- Replace the in-process background worker with a dedicated queue and worker deployment for stronger durability and cross-instance coordination.
- Add authentication, tenant boundaries, and stronger policy-driven redaction for production environments.
- Extend dashboarding with percentile latency, provider cost tracking, and alert-oriented operational views.

## Additional Notes

See [ARCHITECTURE_NOTES.md](./ARCHITECTURE_NOTES.md), [ARCHITECTURE_AND_IMPLEMENTATION_PLAN.md](./ARCHITECTURE_AND_IMPLEMENTATION_PLAN.md), and [k8s/README.md](./k8s/README.md).
