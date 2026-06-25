import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Message-thread actions on WhatsApp: replies (quoted), emoji reactions, and
 * delete-for-everyone tombstones — so a thread behaves like real WhatsApp.
 *
 * DATABASE_SYNC=true adds these columns automatically for fresh deploys; this
 * migration makes them explicit for deployments running with sync off.
 */
export class AddWhatsAppMessageActions1850000000002 implements MigrationInterface {
  name = 'AddWhatsAppMessageActions1850000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "reply_to_message_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "reply_to_preview" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "reactions" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "deleted" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" DROP COLUMN IF EXISTS "deleted"`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" DROP COLUMN IF EXISTS "reactions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" DROP COLUMN IF EXISTS "reply_to_preview"`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" DROP COLUMN IF EXISTS "reply_to_message_id"`,
    );
  }
}
