import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Admin console phases 2–5: runtime settings overlay, engineering ops requests,
 * and an operator-customised marker on plans (so admin price/limit edits survive
 * the boot-time plan re-seed). DATABASE_SYNC=true creates these on boot for
 * fresh deploys; this migration makes them explicit for when sync is off.
 */
export class AddAdminConsolePhases1860000000001 implements MigrationInterface {
  name = 'AddAdminConsolePhases1860000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "platform_settings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "key" character varying(160) NOT NULL,
        "value" text,
        "category" character varying(60) NOT NULL DEFAULT 'general',
        "is_secret" boolean NOT NULL DEFAULT false,
        "description" text,
        "updated_by_staff_id" uuid,
        CONSTRAINT "PK_platform_settings" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_platform_settings_key" ON "platform_settings" ("key")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "ops_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "type" character varying(40) NOT NULL,
        "status" character varying(40) NOT NULL DEFAULT 'pending',
        "reason" text,
        "payload" jsonb,
        "requested_by_staff_id" uuid NOT NULL,
        "decided_by_staff_id" uuid,
        "decided_at" TIMESTAMP WITH TIME ZONE,
        "executed_at" TIMESTAMP WITH TIME ZONE,
        "result" jsonb,
        "error_message" text,
        CONSTRAINT "PK_ops_requests" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ops_requests_status" ON "ops_requests" ("status")`,
    );

    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "customized_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "plans" DROP COLUMN IF EXISTS "customized_at"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ops_requests_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ops_requests"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_platform_settings_key"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_settings"`);
  }
}
