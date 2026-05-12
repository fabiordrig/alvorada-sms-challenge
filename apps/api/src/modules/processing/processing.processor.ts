import { Worker, Job, DelayedError } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { messages, conversations } from '../../db/schema';
import { connection, ProcessJobData } from '../../queue/index';
import { getTwilioClient } from '../../services/twilio/index';
import { sseBus } from '../../services/events/sse.bus';
import { generateReply } from './processing.handler';
import { logger } from '../../lib/logger';

export async function processJob(job: Job<ProcessJobData>, token?: string): Promise<void> {
  const { messageId, conversationId, inboundBody, fromNumber } = job.data;
  logger.info({ messageId }, 'processing started');

  if (fromNumber === '+5511999000003') {
    throw new Error('Simulated failure for test number +5511999000003');
  }

  const lockKey = `lock:conversation:${conversationId}`;
  const acquired = await connection.set(lockKey, '1', 'PX', 30_000, 'NX');
  if (!acquired) {
    logger.info({ conversationId, messageId }, 'lock held — rescheduling');
    await job.moveToDelayed(Date.now() + 500, token);
    throw new DelayedError();
  }

  try {
    const [current] = await db
      .select({ status: messages.status })
      .from(messages)
      .where(eq(messages.id, messageId));

    if (current?.status !== 'received') {
      logger.warn({ messageId, status: current?.status }, 'skipping — already processed');
      return;
    }

    await db
      .update(messages)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(messages.id, messageId));

    sseBus.emit('message:processing', {
      type: 'message:processing',
      conversationId,
      messageId,
      status: 'processing',
    });

    const replyBody = await generateReply(inboundBody);

    const twilioClient = getTwilioClient();
    let sid: string;
    try {
      const result = await twilioClient.sendMessage(fromNumber, replyBody);
      sid = result.sid;
    } catch (err) {
      await db
        .update(messages)
        .set({ status: 'failed', error: (err as Error).message, updatedAt: new Date() })
        .where(eq(messages.id, messageId));
      sseBus.emit('message:failed', { type: 'message:failed', conversationId, messageId, status: 'failed' });
      throw err;
    }

    await db
      .insert(messages)
      .values({ conversationId, direction: 'outbound', body: replyBody, twilioSid: sid, status: 'sent' });

    await db
      .update(messages)
      .set({ status: 'sent', updatedAt: new Date() })
      .where(eq(messages.id, messageId));

    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));

    sseBus.emit('message:sent', {
      type: 'message:sent',
      conversationId,
      messageId,
      status: 'sent',
    });

    logger.info({ messageId, sid }, 'processing complete');
  } finally {
    await connection.del(lockKey);
  }
}

export function createWorker() {
  return new Worker<ProcessJobData>('sms-processing', processJob, {
    connection,
    concurrency: 10,
  });
}

export function attachWorkerEvents(worker: Worker) {
  worker.on('failed', async (job, err) => {
    if (!job) return;
    const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 5);
    if (isLastAttempt) {
      const { messageId, conversationId } = job.data as ProcessJobData;
      logger.error({ messageId, err: err.message }, 'job dead-lettered');
      await db
        .update(messages)
        .set({ status: 'failed', error: err.message, attempts: job.attemptsMade, updatedAt: new Date() })
        .where(eq(messages.id, messageId));
      sseBus.emit('message:failed', {
        type: 'message:failed',
        conversationId,
        messageId,
        status: 'failed',
      });
    }
  });
}
