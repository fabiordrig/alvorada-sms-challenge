# Architecture

## 1. System Overview

```
                       ┌──────────────────────────────┐
                       │          INBOUND FLOW         │
                       └──────────────────────────────┘

  Twilio           API (Fastify)        BullMQ          Worker
    │                   │                 │               │
    │  POST /webhook/sms│                 │               │
    │──────────────────>│                 │               │
    │                   │ 1. validate     │               │
    │                   │ 2. upsert conv  │               │
    │                   │ 3. INSERT msg   │               │
    │                   │ 4. queue.add()  │               │
    │                   │────────────────>│               │
    │  200 OK <5ms      │                 │               │
    │<──────────────────│                 │               │
    │                   │                 │ dequeue       │
    │                   │                 │──────────────>│
    │                   │                 │               │ UPDATE status=processing → Postgres
    │                   │                 │               │ TwilioClient.send()
    │                   │                 │               │ UPDATE status=sent|failed → Postgres
    │                   │                 │<── ack ───────│

                       ┌──────────────────────────────┐
                       │        REAL-TIME / READ       │
                       └──────────────────────────────┘

  Browser (React)      API (Fastify)        Postgres
    │                       │                  │
    │  GET /conversations   │                  │
    │──────────────────────>│──SELECT──────────>│
    │<──────────────────────│<─────────────────│
    │                       │                  │
    │  GET /conversations/:id/messages          │
    │──────────────────────>│──SELECT──────────>│
    │<──────────────────────│<─────────────────│
    │                       │                  │
    │  GET /conversations/:id/sse (EventSource)│
    │──────────────────────>│                  │
    │   ← status:processing │ (worker publishes│
    │   ← status:sent       │  via in-process  │
    │                       │  emitter)        │
```

---

## 2. The 5-Second Problem

Twilio requires HTTP 200 within **5 seconds**; late responses cause retries and duplicate processing. Processing an SMS far exceeds that budget:

| Step                      | Typical latency |
|---------------------------|-----------------|
| Postgres INSERT            | 2–5 ms          |
| Twilio outbound API call   | 300–3000 ms     |
| Retry on transient failure | up to 16 s      |

**Solution:** the webhook handler does only: validate → upsert conversation → INSERT message (`status=received`) → enqueue BullMQ job → return `200 OK`. Total webhook latency: **< 50 ms**. Processing is async in a separate worker.

---

## 3. Processing Decoupling

```
Webhook (Fastify)                BullMQ (Redis)         Worker
  │── INSERT message ──> Postgres    │                     │
  │── queue.add(jobId=messageId) ───>│                     │
  │<── 200 OK                        │── dequeue ─────────>│
                                     │                     │── UPDATE status=processing
                                     │                     │── TwilioClient.send()
                                     │                     │── UPDATE status=sent|failed
                                     │                     │── ack
```

- **Producer** (webhook): fire-and-forget after enqueue.
- **Consumer** (worker): processes at its own pace, retries on failure, never blocks HTTP.
- **Backpressure**: BullMQ `concurrency` limits parallel Twilio calls per worker.
- **Scaling**: add worker replicas; they compete for jobs from the same Redis queue.

---

## 4. Idempotency

Twilio has **at-least-once** delivery; the same webhook may arrive multiple times.

### Layer 1 — Database UNIQUE constraint

INSERT uses `ON CONFLICT (twilio_sid) DO NOTHING`. Duplicate webhooks produce no new rows and no duplicate processing.

### Layer 2 — BullMQ `jobId` deduplication

```ts
await queue.add('process-sms', payload, { jobId: messageId });
```

BullMQ rejects duplicate `jobId`s while the original job is active/waiting.

### Layer 3 — Worker guard

Worker checks `status` before calling Twilio. If `status !== 'received'`, the Twilio call is skipped — handles edge cases from mid-flight crashes.

---

## 5. No Message Loss

- **Redis persistence**: jobs stored in sorted sets survive worker crashes. AOF/RDB ensures Redis-side durability.
- **Ack-after-write**: worker only acks after final `UPDATE status=...` is committed to Postgres. Crash before that → job stays `active` → re-delivered after `lockDuration`.
- **Exponential back-off**: `attempts: 5`, `backoff: { type: 'exponential', delay: 1000 }` — delays 1 s, 2 s, 4 s, 8 s, 16 s.
- **Dead Letter Queue**: after all attempts exhausted, job moves to `failed` set. Message row retains `status=failed` and is visible in UI.

