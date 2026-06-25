import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';
import type { FolderPermission } from '../../folders/entities/folder-acl.entity';

/**
 * Direct file share to a specific person — orthogonal to folder ACLs.
 * If the recipient is on Stack62, `targetUserId` is set; otherwise we
 * stash their email and resolve when they sign up.
 *
 * `shareToken` is a 32-byte url-safe token used for anonymous public
 * links (`/share/<token>`) — null for direct shares.
 */
@Entity({ name: 'file_shares' })
@Index(['fileId'])
@Index(['targetUserId'])
@Index(['targetEmail'])
@Index(['shareToken'], { unique: true, where: '"share_token" IS NOT NULL' })
export class FileShareEntity extends AppBaseEntity {
  @Column({ name: 'file_id', type: 'uuid' })
  fileId!: string;

  /** Set when the recipient is already on Stack62. */
  @Column({ name: 'target_user_id', type: 'uuid', nullable: true })
  targetUserId!: string | null;

  /**
   * Set when the recipient hasn't signed up yet. We attach the share to
   * their account when they register with this email.
   */
  @Column({
    name: 'target_email',
    type: 'varchar',
    length: 320,
    nullable: true,
  })
  targetEmail!: string | null;

  /** Anonymous-link token, when `subjectType=link`. */
  @Column({ name: 'share_token', type: 'varchar', length: 64, nullable: true })
  shareToken!: string | null;

  @Column({ type: 'varchar', length: 20 })
  permission!: FolderPermission;

  @Column({ name: 'shared_by_user_id', type: 'uuid' })
  sharedByUserId!: string;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ name: 'optional_message', type: 'text', nullable: true })
  optionalMessage!: string | null;
}
