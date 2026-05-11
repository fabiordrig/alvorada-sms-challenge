import { Worker, Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { messages, conversations } from '../../db/schema.ts';
import { connection, ProcessJobData } from '../../queue/index.ts';
import { getTwilioClient } from '../../services/twilio/index.ts';
import { sseBus } from '../../services/events/sse.bus.ts';
import { generateReply } from './processing.handler.ts';
import { logger } from '../../lib/logger.ts';

export async function processJob(job: Job<ProcessJobData>): Promise<void> {
  const { messageId, conversationId, inboundBody, fromNumber } = job.data;
  logger.info({ messageId }, 'processing started');

  if (fromNumber === '+5511999000003') {
    throw new Error('Simulated failure for test number +5511999000003');
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
    sid = await twilioClient.sendMessage(fromNumber, replyBody);
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
    const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 3);
    if (isLastAttempt) {
      const { messageId, conversationId } = job.data as ProcessJobData;
      logger.error({ messageId, err: err.message }, 'job dead-lettered');
      await db
        .update(messages)
        .set({ status: 'failed', error: err.message, updatedAt: new Date() })
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
