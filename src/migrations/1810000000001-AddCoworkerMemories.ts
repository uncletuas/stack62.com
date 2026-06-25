import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoworkerMemories1810000000001 implements MigrationInterface {
  name = 'AddCoworkerMemories1810000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "coworker_memories" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "organization_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "system_id" uuid,
        "kind" character varying(20) NOT NULL DEFAULT 'fact',
        "memory_key" character varying(180),
        "text" text NOT NULL,
        "source" character varying(20) NOT NULL DEFAULT 'user',
        "created_by_user_id" uuid,
        "metadata" jsonb,
        CONSTRAINT "PK_coworker_memories" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_coworker_memories_scope" ON "coworker_memories" ("organization_id", "workspace_id", "system_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_coworker_memories_scope"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "coworker_memories"`);
  }
}
