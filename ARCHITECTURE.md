# Architecture

## 1. System Overview

```
                        ┌─────────────────────────────────────────────────────────┐
                        │                      INBOUND FLOW                        │
                        └─────────────────────────────────────────────────────────┘

  Twilio                  API (Fastify)              BullMQ              Worker
    │                          │                       │                    │
    │  POST /webhook/sms        │                       │                    │
    │  (x-www-form-urlencoded) │                       │                    │
    │─────────────────────────>│                       │                    │
    │                          │ 1. validate shape      │                    │
    │                          │ 2. upsert conversation │                    │
    │                          │ 3. INSERT message      │                    │
    │                          │    (status=received)   │                    │
    │                          │ 4. queue.add(jobId=    │                    │
    │                          │    messageId)          │                    │
    │                          │───────────────────────>│                    │
    │  200 OK <5ms             │                       │                    │
    │<─────────────────────────│                       │                    │
    │                          │                       │ dequeue job        │
    │                          │                       │───────────────────>│
    │                          │                       │                    │ UPDATE status
    │                          │                       │                    │ =processing
    │                          │                       │                    │──────────────┐
    │                          │                       │                    │              │ Postgres
    │                          │                       │                    │<─────────────┘
    │                          │                       │                    │
    │                          │                       │                    │ call Twilio API
    │                          │                       │                    │ (or mock)
    │                          │                       │                    │──────────────┐
    │                          │                       │                    │              │ TwilioClient
    │                          │                       │                    │<─────────────┘
    │                          │                       │                    │
    │                          │                       │                    │ UPDATE status
    │                          │                       │                    │ =sent|failed
    │                          │                       │                    │──────────────┐
    │                          │                       │                    │              │ Postgres
    │                          │                       │                    │<─────────────┘
    │                          │                       │  ack (job done)    │
    │                          │                       │<───────────────────│
    │                          │                       │                    │


                        ┌─────────────────────────────────────────────────────────┐
                        │                    REAL-TIME / READ                      │
                        └─────────────────────────────────────────────────────────┘

  Browser (React)             API (Fastify)              Postgres
    │                              │                         │
    │  GET /conversations          │                         │
    │─────────────────────────────>│                         │
    │                              │  SELECT conversations   │
    │                              │────────────────────────>│
    │                              │<────────────────────────│
    │<─────────────────────────────│                         │
    │                              │                         │
    │  GET /conversations/:id/     │                         │
    │       messages               │                         │
    │─────────────────────────────>│                         │
    │                              │  SELECT messages        │
    │                              │────────────────────────>│
    │                              │<────────────────────────│
    │<─────────────────────────────│                         │
    │                              │                         │
    │  GET /conversations/:id/     │                         │
    │       sse  (EventSource)     │                         │
    │─────────────────────────────>│                         │
    │   text/event-stream          │                         │
    │<─────────────────────────────│                         │
    │                              │                         │
    │  ← status:processing event   │  (worker publishes to   │
    │  ← status:sent event         │   in-process emitter)   │
    │                              │                         │
```

---

## 2. The 5-Second Problem

Twilio requires that webhook endpoints respond with HTTP 200 within **5 seconds**. If the
response takes longer, Twilio marks the delivery as failed and retries — which can cause
duplicate processing.

However, processing an SMS is not fast:

| Step                        | Typical latency |
|-----------------------------|-----------------|
| Postgres INSERT              | 2–5 ms          |
| Twilio outbound API call     | 300–3000 ms     |
| Retry on transient failure   | up to 16 s      |

Total end-to-end processing can easily exceed 5 s under normal conditions and much more
under failure.

**Solution: decouple acknowledgement from processing.**

The webhook handler does the minimum necessary:
1. Validate request shape (no I/O).
2. Upsert conversation (one indexed read + conditional write).
3. Insert message row with `status = 'received'`.
4. Enqueue a BullMQ job (Redis LPUSH — sub-millisecond).
5. Return `200 OK`.

Total webhook latency: **< 50 ms** in the worst case, **< 10 ms** typically.
Processing happens asynchronously in a separate worker process.

---

## 3. Processing Decoupling

