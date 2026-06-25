import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

/**
 * Persisted Baileys auth state for a WhatsApp Web ("link a device") session.
 *
 * Stack62 links itself as a *companion device* on a coworker's WhatsApp
 * account via the phone-number pairing-code flow. Baileys normally writes
 * its auth state (Noise keys, Signal sessions, app-state-sync keys) to the
 * local filesystem — that does not survive a Render redeploy, so we persist
 * the whole serialized blob here instead, one row per integration connection.
 *
 * `authState` is the BufferJSON-serialized `{ creds, keys }` blob, encrypted
 * at rest with the same AES-GCM envelope used for connection credentials.
 * Whoever holds this row effectively controls the linked WhatsApp account,
 * so it is never returned to clients.
 */
@Entity({ name: 'whatsapp_web_sessions' })
@Index(['connectionId'], { unique: true })
export class WhatsAppWebSessionEntity extends AppBaseEntity {
  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** Encrypted, BufferJSON-serialized Baileys `{ creds, keys }` blob. */
  @Column({ name: 'auth_state', type: 'jsonb', nullable: true })
  authState!: Record<string, unknown> | null;

  /** Linked device phone number (digits, country code, no '+'). */
  @Column({ name: 'phone_number', type: 'varchar', length: 32, nullable: true })
  phoneNumber!: string | null;

  /** Linked WhatsApp JID once the device is registered (e.g. "234...:7@s.whatsapp.net"). */
  @Column({ name: 'wa_jid', type: 'varchar', length: 80, nullable: true })
  waJid!: string | null;

  /** pairing | connecting | ready | logged_out | error */
  @Column({ length: 24, default: 'pairing' })
  status!: string;

  @Column({ name: 'last_connected_at', type: 'timestamp', nullable: true })
  lastConnectedAt!: Date | null;
}
