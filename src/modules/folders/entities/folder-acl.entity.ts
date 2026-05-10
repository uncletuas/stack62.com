import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type FolderPermission = 'read' | 'comment' | 'write' | 'share' | 'admin';

/** Who an ACL row applies to. Exactly one of the three fields is set. */
export type FolderAclSubjectType =
  | 'user' // a specific user
  | 'role' // every member with this role
  | 'org_everyone' // every member of the org
  | 'workspace_everyone'; // every member of the workspace

/**
 * Folder access rule. Cascades to child folders unless an explicit child
 * rule overrides it. The full effective permission for a (user, folder)
 * pair is computed by the FoldersService at read-time, not stored.
 */
@Entity({ name: 'folder_acls' })
@Index(['folderId'])
@Index(['userId'])
export class FolderAclEntity extends AppBaseEntity {
  @Column({ name: 'folder_id', type: 'uuid' })
  folderId!: string;

  @Column({ name: 'subject_type', type: 'varchar', length: 30 })
  subjectType!: FolderAclSubjectType;

  /** Set when subjectType = 'user'. */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  /** Set when subjectType = 'role'. e.g. 'owner', 'manager', 'member'. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  role!: string | null;

  @Column({ type: 'varchar', length: 20 })
  permission!: FolderPermission;

  /** Who granted this access. */
  @Column({ name: 'granted_by_user_id', type: 'uuid' })
  grantedByUserId!: string;

  /** Optional expiry — useful for time-limited shares. */
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;
}
