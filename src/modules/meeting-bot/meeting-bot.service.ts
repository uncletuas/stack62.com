import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import { MeetingBotSessionEntity } from './entities/meeting-bot-session.entity';
import { MeetingBotTranscriptEntity } from './entities/meeting-bot-transcript.entity';
import {
  MEETING_BOT_QUEUE,
  MEETING_BOT_SPEAK_QUEUE,
  type MeetingBotJobData,
  type MeetingBotSpeakJobData,
} from './meeting-bot.constants';

/**
 * Service-side of the meeting bot. Owns:
 *   - session CRUD + access control
 *   - queueing the BullMQ job that the external worker consumes
 *   - receiving caption / status callbacks from the worker
 *   - kicking off the end-of-call summary (Claude via OpenRouter)
 *
 * The actual Playwright + Meet-join runs in a separate Render worker
 * service that subscribes to MEETING_BOT_QUEUE. That keeps Chromium
 * + the Playwright base image out of the main API container.
 */
@Injectable()
export class MeetingBotService {
  private readonly logger = new Logger(MeetingBotService.name);

  constructor(
    @InjectRepository(MeetingBotSessionEntity)
    private readonly sessionsRepo: Repository<MeetingBotSessionEntity>,
    @InjectRepository(MeetingBotTranscriptEntity)
    private readonly transcriptsRepo: Repository<MeetingBotTranscriptEntity>,
    @InjectQueue(MEETING_BOT_QUEUE)
    private readonly queue: Queue<MeetingBotJobData>,
    @InjectQueue(MEETING_BOT_SPEAK_QUEUE)
    private readonly speakQueue: Queue<MeetingBotSpeakJobData>,
    private readonly accessControl: AccessControlService,
    private readonly activity: ActivityService,
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  // ── Schedule ────────────────────────────────────────────────────────

  async schedule(input: {
    organizationId: string;
    workspaceId: string;
    meetingUrl: string;
    title?: string;
    roomId?: string;
    requestedByUserId: string;
  }): Promise<MeetingBotSessionEntity> {
    if (!/^https?:\/\/meet\.google\.com\//i.test(input.meetingUrl)) {
      throw new BadRequestException(
        'Only Google Meet URLs are supported. Pass a https://meet.google.com/... link.',
      );
    }

    await this.accessControl.assertResolvedAccess(input.requestedByUserId, {
      resource: 'system',
      action: 'create',
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
    });

    const session = await this.sessionsRepo.save(
      this.sessionsRepo.create({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        requestedByUserId: input.requestedByUserId,
        roomId: input.roomId ?? null,
        provider: 'google-meet',
        meetingUrl: input.meetingUrl,
        displayName:
          this.config.get<string>('MEETING_BOT_DISPLAY_NAME') ||
          'Stack62 Coworker',
        title: input.title ?? null,
        status: 'queued',
      }),
    );

    // Worker token: short-lived (2h) JWT scoped to this session id. The
    // worker uses it to authenticate when posting transcript chunks
    // and the end-of-call signal back. Limited blast radius if leaked.
    const workerToken = this.jwtService.sign(
      {
        sub: `meeting-bot:${session.id}`,
        scope: 'meeting-bot.worker',
        sessionId: session.id,
        organizationId: input.organizationId,
      },
      { expiresIn: '2h' },
    );

    await this.queue.add(
      'attend',
      {
        sessionId: session.id,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        meetingUrl: input.meetingUrl,
        displayName: session.displayName,
        apiBaseUrl:
          this.config.get<string>('APP_INTERNAL_API_URL') ||
          'http://localhost:3000',
        workerToken,
      },
      {
        attempts: 1, // a failed Meet join shouldn't retry; user will see error
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );

    await this.activity.log({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      actorUserId: input.requestedByUserId,
      action: 'meeting_bot.schedule',
      targetType: 'meeting_bot_session',
      targetId: session.id,
      origin: 'user',
      metadata: { meetingUrl: input.meetingUrl, title: input.title },
    });

    return session;
  }

  // ── Speak out (Phase 5) ─────────────────────────────────────────────
  // The user (or Coworker engine) asks the bot to say something into
  // the live meeting. We generate the TTS server-side, enqueue the
  // audio bytes on a separate queue, and the worker plays them
  // through PulseAudio's virtual sink so Chrome captures them as the
  // bot's mic input.

  async speak(input: {
    sessionId: string;
    text: string;
    actorUserId: string;
  }): Promise<{ enqueued: boolean }> {
    const session = await this.findById(input.sessionId, input.actorUserId);
    if (session.status !== 'in_meeting') {
      throw new BadRequestException(
        `Bot isn't in the meeting (status: ${session.status}). Speak is only available while the bot is live.`,
      );
    }
    const cleaned = input.text.trim();
    if (!cleaned) throw new BadRequestException('text required.');
    if (cleaned.length > 800) {
      throw new BadRequestException(
        'Keep utterances under 800 characters — long monologues are bot-energy. Break it into shorter messages.',
      );
    }

    const audio = await this.synthesiseSpeech(cleaned);
    await this.speakQueue.add(
      'speak',
      {
        sessionId: session.id,
        audioBase64: audio.toString('base64'),
        text: cleaned,
      },
      { attempts: 1, removeOnComplete: 50, removeOnFail: 25 },
    );

    await this.activity.log({
      organizationId: session.organizationId,
      workspaceId: session.workspaceId,
      actorUserId: input.actorUserId,
      action: 'meeting_bot.speak',
      targetType: 'meeting_bot_session',
      targetId: session.id,
      origin: 'user',
      metadata: { textLength: cleaned.length },
    });

    return { enqueued: true };
  }

  /**
   * Generate TTS audio via OpenAI's tts-1 model. Returns the raw
   * mp3 buffer. Voice + model are configurable via env so the user
   * can swap to tts-1-hd or a different voice without code changes.
   */
  private async synthesiseSpeech(text: string): Promise<Buffer> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new BadRequestException(
        'OPENAI_API_KEY is not configured. Speak-out needs OpenAI TTS.',
      );
    }
    const model = this.config.get<string>('MEETING_BOT_TTS_MODEL') || 'tts-1';
    const voice = this.config.get<string>('MEETING_BOT_TTS_VOICE') || 'verse';

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        voice,
        input: text,
        response_format: 'mp3',
      }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      this.logger.error(`OpenAI TTS failed: ${errText.slice(0, 200)}`);
      throw new Error(`TTS HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // ── Read ────────────────────────────────────────────────────────────

  async listForUser(
    organizationId: string,
    actorUserId: string,
    limit = 25,
  ): Promise<MeetingBotSessionEntity[]> {
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'system',
      action: 'read',
      organizationId,
    });
    return this.sessionsRepo.find({
      where: { organizationId, requestedByUserId: actorUserId },
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 100),
    });
  }

  async findById(
    sessionId: string,
    actorUserId: string,
  ): Promise<MeetingBotSessionEntity> {
    const session = await this.sessionsRepo.findOne({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Meeting session not found.');
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'system',
      action: 'read',
      organizationId: session.organizationId,
    });
    return session;
  }

  async getTranscript(sessionId: string, actorUserId: string) {
    await this.findById(sessionId, actorUserId);
    return this.transcriptsRepo.find({
      where: { sessionId },
      order: { ordinal: 'ASC' },
    });
  }

  // ── Worker callbacks ────────────────────────────────────────────────
  // Auth: the worker presents the short-lived JWT we minted at
  // scheduling time. The controller validates and forwards here.

  async markStatus(
    sessionId: string,
    status: MeetingBotSessionEntity['status'],
    extra: { errorMessage?: string } = {},
  ) {
    const update: Partial<MeetingBotSessionEntity> = { status };
    if (status === 'in_meeting') update.startedAt = new Date();
    if (
      status === 'completed' ||
      status === 'failed' ||
      status === 'cancelled'
    ) {
      update.endedAt = new Date();
    }
    if (extra.errorMessage) update.errorMessage = extra.errorMessage;
    await this.sessionsRepo.update({ id: sessionId }, update);
  }

  async appendTranscript(
    sessionId: string,
    chunks: Array<{
      speakerLabel?: string;
      text: string;
      startsAtSec?: number;
    }>,
  ) {
    if (chunks.length === 0) return;
    // Resume numbering after whatever's already on disk.
    const lastOrdinal = await this.transcriptsRepo
      .createQueryBuilder('t')
      .select('MAX(t.ordinal)', 'max')
      .where('t.sessionId = :sessionId', { sessionId })
      .getRawOne<{ max: number | null }>();
    let next = (lastOrdinal?.max ?? -1) + 1;
    const rows = chunks.map((c) =>
      this.transcriptsRepo.create({
        sessionId,
        ordinal: next++,
        speakerLabel: c.speakerLabel ?? null,
        text: c.text,
        startsAtSec: c.startsAtSec ?? null,
      }),
    );
    await this.transcriptsRepo.save(rows);
  }

  /**
   * Called by the worker when the meeting ends. We generate the
   * Claude summary asynchronously and stash it on the session.
   */
  async completeSession(sessionId: string) {
    const session = await this.sessionsRepo.findOne({
      where: { id: sessionId },
    });
    if (!session) return;
    const transcripts = await this.transcriptsRepo.find({
      where: { sessionId },
      order: { ordinal: 'ASC' },
    });
    if (transcripts.length === 0) {
      await this.sessionsRepo.update(
        { id: sessionId },
        {
          status: 'completed',
          endedAt: new Date(),
          summary:
            'No captions were captured during this meeting. (Captions may have been disabled by the host, or only one person was speaking — Meet only emits captions for non-host audio.)',
        },
      );
      return;
    }

    await this.sessionsRepo.update(
      { id: sessionId },
      { status: 'summarising' },
    );

    const transcriptText = transcripts
      .map((t) => `${t.speakerLabel ? `${t.speakerLabel}: ` : ''}${t.text}`)
      .join('\n');

    let summary: string;
    try {
      summary = await this.callSummariser(transcriptText, session.title);
    } catch (err) {
      this.logger.error(
        `Summary failed for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      summary = `Transcript captured (${transcripts.length} caption chunks). The auto-summary failed; you can re-run it from the session page.`;
    }

