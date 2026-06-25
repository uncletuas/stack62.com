import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Platform staff — the internal team that operates Stack62 from the admin
 * console (assembly.loopital.com). Separate identity system from `users`:
 * own login surface, own JWT audience, mandatory 2FA, optional IP allowlist.
 *
 * DATABASE_SYNC=true already creates this table on boot for fresh deploys;
 * this migration makes the schema explicit for when sync is turned off.
 */
export class AddPlatformStaff1860000000000 implements MigrationInterface {
  name = 'AddPlatformStaff1860000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "platform_staff" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "email" character varying(255) NOT NULL,
        "password_hash" character varying(255) NOT NULL,
        "first_name" character varying(120) NOT NULL,
        "last_name" character varying(120) NOT NULL,
        "role" character varying(40) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "two_factor_secret" text,
        "two_factor_enabled_at" TIMESTAMP WITH TIME ZONE,
        "allowed_ips" jsonb,
        "must_reset_password" boolean NOT NULL DEFAULT false,
        "last_login_at" TIMESTAMP WITH TIME ZONE,
        "created_by_staff_id" uuid,
        CONSTRAINT "PK_platform_staff" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_platform_staff_email" ON "platform_staff" ("email")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_platform_staff_email"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_staff"`);
  }
}
