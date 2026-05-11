import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { config } from './config.ts';
import { logger } from './lib/logger.ts';
import { db } from './db/client.ts';
import { connection as redisConnection } from './queue/index.ts';
import { webhookRoutes } from './modules/webhook/webhook.controller.ts';
import { conversationsRoutes } from './modules/conversations/conversations.controller.ts';
import { sql } from 'drizzle-orm';

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

const start = async () => {
  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    logger.info(`API listening on port ${config.PORT}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
