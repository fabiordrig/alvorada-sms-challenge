import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';

export const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

export const smsQueue = new Queue('sms-processing', {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: false,
    removeOnFail: false,
  },
});

export interface ProcessJobData {
  messageId: string;
  conversationId: string;
  inboundBody: string;
  fromNumber: string;
}
