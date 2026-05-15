import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { CryptoService } from '../../shared/security/crypto.service';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { CreateIntegrationConnectionDto } from './dto/create-integration-connection.dto';
import { DispatchWebhookDto } from './dto/dispatch-webhook.dto';
import { InitializePaymentDto } from './dto/initialize-payment.dto';
import { ListIntegrationConnectionsDto } from './dto/list-integration-connections.dto';
import { SendEmailDto } from './dto/send-email.dto';
import { SendWhatsAppDto } from './dto/send-whatsapp.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { IntegrationConnectionEntity } from './entities/integration-connection.entity';
import { IntegrationTokenEntity } from './entities/integration-token.entity';
import { WebhookEventEntity } from './entities/webhook-event.entity';
import {
  GmailDraftDto,
  GmailSearchDto,
  GmailSendDto,
  GoogleCalendarEventDto,
  GoogleOpenWorkspaceItemDto,
  GoogleOAuthCallbackDto,
  GoogleOAuthUrlDto,
  MetaOAuthCallbackDto,
  MetaOAuthUrlDto,
  QuickBooksOAuthCallbackDto,
  QuickBooksOAuthUrlDto,
} from './dto/google-integration.dto';
import {
  SelectWhatsAppPhoneNumberDto,
  WhatsAppDraftReplyDto,
  WhatsAppWebhookQueryDto,
} from './dto/whatsapp-webhook.dto';
import {
  findIntegrationProvider,
  INTEGRATION_MARKETPLACE,
  USER_OAUTH_INTEGRATIONS,
  USER_OAUTH_PROVIDER_KEYS,
} from './integration-marketplace';

interface MetaBusinessResponse {
  data?: Array<{
    id: string;
    name?: string;
    owned_whatsapp_business_accounts?: {
      data?: Array<{
        id: string;
        name?: string;
        phone_numbers?: {
          data?: Array<{
            id: string;
            display_phone_number?: string;
            verified_name?: string;
          }>;
        };
      }>;
    };
  }>;
}

@Injectable()
export class IntegrationsService {
  constructor(
    @InjectRepository(IntegrationConnectionEntity)
    private readonly connectionsRepository: Repository<IntegrationConnectionEntity>,
    @InjectRepository(IntegrationTokenEntity)
    private readonly tokensRepository: Repository<IntegrationTokenEntity>,
    @InjectRepository(WebhookEventEntity)
    private readonly webhookEventsRepository: Repository<WebhookEventEntity>,
    private readonly accessControlService: AccessControlService,
    private readonly activityService: ActivityService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
    private readonly cryptoService: CryptoService,
  ) {}

  listMarketplace() {
    return USER_OAUTH_INTEGRATIONS;
  }

  /**
   * Report which OAuth providers have credentials configured on this
   * deployment. The UI uses this to grey out providers that would
   * 400 on click, so the user doesn't have to find out by failing.
   *
   * "configured" means: the minimum env vars needed to *start* the
   * OAuth flow are set. Some providers also need a secret to *finish*
   * the flow; we still report configured=true because the click-flow
   * gets us to the redirect — finish errors surface separately.
   */
  getProviderConfigStatus(): Array<{
    providerKey: string;
    configured: boolean;
    missing: string[];
  }> {
    const cs = this.configService;
    const has = (key: string) => !!cs.get<string>(key);
    const report = (
      providerKey: string,
      requiredAny: string[][],
    ): { providerKey: string; configured: boolean; missing: string[] } => {
      const missing = requiredAny
        .filter((alts) => !alts.some((k) => has(k)))
        .map((alts) => alts.join(' or '));
      return { providerKey, configured: missing.length === 0, missing };
    };
    return [
      report('google-workspace', [
        ['GOOGLE_CLIENT_ID', 'GOOGLE_WORKSPACE_CLIENT_ID'],
        ['GOOGLE_REDIRECT_URI'],
      ]),
      report('whatsapp-cloud', [
        ['META_APP_ID'],
        ['META_REDIRECT_URI'],
      ]),
      report('quickbooks', [
        ['QUICKBOOKS_CLIENT_ID', 'INTUIT_CLIENT_ID'],
        ['QUICKBOOKS_REDIRECT_URI', 'INTUIT_REDIRECT_URI'],
      ]),
    ];
  }

