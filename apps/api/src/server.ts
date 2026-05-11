import { config } from './config.ts';
import { logger } from './lib/logger.ts';
import { buildApp } from './app.ts';

const app = buildApp();

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
