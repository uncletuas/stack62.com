import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type RoomKind =
  | 'channel' // public org/workspace channel
  | 'group' // private group of explicit members
  | 'dm' // direct message between two humans
  | 'coworker_private'; // 1:1 between one human + the Coworker

export type RoomVisibility = 'public' | 'private';

/**
 * A Coworker Room. Channels and DMs share this model; Coworker can be
 * a participant in any of them via the @stack62 mention. The
 * `coworker_private` kind is the "step out into a 1:1 with the AI"
 * surface — a private thread visible only to a single human + Coworker.
 *
 * A user can toggle between a group room and their `coworker_private`
 * room at any time; the chat UI swaps the thread but keeps the same
 * conversation context for the AI (memory is org-shared, not per-room).
 */
@Entity({ name: 'rooms' })
@Index(['organizationId', 'kind'])
@Index(['organizationId', 'systemId'])
export class RoomEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  /** Optional: room scoped to a specific system / project. */
  @Column({ name: 'system_id', type: 'uuid', nullable: true })
  systemId!: string | null;

  @Column({ type: 'varchar', length: 30 })
  kind!: RoomKind;

  @Column({ type: 'varchar', length: 20, default: 'private' })
  visibility!: RoomVisibility;

  /** Display name. For DMs we compute it from the participants. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  name!: string | null;

  /** Optional short purpose, like a Slack channel topic. */
  @Column({ type: 'text', nullable: true })
  topic!: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string;

  /** Whether Coworker is a participant by default. */
  @Column({ name: 'coworker_enabled', default: true })
  coworkerEnabled!: boolean;

  @Column({ name: 'last_activity_at', type: 'timestamptz', nullable: true })
  lastActivityAt!: Date | null;
}