---

## 6. Message Ordering

Within a conversation, replies must process in sequence.

**Strategy:** global FIFO queue with a Redis lock `lock:conversation:{conversationId}`. If the lock is held, the job is delayed 500 ms and rescheduled (not a failure retry).

| Property        | With ordering      | Without ordering |
|-----------------|--------------------|------------------|
| Throughput      | Limited by conv.   | Full parallelism |
| Reply coherence | Guaranteed         | Best-effort      |
| Complexity      | Moderate           | Low              |

At challenge scope with a single worker, global `concurrency = 10` is acceptable and ordering is implicitly preserved by FIFO.

---

## 7. Data Model

```sql
CREATE TABLE conversations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT        NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  twilio_sid      TEXT        NOT NULL,
  direction       TEXT        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body            TEXT        NOT NULL,
  status          TEXT        NOT NULL CHECK (status IN ('received', 'processing', 'sent', 'failed')),
  error           TEXT,
  attempts        INT         NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT messages_twilio_sid_unique UNIQUE (twilio_sid)
);

CREATE INDEX messages_conversation_id_created_at ON messages (conversation_id, created_at DESC);
CREATE INDEX messages_status ON messages (status) WHERE status IN ('received', 'processing');
```

| Field             | Purpose                                                       |
|-------------------|---------------------------------------------------------------|
| `id`              | Internal UUID PK; used as BullMQ `jobId`                     |
| `conversation_id` | Groups messages by phone number; FK with CASCADE delete       |
| `twilio_sid`      | Twilio's `MessageSid`; UNIQUE ensures DB-level idempotency    |
| `direction`       | `inbound` = Twilio→us; `outbound` = us→Twilio                |
| `body`            | Raw SMS text; PII — see SECURITY.md                          |
| `status`          | State machine: `received` → `processing` → `sent` / `failed` |
| `error`           | Last error string; visible without tailing worker logs        |
| `attempts`        | Mirrors BullMQ attempts; visible in admin UI                  |
| `updated_at`      | Used by SSE to detect changes in fallback polling mode        |

### Status State Machine

```
received ──> processing ──> sent
                 │
                 └──────> failed (after N attempts)
```

---

## 8. Real-time Updates

| Mechanism | Latency | Connections           | Complexity  |
|-----------|---------|-----------------------|-------------|
| Polling   | ~2–5 s  | O(clients × interval) | Low         |
| SSE       | ~50 ms  | 1 per client          | Low–Medium  |
| WebSocket | ~10 ms  | 1 per client          | High        |

SSE is chosen: native browser support, works through HTTP/2, half-duplex is sufficient.

**Current implementation (single-node):** worker emits status changes via a Node.js `EventEmitter` (in-process); SSE handler subscribes and forwards to browser.

```
Worker → EventEmitter (in-process) → SSE handler → Browser
```

**Limitation:** only works when API and worker share the same process/OS.

**Upgrade path — Redis Pub/Sub:**
```
Worker → Redis PUBLISH conversation:{id} → API subscribes → SSE → Browser
```
This allows N API replicas + M worker replicas with no shared state beyond Redis.

---

## 9. Twilio Integration

`TwilioClient` is an injected interface with `RealTwilioClient` and `MockTwilioClient` implementations. Selected via `TWILIO_USE_MOCK=true`. The mock adds configurable latency (`TWILIO_MOCK_DELAY_MIN/MAX`, default 3–15 s) and a configurable failure rate (`TWILIO_MOCK_FAIL_RATE`, default 0) for realistic testing without a Twilio account.

**Signature validation:** Twilio signs webhooks with `HMAC-SHA1(authToken, url + sortedParams)` in `X-Twilio-Signature`. Enabled via `TWILIO_VALIDATE_SIGNATURE=true` as a Fastify preHandler on `/webhook/*`. Skipped in mock/dev mode.

