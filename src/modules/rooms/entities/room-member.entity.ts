import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type RoomMemberRole = 'owner' | 'admin' | 'member';

/**
 * Pivot between a Room and a human user. Coworker is NOT a row here —
 * its participation is implicit (`Room.coworkerEnabled`) and gated
 * by org-level access. This keeps the membership model honest:
 * one humans-only collaboration boundary.
 */
@Entity({ name: 'room_members' })
@Unique(['roomId', 'userId'])
@Index(['userId'])
export class RoomMemberEntity extends AppBaseEntity {
  @Column({ name: 'room_id', type: 'uuid' })
  roomId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 20, default: 'member' })
  role!: RoomMemberRole;

  /** Used for unread counts. */
  @Column({ name: 'last_read_at', type: 'timestamptz', nullable: true })
  lastReadAt!: Date | null;

  /** User can mute notifications without leaving. */
  @Column({ default: false })
  muted!: boolean;
}
