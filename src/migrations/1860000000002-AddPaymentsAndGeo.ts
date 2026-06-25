import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Real payment tracking + geography capture for the analytics dashboard:
 *  - payment_transactions: persisted Paystack charges (true collected revenue).
 *  - users.country / users.signup_ip: best-effort geo captured at signup.
 *  - organizations.country: editable org region.
 *
 * DATABASE_SYNC=true creates/alters these on boot for fresh deploys; this
 * migration makes them explicit for when sync is turned off.
 */
export class AddPaymentsAndGeo1860000000002 implements MigrationInterface {
  name = 'AddPaymentsAndGeo1860000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "payment_transactions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "provider" character varying(40) NOT NULL DEFAULT 'paystack',
        "reference" character varying(160) NOT NULL,
        "organization_id" uuid,
        "user_id" uuid,
        "amount" bigint NOT NULL DEFAULT 0,
        "currency" character varying(8) NOT NULL DEFAULT 'NGN',
        "status" character varying(20) NOT NULL DEFAULT 'pending',
        "channel" character varying(40),
        "customer_email" character varying(255),
        "paid_at" TIMESTAMP WITH TIME ZONE,
        "raw_event" jsonb,
        CONSTRAINT "PK_payment_transactions" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payment_transactions_reference" ON "payment_transactions" ("reference")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_payment_transactions_created_at" ON "payment_transactions" ("created_at")`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "country" character varying(2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "signup_ip" character varying(45)`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "country" character varying(2)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "country"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "signup_ip"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "country"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_payment_transactions_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_payment_transactions_reference"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_transactions"`);
  }
}