  async createConnection(
    payload: CreateIntegrationConnectionDto,
    actorUserId: string,
  ) {
    const provider = findIntegrationProvider(payload.providerKey);
    if (!provider) {
      throw new BadRequestException('Unknown integration provider.');
    }

    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'organization',
      action: 'update',
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
    });

    const encryptedCredentials = this.cryptoService.encryptJson(
      payload.credentials ?? null,
    );

    const connection = await this.connectionsRepository.save(
      this.connectionsRepository.create({
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId ?? null,
        createdByUserId: actorUserId,
        providerKey: payload.providerKey,
        name: payload.name,
        config: payload.config ?? null,
        credentials: encryptedCredentials as Record<string, unknown> | null,
        status: 'active',
        lastCheckedAt: null,
      }),
    );

    await this.activityService.log({
      organizationId: connection.organizationId,
      workspaceId: connection.workspaceId,
      actorUserId,
      action: 'integration_connection.create',
      targetType: 'integration_connection',
      targetId: connection.id,
      origin: 'user',
      metadata: { providerKey: connection.providerKey },
    });

    return this.redact(connection);
  }

  async listConnections(
    filters: ListIntegrationConnectionsDto,
    actorUserId: string,
  ) {
    await this.disconnectLegacyConnections(filters, actorUserId);
    const qb = this.connectionsRepository.createQueryBuilder('connection');
    await this.accessControlService.applyTenantScopeToQueryBuilder(
      qb,
      'connection',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'workspaceId',
        organizationId: filters.organizationId,
        workspaceId: filters.workspaceId,
      },
    );

    if (filters.providerKey) {
      qb.andWhere('connection.providerKey = :providerKey', {
        providerKey: filters.providerKey,
      });
    }
    qb.andWhere('connection.providerKey IN (:...oauthProviderKeys)', {
      oauthProviderKeys: [...USER_OAUTH_PROVIDER_KEYS],
    });
    qb.andWhere("connection.status != 'deleted'");
    const rows = await qb.orderBy('connection.createdAt', 'DESC').getMany();
    return rows.map((r) => this.redact(r));
  }

  async testConnection(connectionId: string, actorUserId: string) {
    const connection = await this.findConnection(connectionId, actorUserId);
    connection.lastCheckedAt = new Date();
    return this.connectionsRepository.save(connection);
  }

  async disconnectConnection(connectionId: string, actorUserId: string) {
    const connection = await this.findConnection(connectionId, actorUserId);
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'integration',
      action: 'update',
      organizationId: connection.organizationId,
      workspaceId: connection.workspaceId ?? undefined,
    });
    connection.status = 'disconnected';
    connection.config = {
      ...(connection.config ?? {}),
      disconnectedAt: new Date().toISOString(),
      disconnectReason: 'user_requested',
    };
    const saved = await this.connectionsRepository.save(connection);
    await this.activityService.log({
      organizationId: saved.organizationId,
      workspaceId: saved.workspaceId,
      actorUserId,
      action: 'integration.disconnect',
      targetType: 'integration_connection',
      targetId: saved.id,
      origin: 'user',
      metadata: { providerKey: saved.providerKey },
    });
    await this.auditService.log({
      organizationId: saved.organizationId,
      workspaceId: saved.workspaceId,
      actorUserId,
      action: 'integration.disconnect',
      targetType: 'integration_connection',
      targetId: saved.id,
      origin: 'user',
      afterData: { providerKey: saved.providerKey },
    });
    return this.redact(saved);
  }

  async dispatchWebhook(payload: DispatchWebhookDto) {
    this.assertPublicHttpUrl(payload.url, 'Webhook URL');

    const method = payload.method ?? 'POST';
    const response = await fetch(payload.url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload.headers ?? {}),
      },
      body:
        method.toUpperCase() === 'GET'
          ? undefined
          : JSON.stringify(payload.body ?? {}),
    });

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
    };
  }

  async sendEmail(payload: SendEmailDto, actorUserId?: string | null) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    const from = this.configService.get<string>('RESEND_FROM_EMAIL');
    if (!apiKey || !from) {
      throw new BadRequestException(
        'Resend is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.',
      );
    }

    const result = await this.postJson<{ id?: string }>(
      'https://api.resend.com/emails',
      {
        from,
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      },
      { Authorization: `Bearer ${apiKey}` },
    );

    await this.logIntegrationDispatch({
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId ?? null,
      actorUserId,
      providerKey: 'resend',
      action: 'integration.email.send',
      targetId: result.id ?? 'resend-email',
      metadata: {
        toCount: payload.to.length,
        subject: payload.subject,
        ...this.safeMetadata(payload.metadata),
      },
    });

    return { provider: 'resend', id: result.id ?? null, ok: true };
  }

  async sendWhatsApp(payload: SendWhatsAppDto, actorUserId?: string | null) {
    const connection = await this.resolveConnection(
      payload.organizationId,
      'whatsapp-cloud',
      payload.workspaceId,
    );
    const creds = connection ? this.decryptCredentials(connection) : null;
    const accessToken =
      (creds?.accessToken as string | undefined) ??
      this.configService.get<string>('META_WHATSAPP_ACCESS_TOKEN');
    const phoneNumberId =
      (creds?.phoneNumberId as string | undefined) ??
      (connection?.config?.phoneNumberId as string | undefined) ??
      (connection?.config?.selectedPhoneNumberId as string | undefined) ??
      this.configService.get<string>('META_WHATSAPP_PHONE_NUMBER_ID');
    if (!accessToken || !phoneNumberId) {
      throw new BadRequestException(
        'WhatsApp is not fully connected. Connect WhatsApp Business and select a business phone number.',
      );
    }

    const result = await this.postJson<{
      messages?: Array<{ id?: string }>;
    }>(
      `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: payload.to,
        type: 'text',
        text: { preview_url: false, body: payload.message },
      },
      { Authorization: `Bearer ${accessToken}` },
    );

    await this.logIntegrationDispatch({
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId ?? null,
      actorUserId,
      providerKey: 'whatsapp-cloud',
      action: 'integration.whatsapp.send',
      targetId: result.messages?.[0]?.id ?? 'whatsapp-message',
      metadata: {
        to: this.maskPhone(payload.to),
        ...this.safeMetadata(payload.metadata),
      },
    });

    return {
      provider: 'whatsapp-cloud',
      id: result.messages?.[0]?.id ?? null,
      ok: true,
    };
  }

  async googleOAuthUrl(payload: GoogleOAuthUrlDto, actorUserId: string) {
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'integration',
      action: 'update',
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
    });
    const clientId =
      this.configService.get<string>('GOOGLE_CLIENT_ID') ??
      this.configService.get<string>('GOOGLE_WORKSPACE_CLIENT_ID');
    const redirectUri =
      payload.redirectUri ??
      this.configService.get<string>('GOOGLE_REDIRECT_URI');
    if (!clientId || !redirectUri) {
      throw new BadRequestException(
        'Google sign-in is not configured for this Stack62 app. Set GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI. A Google API key is not enough for user sign-in.',
      );
    }
    const state = Buffer.from(
      JSON.stringify({
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId ?? null,
        actorUserId,
      }),
    ).toString('base64url');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set(
      'scope',
      [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/drive.file',
      ].join(' '),
    );
    url.searchParams.set('state', state);
    return { url: url.toString(), state };
  }

  async completeGoogleOAuth(payload: GoogleOAuthCallbackDto, actorUserId: string) {
    const state = this.decodeOAuthState(payload.state);
    if (state.actorUserId !== actorUserId) {
      throw new BadRequestException('OAuth state does not match this user.');
    }
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'integration',
      action: 'update',
      organizationId: state.organizationId,
      workspaceId: state.workspaceId ?? undefined,
    });
    const clientId =
      this.configService.get<string>('GOOGLE_CLIENT_ID') ??
      this.configService.get<string>('GOOGLE_WORKSPACE_CLIENT_ID');
    const clientSecret =
      this.configService.get<string>('GOOGLE_CLIENT_SECRET') ??
      this.configService.get<string>('GOOGLE_WORKSPACE_CLIENT_SECRET');
    const redirectUri =
      payload.redirectUri ??
      this.configService.get<string>('GOOGLE_REDIRECT_URI');
    if (!clientId || !clientSecret || !redirectUri) {
      throw new BadRequestException(
        'Google sign-in is not configured for this Stack62 app. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI. A Google API key is not enough for user sign-in.',
      );
    }
    const token = await this.postForm<{
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
    }>('https://oauth2.googleapis.com/token', {
      code: payload.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    const expiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000)
      : null;
    const connection = await this.createConnection(
      {
        organizationId: state.organizationId,
        workspaceId: state.workspaceId ?? undefined,
        providerKey: 'google-workspace',
        name: 'Google Workspace',
        config: {
          source: 'google_oauth',
          scopes: token.scope?.split(' ') ?? [],
        },
        credentials: {
          accessToken: token.access_token,
          refreshToken: token.refresh_token ?? null,
          expiresAt: expiresAt?.toISOString() ?? null,
          tokenType: token.token_type ?? 'Bearer',
        },
      },
      actorUserId,
    );
    await this.tokensRepository.save(
      this.tokensRepository.create({
        connectionId: connection.id,
        tokenType: 'oauth',
        encryptedAccessToken: this.encryptTokenValue(token.access_token),
        encryptedRefreshToken: token.refresh_token
          ? this.encryptTokenValue(token.refresh_token)
          : null,
        expiresAt,
        metadata: { scope: token.scope ?? null },
      }),
    );
    await this.auditService.log({
      organizationId: state.organizationId,
      workspaceId: state.workspaceId ?? null,
      actorUserId,
      action: 'integration.google.oauth_connect',
      targetType: 'integration_connection',
      targetId: connection.id,
      origin: 'user',
      afterData: { providerKey: 'google-workspace' },
    });
    return connection;
  }

  async metaOAuthUrl(payload: MetaOAuthUrlDto, actorUserId: string) {
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'integration',
      action: 'update',
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
    });
    const appId = this.configService.get<string>('META_APP_ID');
    const redirectUri =
      payload.redirectUri ?? this.configService.get<string>('META_REDIRECT_URI');
    if (!appId || !redirectUri) {
      throw new BadRequestException(
        'WhatsApp Business onboarding is not configured for this Stack62 app. Set META_APP_ID and META_REDIRECT_URI. Official WhatsApp Cloud API onboarding starts through Meta Business; WhatsApp Web QR login is not supported for this business integration.',
      );
    }
    const state = Buffer.from(
      JSON.stringify({
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId ?? null,
        actorUserId,
        provider: 'whatsapp-cloud',
      }),
    ).toString('base64url');
    const url = new URL('https://www.facebook.com/v20.0/dialog/oauth');
    url.searchParams.set('client_id', appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    const embeddedSignupConfigId = this.configService.get<string>(
      'META_WHATSAPP_CONFIGURATION_ID',
    );
    if (embeddedSignupConfigId) {
      url.searchParams.set('config_id', embeddedSignupConfigId);
      url.searchParams.set('extras', JSON.stringify({ setup: {} }));
    }
    url.searchParams.set(
      'scope',
      [
        'business_management',
        'whatsapp_business_management',
        'whatsapp_business_messaging',
      ].join(','),
    );
    url.searchParams.set('state', state);
    return { url: url.toString(), state };
  }

  async completeMetaOAuth(payload: MetaOAuthCallbackDto, actorUserId: string) {
    const state = this.decodeOAuthState(payload.state);
    if (state.actorUserId !== actorUserId) {
      throw new BadRequestException('OAuth state does not match this user.');
    }
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'integration',
      action: 'update',
      organizationId: state.organizationId,
      workspaceId: state.workspaceId ?? undefined,
    });
    const appId = this.configService.get<string>('META_APP_ID');
    const appSecret = this.configService.get<string>('META_APP_SECRET');
    const redirectUri =
      payload.redirectUri ?? this.configService.get<string>('META_REDIRECT_URI');
    if (!appId || !appSecret || !redirectUri) {
      throw new BadRequestException(
        'WhatsApp Business onboarding is not configured for this Stack62 app. Set META_APP_ID, META_APP_SECRET and META_REDIRECT_URI. Official WhatsApp Cloud API onboarding starts through Meta Business; WhatsApp Web QR login is not supported for this business integration.',
      );
    }
    const token = await this.getJsonNoAuth<{
      access_token: string;
      token_type?: string;
      expires_in?: number;
    }>(
      `https://graph.facebook.com/v20.0/oauth/access_token?${new URLSearchParams(
        {
          client_id: appId,
          client_secret: appSecret,
          redirect_uri: redirectUri,
          code: payload.code,
        },
      ).toString()}`,
    );
    const expiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000)
      : null;
    const connection = await this.createConnection(
      {
        organizationId: state.organizationId,
        workspaceId: state.workspaceId ?? undefined,
        providerKey: 'whatsapp-cloud',
        name: 'WhatsApp Business',
        config: {
          source: 'meta_oauth',
          selectedPhoneNumberId: null,
          setupStatus: 'connected_needs_business_selection',
        },
        credentials: {
          accessToken: token.access_token,
          expiresAt: expiresAt?.toISOString() ?? null,
          tokenType: token.token_type ?? 'Bearer',
        },
      },
      actorUserId,
    );
    await this.tokensRepository.save(
      this.tokensRepository.create({
        connectionId: connection.id,
        tokenType: 'oauth',
        encryptedAccessToken: this.encryptTokenValue(token.access_token),
        encryptedRefreshToken: null,
        expiresAt,
        metadata: { provider: 'meta' },
      }),
    );
    await this.auditService.log({
      organizationId: state.organizationId,
      workspaceId: state.workspaceId ?? null,
      actorUserId,
      action: 'integration.meta.oauth_connect',
      targetType: 'integration_connection',
      targetId: connection.id,
      origin: 'user',
      afterData: { providerKey: 'whatsapp-cloud' },
    });
    return connection;
  }

  async quickBooksOAuthUrl(
    payload: QuickBooksOAuthUrlDto,
    actorUserId: string,
  ) {
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'integration',
      action: 'update',
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
    });
    const clientId =
      this.configService.get<string>('QUICKBOOKS_CLIENT_ID') ??
      this.configService.get<string>('INTUIT_CLIENT_ID');
    const redirectUri =
      payload.redirectUri ??
      this.configService.get<string>('QUICKBOOKS_REDIRECT_URI') ??
      this.configService.get<string>('INTUIT_REDIRECT_URI');
    if (!clientId || !redirectUri) {
      throw new BadRequestException(
        'QuickBooks sign-in is not configured for this Stack62 app. Set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_REDIRECT_URI.',
      );
    }
    const state = Buffer.from(
      JSON.stringify({
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId ?? null,
        actorUserId,
        provider: 'quickbooks',
      }),
    ).toString('base64url');
    const url = new URL('https://appcenter.intuit.com/connect/oauth2');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'com.intuit.quickbooks.accounting');
    url.searchParams.set('state', state);
    return { url: url.toString(), state };
  }

  async completeQuickBooksOAuth(
    payload: QuickBooksOAuthCallbackDto,
    actorUserId: string,
  ) {
    const state = this.decodeOAuthState(payload.state);
    if (state.actorUserId !== actorUserId) {
      throw new BadRequestException('OAuth state does not match this user.');
    }
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'integration',
      action: 'update',
      organizationId: state.organizationId,
      workspaceId: state.workspaceId ?? undefined,
    });
    const clientId =
      this.configService.get<string>('QUICKBOOKS_CLIENT_ID') ??
      this.configService.get<string>('INTUIT_CLIENT_ID');
    const clientSecret =
      this.configService.get<string>('QUICKBOOKS_CLIENT_SECRET') ??
      this.configService.get<string>('INTUIT_CLIENT_SECRET');
    const redirectUri =
      payload.redirectUri ??
      this.configService.get<string>('QUICKBOOKS_REDIRECT_URI') ??
      this.configService.get<string>('INTUIT_REDIRECT_URI');
    if (!clientId || !clientSecret || !redirectUri) {
      throw new BadRequestException(
        'QuickBooks sign-in is not configured for this Stack62 app. Set QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET and QUICKBOOKS_REDIRECT_URI.',
      );
    }
    const token = await this.postForm<{
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      x_refresh_token_expires_in?: number;
      token_type?: string;
    }>(
      'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      {
        code: payload.code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      },
      {
        Authorization: `Basic ${Buffer.from(
          `${clientId}:${clientSecret}`,
        ).toString('base64')}`,
      },
    );
    const expiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000)
      : null;
    const refreshExpiresAt = token.x_refresh_token_expires_in
      ? new Date(Date.now() + token.x_refresh_token_expires_in * 1000)
      : null;
    const connection = await this.createConnection(
      {
        organizationId: state.organizationId,
        workspaceId: state.workspaceId ?? undefined,
        providerKey: 'quickbooks',
        name: 'QuickBooks',
        config: {
          source: 'quickbooks_oauth',
          realmId: payload.realmId ?? null,
          environment:
            this.configService.get<string>('QUICKBOOKS_ENVIRONMENT') ??
            'sandbox',
        },
        credentials: {
          accessToken: token.access_token,
          refreshToken: token.refresh_token ?? null,
          expiresAt: expiresAt?.toISOString() ?? null,
          refreshExpiresAt: refreshExpiresAt?.toISOString() ?? null,
          tokenType: token.token_type ?? 'Bearer',
        },
      },
      actorUserId,
    );
    await this.tokensRepository.save(
      this.tokensRepository.create({
        connectionId: connection.id,
        tokenType: 'oauth',
        encryptedAccessToken: this.encryptTokenValue(token.access_token),
        encryptedRefreshToken: token.refresh_token
          ? this.encryptTokenValue(token.refresh_token)
          : null,
        expiresAt,
        metadata: {
          provider: 'quickbooks',
          realmId: payload.realmId ?? null,
          refreshExpiresAt: refreshExpiresAt?.toISOString() ?? null,
        },
      }),
    );
    await this.auditService.log({
      organizationId: state.organizationId,
      workspaceId: state.workspaceId ?? null,
      actorUserId,
      action: 'integration.quickbooks.oauth_connect',
      targetType: 'integration_connection',
      targetId: connection.id,
      origin: 'user',
      afterData: { providerKey: 'quickbooks', realmId: payload.realmId ?? null },
    });
    return connection;
  }

  async gmailSearch(payload: GmailSearchDto, actorUserId: string) {
    const { token } = await this.getGoogleAccess(payload, actorUserId, 'read');
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('q', payload.q);
    url.searchParams.set('maxResults', '10');
    const data = await this.getJson<{ messages?: Array<{ id: string; threadId: string }> }>(
      url.toString(),
      token,
    );
    await this.logIntegrationDispatch({
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId ?? null,
      actorUserId,
      providerKey: 'google-workspace',
      action: 'integration.gmail.search',
      targetId: 'gmail-search',
      metadata: { query: payload.q, count: data.messages?.length ?? 0 },
    });
    return data;
  }

  async gmailDraft(payload: GmailDraftDto, actorUserId: string) {
    const { token } = await this.getGoogleAccess(payload, actorUserId, 'update');
    const data = await this.postJson<{ id?: string; message?: { id?: string } }>(
      'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
      {
        message: {
          threadId: payload.threadId,
          raw: this.toBase64Url(
            [
              `To: ${payload.to.join(', ')}`,
              `Subject: ${payload.subject}`,
              'Content-Type: text/plain; charset="UTF-8"',
              '',
              payload.body,
            ].join('\r\n'),
          ),
        },
      },
      { Authorization: `Bearer ${token}` },
    );
    await this.logIntegrationDispatch({
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId ?? null,
      actorUserId,
      providerKey: 'google-workspace',
      action: 'integration.gmail.draft',
      targetId: data.id ?? 'gmail-draft',
      metadata: { toCount: payload.to.length, subject: payload.subject },
    });
    return { provider: 'google-workspace', id: data.id ?? null, ok: true };
  }

  async gmailSend(payload: GmailSendDto, actorUserId: string) {
    if (!payload.confirmed) {
      throw new BadRequestException('Email sending requires confirmation.');
    }
    const { token } = await this.getGoogleAccess(payload, actorUserId, 'update');
    const data = await this.postJson<{ id?: string }>(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        raw: this.toBase64Url(
          [
            `To: ${payload.to.join(', ')}`,
            `Subject: ${payload.subject}`,
            'Content-Type: text/plain; charset="UTF-8"',
            '',
            payload.body,
          ].join('\r\n'),
        ),
      },
      { Authorization: `Bearer ${token}` },
    );
    await this.logIntegrationDispatch({
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId ?? null,
      actorUserId,
      providerKey: 'google-workspace',
      action: 'integration.gmail.send',
      targetId: data.id ?? 'gmail-message',
      metadata: { toCount: payload.to.length, subject: payload.subject },
    });
    return { provider: 'google-workspace', id: data.id ?? null, ok: true };
  }

  async googleCalendarEvent(
    payload: GoogleCalendarEventDto,
    actorUserId: string,
  ) {
    const { token } = await this.getGoogleAccess(payload, actorUserId, 'update');
    const requestId = `stack62-${Date.now().toString(36)}`;
    const data = await this.postJson<{
      id?: string;
      htmlLink?: string;
      hangoutLink?: string;
    }>(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1',
      {
        summary: payload.summary,
        start: { dateTime: payload.start },
        end: { dateTime: payload.end },
        attendees: payload.attendees?.map((email) => ({ email })),
        conferenceData: payload.createMeetLink
          ? {
              createRequest: {
                requestId,
                conferenceSolutionKey: { type: 'hangoutsMeet' },
              },
            }
          : undefined,
      },
      { Authorization: `Bearer ${token}` },
    );
    await this.logIntegrationDispatch({
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId ?? null,
      actorUserId,
      providerKey: 'google-workspace',
      action: 'integration.google_calendar.event_create',
      targetId: data.id ?? 'calendar-event',
      metadata: {
        title: payload.summary,
        meet: Boolean(data.hangoutLink),
        ...this.safeMetadata(payload.metadata),
      },
    });
    return {
      provider: 'google-workspace',
      id: data.id ?? null,
      htmlLink: data.htmlLink ?? null,
      meetLink: data.hangoutLink ?? null,
      ok: true,
    };
  }

  async googleOpenWorkspaceItem(
    payload: GoogleOpenWorkspaceItemDto,
    actorUserId: string,
  ) {
    const { token } = await this.getGoogleAccess(payload, actorUserId, 'update');
    const googleMimeType =
      payload.kind === 'spreadsheet'
        ? 'application/vnd.google-apps.spreadsheet'
        : payload.kind === 'presentation'
          ? 'application/vnd.google-apps.presentation'
          : 'application/vnd.google-apps.document';
    const uploadMimeType =
      payload.kind === 'spreadsheet'
        ? 'text/csv'
        : payload.kind === 'presentation'
          ? 'text/plain'
          : 'text/plain';
    const created = await this.postMultipartUpload<{
      id: string;
      name?: string;
      mimeType?: string;
      webViewLink?: string;
    }>(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink',
      {
        name: payload.title,
        mimeType: googleMimeType,
      },
      payload.content,
      uploadMimeType,
      token,
    );
    await this.logIntegrationDispatch({
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId ?? null,
      actorUserId,
      providerKey: 'google-workspace',
      action: 'integration.google_drive.file_open',
      targetId: created.id,
      metadata: {
        title: payload.title,
        kind: payload.kind,
        sourceType: payload.sourceType ?? null,
        sourceId: payload.sourceId ?? null,
      },
    });
    return {
      provider: 'google-workspace',
      id: created.id,
      name: created.name ?? payload.title,
      mimeType: created.mimeType ?? googleMimeType,
      webViewLink:
        created.webViewLink ??
        `https://drive.google.com/open?id=${encodeURIComponent(created.id)}`,
      ok: true,
    };
  }

  async receiveWhatsAppWebhook(
    query: WhatsAppWebhookQueryDto,
    payload: Record<string, unknown>,
  ) {
    const eventType = this.whatsAppEventType(payload);
    const event = await this.webhookEventsRepository.save(
      this.webhookEventsRepository.create({
        organizationId: query.organizationId ?? null,
        workspaceId: query.workspaceId ?? null,
        providerKey: query.providerKey ?? 'whatsapp-cloud',
        eventType,
        payload,
        status: 'received',
      }),
    );
    await this.activityService.log({
      organizationId: query.organizationId ?? null,
      workspaceId: query.workspaceId ?? null,
      actorUserId: null,
      action: 'integration.whatsapp.message_received',
      targetType: 'webhook_event',
      targetId: event.id,
      origin: 'system',
      metadata: {
        providerKey: 'whatsapp-cloud',
        eventType,
        preview: this.whatsAppTextPreview(payload),
      },
    });
    return { ok: true, eventId: event.id };
  }

  async draftWhatsAppReply(payload: WhatsAppDraftReplyDto, actorUserId: string) {
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'integration',
      action: 'read',
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
    });
    const reply =
      `Thanks for reaching out. I have received your message: "${payload.message}". ` +
      'I will review it and get back to you shortly.';
    await this.activityService.log({
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId ?? null,
      actorUserId,
      action: 'integration.whatsapp.reply_drafted',
      targetType: 'integration_dispatch',
      targetId: 'whatsapp-draft',
      origin: 'ai',
      metadata: { to: this.maskPhone(payload.from) },
    });
    return {
      provider: 'whatsapp-cloud',
      to: payload.from,
      draft: reply,
      requiresConfirmation: true,
    };
  }

  async listWhatsAppPhoneNumbers(connectionId: string, actorUserId: string) {
    const connection = await this.findConnection(connectionId, actorUserId);
    if (connection.providerKey !== 'whatsapp-cloud') {
      throw new BadRequestException('This connection is not WhatsApp Business.');
    }
    const creds = this.decryptCredentials(connection);
    const accessToken = creds?.accessToken as string | undefined;
    if (!accessToken) {
      throw new BadRequestException('Reconnect WhatsApp Business first.');
    }
    const result = await this.getJson<MetaBusinessResponse>(
      'https://graph.facebook.com/v20.0/me/businesses?fields=id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}}',
      accessToken,
    );
    const phoneNumbers =
      result.data?.flatMap((business) =>
        business.owned_whatsapp_business_accounts?.data?.flatMap((account) =>
          account.phone_numbers?.data?.map((phone) => ({
            id: phone.id,
            displayPhoneNumber: phone.display_phone_number ?? phone.id,
            verifiedName: phone.verified_name ?? null,
            businessId: business.id,
            businessName: business.name ?? 'Business',
            businessAccountId: account.id,
            businessAccountName: account.name ?? 'WhatsApp account',
          })) ?? [],
        ) ?? [],
      ) ?? [];
    return { connectionId, phoneNumbers };
  }

  async selectWhatsAppPhoneNumber(
    connectionId: string,
    payload: SelectWhatsAppPhoneNumberDto,
    actorUserId: string,
  ) {
    const connection = await this.findConnection(connectionId, actorUserId);
    if (connection.providerKey !== 'whatsapp-cloud') {
      throw new BadRequestException('This connection is not WhatsApp Business.');
    }
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'integration',
      action: 'update',
      organizationId: connection.organizationId,
      workspaceId: connection.workspaceId ?? undefined,
    });
    connection.config = {
      ...(connection.config ?? {}),
      selectedPhoneNumberId: payload.phoneNumberId,
      phoneNumberId: payload.phoneNumberId,
      displayPhoneNumber: payload.displayPhoneNumber ?? null,
      verifiedName: payload.verifiedName ?? null,
      businessAccountId: payload.businessAccountId ?? null,
      setupStatus: 'ready',
    };
    connection.status = 'active';
    const saved = await this.connectionsRepository.save(connection);
    await this.activityService.log({
      organizationId: saved.organizationId,
      workspaceId: saved.workspaceId,
      actorUserId,
      action: 'integration.whatsapp.phone_number_selected',
      targetType: 'integration_connection',
      targetId: saved.id,
      origin: 'user',
      metadata: {
        phoneNumber: payload.displayPhoneNumber ?? null,
        verifiedName: payload.verifiedName ?? null,
      },
    });
    await this.auditService.log({
      organizationId: saved.organizationId,
      workspaceId: saved.workspaceId,
      actorUserId,
      action: 'integration.whatsapp.phone_number_selected',
      targetType: 'integration_connection',
      targetId: saved.id,
      origin: 'user',
      afterData: {
        phoneNumberId: payload.phoneNumberId,
        displayPhoneNumber: payload.displayPhoneNumber ?? null,
      },
    });
    return this.redact(saved);
  }

  private async disconnectLegacyConnections(
    filters: ListIntegrationConnectionsDto,
    actorUserId: string,
  ) {
    const qb = this.connectionsRepository.createQueryBuilder('connection');
    await this.accessControlService.applyTenantScopeToQueryBuilder(
      qb,
      'connection',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'workspaceId',
        organizationId: filters.organizationId,
        workspaceId: filters.workspaceId,
      },
    );
    qb.andWhere('connection.status = :status', { status: 'active' });
    const rows = await qb.getMany();
    const legacy = rows.filter((connection) => {
      if (!USER_OAUTH_PROVIDER_KEYS.has(connection.providerKey)) return true;
      if (connection.providerKey === 'google-workspace') {
        return connection.config?.source !== 'google_oauth';
      }
      if (connection.providerKey === 'whatsapp-cloud') {
        return connection.config?.source !== 'meta_oauth';
      }
      if (connection.providerKey === 'quickbooks') {
        return connection.config?.source !== 'quickbooks_oauth';
      }
      return false;
    });
    if (legacy.length === 0) return;
    const now = new Date().toISOString();
    await this.connectionsRepository.save(
      legacy.map((connection) => ({
        ...connection,
        status: 'disconnected',
        config: {
          ...(connection.config ?? {}),
          disconnectedAt: now,
          disconnectReason: 'legacy_manual_connection',
        },
      })),
    );
  }

  async initializePaystackPayment(
    payload: InitializePaymentDto,
    actorUserId?: string | null,
  ) {
    const secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!secretKey) {
      throw new BadRequestException(
        'Paystack is not configured. Set PAYSTACK_SECRET_KEY.',
      );
    }

    const callbackUrl =
      payload.callbackUrl ??
      this.configService.get<string>('PAYSTACK_CALLBACK_URL') ??
      undefined;

    const result = await this.postJson<{
      status: boolean;
      message: string;
      data?: {
        authorization_url?: string;
        access_code?: string;
        reference?: string;
      };
    }>(
      'https://api.paystack.co/transaction/initialize',
      {
        email: payload.email,
        amount: payload.amountKobo,
        reference: payload.reference,
        callback_url: callbackUrl,
        metadata: payload.metadata ?? {},
      },
      { Authorization: `Bearer ${secretKey}` },
    );

    await this.logIntegrationDispatch({
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId ?? null,
      actorUserId,
      providerKey: 'paystack',
      action: 'integration.payment.initialize',
      targetId: result.data?.reference ?? payload.reference ?? 'paystack',
      metadata: {
        amountKobo: payload.amountKobo,
        reference: result.data?.reference ?? payload.reference ?? null,
      },
    });

    return {
      provider: 'paystack',
      ok: result.status,
      message: result.message,
      authorizationUrl: result.data?.authorization_url ?? null,
      accessCode: result.data?.access_code ?? null,
      reference: result.data?.reference ?? null,
    };
  }

  async verifyPaystackPayment(
    payload: VerifyPaymentDto,
    actorUserId?: string | null,
  ) {
    const secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!secretKey) {
      throw new BadRequestException(
        'Paystack is not configured. Set PAYSTACK_SECRET_KEY.',
      );
    }

    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(
        payload.reference,
      )}`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    );
    const data = (await response.json()) as {
      status?: boolean;
      message?: string;
      data?: { status?: string; amount?: number; reference?: string };
    };
    if (!response.ok) {
      throw new BadRequestException(
        data.message ?? `Paystack verify failed with ${response.status}`,
      );
    }

    await this.logIntegrationDispatch({
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId ?? null,
      actorUserId,
      providerKey: 'paystack',
      action: 'integration.payment.verify',
      targetId: payload.reference,
      metadata: {
        status: data.data?.status ?? null,
        amountKobo: data.data?.amount ?? null,
      },
    });

    return {
      provider: 'paystack',
      ok: Boolean(data.status),
      message: data.message ?? null,
      paymentStatus: data.data?.status ?? null,
      amountKobo: data.data?.amount ?? null,
      reference: data.data?.reference ?? payload.reference,
    };
  }

  private async getGoogleAccess(
    payload: { organizationId: string; workspaceId?: string },
    actorUserId: string,
    action: 'read' | 'update',
  ) {
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'integration',
      action,
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
    });
    const connection = await this.resolveConnection(
      payload.organizationId,
      'google-workspace',
      payload.workspaceId,
    );
    if (!connection) {
      throw new NotFoundException('No Google Workspace connection found.');
    }
    const creds = this.decryptCredentials(connection);
    const token = creds?.accessToken as string | undefined;
    if (!token) {
      throw new BadRequestException(
        'Google Workspace connection is missing an access token. Reconnect Google.',
      );
    }
    return { connection, token };
  }

  private decodeOAuthState(state: string) {
    try {
      const parsed = JSON.parse(
        Buffer.from(state, 'base64url').toString('utf8'),
      ) as {
        organizationId?: string;
        workspaceId?: string | null;
        actorUserId?: string;
      };
      if (!parsed.organizationId || !parsed.actorUserId) {
        throw new Error('Missing state fields');
      }
      return {
        organizationId: parsed.organizationId,
        workspaceId: parsed.workspaceId ?? null,
        actorUserId: parsed.actorUserId,
      };
    } catch {
      throw new BadRequestException('Invalid OAuth state.');
    }
  }

  private encryptTokenValue(value: string) {
    const encrypted = this.cryptoService.encryptJson({ value });
    return encrypted ? JSON.stringify(encrypted) : null;
  }

  private async postForm<T>(
    url: string,
    body: Record<string, string>,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...headers,
      },
      body: new URLSearchParams(body).toString(),
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : {};
    if (!response.ok) {
      const message =
        data && typeof data === 'object' && 'error_description' in data
          ? String((data as { error_description: unknown }).error_description)
          : `${url} failed with status ${response.status}`;
      throw new BadRequestException(message);
    }
    return data as T;
  }

  private async getJson<T>(url: string, bearerToken: string): Promise<T> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : {};
    if (!response.ok) {
      const message =
        data && typeof data === 'object' && 'error' in data
          ? JSON.stringify((data as { error: unknown }).error)
          : `${url} failed with status ${response.status}`;
      throw new BadRequestException(message);
    }
    return data as T;
  }

  private async getJsonNoAuth<T>(url: string): Promise<T> {
    const response = await fetch(url);
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : {};
    if (!response.ok) {
      const message =
        data && typeof data === 'object' && 'error' in data
          ? JSON.stringify((data as { error: unknown }).error)
          : `${url} failed with status ${response.status}`;
      throw new BadRequestException(message);
    }
    return data as T;
  }

  private toBase64Url(value: string) {
    return Buffer.from(value)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  private whatsAppEventType(payload: Record<string, unknown>) {
    const entry = Array.isArray(payload.entry) ? payload.entry[0] : null;
    const change = entry?.changes?.[0];
    if (change?.value?.messages?.length) return 'message';
    if (change?.value?.statuses?.length) return 'status';
    return 'unknown';
  }

  private whatsAppTextPreview(payload: Record<string, unknown>) {
    const entry = Array.isArray(payload.entry) ? payload.entry[0] : null;
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    if (typeof message?.text?.body === 'string') {
      return message.text.body.slice(0, 140);
    }
    return null;
  }

  private async findConnection(connectionId: string, actorUserId: string) {
    const connection = await this.connectionsRepository.findOne({
      where: { id: connectionId },
    });
    if (!connection || connection.status === 'deleted') {
      throw new NotFoundException('Integration connection not found.');
    }

    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'organization',
      action: 'read',
      organizationId: connection.organizationId,
      workspaceId: connection.workspaceId ?? undefined,
    });

    return connection;
  }

  /**
   * Returns the most relevant active connection for a provider in this org.
   * Workspace-scoped connections win over org-wide ones.
   */
  async resolveConnection(
    organizationId: string,
    providerKey: string,
    workspaceId?: string | null,
  ): Promise<IntegrationConnectionEntity | null> {
    const all = await this.connectionsRepository.find({
      where: { organizationId, providerKey, status: 'active' },
      order: { updatedAt: 'DESC' },
    });
    const scoped =
      (workspaceId
        ? all.find((c) => c.workspaceId === workspaceId)
        : null) ?? all.find((c) => c.workspaceId === null) ?? all[0] ?? null;
    return scoped;
  }

  /** Decrypts a connection's credentials. Returns null if missing/masked. */
  decryptCredentials(connection: IntegrationConnectionEntity) {
    const decrypted = this.cryptoService.readCredentials(connection.credentials);
    if (!decrypted) return null;
    if (this.cryptoService.isMasked(decrypted)) return null;
    return decrypted;
  }

  /** Loads a connection by id with access control. Returns the raw entity (encrypted creds). */
  async findConnectionRaw(connectionId: string, actorUserId: string) {
    return this.findConnection(connectionId, actorUserId);
  }

  /** Persists timestamp updates etc. without changing protected fields. */
  async touchConnection(connection: IntegrationConnectionEntity) {
    return this.connectionsRepository.save(connection);
  }

  /** Returns the redacted public-facing form of a connection (for list/detail). */
  redact(connection: IntegrationConnectionEntity) {
    const credKeys = connection.credentials
      ? Object.keys(this.cryptoService.readCredentials(connection.credentials) ?? {})
      : [];
    return {
      ...connection,
      credentials: credKeys.length
        ? Object.fromEntries(credKeys.map((k) => [k, '********']))
        : null,
    };
  }

  private async postJson<T>(
    url: string,
    body: Record<string, unknown>,
    headers: Record<string, string>,
  ): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : {};
    if (!response.ok) {
      const message =
        typeof data === 'object' &&
        data !== null &&
        'message' in data &&
        typeof data.message === 'string'
          ? data.message
          : `${url} failed with status ${response.status}`;
      throw new BadRequestException(message);
    }

    return data as T;
  }

  private async postMultipartUpload<T>(
    url: string,
    metadata: Record<string, unknown>,
    content: string,
    contentType: string,
    bearerToken: string,
  ): Promise<T> {
    const boundary = `stack62_${Date.now().toString(36)}`;
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${contentType}; charset=UTF-8`,
      '',
      content,
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : {};
    if (!response.ok) {
      const message =
        data && typeof data === 'object' && 'error' in data
          ? JSON.stringify((data as { error: unknown }).error)
          : `${url} failed with status ${response.status}`;
      throw new BadRequestException(message);
    }
    return data as T;
  }

  private async logIntegrationDispatch(input: {
    organizationId: string;
    workspaceId: string | null;
    actorUserId?: string | null;
    providerKey: string;
    action: string;
    targetId: string;
    metadata: Record<string, unknown>;
  }) {
    await this.activityService.log({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetType: 'integration_dispatch',
      targetId: input.targetId,
      origin: 'system',
      metadata: {
        providerKey: input.providerKey,
        ...input.metadata,
      },
    });

    await this.auditService.log({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetType: 'integration_dispatch',
      targetId: input.targetId,
      origin: 'system',
      afterData: {
        providerKey: input.providerKey,
        ...input.metadata,
      },
    });
  }

  private safeMetadata(metadata?: Record<string, unknown>) {
    if (!metadata) return {};
    return Object.fromEntries(
      Object.entries(metadata).filter(
        ([key]) => !key.toLowerCase().includes('secret'),
      ),
    );
  }

  private assertPublicHttpUrl(rawUrl: string, label: string) {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new BadRequestException(`${label} must be a valid URL.`);
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException(`${label} must be http(s).`);
    }

    const hostname = parsed.hostname.toLowerCase();
    const blockedHosts = new Set([
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      '169.254.169.254',
    ]);
    if (
      blockedHosts.has(hostname) ||
      hostname.endsWith('.local') ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    ) {
      throw new BadRequestException(
        `${label} cannot target localhost, link-local, or private network addresses.`,
      );
    }
  }

  private maskPhone(value: string) {
    return value.length <= 4
      ? '****'
      : `${'*'.repeat(Math.max(value.length - 4, 0))}${value.slice(-4)}`;
  }
}
