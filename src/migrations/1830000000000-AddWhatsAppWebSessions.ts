import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * WhatsApp Web ("link a device") sessions.
 *
 * Backs the phone-number pairing-code flow: Stack62 links itself as a
 * companion device on a coworker's WhatsApp account and persists the
 * Baileys auth state here so the link survives redeploys. One row per
 * `whatsapp-web` integration connection.
 *
 * DATABASE_SYNC=true already creates this table on boot for fresh deploys;
 * this migration makes the schema explicit for when sync is turned off.
 */
export class AddWhatsAppWebSessions1830000000000 implements MigrationInterface {
  name = 'AddWhatsAppWebSessions1830000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "whatsapp_web_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "connection_id" uuid NOT NULL,
        "organization_id" uuid NOT NULL,
        "auth_state" jsonb,
        "phone_number" character varying(32),
        "wa_jid" character varying(80),
        "status" character varying(24) NOT NULL DEFAULT 'pairing',
        "last_connected_at" TIMESTAMP,
        CONSTRAINT "PK_whatsapp_web_sessions" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_whatsapp_web_sessions_connection" ON "whatsapp_web_sessions" ("connection_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_whatsapp_web_sessions_connection"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "whatsapp_web_sessions"`);
  }
}