**At-least-once delivery:** `UNIQUE (twilio_sid)` + `ON CONFLICT DO NOTHING` handles duplicates transparently — Twilio gets `200` for all duplicates so it stops retrying; no duplicate processing occurs.

---

## 10. Production Considerations

### Observability

| Signal  | Tool                 | Details                                                |
|---------|----------------------|--------------------------------------------------------|
| Traces  | OpenTelemetry + OTLP | Trace per webhook; span per job; correlate via traceId |
| Logs    | pino (JSON)          | Structured; `messageId` in every line; PII masked      |
| Metrics | Prometheus + Grafana | Queue depth, job latency p50/p95, error rate           |
| Errors  | Sentry (optional)    | DLQ alerts, worker panics                              |

### Scalability

- **API**: stateless Fastify; scale horizontally behind a load balancer.
- **Workers**: stateless BullMQ consumers; add replicas until queue depth stabilises.
- **Postgres**: read replica for conversations list; primary handles writes only.
- **Redis**: Redis Cluster if queue depth exceeds single-node capacity.

### Security

- `TWILIO_VALIDATE_SIGNATURE=true` in production.
- Twilio IP allowlist at load balancer / WAF level.
- Secrets via Vault or cloud KMS — never in env files on disk.
- HTTPS only; HSTS preloading.
- Admin UI (Bull Board) behind OIDC (Keycloak / Auth0).

### Compliance

- **Audit log**: append-only `audit_events` table written by triggers; no app code can update it.
- **PII retention**: `body` encrypted at rest (pgcrypto or Vault Transit); 90-day soft-delete then hard-delete via cron.

---

## 11. Trade-offs Table

| Decision           | Choice                           | Alternative            | Reason                                                            |
|--------------------|----------------------------------|------------------------|-------------------------------------------------------------------|
| Queue              | BullMQ (Redis)                   | SQS / RabbitMQ         | Zero infra overhead; Redis already needed; BullMQ UI is excellent |
| Database           | Postgres (Drizzle)               | MySQL / MongoDB        | Strong ACID; UNIQUE constraints; native UUID; JSON operators      |
| ORM                | Drizzle                          | Prisma / TypeORM       | Type-safe SQL; no runtime overhead; migrations as code            |
| Real-time          | SSE                              | WebSocket / polling    | Native browser; half-duplex sufficient; simpler infra             |
| HTTP framework     | Fastify                          | Express / Hono         | Schema-first validation; plugins; pino built-in; perf             |
| Frontend routing   | TanStack Router                  | React Router / Next.js | Type-safe file-based routes; loader pattern; no SSR needed        |
| Idempotency        | DB UNIQUE + BullMQ jobId         | Redis SET NX           | Single source of truth in Postgres; Redis is backup layer         |
| Twilio mock        | Injected interface               | nock / jest mock       | Works in production mode too; no test-only code paths             |
| Ordering           | FIFO + Redis lock (500 ms delay) | BullMQ Pro groups      | Lock simpler than Pro; acceptable latency at challenge scale      |
| Auth               | None (out of scope)              | OIDC / JWT             | Challenge requirement; noted as known gap                         |
| Monorepo tooling   | pnpm workspaces                  | Nx / Turborepo         | Lightweight; sufficient for 3-package repo                        |

---

## 12. Known Gaps

- **Redis job retention growth**: `removeOnComplete: false` / `removeOnFail: false` are fine for dev visibility but Redis memory grows unboundedly in production. Needs `{ age, count }` TTL policy.
- **SSE + polling dual mechanism**: frontend uses both EventSource and `refetchInterval` (3–5 s) simultaneously. SSE is primary; polling is a silent fallback. ~20% of requests are redundant when SSE is healthy. A proper reconnect strategy would eliminate the polling dependency.
- **No pagination on conversation list**: `GET /conversations` returns all rows. Unbounded wire payload at 100 k+ conversations. Offset/cursor pagination is out of scope.
- **No Twilio rate limiting on worker**: `concurrency = 10` can trigger retry storms on 429 responses. BullMQ `RateLimiter` (`max: 5, duration: 1000`) would cap this; not implemented.
- **SSE is single-node only**: documented in §8. Mitigation: React client polls as fallback. Upgrade path: Redis Pub/Sub (§8). Not implemented.
