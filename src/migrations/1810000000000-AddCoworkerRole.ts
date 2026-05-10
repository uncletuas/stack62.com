import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoworkerRole1810000000000 implements MigrationInterface {
  name = 'AddCoworkerRole1810000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coworker_configs" ADD COLUMN IF NOT EXISTS "role" character varying(40) NOT NULL DEFAULT 'staff'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coworker_configs" DROP COLUMN IF EXISTS "role"`,
    );
  }
}
