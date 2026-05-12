import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { conversations, messages } from '../../db/schema';
import { smsQueue, ProcessJobData } from '../../queue/index';
import { sseBus } from '../../services/events/sse.bus';
import { logger } from '../../lib/logger';

export async function handleInbound(payload: {
  from: string;
  body: string;
  messageSid: string;
}): Promise<{ duplicate: boolean }> {
  const result = await db.transaction(async (tx) => {
    const [conv] = await tx
      .insert(conversations)
      .values({ phoneNumber: payload.from })
      .onConflictDoUpdate({
        target: conversations.phoneNumber,
        set: { updatedAt: sql`now()` },
      })
      .returning({ id: conversations.id });

    const [msg] = await tx
      .insert(messages)
      .values({
        conversationId: conv.id,
        twilioSid: payload.messageSid,
        direction: 'inbound',
        body: payload.body,
        status: 'received',
      })
      .onConflictDoNothing()
      .returning({ id: messages.id });

    return { conv, msg: msg ?? null };
  });

  if (!result.msg) {
    logger.warn({ messageSid: payload.messageSid }, 'duplicate webhook ignored');
    return { duplicate: true };
  }

  const jobData: ProcessJobData = {
    messageId: result.msg.id,
    conversationId: result.conv.id,
    inboundBody: payload.body,
    fromNumber: payload.from,
  };

  await smsQueue.add('process', jobData, { jobId: result.msg.id });

  sseBus.emit('message:received', {
    type: 'message:received',
    conversationId: result.conv.id,
    messageId: result.msg.id,
    status: 'received',
  });

  logger.info({ messageId: result.msg.id, from: payload.from }, 'inbound message queued');
  return { duplicate: false };
}
