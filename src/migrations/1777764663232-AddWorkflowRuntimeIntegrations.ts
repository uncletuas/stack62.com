import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkflowRuntimeIntegrations1777764663232 implements MigrationInterface {
  name = 'AddWorkflowRuntimeIntegrations1777764663232';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "workflow_runs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "organization_id" uuid NOT NULL, "workspace_id" uuid NOT NULL, "system_id" uuid NOT NULL, "workflow_definition_id" uuid NOT NULL, "record_id" uuid, "started_by_user_id" uuid NOT NULL, "current_step_key" character varying(180), "status" character varying(40) NOT NULL DEFAULT 'active', "context" jsonb, "history" jsonb NOT NULL DEFAULT '[]', "next_run_at" TIMESTAMP, "retry_count" integer NOT NULL DEFAULT '0', "max_retries" integer NOT NULL DEFAULT '3', "escalation_at" TIMESTAMP, "last_error" text, "completed_at" TIMESTAMP, CONSTRAINT "PK_eea9f8d0a660b3f48114c313233" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_36a5a0bb1fb43b3a50bc9f1169" ON "workflow_runs" ("workflow_definition_id", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6d136bda48969ed5856945c643" ON "workflow_runs" ("organization_id", "workspace_id", "system_id", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "integration_connections" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "organization_id" uuid NOT NULL, "workspace_id" uuid, "created_by_user_id" uuid NOT NULL, "provider_key" character varying(80) NOT NULL, "name" character varying(160) NOT NULL, "config" jsonb, "credentials" jsonb, "status" character varying(40) NOT NULL DEFAULT 'active', "last_checked_at" TIMESTAMP, CONSTRAINT "PK_b1ec518bfa5fa7404045412de2e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1fcde3fc9f4e381cff4c630e2c" ON "integration_connections" ("organization_id", "provider_key") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1fcde3fc9f4e381cff4c630e2c"`,
    );
    await queryRunner.query(`DROP TABLE "integration_connections"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6d136bda48969ed5856945c643"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_36a5a0bb1fb43b3a50bc9f1169"`,
    );
    await queryRunner.query(`DROP TABLE "workflow_runs"`);
  }
}