```
Webhook handler (Fastify)          BullMQ Queue (Redis)       Worker process
        │                                   │                        │
        │── INSERT message ──> Postgres      │                        │
        │── queue.add(jobId=messageId) ─────>│                        │
        │<── 200 OK                          │                        │
                                             │── dequeue ────────────>│
                                             │                        │── UPDATE status=processing
                                             │                        │── TwilioClient.send()
                                             │                        │── UPDATE status=sent|failed
                                             │                        │── ack
```

The queue is the contract between the webhook and the worker:

- **Producer** (webhook handler): fire-and-forget after the job is enqueued.
- **Consumer** (worker): processes at its own pace, retries on failure, never blocks the HTTP tier.
- **Backpressure**: BullMQ's `concurrency` option limits parallel Twilio calls per worker.
- **Scaling**: add more worker replicas; they compete for jobs from the same Redis queue.

---

## 4. Idempotency

Twilio has an **at-least-once** delivery guarantee. The same webhook can be delivered
multiple times if the first response was lost or delayed.

**Defense in depth:**

### Layer 1 — Database UNIQUE constraint

```sql
ALTER TABLE messages ADD CONSTRAINT messages_twilio_sid_unique UNIQUE (twilio_sid);
```

The INSERT uses `ON CONFLICT (twilio_sid) DO NOTHING`. A duplicate webhook produces zero
new rows and returns the existing `messageId` (or nothing). No duplicate processing.

### Layer 2 — BullMQ `jobId` deduplication

```ts
await queue.add('process-sms', payload, { jobId: messageId });
```

BullMQ rejects jobs with a duplicate `jobId` if the original job is still active/waiting.
Even if the DB row somehow got created twice (impossible with UNIQUE, but defensive),
no second job is enqueued.

### Layer 3 — Worker guard

Before calling Twilio, the worker checks `status`. If `status !== 'received'`, it skips
the Twilio call. This catches edge cases where a job was re-queued after a crash mid-flight.

---

## 5. No Message Loss

### BullMQ + Redis persistence

- Jobs are stored in Redis sorted sets. Even if all workers crash, jobs survive.
- Redis AOF/RDB ensures durability on the Redis side.
- Workers use `removeOnComplete: false` during development; production can tune TTL.

### Ack-after-write

The worker only acknowledges (completes) the job **after** the final `UPDATE status=...`
has been committed to Postgres. If the worker crashes between the Twilio call and the DB
write, the job remains in `active` state and is re-delivered after `lockDuration`.

### Exponential back-off retry

```ts
{
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 }
}
// delays: 1s, 2s, 4s, 8s, 16s
```

Transient Twilio errors (5xx, network timeout) are retried automatically.

### Dead Letter Queue (DLQ)

After all attempts are exhausted, the job moves to the `failed` set. A separate process
(or a Bull Board alert) can inspect and re-queue. The message row retains `status=failed`
so it is visible in the UI.

---

## 6. Message Ordering

Within a conversation, message ordering matters (replies must be processed in sequence).

**Strategy: `groupKey` = `conversationId`**

BullMQ supports named groups (Bull MQ Pro) or can be emulated with a per-conversation
queue prefix. In this implementation, a simpler approach is used:

- Worker `concurrency = 1` per conversation is approximated by relying on BullMQ's FIFO
  queue and keeping one active job per `conversationId` using a Redis lock:
  `lock:conversation:{conversationId}`.
- If a lock is held, the job is delayed by 500 ms and retried (not a failure retry —
  a deliberate reschedule).

**Trade-off:**

| Property          | With ordering       | Without ordering     |
|-------------------|---------------------|----------------------|
| Throughput        | Limited by conv.    | Full parallelism     |
| Reply coherence   | Guaranteed          | Best-effort          |
| Complexity        | Moderate            | Low                  |

For a challenge scope with a single worker, global `concurrency = 5` is acceptable and
ordering is implicitly preserved by the FIFO queue.

---

## 7. Data Model

```sql
-- Represents a unique phone-number conversation thread
CREATE TABLE conversations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT        NOT NULL UNIQUE,   -- E.164 format (+5511...)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every inbound (and future outbound) SMS message
CREATE TABLE messages (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID     NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  twilio_sid   TEXT        NOT NULL,          -- SM... from Twilio; idempotency key
  direction    TEXT        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body         TEXT        NOT NULL,          -- raw SMS content
  status       TEXT        NOT NULL           -- state machine (see below)
               CHECK (status IN ('received', 'processing', 'sent', 'failed')),
  error        TEXT,                          -- last error message if status=failed
  attempts     INT         NOT NULL DEFAULT 0, -- BullMQ retry count mirror
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT messages_twilio_sid_unique UNIQUE (twilio_sid)
);

-- Indices
CREATE INDEX messages_conversation_id_created_at
  ON messages (conversation_id, created_at DESC);

CREATE INDEX messages_status
  ON messages (status)
  WHERE status IN ('received', 'processing');   -- partial index; only open jobs
```

