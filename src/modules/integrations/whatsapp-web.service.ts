/*
 * Baileys is an ESM-only package loaded via a dynamic `import()` with a
 * variable specifier, so its surface is typed `any` here. The unsafe-* rules
 * would fire on every Baileys call; disable them file-wide rather than litter
 * the module with per-line directives.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { CryptoService } from '../../shared/security/crypto.service';
import { FilesService } from '../files/files.service';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { IntegrationConnectionEntity } from './entities/integration-connection.entity';
import { WhatsAppWebSessionEntity } from './entities/whatsapp-web-session.entity';
import { IntegrationsService } from './integrations.service';
import {
  WhatsAppConversationService,
  type MessageMedia,
} from './whatsapp-conversation.service';
import {
  type BaileysApi,
  deserializeAuthState,
  makeInMemoryAuthState,
  serializeAuthState,
  type StoredAuthState,
} from './whatsapp-web-auth-state';

export const WHATSAPP_WEB_PROVIDER_KEY = 'whatsapp-web';

interface DispatchContext {
  organizationId: string;
  workspaceId?: string | null;
  actorUserId?: string | null;
  source?: string;
}

type SessionStatus =
  | 'pairing'
  | 'connecting'
  | 'ready'
  | 'logged_out'
  | 'error';

interface LiveSession {
  sock: any;
  status: SessionStatus;
  pairingCode: string | null;
  pairingExpiresAt: number | null;
  reconnectTimer: NodeJS.Timeout | null;
  closing: boolean;
}

/**
 * Drives WhatsApp's "Link a device → Link with phone number" companion-device
 * flow via Baileys. A coworker enters their phone number, Stack62 returns the
 * 8-character pairing code shown by WhatsApp, and once they enter it on their
 * phone the linked account can send and receive messages through Stack62.
 *
 * This is the WhatsApp Web multi-device protocol — unofficial, and not the
 * Meta Cloud API. Auth state is persisted (encrypted) in `whatsapp_web_sessions`
 * so links survive redeploys; live sockets are rehydrated on boot.
 */
