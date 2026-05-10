import { Injectable, Logger } from '@nestjs/common';

type JobHandler = (backgroundJobId: string) => Promise<void>;

@Injectable()
export class LocalJobRunnerService {
  private readonly logger = new Logger(LocalJobRunnerService.name);
  private readonly handlers = new Map<string, JobHandler>();

  register(queueName: string, handler: JobHandler) {
    this.handlers.set(queueName, handler);
  }

  dispatch(queueName: string, backgroundJobId: string) {
    const handler = this.handlers.get(queueName);
    if (!handler) {
      this.logger.warn(`No local handler registered for queue: ${queueName}`);
      return;
    }
    setImmediate(() => {
      handler(backgroundJobId).catch((err: unknown) => {
        this.logger.error(
          `Local job runner error for queue=${queueName} job=${backgroundJobId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    });
  }
}