### Field explanations

| Field              | Purpose                                                                  |
|--------------------|--------------------------------------------------------------------------|
| `id`               | Internal UUID PK; used as BullMQ `jobId` for deduplication              |
| `conversation_id`  | Groups messages by phone number; FK with CASCADE delete                  |
| `twilio_sid`       | Twilio's `MessageSid`; UNIQUE ensures idempotency at DB level            |
| `direction`        | `inbound` = Twilio→us; `outbound` = us→Twilio (reply)                   |
| `body`             | Raw SMS text; PII — see SECURITY.md                                      |
| `status`           | State machine: `received` → `processing` → `sent` / `failed`            |
| `error`            | Last error string; helps debugging without tailing worker logs           |
| `attempts`         | Mirrors BullMQ attempts; visible in the admin UI                         |
| `updated_at`       | Used by SSE to detect changes when polling (fallback mode)               |

### Status State Machine

```
received ──> processing ──> sent
                  │
                  └──────> failed (after N attempts)
```

---

## 8. Real-time Updates

### Why SSE over polling

| Mechanism   | Latency  | Connections | Complexity |
|-------------|----------|-------------|------------|
| Polling     | ~2–5 s   | O(clients × interval) | Low     |
| SSE         | ~50 ms   | 1 per client | Low–Medium |
| WebSocket   | ~10 ms   | 1 per client | High      |

SSE is the pragmatic choice: native browser support, works through HTTP/2 multiplexing,
half-duplex is sufficient (server→browser only), and no extra infra.

### Current implementation (single-node)

The worker emits status changes via a Node.js `EventEmitter` (in-process). The SSE
handler subscribes to that emitter and forwards events to the browser.

```
Worker → EventEmitter (in-process) → SSE handler → Browser
```

**Limitation:** this only works when the API and worker share the same process or OS.
On separate containers, events from worker container A do not reach API container B.

### Upgrade path — Redis Pub/Sub

Replace the in-process emitter with Redis pub/sub:

```
Worker → Redis PUBLISH conversation:{id} → API subscribes → SSE → Browser
```

This allows N API replicas and M worker replicas to interoperate correctly, with no
shared state beyond Redis (which is already required for BullMQ).

---

## 9. Twilio Integration

### Mockable interface

```ts
interface TwilioClient {
  sendMessage(to: string, body: string): Promise<{ sid: string }>;
}

class RealTwilioClient implements TwilioClient { ... }
class MockTwilioClient implements TwilioClient { ... }
```

Selected via `TWILIO_USE_MOCK=true`. The mock adds configurable latency (100–800 ms) and
simulates occasional failures (10% by default) to allow realistic testing without a
Twilio account.

### Signature validation

Twilio signs every webhook with HMAC-SHA1 using the auth token:

```
X-Twilio-Signature: base64(HMAC-SHA1(authToken, url + sortedParams))
```

Enable with `TWILIO_VALIDATE_SIGNATURE=true`. Validation is a Fastify preHandler hook
applied only to `/webhook/*` routes. In mock/development mode the header is absent and
validation is skipped.

### At-least-once delivery

Twilio retries failed webhooks. The combination of UNIQUE constraint + ON CONFLICT
handles duplicate delivery transparently. The client receives a `200` for all duplicates
(so Twilio stops retrying) but no duplicate processing occurs.

---

## 10. Production Considerations

### Observability

| Signal  | Tool                   | Details                                               |
|---------|------------------------|-------------------------------------------------------|
| Traces  | OpenTelemetry + OTLP   | Trace per webhook; span per job; correlate via traceId |
| Logs    | pino (JSON)            | Structured; `messageId` in every log line; PII masked  |
| Metrics | Prometheus + Grafana   | Queue depth, job latency p50/p95, error rate           |
| Errors  | Sentry (optional)      | DLQ alerts, worker panics                              |

### Scalability

- **API**: stateless Fastify; scale horizontally behind a load balancer.
- **Workers**: stateless BullMQ consumers; scale independently. Add replicas until queue
  depth stabilises.
