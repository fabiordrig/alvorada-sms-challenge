import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { logger } from './lib/logger';
import { db } from './db/client';
import { connection as redisConnection } from './queue/index';
import { webhookRoutes } from './modules/webhook/webhook.controller';
import { conversationsRoutes } from './modules/conversations/conversations.controller';
import { sql } from 'drizzle-orm';

export function buildApp() {
  const app = Fastify({ logger: false });

  app.register(formbody);

  app.get('/health', async () => {
    let dbOk = false;
    try {
      const result = await db.execute(sql`SELECT 1 AS ok`);
      dbOk = result.rows.length > 0;
    } catch {}
    const redisReady = redisConnection.status === 'ready';
    return { status: 'ok', db: dbOk ? 'ok' : 'error', redis: redisReady ? 'ok' : 'degraded' };
  });

  app.register(webhookRoutes);
  app.register(conversationsRoutes);

  app.setErrorHandler((error, _request, reply) => {
    logger.error(error);
    reply.code(error.statusCode ?? 500).send({ error: error.message, code: error.code });
  });

  return app;
}
