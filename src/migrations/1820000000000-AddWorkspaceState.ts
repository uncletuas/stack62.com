import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AI-native workspace foundation — see docs/AI_NATIVE_WORKSPACE.md.
 *
 *  - `workspace_docs` is the durable home of every doc / sheet /
 *    slide deck created via the new action pipeline. The yjs_state
 *    column is the encoded snapshot (bytea); current_version is a
 *    monotonic counter clients use to detect they're up to date
 *    without diffing the binary.
 *  - `workspace_action_log` is the immutable audit log — one row per
 *    applied action. Used by "Restore version" and by future
 *    multi-agent reconciliation.
 *
 * Indexed by (organization_id, workspace_id) so the per-tenant list
 * is fast, and by (doc_id, occurred_at) on the log so per-doc
 * history pages don't scan the whole table.
 */
export class AddWorkspaceState1820000000000 implements MigrationInterface {
  name = 'AddWorkspaceState1820000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "workspace_docs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "organization_id" uuid NOT NULL,
        "workspace_id" uuid,
        "created_by_user_id" uuid NOT NULL,
        "kind" character varying(30) NOT NULL,
        "title" character varying(200) NOT NULL,
        "yjs_state" bytea NOT NULL,
        "current_version" integer NOT NULL DEFAULT 0,
        "status" character varying(30) NOT NULL DEFAULT 'active',
        "metadata" jsonb,
        CONSTRAINT "PK_workspace_docs" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_workspace_docs_tenant" ON "workspace_docs" ("organization_id", "workspace_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_workspace_docs_kind" ON "workspace_docs" ("organization_id", "kind")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "workspace_action_log" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "doc_id" uuid NOT NULL,
        "actor_kind" character varying(20) NOT NULL,
        "actor_user_id" uuid NOT NULL,
        "coworker_id" uuid,
        "verb" character varying(64) NOT NULL,
        "payload" jsonb NOT NULL,
        "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_workspace_action_log" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_workspace_action_log_doc" ON "workspace_action_log" ("doc_id", "occurred_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_workspace_action_log_doc"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "workspace_action_log"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_workspace_docs_kind"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_workspace_docs_tenant"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workspace_docs"`);
  }
}
