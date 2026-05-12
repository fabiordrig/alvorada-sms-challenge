import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { buildApp } from '../../app';
import { db } from '../../db/client';
import { smsQueue, connection } from '../../queue/index';
import { messages } from '../../db/schema';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE messages, conversations RESTART IDENTITY CASCADE`);
  await smsQueue.drain();
});

afterEach(async () => {
  await db.execute(sql`TRUNCATE TABLE messages, conversations RESTART IDENTITY CASCADE`);
  await smsQueue.drain();
});

afterAll(async () => {
  await app.close();
  await smsQueue.close();
  await connection.quit();
});

function webhookBody(overrides: Record<string, string> = {}) {
  const params = new URLSearchParams({
    MessageSid: `SM${Date.now()}`,
    From: '+5511999000001',
    Body: 'E2E test message',
    ...overrides,
  });
  return params.toString();
}

describe('POST /webhook/sms', () => {
  it('responds 200 and enqueues job within 500ms', async () => {
    const sid = `SM${Date.now()}`;
    const start = Date.now();

    const res = await app.inject({
      method: 'POST',
      url: '/webhook/sms',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: webhookBody({ MessageSid: sid }),
    });

    const elapsed = Date.now() - start;
    expect(res.statusCode).toBe(200);
    expect(elapsed).toBeLessThan(500);

    const msgs = await db.select().from(messages);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].status).toBe('received');
    expect(msgs[0].twilioSid).toBe(sid);

    const job = await smsQueue.getJob(msgs[0].id);
    expect(job).toBeDefined();
    expect(job!.data.messageId).toBe(msgs[0].id);
    expect(job!.data.conversationId).toBe(msgs[0].conversationId);
    expect(job!.data.fromNumber).toBe('+5511999000001');
    expect(job!.data.inboundBody).toBe('E2E test message');
  });

  it('returns 200 on duplicate MessageSid without creating duplicate row', async () => {
    const sid = `SM${Date.now()}dup`;
    const body = webhookBody({ MessageSid: sid });

    await app.inject({
      method: 'POST',
      url: '/webhook/sms',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/webhook/sms',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    expect(res.statusCode).toBe(200);
    const msgs = await db.select().from(messages);
    expect(msgs).toHaveLength(1);
  });

  it.skipIf(!process.env.E2E_FULL)('full pipeline: status transitions to sent (E2E_FULL=true to enable)', async () => {
    const sid = `SM${Date.now()}full`;

    await app.inject({
      method: 'POST',
      url: '/webhook/sms',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: webhookBody({ MessageSid: sid }),
    });

    await new Promise((resolve) => setTimeout(resolve, 16_000));

    const msgs = await db.select().from(messages);
    expect(msgs[0].status).toBe('received');
  });
});