    await this.sessionsRepo.update(
      { id: sessionId },
      {
        status: 'completed',
        endedAt: new Date(),
        summary,
      },
    );

    // Note: posting the summary into the user's Coworker room is a
    // follow-up — the rooms service expects an actorUserId, but the
    // session row carries the requester so we have what we need.
    // Left as TODO so the worker pipeline is verifiable end-to-end
    // before we add the cross-service write.
  }

  private async callSummariser(
    transcriptText: string,
    title: string | null,
  ): Promise<string> {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY not set.');
    }
    const model =
      this.config.get<string>('MEETING_SUMMARY_MODEL') ||
      'anthropic/claude-3.5-sonnet';
    const response = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer':
            this.config.get<string>('OPENROUTER_HTTP_REFERER') ||
            'https://stack62.com',
          'X-Title': 'Stack62 Meeting Summariser',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 1200,
          messages: [
            {
              role: 'system',
              content:
                "You are a concise meeting note-taker. Given a Google Meet caption transcript, produce a brief summary, the explicit decisions made, the action items (with assignees if named), and any open questions. Use plain markdown with these four sections: ## Summary, ## Decisions, ## Action items, ## Open questions. If a section has nothing, write 'None'. Keep total length under 400 words.",
            },
            {
              role: 'user',
              content: `Meeting${title ? ` — ${title}` : ''}:\n\n${transcriptText.slice(0, 50_000)}`,
            },
          ],
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Summariser HTTP ${response.status}`);
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return (
      json.choices?.[0]?.message?.content?.trim() ||
      "Couldn't generate a summary."
    );
  }
}
