import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Store the contact's WhatsApp profile picture URL on the conversation so the
 * inbox and thread can render real avatars — "just like WhatsApp" — instead of
 * a generic placeholder. The URL is a WhatsApp CDN link that can expire, so the
 * linked-device handler refreshes it on each inbound message.
 *
 * DATABASE_SYNC=true adds this column automatically for fresh deploys; this
 * migration makes it explicit for deployments running with sync off.
 */
export class AddWhatsAppContactAvatar1850000000000 implements MigrationInterface {
  name = 'AddWhatsAppContactAvatar1850000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_conversations" ADD COLUMN IF NOT EXISTS "contact_avatar_url" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_conversations" DROP COLUMN IF EXISTS "contact_avatar_url"`,
    );
  }
}
