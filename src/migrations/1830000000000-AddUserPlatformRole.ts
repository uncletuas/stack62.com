import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserPlatformRole1830000000000 implements MigrationInterface {
  name = 'AddUserPlatformRole1830000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "platform_role" character varying(40)`,
    );
    // Partial index — most rows are NULL (ordinary customers); we only
    // ever filter by non-null platform roles in the Assembly.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_users_platform_role" ON "users" ("platform_role") WHERE "platform_role" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_platform_role"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "platform_role"`,
    );
  }
}
