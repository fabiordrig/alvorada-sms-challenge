import { config } from './config.ts';
import { logger } from './lib/logger.ts';
import { createWorker, attachWorkerEvents } from './modules/processing/processing.processor.ts';

const worker = createWorker();
attachWorkerEvents(worker);

logger.info('BullMQ worker started');

process.on('SIGTERM', async () => {
  logger.info('worker shutting down...');
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('worker shutting down...');
  await worker.close();
  process.exit(0);
});