- **Postgres**: add a read replica for the conversations list query; primary handles
  writes only.
- **Redis**: Redis Cluster if queue depth exceeds single-node capacity.

### Security

See `SECURITY.md` for the full threat model. Key points:

- `TWILIO_VALIDATE_SIGNATURE=true` in production.
- Twilio IP allowlist at the load balancer / WAF level.
- Secrets via Vault or cloud KMS — never in environment files on disk.
- HTTPS only; HSTS preloading.
- Admin UI (Bull Board) behind OIDC (Keycloak / Auth0).

### Compliance

- **Audit log**: append-only table `audit_events(id, entity, entity_id, action, actor, ts, payload)`.
  Written by triggers; no application code can update it.
- **PII retention**: `body` column encrypted at rest (pgcrypto or Vault Transit).
  Purge policy: 90 days soft-delete, then hard-delete via cron.

---

## 11. Trade-offs Table

| Decision              | Choice                    | Alternative               | Reason                                                                 |
|-----------------------|---------------------------|---------------------------|------------------------------------------------------------------------|
| Queue                 | BullMQ (Redis)            | SQS / RabbitMQ            | Zero infra overhead; Redis already needed; BullMQ UI is excellent      |
| Database              | Postgres (Drizzle)        | MySQL / MongoDB           | Strong ACID; UNIQUE constraints; native UUID; JSON operators           |
| ORM                   | Drizzle                   | Prisma / TypeORM          | Type-safe SQL; no runtime overhead; migrations as code                 |
| Real-time             | SSE                       | WebSocket / polling       | Native browser; half-duplex sufficient; simpler infra                  |
| HTTP framework        | Fastify                   | Express / Hono            | Schema-first validation; plugins; pino built-in; perf                  |
| Frontend routing      | TanStack Router            | React Router / Next.js    | Type-safe file-based routes; loader pattern; no SSR needed             |
| Idempotency           | DB UNIQUE + BullMQ jobId  | Redis SET NX              | Single source of truth in Postgres; Redis is backup layer              |
| Twilio mock           | Injected interface         | nock / jest mock          | Works in production mode too; no test-only code paths                  |
| Ordering              | FIFO + Redis lock (500 ms reschedule) | BullMQ Pro groups  | Lock is simpler than Pro; acceptable latency at challenge scale        |
| Auth                  | None (out of scope)        | OIDC / JWT                | Challenge requirement; noted as known gap                              |
| Monorepo tooling      | pnpm workspaces            | Nx / Turborepo            | Lightweight; sufficient for 3-package repo                             |

---

## 12. Known Gaps & Trade-offs Not Yet Documented

### Redis job retention growth

`removeOnComplete: false` and `removeOnFail: false` are deliberate for development
visibility — every job remains inspectable in Bull Board. In production these should be:

```ts
removeOnComplete: { age: 3600, count: 1_000 },
removeOnFail:    { age: 86_400, count: 5_000 },
```

Without TTL policy, Redis memory grows unboundedly under sustained load. Not implemented.

### SSE + polling dual mechanism

The frontend subscribes to `GET /conversations/:id/sse` (EventSource) **and** polls via
`refetchInterval` (3–5 s) simultaneously. SSE is the primary path; polling is a silent
fallback for SSE drops without reconnect logic. Cost: ~20 % of requests are redundant
when the SSE stream is healthy. A proper reconnect strategy would eliminate the polling
dependency; not worth the complexity at challenge scope.

### No pagination on conversation list

`GET /conversations` returns all rows. At 100 k+ conversations this becomes a
multi-megabyte response. Offset or cursor pagination is linear work that is out of scope
for this challenge. The partial index on `status` mitigates query cost, but the wire
payload is unbounded.

### No Twilio rate limiting on the worker

`concurrency = 10` allows up to 10 simultaneous Twilio API calls per worker process. If
all 10 fail with a 429, all 10 retry simultaneously — amplifying the storm. BullMQ's
built-in `RateLimiter` would cap requests per time window:

```ts
limiter: { max: 5, duration: 1000 }
```

Acceptable at challenge traffic volumes; required in production.

### SSE is single-node only

Documented in §8. Mitigation in this implementation: the React client polls as a fallback.
Upgrade path: Redis Pub/Sub (§8). Not implemented.
