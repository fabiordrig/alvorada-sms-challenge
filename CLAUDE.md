# CLAUDE.md

## Project Overview

`alvorada-sms-challenge` is a conversational SMS platform. Twilio webhooks hit a Fastify API,
which enqueues jobs into BullMQ (Redis) and returns `200 OK` in < 50 ms. A separate worker
processes each job: persists to Postgres, calls Twilio (real or mock), updates status. A React
frontend shows conversations and live status via SSE.

Monorepo: `apps/api` (Fastify) + `apps/worker` (BullMQ consumer) + `apps/web` (Vite + React) +
`packages/shared` (types, DB schema, Twilio client interface).

## AI Behavior — Caveman Mode

- Short answers. No filler. No "Great question!". No "Certainly!".
- Code first. Explain only if asked.
- No placeholders. No `// TODO` without a ticket reference.
- No hallucinated APIs. If unsure, say so.
- Fix the actual bug. Do not add abstraction layers to avoid it.

## Spec-Driven Design

Before writing code, confirm:

1. What is the input? What is the output?
2. What are the failure modes?
3. What is the idempotency contract?
4. What changes in the DB schema?

Do not start coding until these are answered.

## Definition of Done

A task is done when:

- [ ] Types compile (`tsc --noEmit`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Tests pass (`pnpm test`)
- [ ] DB migration exists if schema changed
- [ ] No `console.log` left in production paths (use `logger`)
- [ ] No PII in log lines

## Conventions

- **Language**: English everywhere — code, comments, commit messages, PR descriptions.
- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`).
  Subject ≤ 72 chars. Body only when "why" is not obvious from the diff.
- **Comments**: no obvious comments (`// increment counter` above `counter++`).
  Comments explain *why*, never *what*.
- **Query params**: camelCase (`conversationId`, `pageSize`, `createdAfter`).
- **API responses**: camelCase JSON keys. No snake_case leaking from DB columns.
- **Error handling**: never swallow errors silently. Log with context. Re-throw or convert
  to typed error. No bare `catch (e) {}`.
- **Imports**: absolute imports via workspace packages (`@alvorada/shared`). No relative
  `../../..` across package boundaries.
- **Env vars**: validated at startup with `zod`. The app must fail fast with a clear message
  if a required variable is missing.
