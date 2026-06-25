import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

/**
 * One row per caption chunk the bot scrapes off Google Meet. In
 * Meet's UI captions arrive as discrete sentences with a speaker
 * label; we mirror that here. The end-of-call summariser reads the
 * whole transcript in order and produces the final summary.
 */
@Entity({ name: 'meeting_bot_transcripts' })
@Index(['sessionId', 'ordinal'])
export class MeetingBotTranscriptEntity extends AppBaseEntity {
  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  /** 0-indexed, monotonic in arrival order. */
  @Column({ type: 'int' })
  ordinal!: number;

  /** Speaker label as it appeared in Meet's captions ("You", "Alice"). */
  @Column({
    name: 'speaker_label',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  speakerLabel!: string | null;

  @Column({ type: 'text' })
  text!: string;

  /** Seconds since the bot joined; useful for replays. */
  @Column({ name: 'starts_at_sec', type: 'int', nullable: true })
  startsAtSec!: number | null;
}
