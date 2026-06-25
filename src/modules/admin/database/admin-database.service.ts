import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Read-only database insight + on-demand logical backup for the ops console.
 * Backups are streamed to the operator as JSON (a snapshot of the critical
 * tables) so they work with zero extra infrastructure — no pg_dump binary or
 * storage volume required. Actually RUNNING migrations stays behind the
 * approval-gated engineering-ops flow; here we only report their status.
 */
@Injectable()
export class AdminDatabaseService {
  // Tables worth snapshotting for a config/identity/billing restore.
  private readonly BACKUP_TABLES = [
    'organizations',
    'workspaces',
    'memberships',
    'users',
    'subscriptions',
    'plans',
    'platform_staff',
    'platform_settings',
    'payment_transactions',
  ];

  constructor(private readonly dataSource: DataSource) {}

  async status() {
    const connected = this.dataSource.isInitialized;

    let pending = false;
    try {
      pending = await this.dataSource.showMigrations();
    } catch {
      pending = false;
    }

    let executed: { name: string; timestamp: string }[] = [];
    try {
      const rows = await this.dataSource.query(
        `SELECT name, timestamp FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 100`,
      );
      executed = (rows as { name: string; timestamp: string }[]).map((r) => ({
        name: r.name,
        timestamp: String(r.timestamp),
      }));
    } catch {
      executed = [];
    }

    const knownMigrations = this.dataSource.migrations.map((m) =>
      m.constructor?.name ?? 'unknown',
    );

    let sizePretty = 'unknown';
    let tableCount = 0;
    try {
      const sizeRow = await this.dataSource.query(
        `SELECT pg_size_pretty(pg_database_size(current_database())) AS size`,
      );
      sizePretty = sizeRow?.[0]?.size ?? 'unknown';
      const countRow = await this.dataSource.query(
        `SELECT COUNT(*)::int AS c FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      tableCount = Number(countRow?.[0]?.c ?? 0);
    } catch {
      /* best-effort */
    }

    return {
      connected,
      hasPendingMigrations: pending,
      executedMigrations: executed,
      knownMigrations,
      database: { sizePretty, tableCount },
    };
  }

  /** Largest tables by total size — handy when investigating bloat/growth. */
  async tableStats() {
    try {
      const rows = await this.dataSource.query(
        `SELECT relname AS table,
                n_live_tup AS rows,
                pg_size_pretty(pg_total_relation_size(relid)) AS size
           FROM pg_stat_user_tables
          ORDER BY pg_total_relation_size(relid) DESC
          LIMIT 30`,
      );
      return (rows as { table: string; rows: string; size: string }[]).map((r) => ({
        table: r.table,
        rows: Number(r.rows),
        size: r.size,
      }));
    } catch {
      return [];
    }
  }

  /** Build a logical JSON backup of the critical tables. */
  async buildBackup(): Promise<{ filename: string; payload: string }> {
    const tables: Record<string, unknown[]> = {};
    for (const table of this.BACKUP_TABLES) {
      try {
        tables[table] = await this.dataSource.query(
          `SELECT * FROM "${table}" LIMIT 100000`,
        );
      } catch {
        tables[table] = [];
      }
    }
    const snapshot = {
      generatedAt: new Date().toISOString(),
      database: this.dataSource.options.database,
      tableCount: this.BACKUP_TABLES.length,
      tables,
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return {
      filename: `stack62-backup-${stamp}.json`,
      payload: JSON.stringify(snapshot, null, 2),
    };
  }
}
