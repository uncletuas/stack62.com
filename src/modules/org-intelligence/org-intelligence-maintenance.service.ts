import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ResponseCacheService } from './response-cache.service';

/**
 * Housekeeping for the intelligence layer. Currently: purge expired response
 * cache rows hourly so the table doesn't grow unbounded. The cache is
 * freshness-safe by design (read-like tools replay live; replies are a pure
 * function of the prompt), so this is pure cleanup, not correctness.
 */
@Injectable()
export class OrgIntelligenceMaintenanceService {
  private readonly logger = new Logger(OrgIntelligenceMaintenanceService.name);

  constructor(private readonly responseCache: ResponseCacheService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpiredCache(): Promise<void> {
    try {
      const removed = await this.responseCache.purgeExpired();
      if (removed > 0) {
        this.logger.log(`Purged ${removed} expired response-cache rows.`);
      }
    } catch (err) {
      this.logger.warn(
        `Cache purge failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
