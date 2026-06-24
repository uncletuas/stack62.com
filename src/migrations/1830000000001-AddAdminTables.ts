import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tables owned by the Assembly (admin) module. Only created when
 * DATABASE_SYNC=false; in dev (synchronize=true) TypeORM creates them from
 * the entity metadata automatically.
 */
export class AddAdminTables1830000000001 implements MigrationInterface {
  name = 'AddAdminTables1830000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "support_tickets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "subject" character varying(200) NOT NULL,
        "body" text,
        "status" character varying(30) NOT NULL DEFAULT 'open',
        "priority" character varying(20) NOT NULL DEFAULT 'normal',
        "organization_id" uuid,
        "requester_user_id" uuid,
        "assignee_user_id" uuid,
        "sla_minutes" integer NOT NULL DEFAULT 480,
        "first_response_at" TIMESTAMPTZ,
        "resolved_at" TIMESTAMPTZ,
        "csat_score" integer,
        CONSTRAINT "pk_support_tickets" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_support_tickets_status_priority" ON "support_tickets" ("status", "priority")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_announcements" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "title" character varying(200) NOT NULL,
        "body" text NOT NULL,
        "channel" character varying(20) NOT NULL DEFAULT 'in_app',
        "status" character varying(20) NOT NULL DEFAULT 'draft',
        "audience" jsonb,
        "scheduled_for" TIMESTAMPTZ,
        "sent_at" TIMESTAMPTZ,
        "recipients_count" integer NOT NULL DEFAULT 0,
        "engaged_count" integer NOT NULL DEFAULT 0,
        "created_by_user_id" uuid,
        CONSTRAINT "pk_admin_announcements" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_admin_announcements_status_channel" ON "admin_announcements" ("status", "channel")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "platform_configs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "key" character varying(160) NOT NULL,
        "value" text,
        "previous_value" text,
        "category" character varying(30) NOT NULL DEFAULT 'general',
        "description" text,
        "is_secret" boolean NOT NULL DEFAULT false,
        "version" integer NOT NULL DEFAULT 1,
        "updated_by_user_id" uuid,
        CONSTRAINT "pk_platform_configs" PRIMARY KEY ("id"),
        CONSTRAINT "uq_platform_configs_key" UNIQUE ("key")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_ip_rules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "cidr" character varying(64) NOT NULL,
        "kind" character varying(10) NOT NULL DEFAULT 'block',
        "reason" text,
        "created_by_user_id" uuid,
        CONSTRAINT "pk_admin_ip_rules" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_admin_ip_rules_kind" ON "admin_ip_rules" ("kind")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_security_incidents" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "title" character varying(200) NOT NULL,
        "detail" text,
        "severity" character varying(20) NOT NULL DEFAULT 'medium',
        "status" character varying(20) NOT NULL DEFAULT 'open',
        "source" character varying(80) NOT NULL DEFAULT 'manual',
        "organization_id" uuid,
        "subject_user_id" uuid,
        "ip_address" character varying(64),
        "assignee_user_id" uuid,
        "resolved_at" TIMESTAMPTZ,
        CONSTRAINT "pk_admin_security_incidents" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_admin_security_incidents_status_severity" ON "admin_security_incidents" ("status", "severity")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_security_incidents"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_ip_rules"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_configs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_announcements"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "support_tickets"`);
  }
}