@Injectable()
export class WhatsAppWebService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppWebService.name);
  private readonly sessions = new Map<string, LiveSession>();
  private baileysPromise: Promise<BaileysApi> | null = null;

  /** Pairing codes are short-lived; WhatsApp expires them after a few minutes. */
  private static readonly PAIRING_TTL_MS = 3 * 60 * 1000;
  private static readonly CONNECT_TIMEOUT_MS = 20_000;
  private static readonly RECONNECT_DELAY_MS = 5_000;

  constructor(
    @InjectRepository(WhatsAppWebSessionEntity)
    private readonly sessionRepo: Repository<WhatsAppWebSessionEntity>,
    @InjectRepository(IntegrationConnectionEntity)
    private readonly connectionRepo: Repository<IntegrationConnectionEntity>,
    private readonly integrations: IntegrationsService,
    private readonly conversations: WhatsAppConversationService,
    private readonly accessControl: AccessControlService,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    private readonly files: FilesService,
  ) {}

  async onModuleInit() {
    if (!this.isEnabled()) return;
    // Sockets are single-instance: only the API process owns them, never the
    // worker, so the same WhatsApp account isn't linked twice concurrently.
    if (process.env.STACK62_ROLE === 'worker') return;
    // Rehydrate previously-linked devices so they keep sending/receiving after
    // a redeploy. Best-effort: never block boot on a flaky WhatsApp socket.
    try {
      const rows = await this.sessionRepo.find({ where: { status: 'ready' } });
      for (const row of rows) {
        this.connectSocket(row.connectionId, { requestPairing: false }).catch(
          (err) =>
            this.logger.warn(
              `Failed to rehydrate WhatsApp Web session ${row.connectionId}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            ),
        );
      }
      if (rows.length) {
        this.logger.log(`Rehydrating ${rows.length} WhatsApp Web session(s).`);
      }
    } catch (err) {
      this.logger.warn(
        `WhatsApp Web rehydrate skipped: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private isEnabled() {
    const flag = this.config.get<string>('WHATSAPP_WEB_ENABLED');
    if (flag !== undefined) return String(flag).toLowerCase() !== 'false';
    return this.config.get<string>('NODE_ENV') !== 'test';
  }

  /**
   * Start (or restart) linking a phone number as a device. Returns the pairing
   * code to enter on the phone under Settings → Linked devices → Link a device
   * → "Link with phone number instead".
   */
  async startLink(
    input: {
      organizationId: string;
      workspaceId?: string | null;
      phoneNumber: string;
      name?: string;
      connectionId?: string;
    },
    actorUserId: string,
  ) {
    if (!this.isEnabled()) {
      throw new BadRequestException(
        'WhatsApp Web linking is disabled on this deployment.',
      );
    }
    const phone = this.sanitizePhone(input.phoneNumber);
    if (phone.length < 8) {
      throw new BadRequestException(
        'Enter the full phone number including country code (digits only).',
      );
    }

    // Resolve or create the connection that this device link belongs to.
    let connection: IntegrationConnectionEntity;
    if (input.connectionId) {
      connection = await this.integrations.findConnectionRaw(
        input.connectionId,
        actorUserId,
      );
      if (connection.providerKey !== WHATSAPP_WEB_PROVIDER_KEY) {
        throw new BadRequestException(
          'This connection is not a WhatsApp Web device link.',
        );
      }
      await this.accessControl.assertResolvedAccess(actorUserId, {
        resource: 'organization',
        action: 'update',
        organizationId: connection.organizationId,
        workspaceId: connection.workspaceId ?? undefined,
      });
    } else {
      const created = await this.integrations.createConnection(
        {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId ?? undefined,
          providerKey: WHATSAPP_WEB_PROVIDER_KEY,
          name: input.name ?? `WhatsApp (+${phone})`,
          config: {
            source: 'whatsapp_web',
            setupStatus: 'pairing',
            status: 'pairing',
            linkedPhoneNumber: phone,
          },
        },
        actorUserId,
      );
      connection = await this.connectionRepo.findOneOrFail({
        where: { id: created.id },
      });
    }

    // Tear down any existing live socket for a clean re-pair.
    this.teardown(connection.id);
    // Reset auth state so we request a brand-new pairing code.
    await this.upsertSession(connection.id, connection.organizationId, {
      authState: null,
      phoneNumber: phone,
      waJid: null,
      status: 'pairing',
    });

    const { pairingCode, expiresAt } = await this.connectSocket(connection.id, {
      requestPairing: true,
      phoneNumber: phone,
    });

    await this.patchConnectionConfig(connection.id, {
      status: 'pairing',
      setupStatus: 'pairing',
      linkedPhoneNumber: phone,
      pairingCode,
      pairingCodeExpiresAt: expiresAt,
    });

    await this.activity.log({
      organizationId: connection.organizationId,
      workspaceId: connection.workspaceId,
      actorUserId,
      action: 'integration.whatsapp_web.link_started',
      targetType: 'integration_connection',
      targetId: connection.id,
      origin: 'user',
      metadata: { phone: this.maskPhone(phone) },
    });

    return {
      connectionId: connection.id,
      providerKey: WHATSAPP_WEB_PROVIDER_KEY,
      phoneNumber: phone,
      pairingCode,
      pairingCodeExpiresAt: expiresAt,
      status: 'pairing' as SessionStatus,
      instructions:
        'On the phone: WhatsApp → Settings → Linked devices → Link a device → "Link with phone number instead", then enter this code.',
    };
  }

  /** Current link status for a connection, including a fresh pairing code if still pairing. */
  async getStatus(connectionId: string, actorUserId: string) {
    const connection = await this.integrations.findConnectionRaw(
      connectionId,
      actorUserId,
    );
    if (connection.providerKey !== WHATSAPP_WEB_PROVIDER_KEY) {
      throw new BadRequestException(
        'This connection is not a WhatsApp Web device link.',
      );
    }
    const row = await this.sessionRepo.findOne({ where: { connectionId } });
    const live = this.sessions.get(connectionId);
    const cfg = connection.config ?? {};
    const status: SessionStatus =
      live?.status ?? (row?.status as SessionStatus) ?? 'pairing';
    const pairingValid =
      live?.pairingExpiresAt != null && live.pairingExpiresAt > Date.now();
    return {
      connectionId,
      status,
      phoneNumber:
        row?.phoneNumber ?? (cfg.linkedPhoneNumber as string) ?? null,
      waJid: row?.waJid ?? null,
      pairingCode: pairingValid ? (live?.pairingCode ?? null) : null,
      pairingCodeExpiresAt:
        pairingValid && live?.pairingExpiresAt
          ? new Date(live.pairingExpiresAt).toISOString()
          : null,
      lastConnectedAt: row?.lastConnectedAt?.toISOString() ?? null,
    };
  }

  /** Unlink the device and forget its session. */
  async logout(connectionId: string, actorUserId: string) {
    const connection = await this.integrations.findConnectionRaw(
      connectionId,
      actorUserId,
    );
    if (connection.providerKey !== WHATSAPP_WEB_PROVIDER_KEY) {
      throw new BadRequestException(
        'This connection is not a WhatsApp Web device link.',
      );
    }
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'integration',
      action: 'update',
      organizationId: connection.organizationId,
      workspaceId: connection.workspaceId ?? undefined,
    });
    const live = this.sessions.get(connectionId);
    if (live?.sock) {
      try {
        await live.sock.logout();
      } catch {
        /* socket may already be dead */
      }
    }
    this.teardown(connectionId);
    await this.sessionRepo.update(
      { connectionId },
      { status: 'logged_out', authState: null, waJid: null },
    );
    connection.status = 'disconnected';
    connection.config = {
      ...(connection.config ?? {}),
      status: 'logged_out',
      setupStatus: 'logged_out',
      pairingCode: null,
      disconnectedAt: new Date().toISOString(),
    };
    await this.connectionRepo.save(connection);
    await this.audit.log({
      organizationId: connection.organizationId,
      workspaceId: connection.workspaceId,
      actorUserId,
      action: 'integration.whatsapp_web.logout',
      targetType: 'integration_connection',
      targetId: connectionId,
      origin: 'user',
      afterData: { providerKey: WHATSAPP_WEB_PROVIDER_KEY },
    });
    return { connectionId, status: 'logged_out' as SessionStatus };
  }

  /**
   * Send a text message through a linked WhatsApp Web device. Connects (and
   * waits) if the socket isn't live yet — e.g. right after a redeploy.
   * Called by the provider runtime when a ready `whatsapp-web` connection exists.
   */
  async sendText(
    connection: IntegrationConnectionEntity,
    to: string,
    message: string,
    ctx: DispatchContext,
    opts: { quoted?: any } = {},
  ): Promise<{ provider: string; id: string | null; ok: boolean }> {
    const sock = await this.ensureConnected(connection.id);
    const jid = this.toJid(to);
    const result = await sock.sendMessage(
      jid,
      { text: message },
      opts.quoted ? { quoted: opts.quoted } : undefined,
    );
    await this.activity.log({
      organizationId: connection.organizationId,
      workspaceId: connection.workspaceId,
      actorUserId: ctx.actorUserId ?? null,
      action: 'integration.whatsapp_web.send',
      targetType: 'integration_dispatch',
      targetId: connection.id,
      origin: ctx.source === 'engine' ? 'ai' : 'system',
      metadata: { to: this.maskPhone(to) },
    });
    return {
      provider: WHATSAPP_WEB_PROVIDER_KEY,
      id: result?.key?.id ?? null,
      ok: true,
    };
  }

  /** Whether a connection currently has a usable (ready) linked device. */
  async isReady(connectionId: string): Promise<boolean> {
    const live = this.sessions.get(connectionId);
    if (live) return live.status === 'ready';
    const row = await this.sessionRepo.findOne({ where: { connectionId } });
    return row?.status === 'ready';
  }

  // ---------------------------------------------------------------------------
  // Socket lifecycle
  // ---------------------------------------------------------------------------

  private async loadBaileys(): Promise<BaileysApi> {
    if (!this.baileysPromise) {
      // Variable specifier keeps this an ESM dynamic import at runtime and
      // leaves the module typed as `any` (Baileys ships no CJS build).
      const moduleName = '@whiskeysockets/baileys';
      this.baileysPromise = import(moduleName).catch(() => {
        this.baileysPromise = null;
        throw new BadRequestException(
          'WhatsApp Web library (@whiskeysockets/baileys) is not installed on this deployment.',
        );
      });
    }
    return this.baileysPromise;
  }

  private async connectSocket(
    connectionId: string,
    opts: { requestPairing: boolean; phoneNumber?: string },
  ): Promise<{ pairingCode: string | null; expiresAt: string | null }> {
    const baileys = await this.loadBaileys();
    const row = await this.sessionRepo.findOne({ where: { connectionId } });
    if (!row) {
      throw new NotFoundException('WhatsApp Web session not found.');
    }

    const initial = this.loadInitialState(baileys, row);
    const auth = makeInMemoryAuthState(baileys, initial, (snapshot) =>
      this.persistState(connectionId, baileys, snapshot),
    );

    const logger = this.silentLogger();
    let version: unknown;
    try {
      const fetched = await baileys.fetchLatestBaileysVersion();
      version = fetched?.version;
    } catch {
      /* fall back to the version bundled with Baileys */
    }

    const makeWASocket = baileys.default ?? baileys.makeWASocket;
    const sock = makeWASocket({
      version,
      auth: {
        creds: auth.state.creds,
        keys: baileys.makeCacheableSignalKeyStore(auth.state.keys, logger),
      },
      logger,
      browser: baileys.Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    const session: LiveSession = {
      sock,
      status: opts.requestPairing ? 'pairing' : 'connecting',
      pairingCode: null,
      pairingExpiresAt: null,
      reconnectTimer: null,
      closing: false,
    };
    this.sessions.set(connectionId, session);

    sock.ev.on('creds.update', () => {
      auth
        .saveCreds()
        .catch((err) =>
          this.logger.warn(
            `creds.update persist failed for ${connectionId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
    });
    sock.ev.on('connection.update', (update: any) =>
      this.onConnectionUpdate(connectionId, update),
    );
    sock.ev.on('messages.upsert', (payload: any) => {
      this.onMessagesUpsert(connectionId, payload).catch((err) =>
        this.logger.warn(
          `inbound handling failed for ${connectionId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
    });
    // Reactions the contact (or another linked device) adds to messages.
    sock.ev.on('messages.reaction', (payload: any) => {
      this.onMessagesReaction(connectionId, payload).catch((err) =>
        this.logger.warn(
          `reaction handling failed for ${connectionId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
    });
    // Deletes / revokes (a "delete for everyone" by either side).
    sock.ev.on('messages.update', (payload: any) => {
      this.onMessagesUpdate(connectionId, payload).catch((err) =>
        this.logger.warn(
          `update handling failed for ${connectionId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
    });

    let pairingCode: string | null = null;
    let expiresAt: string | null = null;
    if (opts.requestPairing && !auth.state.creds.registered) {
      const phone = this.sanitizePhone(opts.phoneNumber ?? '');
      const rawCode = await this.requestPairingWithRetry(sock, phone);
      pairingCode = this.formatPairingCode(rawCode);
      const expiry = Date.now() + WhatsAppWebService.PAIRING_TTL_MS;
      session.pairingCode = pairingCode;
      session.pairingExpiresAt = expiry;
      expiresAt = new Date(expiry).toISOString();
    }

    return { pairingCode, expiresAt };
  }

  /**
   * Ask WhatsApp for a pairing code, retrying until the underlying WebSocket
   * is open. `requestPairingCode` throws if called before the connection is
   * ready, so a fixed delay is unreliable — we poll for a few seconds instead.
   */
  private async requestPairingWithRetry(
    sock: any,
    phone: string,
  ): Promise<string> {
    if (typeof sock?.requestPairingCode !== 'function') {
      throw new BadRequestException(
        'Installed WhatsApp library does not support phone-number pairing.',
      );
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise((resolve) =>
        setTimeout(resolve, attempt === 0 ? 1200 : 1500),
      );
      try {
        const code: string = await sock.requestPairingCode(phone);
        if (code) return code;
      } catch (err) {
        lastError = err;
        this.logger.warn(
          `requestPairingCode attempt ${attempt + 1} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    throw new BadRequestException(
      `WhatsApp did not return a pairing code: ${
        lastError instanceof Error ? lastError.message : 'connection not ready'
      }. Check the number has the country code and try again.`,
    );
  }

  private onConnectionUpdate(connectionId: string, update: any) {
    const session = this.sessions.get(connectionId);
    if (!session) return;
    const { connection, lastDisconnect } = update;

    if (connection) {
      this.logger.log(
        `connection.update for ${connectionId}: ${connection}${
          lastDisconnect?.error
            ? ` (lastDisconnect: ${
                lastDisconnect.error?.output?.statusCode ??
                lastDisconnect.error?.message ??
                'unknown'
              })`
            : ''
        }`,
      );
    }

    if (connection === 'open') {
      session.status = 'ready';
      session.pairingCode = null;
      session.pairingExpiresAt = null;
      const jid: string | null = session.sock?.user?.id ?? null;
      void this.onLinked(connectionId, jid);
      return;
    }

    if (connection === 'close') {
      const statusCode =
        lastDisconnect?.error?.output?.statusCode ??
        lastDisconnect?.error?.output?.payload?.statusCode;
      void this.loadBaileys()
        .then((baileys) => {
          const loggedOut = statusCode === baileys.DisconnectReason?.loggedOut;
          if (loggedOut) {
            this.logger.warn(
              `WhatsApp Web ${connectionId} logged out by the phone.`,
            );
            session.status = 'logged_out';
            void this.teardown(connectionId);
            void this.sessionRepo.update(
              { connectionId },
              { status: 'logged_out', authState: null, waJid: null },
            );
            void this.patchConnectionConfig(connectionId, {
              status: 'logged_out',
              setupStatus: 'logged_out',
              pairingCode: null,
            });
          } else if (!session.closing) {
            this.scheduleReconnect(connectionId);
          }
        })
        .catch(() => {
          if (!session.closing) this.scheduleReconnect(connectionId);
        });
    }
  }

  private scheduleReconnect(connectionId: string) {
    const session = this.sessions.get(connectionId);
    if (!session || session.reconnectTimer) return;
    session.status = 'connecting';
    session.reconnectTimer = setTimeout(() => {
      this.sessions.delete(connectionId);
      this.connectSocket(connectionId, { requestPairing: false }).catch((err) =>
        this.logger.warn(
          `Reconnect failed for ${connectionId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
    }, WhatsAppWebService.RECONNECT_DELAY_MS);
  }

  private async onLinked(connectionId: string, jid: string | null) {
    await this.sessionRepo.update(
      { connectionId },
      { status: 'ready', waJid: jid, lastConnectedAt: new Date() },
    );
    const connection = await this.connectionRepo.findOne({
      where: { id: connectionId },
    });
    if (connection) {
      connection.status = 'active';
      connection.lastCheckedAt = new Date();
      connection.config = {
        ...(connection.config ?? {}),
        status: 'ready',
        setupStatus: 'ready',
        waJid: jid,
        pairingCode: null,
        pairingCodeExpiresAt: null,
      };
      await this.connectionRepo.save(connection);
      await this.activity.log({
        organizationId: connection.organizationId,
        workspaceId: connection.workspaceId,
        actorUserId: null,
        action: 'integration.whatsapp_web.linked',
        targetType: 'integration_connection',
        targetId: connectionId,
        origin: 'system',
        metadata: { waJid: jid },
      });
    }
    this.logger.log(`WhatsApp Web device linked for ${connectionId}.`);
  }

  private async onMessagesUpsert(connectionId: string, payload: any) {
    const count = Array.isArray(payload?.messages)
      ? payload.messages.length
      : 0;
    this.logger.log(
      `messages.upsert for ${connectionId}: type=${payload?.type} count=${count}`,
    );
    // 'notify' = live messages; 'append' = history sync after linking. We only
    // surface live messages so the inbox isn't flooded with backfilled history.
    if (payload?.type !== 'notify') return;
    const connection = await this.connectionRepo.findOne({
      where: { id: connectionId },
    });
    if (!connection) {
      this.logger.warn(
        `messages.upsert: no connection row for ${connectionId}; dropping.`,
      );
      return;
    }
    for (const msg of (payload.messages ?? []) as any[]) {
      const from: string = msg?.key?.remoteJid ?? '';
      // 1:1 customer chats only. Modern WhatsApp routes direct chats either as
      // a phone JID (@s.whatsapp.net) or a privacy "LID" (@lid). Both are 1:1.
      // Groups (@g.us), status (status@broadcast), and channels (@newsletter)
      // are skipped — auto-replying there would spam everyone.
      const isOneToOne =
        from.endsWith('@s.whatsapp.net') || from.endsWith('@lid');
      if (!isOneToOne) {
        this.logger.log(`Skipping non-1:1 chat (remoteJid=${from}).`);
        continue;
      }
      const text = this.extractMessageText(msg?.message);
      const hasMedia = this.hasInboundMedia(msg?.message);
      if (!text && !hasMedia) {
        this.logger.log(
          `Skipping unsupported WhatsApp message type from ${from}: ${
            Object.keys(msg?.message ?? {}).join(',') || 'empty'
          }`,
        );
        continue;
      }
      // `remoteJid` is the other party in the 1:1 chat — for inbound it's the
      // sender, for our own (fromMe) messages it's the recipient. Either way it
      // identifies the conversation. Resolve a real phone for @lid contacts so
      // the thread shows a usable number and replies deliver.
      const { phone, jid } = await this.resolveContact(
        connectionId,
        from,
        msg?.key,
      );

      if (msg?.key?.fromMe) {
        // A message *we* sent on this account — from the Stack62 UI, a coworker
        // auto-reply, or the operator typing on their own phone / another
        // linked device. Record it as outbound so the coworker sees BOTH sides
        // of every conversation. recordOutbound dedupes on waMessageId, so a
        // coworker reply we already stored isn't re-recorded by its echo.
        //
        // Media we send from Stack62 is recorded at send time (with its file),
        // so skip media-only echoes here to avoid empty outbound rows.
        if (!text) continue;
        await this.conversations.recordOutbound({
          organizationId: connection.organizationId,
          workspaceId: connection.workspaceId ?? null,
          connectionId: connection.id,
          channel: 'web',
          contactPhone: phone,
          contactJid: jid,
          text,
          waMessageId: msg?.key?.id ?? null,
          authoredBy: 'user',
          status: 'sent',
        });
        continue;
      }

      // Download + store any attachment off the inbound message so the thread
      // can render the photo/video/audio/document. Best-effort: a failed
      // download still records the text (or a media placeholder).
      const media = hasMedia
        ? await this.downloadInboundMedia(connection, connectionId, msg)
        : null;

      // Best-effort: pull the contact's WhatsApp profile picture so the inbox
      // renders a real avatar. Privacy settings or a cold socket can make this
      // unavailable — never let it block recording the message.
      const contactAvatarUrl = await this.fetchAvatar(
        connectionId,
        jid,
        `${phone}@s.whatsapp.net`,
      );

      // If this message quotes another, capture a preview + link to the
      // original so the thread renders the reply context.
      const quoted = this.extractQuoted(msg?.message);
      const replyToMessage = quoted?.stanzaId
        ? await this.conversations.findByWaMessageId(
            connection.id,
            quoted.stanzaId,
          )
        : null;

      // recordInbound persists the message into the conversation thread and
      // emits the inbound event the auto-responder listens for.
      await this.conversations.recordInbound({
        organizationId: connection.organizationId,
        workspaceId: connection.workspaceId ?? null,
        connectionId: connection.id,
        channel: 'web',
        contactPhone: phone,
        contactJid: jid,
        contactName: typeof msg?.pushName === 'string' ? msg.pushName : null,
        contactAvatarUrl,
        text,
        media,
        waMessageId: msg?.key?.id ?? null,
        replyToMessageId: replyToMessage?.id ?? null,
        replyToPreview: quoted?.preview ?? null,
      });
      await this.activity.log({
        organizationId: connection.organizationId,
        workspaceId: connection.workspaceId ?? null,
        actorUserId: null,
        action: 'integration.whatsapp_web.message_received',
        targetType: 'whatsapp_conversation',
        targetId: connection.id,
        origin: 'system',
        metadata: {
          providerKey: WHATSAPP_WEB_PROVIDER_KEY,
          from: this.maskPhone(phone),
          preview: text.slice(0, 140),
        },
      });
    }
  }

  /**
   * Pull the human-readable text out of a Baileys message, unwrapping the
   * common envelopes WhatsApp uses (disappearing messages, view-once, media
   * captions, and button/list replies). Returns '' when there's nothing we
   * can render as a chat line (e.g. stickers, reactions, protocol messages).
   */
  private extractMessageText(message: any): string {
    if (!message || typeof message !== 'object') return '';
    // Unwrap disappearing + view-once envelopes, then re-run on the inner msg.
    const inner =
      message.ephemeralMessage?.message ??
      message.viewOnceMessage?.message ??
      message.viewOnceMessageV2?.message ??
      message.viewOnceMessageV2Extension?.message ??
      message.documentWithCaptionMessage?.message ??
      message.editedMessage?.message;
    if (inner) return this.extractMessageText(inner);
    return (
      message.conversation ??
      message.extendedTextMessage?.text ??
      message.imageMessage?.caption ??
      message.videoMessage?.caption ??
      message.documentMessage?.caption ??
      message.buttonsResponseMessage?.selectedDisplayText ??
      message.listResponseMessage?.title ??
      message.templateButtonReplyMessage?.selectedDisplayText ??
      ''
    );
  }

  /**
   * Handle reaction events. Each entry references the message that was reacted
   * to (`key.id`) and the emoji (`reaction.text`, empty = removed). We attribute
   * it to "them" (the contact) unless the reaction came from our own account.
   * Best-effort — a reaction we can't map to a stored message is ignored.
   */
  private async onMessagesReaction(connectionId: string, payload: any) {
    const items: any[] = Array.isArray(payload) ? payload : [payload];
    for (const item of items) {
      const waId: string | undefined = item?.key?.id;
      const emoji: string = item?.reaction?.text ?? '';
      if (!waId) continue;
      const message = await this.conversations.findByWaMessageId(
        connectionId,
        waId,
      );
      if (!message) continue;
      const who = item?.reaction?.key?.fromMe ? 'me' : 'them';
      await this.conversations.setReaction(message.id, who, emoji);
    }
  }

  /**
   * Handle message updates — specifically "delete for everyone" revokes, which
   * arrive as a protocol message of type REVOKE. We tombstone the stored row.
   */
  private async onMessagesUpdate(connectionId: string, payload: any) {
    const items: any[] = Array.isArray(payload) ? payload : [payload];
    for (const item of items) {
      const waId: string | undefined = item?.key?.id;
      if (!waId) continue;
      const update = item?.update ?? {};
      const revoked =
        update?.message === null ||
        update?.messageStubType === 1 || // REVOKE
        update?.message?.protocolMessage?.type === 0;
      if (!revoked) continue;
      const message = await this.conversations.findByWaMessageId(
        connectionId,
        waId,
      );
      if (message) await this.conversations.markDeleted(message.id);
    }
  }

  /**
   * Extract the quoted-message context (for replies) from an inbound message:
   * the original provider id (stanzaId) and a short text preview. Returns null
   * when the message isn't a reply.
   */
  private extractQuoted(
    message: any,
  ): { stanzaId: string | null; preview: string } | null {
    const m = this.unwrapMessage(message);
    if (!m || typeof m !== 'object') return null;
    // contextInfo lives on whichever content node carries the message.
    const ctx =
      m.extendedTextMessage?.contextInfo ??
      m.imageMessage?.contextInfo ??
      m.videoMessage?.contextInfo ??
      m.documentMessage?.contextInfo ??
      m.audioMessage?.contextInfo ??
      m.stickerMessage?.contextInfo;
    if (!ctx?.quotedMessage) return null;
    return {
      stanzaId: typeof ctx.stanzaId === 'string' ? ctx.stanzaId : null,
      preview: this.extractMessageText(ctx.quotedMessage).slice(0, 160),
    };
  }

  /** Unwrap the common WhatsApp envelopes to the innermost message node. */
  private unwrapMessage(message: any): any {
    if (!message || typeof message !== 'object') return message;
    const inner =
      message.ephemeralMessage?.message ??
      message.viewOnceMessage?.message ??
      message.viewOnceMessageV2?.message ??
      message.viewOnceMessageV2Extension?.message ??
      message.documentWithCaptionMessage?.message ??
      message.editedMessage?.message;
    return inner ? this.unwrapMessage(inner) : message;
  }

  /** Does this message carry a downloadable attachment? */
  private hasInboundMedia(message: any): boolean {
    const m = this.unwrapMessage(message);
    return !!(
      m?.imageMessage ||
      m?.videoMessage ||
      m?.audioMessage ||
      m?.documentMessage ||
      m?.stickerMessage
    );
  }

  /**
   * Identify the media node + type/mime/filename for a message, or null if it
   * carries no supported attachment.
   */
  private describeMedia(message: any): {
    mediaType: MessageMedia['mediaType'];
    mime: string;
    filename: string;
  } | null {
    const m = this.unwrapMessage(message);
    if (!m) return null;
    if (m.imageMessage) {
      const mime = m.imageMessage.mimetype ?? 'image/jpeg';
      return {
        mediaType: 'image',
        mime,
        filename: this.mediaName('image', mime),
      };
    }
    if (m.videoMessage) {
      const mime = m.videoMessage.mimetype ?? 'video/mp4';
      return {
        mediaType: 'video',
        mime,
        filename: this.mediaName('video', mime),
      };
    }
    if (m.audioMessage) {
      const mime = m.audioMessage.mimetype ?? 'audio/ogg';
      return {
        mediaType: 'audio',
        mime,
        filename: this.mediaName('audio', mime),
      };
    }
    if (m.stickerMessage) {
      const mime = m.stickerMessage.mimetype ?? 'image/webp';
      return {
        mediaType: 'sticker',
        mime,
        filename: this.mediaName('sticker', mime),
      };
    }
    if (m.documentMessage) {
      const mime = m.documentMessage.mimetype ?? 'application/octet-stream';
      const name =
        typeof m.documentMessage.fileName === 'string' &&
        m.documentMessage.fileName.trim()
          ? m.documentMessage.fileName.trim()
          : this.mediaName('document', mime);
      return { mediaType: 'document', mime, filename: name };
    }
    return null;
  }

  private mediaName(kind: string, mime: string): string {
    const ext = (mime.split('/')[1] ?? 'bin').split(';')[0].replace('+xml', '');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return `whatsapp-${kind}-${stamp}.${ext}`;
  }

  /**
   * Download an inbound message's attachment via Baileys (handles the
   * encrypted-media decrypt + reupload-on-expiry), store it as a file, and
   * return the media descriptor to record on the message. Best-effort: any
   * failure resolves to null so the message still records as text/placeholder.
   */
  private async downloadInboundMedia(
    connection: IntegrationConnectionEntity,
    connectionId: string,
    msg: any,
  ): Promise<MessageMedia | null> {
    try {
      const info = this.describeMedia(msg?.message);
      if (!info) return null;
      const baileys = await this.loadBaileys();
      const downloader = baileys.downloadMediaMessage;
      if (typeof downloader !== 'function') return null;
      const sock = this.sessions.get(connectionId)?.sock;
      // Pass a normalized message (envelopes unwrapped) so the downloader finds
      // the media node directly.
      const normalized = {
        key: msg.key,
        message: this.unwrapMessage(msg.message),
      };
      const buffer: Buffer = await downloader(
        normalized,
        'buffer',
        {},
        {
          logger: this.silentLogger(),
          reuploadRequest: sock?.updateMediaMessage,
        },
      );
      if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
        return null;
      }
      const stored = await this.files.registerBuffer({
        organizationId: connection.organizationId,
        workspaceId: connection.workspaceId ?? null,
        scope: 'attachment',
        filename: info.filename,
        mimeType: info.mime,
        buffer,
        ownerKind: 'whatsapp',
        ownerId: connectionId,
        metadata: { source: 'whatsapp_inbound', mediaType: info.mediaType },
      });
      return {
        mediaType: info.mediaType,
        mediaFileId: stored.id,
        mediaMimeType: info.mime,
        mediaFilename: info.filename,
      };
    } catch (err) {
      this.logger.warn(
        `WhatsApp media download failed for ${connectionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * Send a media message (image/video/audio/document) through a linked device,
   * with an optional caption. Returns the provider message id. The conversation
   * thread row is recorded by the caller (controller) with the stored fileId.
   */
  async sendMedia(
    connection: IntegrationConnectionEntity,
    to: string,
    media: {
      buffer: Buffer;
      mime: string;
      filename: string;
      mediaType: MessageMedia['mediaType'];
      /** Send audio as a voice note (push-to-talk) rather than a music file. */
      ptt?: boolean;
    },
    caption: string | undefined,
    ctx: DispatchContext,
    opts: { quoted?: any } = {},
  ): Promise<{ provider: string; id: string | null; ok: boolean }> {
    const sock = await this.ensureConnected(connection.id);
    const jid = this.toJid(to);
    const content =
      media.mediaType === 'image'
        ? { image: media.buffer, caption, mimetype: media.mime }
        : media.mediaType === 'video'
          ? { video: media.buffer, caption, mimetype: media.mime }
          : media.mediaType === 'audio'
            ? { audio: media.buffer, mimetype: media.mime, ptt: !!media.ptt }
            : media.mediaType === 'sticker'
              ? { sticker: media.buffer }
              : {
                  document: media.buffer,
                  mimetype: media.mime,
                  fileName: media.filename,
                  caption,
                };
    const result = await sock.sendMessage(
      jid,
      content,
      opts.quoted ? { quoted: opts.quoted } : undefined,
    );
    await this.activity.log({
      organizationId: connection.organizationId,
      workspaceId: connection.workspaceId,
      actorUserId: ctx.actorUserId ?? null,
      action: 'integration.whatsapp_web.send_media',
      targetType: 'integration_dispatch',
      targetId: connection.id,
      origin: ctx.source === 'engine' ? 'ai' : 'system',
      metadata: { to: this.maskPhone(to), mediaType: media.mediaType },
    });
    return {
      provider: WHATSAPP_WEB_PROVIDER_KEY,
      id: result?.key?.id ?? null,
      ok: true,
    };
  }

  /**
   * Reconstruct the Baileys message key for a stored message so we can react
   * to it, delete it, or quote it. `fromMe` distinguishes our own messages
   * from the contact's; the remoteJid is the contact's chat JID.
   */
  private messageKeyFor(
    contactJid: string | null,
    contactPhone: string,
    waMessageId: string,
    fromMe: boolean,
  ) {
    const remoteJid =
      contactJid ?? `${this.sanitizePhone(contactPhone)}@s.whatsapp.net`;
    return { remoteJid, id: waMessageId, fromMe };
  }

  /** A minimal WAMessage so Baileys can render a quoted reply preview. */
  private quotedFor(
    contactJid: string | null,
    contactPhone: string,
    waMessageId: string,
    fromMe: boolean,
    previewText: string,
  ) {
    return {
      key: this.messageKeyFor(contactJid, contactPhone, waMessageId, fromMe),
      message: { conversation: previewText || ' ' },
    };
  }

  /** React to a message with an emoji (empty string clears the reaction). */
  async reactToMessage(
    connectionId: string,
    contactJid: string | null,
    contactPhone: string,
    waMessageId: string,
    fromMe: boolean,
    emoji: string,
  ): Promise<{ id: string | null; ok: boolean }> {
    const sock = await this.ensureConnected(connectionId);
    const jid = this.toJid(contactJid ?? contactPhone);
    const key = this.messageKeyFor(
      contactJid,
      contactPhone,
      waMessageId,
      fromMe,
    );
    const result = await sock.sendMessage(jid, {
      react: { text: emoji, key },
    });
    return { id: result?.key?.id ?? null, ok: true };
  }

  /** Delete a message for everyone in the chat. */
  async deleteMessageForEveryone(
    connectionId: string,
    contactJid: string | null,
    contactPhone: string,
    waMessageId: string,
    fromMe: boolean,
  ): Promise<{ ok: boolean }> {
    const sock = await this.ensureConnected(connectionId);
    const jid = this.toJid(contactJid ?? contactPhone);
    const key = this.messageKeyFor(
      contactJid,
      contactPhone,
      waMessageId,
      fromMe,
    );
    await sock.sendMessage(jid, { delete: key });
    return { ok: true };
  }

  /** Operator-facing react: access-checks, sends the reaction, persists it. */
  async reactForOperator(
    messageId: string,
    emoji: string,
    actorUserId: string,
  ) {
    const message = await this.conversations.getMessageById(messageId);
    const conversation = await this.conversations.getConversationById(
      message.conversationId,
    );
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'organization',
      action: 'update',
      organizationId: conversation.organizationId,
      workspaceId: conversation.workspaceId ?? undefined,
    });
    await this.reactToMessage(
      message.connectionId,
      conversation.contactJid,
      conversation.contactPhone,
      message.waMessageId ?? '',
      message.direction === 'outbound',
      emoji,
    );
    return this.conversations.setReaction(message.id, 'me', emoji);
  }

  /** Operator-facing delete-for-everyone: access-checks, deletes, tombstones. */
  async deleteForOperator(messageId: string, actorUserId: string) {
    const message = await this.conversations.getMessageById(messageId);
    const conversation = await this.conversations.getConversationById(
      message.conversationId,
    );
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'organization',
      action: 'update',
      organizationId: conversation.organizationId,
      workspaceId: conversation.workspaceId ?? undefined,
    });
    await this.deleteMessageForEveryone(
      message.connectionId,
      conversation.contactJid,
      conversation.contactPhone,
      message.waMessageId ?? '',
      message.direction === 'outbound',
    );
    return this.conversations.markDeleted(message.id);
  }

  /** Build a quoted-message stub from a stored message for replies. */
  buildQuoted(message: {
    contactJid: string | null;
    contactPhone: string;
    waMessageId: string | null;
    fromMe: boolean;
    preview: string;
  }) {
    if (!message.waMessageId) return undefined;
    return this.quotedFor(
      message.contactJid,
      message.contactPhone,
      message.waMessageId,
      message.fromMe,
      message.preview,
    );
  }

  /**
   * Resolve an inbound sender into a `{ phone, jid }` pair. A phone JID
   * (@s.whatsapp.net) is already the number. For privacy "LID" senders (@lid)
   * the real number isn't in the JID — we recover it from `key.remoteJidAlt`
   * or the LID↔phone mapping store so the thread shows a real number and
   * replies deliver. Falls back to the LID itself when the phone is unknown.
   */
  private async resolveContact(
    connectionId: string,
    remoteJid: string,
    key: any,
  ): Promise<{ phone: string; jid: string }> {
    if (remoteJid.endsWith('@s.whatsapp.net')) {
      return { phone: remoteJid.split('@')[0] ?? remoteJid, jid: remoteJid };
    }
    const alt = typeof key?.remoteJidAlt === 'string' ? key.remoteJidAlt : '';
    if (alt.endsWith('@s.whatsapp.net')) {
      return { phone: alt.split('@')[0] ?? alt, jid: alt };
    }
    try {
      const sock = this.sessions.get(connectionId)?.sock;
      const pn: string | null | undefined =
        await sock?.signalRepository?.lidMapping?.getPNForLID?.(remoteJid);
      if (typeof pn === 'string' && pn.endsWith('@s.whatsapp.net')) {
        return { phone: pn.split('@')[0] ?? pn, jid: pn };
      }
    } catch {
      /* mapping store unavailable — fall through to the LID */
    }
    // Unknown phone: key the thread on the LID and send replies to it directly.
    return { phone: remoteJid.split('@')[0] ?? remoteJid, jid: remoteJid };
  }

  /**
   * Fetch a contact's WhatsApp profile picture URL via the live socket.
   * Tries each candidate JID (the resolved jid, plus the phone JID) because
   * a privacy "LID" jid often won't resolve a picture while the phone JID
   * will. Returns a high-res CDN URL, or null when unavailable. Best-effort:
   * any failure resolves to null so message recording is never blocked.
   */
  private async fetchAvatar(
    connectionId: string,
    ...jids: Array<string | null | undefined>
  ): Promise<string | null> {
    const sock = this.sessions.get(connectionId)?.sock;
    if (typeof sock?.profilePictureUrl !== 'function') return null;
    const seen = new Set<string>();
    for (const jid of jids) {
      if (!jid || seen.has(jid)) continue;
      seen.add(jid);
      try {
        const url: string | undefined = await sock.profilePictureUrl(
          jid,
          'image',
        );
        if (typeof url === 'string' && url) return url;
      } catch {
        /* try the next candidate */
      }
    }
    return null;
  }

  /**
   * Fetch + persist the avatar for one conversation on demand (used when the
   * operator opens a chat or the inbox loads a chat that has no avatar yet).
   * Returns the URL, or null if the device isn't linked / the contact has no
   * visible picture.
   */
  async refreshConversationAvatar(
    connectionId: string,
    conversationId: string,
    contactPhone: string,
    contactJid: string | null,
  ): Promise<string | null> {
    if (!(await this.isReady(connectionId))) return null;
    // Make sure a live socket exists (rehydrate if needed).
    try {
      await this.ensureConnected(connectionId);
    } catch {
      return null;
    }
    const phoneJid = `${this.sanitizePhone(contactPhone)}@s.whatsapp.net`;
    const url = await this.fetchAvatar(connectionId, contactJid, phoneJid);
    await this.conversations.updateAvatar(conversationId, url);
    return url;
  }

  /**
   * Operator-facing avatar refresh: access-checks the caller, then fetches +
   * persists the contact's profile picture. Returns the updated conversation.
   */
  async refreshAvatarForOperator(conversationId: string, actorUserId: string) {
    const conversation =
      await this.conversations.getConversationById(conversationId);
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'organization',
      action: 'read',
      organizationId: conversation.organizationId,
      workspaceId: conversation.workspaceId ?? undefined,
    });
    const url = await this.refreshConversationAvatar(
      conversation.connectionId,
      conversation.id,
      conversation.contactPhone,
      conversation.contactJid,
    );
    return { ...conversation, contactAvatarUrl: url };
  }

  private async ensureConnected(connectionId: string): Promise<any> {
    const existing = this.sessions.get(connectionId);
    if (existing?.status === 'ready' && existing.sock) return existing.sock;

    const row = await this.sessionRepo.findOne({ where: { connectionId } });
    if (!row || row.status === 'logged_out' || !row.authState) {
      throw new BadRequestException(
        'This WhatsApp device is not linked. Start the link flow and enter the pairing code first.',
      );
    }
    if (!existing) {
      await this.connectSocket(connectionId, { requestPairing: false });
    }
    // Wait for the socket to reach "ready".
    const deadline = Date.now() + WhatsAppWebService.CONNECT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const live = this.sessions.get(connectionId);
      if (live?.status === 'ready' && live.sock) return live.sock;
      if (live?.status === 'logged_out') {
        throw new BadRequestException(
          'This WhatsApp device was unlinked from the phone. Re-link it.',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new BadRequestException(
      'WhatsApp device link is not connected yet. Try again in a moment.',
    );
  }

  // ---------------------------------------------------------------------------
  // Persistence helpers
  // ---------------------------------------------------------------------------

  private loadInitialState(
    baileys: BaileysApi,
    row: WhatsAppWebSessionEntity,
  ): StoredAuthState | null {
    if (!row.authState) return null;
    const decrypted = this.crypto.readCredentials(row.authState);
    const blob = decrypted?.blob;
    if (typeof blob !== 'string') return null;
    try {
      return deserializeAuthState(baileys, blob);
    } catch (err) {
      this.logger.warn(
        `Failed to deserialize WhatsApp Web auth state for ${row.connectionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private async persistState(
    connectionId: string,
    baileys: BaileysApi,
    snapshot: StoredAuthState,
  ) {
    const serialized = serializeAuthState(baileys, snapshot);
    const encrypted = this.crypto.encryptJson({ blob: serialized });
    await this.sessionRepo.update(
      { connectionId },
      // EncryptedBlob has no string index signature, so it isn't structurally
      // a Record; the column stores it as jsonb regardless.
      { authState: encrypted as any },
    );
  }

  private async upsertSession(
    connectionId: string,
    organizationId: string,
    patch: Partial<WhatsAppWebSessionEntity>,
  ) {
    const existing = await this.sessionRepo.findOne({
      where: { connectionId },
    });
    if (existing) {
      Object.assign(existing, patch);
      await this.sessionRepo.save(existing);
      return existing;
    }
    return this.sessionRepo.save(
      this.sessionRepo.create({
        connectionId,
        organizationId,
        status: 'pairing',
        ...patch,
      }),
    );
  }

  private async patchConnectionConfig(
    connectionId: string,
    patch: Record<string, unknown>,
  ) {
    const connection = await this.connectionRepo.findOne({
      where: { id: connectionId },
    });
    if (!connection) return;
    connection.config = { ...(connection.config ?? {}), ...patch };
    await this.connectionRepo.save(connection);
  }

  private teardown(connectionId: string) {
    const session = this.sessions.get(connectionId);
    if (!session) return;
    session.closing = true;
    if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
    try {
      session.sock?.ev?.removeAllListeners?.();
      session.sock?.end?.(undefined);
    } catch {
      /* best effort */
    }
    this.sessions.delete(connectionId);
  }

  // ---------------------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------------------

  private sanitizePhone(value: string) {
    return value.replace(/[^0-9]/g, '');
  }

  private toJid(to: string) {
    if (to.includes('@')) return to;
    return `${this.sanitizePhone(to)}@s.whatsapp.net`;
  }

  private formatPairingCode(code: string) {
    const clean = (code ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (clean.length === 8) return `${clean.slice(0, 4)}-${clean.slice(4)}`;
    return code;
  }

  private maskPhone(value: string) {
    return value.length <= 4
      ? '****'
      : `${'*'.repeat(Math.max(value.length - 4, 0))}${value.slice(-4)}`;
  }

  private silentLogger(): any {
    const noop = () => undefined;
    const logger = {
      level: 'silent',
      trace: noop,
      debug: noop,
      info: noop,
      warn: noop,
      error: noop,
      fatal: noop,
      child: () => logger,
    };
    return logger;
  }
}
