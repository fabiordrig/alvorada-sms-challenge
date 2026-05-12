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

Open [http://localhost:5173](http://localhost:5173) after `make dev`.

- Use the **Simulate Inbound SMS** form to send messages without curl
- Watch status transitions live: `received → processing → sent`
- Click a conversation to open the message thread with real-time updates
- Send to `+5511999000003` to trigger a simulated processing failure

### Or via curl (API directly)

```bash
# Send a webhook — expect 200 OK in < 100 ms
time curl -X POST localhost:3000/webhook/sms \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=+5511999999999&Body=hello&MessageSid=SM_test_1"

# List conversations
curl localhost:3000/conversations | jq '.items'

# List messages for a conversation
CONV_ID=$(curl -s localhost:3000/conversations | jq -r '.items[0].id')
curl "localhost:3000/conversations/$CONV_ID/messages" | jq '.items'

# Trigger simulated failure (number +5511999000003 always fails before any I/O)
curl -X POST localhost:3000/webhook/sms \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=+5511999000003&Body=fail&MessageSid=SM_fail_1"
```

## Make targets

| Target            | Description                                                   |
|-------------------|---------------------------------------------------------------|
| `make setup`      | Install deps + start Docker services + run DB migrations      |
| `make dev`        | Start API, worker, and frontend in watch mode                 |
| `make dev-api`    | Start only the Fastify API (port 3000)                        |
| `make dev-worker` | Start only the BullMQ worker                                  |
| `make dev-web`    | Start only the Vite frontend (port 5173)                      |
| `make infra-up`   | Start Postgres + Redis via Docker Compose                     |
| `make infra-down` | Stop Postgres + Redis                                         |
| `make db-migrate` | Run Drizzle migrations                                        |
| `make db-generate`| Generate migrations from schema changes                       |
| `make reset`      | Wipe Docker volumes + reinstall + migrate (dev only)          |
| `make test`       | Run unit tests (14 tests)                                     |
| `make test-e2e`   | Run E2E tests (starts infra automatically)                    |
| `make lint`       | ESLint across all packages                                    |
| `make build`      | Build all packages                                            |

## Environment variables

| Variable                    | Default          | Description                                         |
|-----------------------------|------------------|-----------------------------------------------------|
| `DATABASE_URL`              | (required)       | Postgres connection string                          |
| `REDIS_URL`                 | (required)       | Redis connection string                             |
| `PORT`                      | `3000`           | Fastify API port                                    |
| `NODE_ENV`                  | `development`    | `development` / `production` / `test`               |
| `TWILIO_USE_MOCK`           | `true`           | Use mock Twilio client (no real account needed)     |
| `TWILIO_MOCK_DELAY_MIN`     | `3000`           | Mock min latency in ms                              |
| `TWILIO_MOCK_DELAY_MAX`     | `15000`          | Mock max latency in ms                              |
| `TWILIO_MOCK_FAIL_RATE`     | `0`              | Fraction of mock calls that fail (0.0–1.0)          |
| `TWILIO_ACCOUNT_SID`        | —                | Required if `TWILIO_USE_MOCK=false`                 |
| `TWILIO_AUTH_TOKEN`         | —                | Required if `TWILIO_USE_MOCK=false`                 |
| `TWILIO_FROM_NUMBER`        | —                | E.164 number to send from                           |
| `TWILIO_VALIDATE_SIGNATURE` | `false`          | Enable HMAC-SHA1 webhook signature validation       |
| `TWILIO_WEBHOOK_URL`        | —                | Public URL for signature validation                 |

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
