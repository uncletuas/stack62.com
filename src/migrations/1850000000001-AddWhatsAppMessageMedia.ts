import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Media attachments on WhatsApp messages. Inbound media is downloaded off the
 * linked device, stored as a file, and referenced here; outbound media sent
 * from Stack62 (by a human or the coworker) is recorded the same way so the
 * thread renders images, video, audio, and documents — not just text.
 *
 * DATABASE_SYNC=true adds these columns automatically for fresh deploys; this
 * migration makes them explicit for deployments running with sync off.
 */
export class AddWhatsAppMessageMedia1850000000001 implements MigrationInterface {
  name = 'AddWhatsAppMessageMedia1850000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "media_type" character varying(16)`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "media_file_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "media_mime_type" character varying(160)`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "media_filename" character varying(255)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" DROP COLUMN IF EXISTS "media_filename"`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" DROP COLUMN IF EXISTS "media_mime_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" DROP COLUMN IF EXISTS "media_file_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" DROP COLUMN IF EXISTS "media_type"`,
    );
  }
}
