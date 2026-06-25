import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * WhatsApp coworker messaging: conversation threads, their messages, and the
 * per-workspace auto-reply agent configuration.
 *
 *  - whatsapp_conversations: one row per (connection, contact) — the system's
 *    representation of a WhatsApp chat, across both the linked-device and
 *    Cloud API channels.
 *  - whatsapp_messages: inbound + outbound messages within a conversation.
 *  - whatsapp_agent_configs: per-workspace controls for automatic coworker
 *    replies (on/off, schedule, delay, tone, identity, business info).
 *
 * DATABASE_SYNC=true creates these on boot for fresh deploys; this makes the
 * schema explicit for when sync is turned off.
 */
export class AddWhatsAppCoworkerMessaging1840000000000 implements MigrationInterface {
  name = 'AddWhatsAppCoworkerMessaging1840000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "whatsapp_conversations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "organization_id" uuid NOT NULL,
        "workspace_id" uuid,
        "connection_id" uuid NOT NULL,
        "channel" character varying(12) NOT NULL,
        "contact_phone" character varying(32) NOT NULL,
        "contact_jid" character varying(80),
        "contact_name" character varying(160),
        "last_message_at" TIMESTAMP,
        "last_message_preview" text,
        "last_direction" character varying(10),
        "unread_count" integer NOT NULL DEFAULT 0,
        "auto_reply_override" boolean,
        "status" character varying(12) NOT NULL DEFAULT 'open',
        CONSTRAINT "PK_whatsapp_conversations" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_whatsapp_conversations_contact" ON "whatsapp_conversations" ("connection_id", "contact_phone")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_whatsapp_conversations_tenant" ON "whatsapp_conversations" ("organization_id", "workspace_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "whatsapp_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "conversation_id" uuid NOT NULL,
        "organization_id" uuid NOT NULL,
        "connection_id" uuid NOT NULL,
        "direction" character varying(10) NOT NULL,
        "text" text NOT NULL DEFAULT '',
        "wa_message_id" character varying(120),
        "authored_by" character varying(12) NOT NULL DEFAULT 'contact',
        "status" character varying(16) NOT NULL DEFAULT 'received',
        CONSTRAINT "PK_whatsapp_messages" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_whatsapp_messages_conversation" ON "whatsapp_messages" ("conversation_id", "created_at")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "whatsapp_agent_configs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "organization_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "auto_reply_enabled" boolean NOT NULL DEFAULT false,
        "response_schedule" character varying(20) NOT NULL DEFAULT 'always',
        "business_hours" jsonb,
        "tone" text,
        "response_delay_seconds" integer NOT NULL DEFAULT 5,
        "identity_name" character varying(80),
        "identity_role" character varying(160),
        "signature" text,
        "business_info" text,
        "away_message" text,
        "max_auto_replies_per_day" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_whatsapp_agent_configs" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_whatsapp_agent_configs_tenant" ON "whatsapp_agent_configs" ("organization_id", "workspace_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_whatsapp_agent_configs_tenant"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "whatsapp_agent_configs"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_whatsapp_messages_conversation"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "whatsapp_messages"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_whatsapp_conversations_tenant"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_whatsapp_conversations_contact"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "whatsapp_conversations"`);
  }
}
