import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrapWorker() {
  const appContext = await NestFactory.createApplicationContext(WorkerModule);
  const logger = new Logger('Stack62Worker');

  logger.log(
    'Worker process started. AI orchestration and coworker job listeners are active.',
  );

  const closeGracefully = async (signal: string) => {
    logger.warn(`Received ${signal}. Closing worker context...`);
    await appContext.close();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void closeGracefully('SIGINT');
  });

  process.on('SIGTERM', () => {
    void closeGracefully('SIGTERM');
  });
}

bootstrapWorker().catch((error: unknown) => {
  const logger = new Logger('Stack62Worker');
  logger.error('Worker bootstrap failed', error);
  process.exit(1);
});
