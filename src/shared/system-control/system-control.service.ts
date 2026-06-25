import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformSettingEntity } from '../../modules/admin/entities/platform-setting.entity';

export interface SystemFlags {
  maintenanceMode: boolean;
  readOnlyMode: boolean;
  rateLimitPerMin: number; // 0 = disabled
  updatedAt: string;
}

const KEYS = {
  maintenance: 'SYSTEM_MAINTENANCE_MODE',
  readOnly: 'SYSTEM_READ_ONLY',
  rateLimit: 'SYSTEM_RATE_LIMIT_PER_MIN',
} as const;

/**
 * Emergency runtime controls for the platform — the levers that let operators
 * shed load, freeze writes, or take the customer surface offline WITHOUT a
 * redeploy or killing the box. Flags persist in platform_settings and are
 * cached in memory (refreshed every 10s and on every write) so the per-request
 * middleware check is essentially free.
 *
 * FAIL-OPEN by design: if the DB can't be read, flags default to "off" so a
 * storage hiccup can never accidentally take the whole platform down.
 */
@Injectable()
export class SystemControlService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemControlService.name);
  private flags: SystemFlags = {
    maintenanceMode: false,
    readOnlyMode: false,
    rateLimitPerMin: 0,
    updatedAt: new Date(0).toISOString(),
  };
  private timer: NodeJS.Timeout | null = null;
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    @InjectRepository(PlatformSettingEntity)
    private readonly settingsRepo: Repository<PlatformSettingEntity>,
  ) {}

  async onModuleInit() {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), 10_000);
    if (this.timer.unref) this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  getFlags(): SystemFlags {
    return { ...this.flags };
  }

  async setMaintenance(on: boolean): Promise<SystemFlags> {
    await this.upsert(KEYS.maintenance, on ? 'true' : 'false');
    return this.refresh();
  }

  async setReadOnly(on: boolean): Promise<SystemFlags> {
    await this.upsert(KEYS.readOnly, on ? 'true' : 'false');
    return this.refresh();
  }

  async setRateLimit(perMin: number): Promise<SystemFlags> {
    await this.upsert(KEYS.rateLimit, String(Math.max(0, Math.floor(perMin))));
    return this.refresh();
  }

  /**
   * Decide whether to block a request. Returns null to allow. Admin console,
   * health checks and payment webhooks are always exempt so operators never
   * lock themselves out and incident signals keep flowing.
   */
  evaluate(
    method: string,
    path: string,
    ip: string,
  ): { status: number; message: string } | null {
    if (this.isExempt(path)) return null;

    if (this.flags.maintenanceMode) {
      return {
        status: 503,
        message: 'Stack62 is under maintenance. Please try again shortly.',
      };
    }

    if (this.flags.rateLimitPerMin > 0) {
      if (this.isRateLimited(ip)) {
        return { status: 429, message: 'Too many requests. Slow down and retry.' };
      }
    }

    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
    if (this.flags.readOnlyMode && mutating) {
      return {
        status: 423,
        message: 'Stack62 is temporarily read-only. Changes are paused.',
      };
    }

    return null;
  }

  // ── internals ───────────────────────────────────────────────────────────

  private isExempt(path: string): boolean {
    // Only the customer API surface (/v1/*) is gated. Admin console, health and
    // webhooks stay up; static assets and /sys runner routes don't hit Nest's
    // gated set here.
    if (!path.startsWith('/v1')) return true;
    return (
      path.startsWith('/v1/admin') ||
      path === '/v1/health' ||
      path.startsWith('/v1/health') ||
      path.startsWith('/v1/billing/webhook')
    );
  }

  private isRateLimited(ip: string): boolean {
    const now = Date.now();
    const key = ip || 'unknown';
    const entry = this.hits.get(key);
    if (!entry || now > entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + 60_000 });
      if (this.hits.size > 50_000) this.sweep(now);
      return false;
    }
    entry.count += 1;
    return entry.count > this.flags.rateLimitPerMin;
  }

  private sweep(now: number) {
    for (const [k, v] of this.hits) {
      if (now > v.resetAt) this.hits.delete(k);
    }
  }

  private async refresh(): Promise<SystemFlags> {
    try {
      const rows = await this.settingsRepo.find({
        where: [
          { key: KEYS.maintenance },
          { key: KEYS.readOnly },
          { key: KEYS.rateLimit },
        ],
      });
      const byKey = new Map(rows.map((r) => [r.key, r.value]));
      this.flags = {
        maintenanceMode: byKey.get(KEYS.maintenance) === 'true',
        readOnlyMode: byKey.get(KEYS.readOnly) === 'true',
        rateLimitPerMin: Number(byKey.get(KEYS.rateLimit) ?? 0) || 0,
        updatedAt: new Date().toISOString(),
      };
    } catch (err) {
      // Fail-open: keep last known flags (default off). Never throw.
      this.logger.warn(
        `System-control refresh failed; keeping current flags. ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
    return this.getFlags();
  }

  private async upsert(key: string, value: string): Promise<void> {
    let row = await this.settingsRepo.findOne({ where: { key } });
    if (!row) {
      row = this.settingsRepo.create({ key, category: 'system', isSecret: false });
    }
    row.value = value;
    await this.settingsRepo.save(row);
  }
}
