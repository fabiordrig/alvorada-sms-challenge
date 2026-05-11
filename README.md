# alvorada-sms-challenge

A conversational SMS platform built on top of Twilio webhooks with asynchronous processing,
real-time status updates, and guaranteed message delivery.

## What is this

An SMS conversation management system that receives inbound messages via Twilio webhooks,
processes them asynchronously through a persistent job queue, and surfaces real-time status
updates to a React frontend — designed to handle the inherent tension between Twilio's 5-second
webhook timeout and the reality of multi-second processing pipelines.

## The Challenge

Twilio demands an HTTP 200 response within **5 seconds** or it retries the webhook. But
processing an SMS — validating, persisting, calling the Twilio API, handling failures — can
take **3–15 seconds**, especially under load or transient Twilio errors.

**How this system solves it:**

The webhook handler does the minimum (validate → persist → enqueue → `200 OK`) in under 50 ms.
A separate BullMQ worker picks up the job from Redis, processes it at its own pace, retries on
failure with exponential back-off, and updates the DB. The frontend receives live status
transitions via SSE (`received → processing → sent | failed`).

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full technical breakdown.

- **Decouple acknowledgement from processing** — webhook returns in < 50 ms; worker handles the rest
- **Idempotency at every layer** — `UNIQUE(twilio_sid)` + `ON CONFLICT DO NOTHING` + BullMQ `jobId` dedup
- **No message loss** — BullMQ persists jobs in Redis; ack only after final DB write; 5-attempt exponential retry

## Tech Stack

| Layer         | Choice                        | Reason                                                              |
|---------------|-------------------------------|---------------------------------------------------------------------|
| Runtime       | Node.js 22                    | LTS; native fetch; ESM; V8 performance                              |
| HTTP          | Fastify                       | Schema-first validation; pino logging built-in; plugin system       |
| Queue         | BullMQ + Redis                | Persistent; retry/DLQ built-in; zero extra infra; Bull Board UI     |
| Database      | Postgres (Drizzle ORM)        | ACID; UNIQUE constraints; type-safe SQL; migrations as code         |
| Frontend      | Vite + React 18               | Fast HMR; RSC-ready when needed                                     |
| Routing       | TanStack Router               | Type-safe file-based routes; loader pattern                         |
| Data fetching | TanStack Query                | Cache; background refetch; optimistic updates                       |
| Styling       | Tailwind CSS                  | Utility-first; no CSS-in-JS overhead                                |
| Real-time     | SSE (EventSource)             | Native browser; half-duplex sufficient; no extra infra              |
| Monorepo      | pnpm workspaces               | Lightweight; shared packages; workspace protocol                    |
| Twilio        | twilio SDK (mockable)         | Interface-injected mock for local dev; no account needed            |

## Prerequisites

- Node.js 22+
- pnpm 9+
- Docker + Docker Compose (Postgres + Redis)

## Setup

```bash
cp .env.example .env   # TWILIO_USE_MOCK=true by default
make setup             # install + infra up + db migrate
make dev               # api:3000 + worker + web:5173
```

The mock Twilio client is active by default. No Twilio account or credentials are needed
to run the full system locally.

## Try it

### Send an inbound SMS webhook

```bash
time curl -X POST localhost:3000/webhook/sms \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=+5511999999999&Body=hello&MessageSid=SM_test_1"
```

Expected: `200 OK` in < 100 ms. The real time output confirms the < 5 s constraint is met.

### Test idempotency

Run the exact same curl command again. Only one message row will exist in the DB:

```bash
curl localhost:3000/conversations | jq '.[0].messageCount'
# => 1  (not 2)
```

### List conversations

```bash
curl localhost:3000/conversations | jq
```

### List messages for a conversation

```bash
CONV_ID=$(curl -s localhost:3000/conversations | jq -r '.[0].id')
curl "localhost:3000/conversations/$CONV_ID/messages" | jq
```

### Watch real-time status updates

Open the frontend at [http://localhost:5173](http://localhost:5173) and send a webhook in
another terminal. Watch the status badge transition live:
`received → processing → sent`

### Simulate a failure

```bash
time curl -X POST localhost:3000/webhook/sms \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=+5511888888888&Body=fail&MessageSid=SM_fail_1"
```

The mock client has a configurable failure rate (`TWILIO_MOCK_FAIL_RATE=1.0` forces all
failures). After exhausting retries the message status becomes `failed`.

## Make targets

| Target          | Description                                                   |
|-----------------|---------------------------------------------------------------|
| `make setup`    | Install deps + start Docker services + run DB migrations      |
| `make dev`      | Start API, worker, and frontend in watch mode                 |
| `make api`      | Start only the Fastify API (port 3000)                        |
| `make worker`   | Start only the BullMQ worker                                  |
| `make web`      | Start only the Vite frontend (port 5173)                      |
| `make infra`    | Start Postgres + Redis via Docker Compose                     |
| `make migrate`  | Run Drizzle migrations                                        |
| `make db:reset` | Drop + recreate DB schema (dev only)                          |
| `make test`     | Run all tests (unit + integration)                            |
| `make lint`     | ESLint + tsc type-check across all packages                   |
| `make clean`    | Remove node_modules + dist artifacts                          |

## Environment variables

| Variable                    | Default          | Description                                         |
|-----------------------------|------------------|-----------------------------------------------------|
| `DATABASE_URL`              | (required)       | Postgres connection string                          |
| `REDIS_URL`                 | `redis://localhost:6379` | Redis connection string                   |
| `PORT`                      | `3000`           | Fastify API port                                    |
| `TWILIO_USE_MOCK`           | `true`           | Use mock Twilio client (no real account needed)     |
| `TWILIO_ACCOUNT_SID`        | —                | Required if `TWILIO_USE_MOCK=false`                 |
| `TWILIO_AUTH_TOKEN`         | —                | Required if `TWILIO_USE_MOCK=false`                 |
| `TWILIO_FROM_NUMBER`        | —                | E.164 number to send from                           |
| `TWILIO_VALIDATE_SIGNATURE` | `false`          | Enable HMAC-SHA1 webhook signature validation       |
| `TWILIO_MOCK_LATENCY_MS`    | `300`            | Simulated Twilio API latency in mock mode           |
| `TWILIO_MOCK_FAIL_RATE`     | `0.1`            | Fraction of mock calls that fail (0.0–1.0)          |
| `WORKER_CONCURRENCY`        | `5`              | Parallel jobs per worker process                    |
| `LOG_LEVEL`                 | `info`           | pino log level                                      |
| `NODE_ENV`                  | `development`    | `development` / `production` / `test`               |

## Known Limitations / Out of Scope

- **No authentication** — the API and admin UI (Bull Board) are unauthenticated. This is an
  explicit challenge scope decision. Production would add OIDC.
- **Real Twilio** — the system is designed to work with real Twilio credentials but only
  the mock client is tested end-to-end here.
- **Deployment** — no Kubernetes manifests, Dockerfile, or CI/CD pipeline. Infrastructure
  is Docker Compose only.
- **OpenTelemetry** — structured logging (pino) is in place; distributed tracing is noted
  in ARCHITECTURE.md but not wired up.
- **Rate limiting** — Twilio is treated as a trusted source; no rate limiting on the
  webhook endpoint. A real deployment would add this at the WAF/LB layer.
- **Horizontal SSE** — the SSE real-time updates work on a single node only. The upgrade
  path (Redis pub/sub) is documented in ARCHITECTURE.md but not implemented.
