# Security

## 1. Webhook Authentication

### How it works

Twilio signs every webhook request using HMAC-SHA1:

```
signature = base64( HMAC-SHA1( authToken, url + sortedPostParams ) )
X-Twilio-Signature: <signature>
```

The API validates this header before any processing occurs. Validation is implemented as a
Fastify `preHandler` hook applied exclusively to `/webhook/*` routes.

```ts
// packages/shared/src/twilio/validateSignature.ts
import twilio from 'twilio';

export function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  return twilio.validateRequest(authToken, signature, url, params);
}
```

### Enabling validation

Set the following in `.env` (or your secrets manager):

```
TWILIO_VALIDATE_SIGNATURE=true
TWILIO_AUTH_TOKEN=<your_auth_token>
```

When `TWILIO_USE_MOCK=true` (local dev), signature validation is automatically bypassed
because the mock client does not generate real signatures.

### What happens on failure

A request with an invalid or missing signature returns `403 Forbidden` with an empty body.
No message processing occurs. The event is logged at `warn` level with the request IP.

---

## 2. Threat Model

### In scope

| Threat                        | Mitigation                                                                 |
|-------------------------------|----------------------------------------------------------------------------|
| Forged webhook (spoofing)      | HMAC-SHA1 signature validation (`TWILIO_VALIDATE_SIGNATURE=true`)          |
| Replay attack                 | Twilio timestamps in the signature; reject if `>5 min` old (configurable) |
| Duplicate delivery             | `UNIQUE(twilio_sid)` + `ON CONFLICT DO NOTHING`; idempotent processing     |
| Worker job poison pill         | BullMQ DLQ; job moves to `failed` after N attempts; no infinite loop       |
| Injection via SMS body         | Body stored as parameterized SQL; never interpolated into queries           |
| Log exfiltration of PII        | Body field masked in logs; phone numbers truncated (see PII section)       |
| Unbounded queue growth         | `WORKER_CONCURRENCY` caps parallel processing; Redis memory alerts         |

### Out of scope

| Threat                        | Reason                                                                     |
|-------------------------------|----------------------------------------------------------------------------|
| Admin UI auth                 | Explicit challenge requirement — noted as known gap                         |
| DDoS on webhook endpoint       | Handled at WAF / LB layer; out of scope for app code                       |
| Postgres SQL injection         | Drizzle uses parameterized queries; no raw string interpolation             |
| Redis unauthorized access      | Network-level control; Redis AUTH + TLS in production                      |
| Twilio account compromise      | Twilio's responsibility; rotate auth token immediately if suspected         |

---

## 3. PII

Phone numbers and message bodies are **personally identifiable information (PII)** under
GDPR, LGPD, and similar frameworks.

### What is PII in this system

| Field          | Table         | PII type                         |
|----------------|---------------|----------------------------------|
| `phone_number` | conversations | Direct identifier                |
| `body`         | messages      | Communication content / metadata |

### Logging policy

**Never log raw PII.** The pino logger serializers redact sensitive fields:

```ts
// apps/api/src/logger.ts
const redact = {
  paths: ['req.body.Body', 'req.body.From', 'message.body'],
  censor: '[REDACTED]'
};
```

Phone numbers in log lines use truncation: `+5511999****999`.

### Storage

- Message bodies are stored in Postgres. In production, enable column-level encryption
  using `pgcrypto` or Vault Transit Encryption.
- Apply a data retention policy: soft-delete after 90 days, hard-delete (including backups)
  after 180 days or per customer agreement.

### Data subject rights

To support right-to-erasure (GDPR Art. 17), the `conversations` table uses `ON DELETE CASCADE`
so deleting a conversation row removes all associated messages atomically.

---

## 4. Production Checklist

```
[ ] TWILIO_VALIDATE_SIGNATURE=true
[ ] TWILIO_AUTH_TOKEN injected from Vault / cloud secrets manager (not .env file)
[ ] Twilio IP allowlist configured at WAF / load balancer:
      https://www.twilio.com/docs/usage/security/validating-requests#allowlist
[ ] HTTPS only; TLS 1.2+ enforced; HSTS header set
[ ] Redis secured with AUTH password + TLS in transit
[ ] Postgres TLS in transit; least-privilege DB user (no superuser)
[ ] Bull Board admin UI behind OIDC (Keycloak / Auth0 / Cognito)
[ ] pino log redaction configured for PII fields
[ ] Column encryption enabled for messages.body
[ ] Data retention cron job configured (90-day soft / 180-day hard delete)
[ ] Prometheus alerts for queue depth > threshold and DLQ depth > 0
[ ] Sentry (or equivalent) wired to worker for DLQ notifications
[ ] OpenTelemetry OTLP exporter configured
[ ] Audit log table created and trigger-populated (append-only)
[ ] Security headers: Content-Security-Policy, X-Content-Type-Options, X-Frame-Options
```

---

## 5. Known Gaps

### No authentication on the admin / read API

The conversations and messages read endpoints (`GET /conversations`, `GET /conversations/:id/messages`)
are unauthenticated. This is an **explicit decision for the challenge scope**. In a
production system these would be behind JWT / session auth with role-based access control.

### No rate limiting on the webhook endpoint

The `/webhook/sms` endpoint has no rate limiting at the application layer. The assumption
is that Twilio is a trusted source and volume is controlled by Twilio account limits.
A production deployment would add rate limiting at the WAF or Fastify middleware level
(`@fastify/rate-limit`) keyed by source IP.

### Single-factor webhook trust

Signature validation alone is the webhook trust mechanism. A complementary control —
allowlisting Twilio's published IP ranges at the load balancer — is recommended in
production but not implemented here.

### No secrets rotation automation

`TWILIO_AUTH_TOKEN` rotation requires a config update and restart. In production, use
Vault dynamic secrets or AWS Secrets Manager with automatic rotation and application
hot-reload.
