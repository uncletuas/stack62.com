import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'integration_tokens' })
@Index(['connectionId', 'status'])
export class IntegrationTokenEntity extends AppBaseEntity {
  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @Column({ name: 'token_type', type: 'varchar', length: 60, default: 'oauth' })
  tokenType!: string;

  @Column({ name: 'encrypted_access_token', type: 'text', nullable: true })
  encryptedAccessToken!: string | null;

  @Column({ name: 'encrypted_refresh_token', type: 'text', nullable: true })
  encryptedRefreshToken!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ type: 'varchar', length: 30, default: 'active' })
  status!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;
}
