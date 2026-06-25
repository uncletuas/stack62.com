import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireAccess } from '../../shared/access-control/access-control.decorator';
import { Public } from '../../shared/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { CreateIntegrationConnectionDto } from './dto/create-integration-connection.dto';
import { DispatchWebhookDto } from './dto/dispatch-webhook.dto';
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
import { InitializePaymentDto } from './dto/initialize-payment.dto';
import { ListIntegrationConnectionsDto } from './dto/list-integration-connections.dto';
import { SendEmailDto } from './dto/send-email.dto';
import { SendWhatsAppDto } from './dto/send-whatsapp.dto';
import { SendWhatsAppMediaDto } from './dto/send-whatsapp-media.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import {
  SelectWhatsAppPhoneNumberDto,
  WhatsAppDraftReplyDto,
  WhatsAppWebhookQueryDto,
} from './dto/whatsapp-webhook.dto';
import { StartWhatsAppWebLinkDto } from './dto/whatsapp-web.dto';
import { EmailConversationService } from './email-conversation.service';
import { IntegrationsService } from './integrations.service';
import { ProviderRuntimeService } from './provider-runtime.service';
import { WhatsAppConversationService } from './whatsapp-conversation.service';
import { WhatsAppWebService } from './whatsapp-web.service';

@ApiTags('integrations')
@ApiBearerAuth()
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly providerRuntime: ProviderRuntimeService,
    private readonly whatsAppWeb: WhatsAppWebService,
    private readonly whatsAppConversations: WhatsAppConversationService,
    private readonly emailConversations: EmailConversationService,
  ) {}

  @Get('marketplace')
  marketplace() {
    return this.integrationsService.listMarketplace();
  }

  /**
   * Per-provider config status — whether the OAuth env vars are set.
   * The UI dims providers with `configured: false` so the user knows
   * before clicking "Connect" that the operator hasn't set up that
   * integration on this Stack62 deployment.
   */
  @Public()
  @Get('providers/status')
  providersStatus() {
    return this.integrationsService.getProviderConfigStatus();
  }

  @RequireAccess({
    resource: 'organization',
    action: 'update',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  @Post('connections')
  createConnection(
    @Body() payload: CreateIntegrationConnectionDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.createConnection(payload, user.userId);
  }

  @RequireAccess({
    resource: 'organization',
    action: 'read',
    organizationId: { source: 'query', key: 'organizationId', optional: true },
    workspaceId: { source: 'query', key: 'workspaceId', optional: true },
    allowUnscoped: true,
  })
  @Get('connections')
  listConnections(
    @Query() query: ListIntegrationConnectionsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.listConnections(query, user.userId);
  }

  @Post('connections/:connectionId/test')
  testConnection(
    @Param('connectionId') connectionId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.testConnection(connectionId, user.userId);
  }

  @Post('connections/:connectionId/verify')
  verifyConnection(
    @Param('connectionId') connectionId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.providerRuntime.verifyConnection(connectionId, user.userId);
  }

  @Delete('connections/:connectionId')
  disconnectConnection(
    @Param('connectionId') connectionId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.disconnectConnection(
      connectionId,
      user.userId,
    );
  }

  @RequireAccess({
    resource: 'organization',
    action: 'update',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  @Post('webhook/dispatch')
  dispatchWebhook(@Body() payload: DispatchWebhookDto) {
    return this.integrationsService.dispatchWebhook(payload);
  }

  @RequireAccess({
    resource: 'organization',
    action: 'update',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  @Post('email/send')
  sendEmail(@Body() payload: SendEmailDto, @CurrentUser() user: JwtUser) {
    return this.integrationsService.sendEmail(payload, user.userId);
  }

  @RequireAccess({
    resource: 'organization',
    action: 'update',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  @Post('whatsapp/send')
  sendWhatsApp(@Body() payload: SendWhatsAppDto, @CurrentUser() user: JwtUser) {
    return this.providerRuntime.sendWhatsApp(
      {
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId ?? null,
        actorUserId: user.userId,
        source: 'user',
      },
      {
        to: payload.to,
        message: payload.message,
        replyToMessageId: payload.replyToMessageId,
      },
    );
  }

  /** React to a WhatsApp message with an emoji (empty string clears it). */
  @Post('whatsapp/messages/:messageId/react')
  reactWhatsApp(
    @Param('messageId') messageId: string,
    @Body() body: { emoji: string },
    @CurrentUser() user: JwtUser,
  ) {
    return this.whatsAppWeb.reactForOperator(
      messageId,
      body.emoji ?? '',
      user.userId,
    );
  }

  /** Delete a WhatsApp message for everyone. */
  @Post('whatsapp/messages/:messageId/delete')
  deleteWhatsAppMessage(
    @Param('messageId') messageId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.whatsAppWeb.deleteForOperator(messageId, user.userId);
  }

  @RequireAccess({
    resource: 'organization',
    action: 'update',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  @Post('whatsapp/send-media')
  sendWhatsAppMedia(
    @Body() payload: SendWhatsAppMediaDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.providerRuntime.sendWhatsAppMedia(
      {
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId ?? null,
        actorUserId: user.userId,
        source: 'user',
      },
      {
        to: payload.to,
        fileId: payload.fileId,
        caption: payload.caption,
        ptt: payload.ptt,
        forceType: payload.forceType,
        replyToMessageId: payload.replyToMessageId,
      },
    );
  }

  /**
   * Begin WhatsApp's "Link a device → Link with phone number" flow. Returns the
   * pairing code the coworker types into their phone to link this WhatsApp
   * account to Stack62 as a companion device.
   */
  @RequireAccess({
    resource: 'organization',
    action: 'update',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  @Post('whatsapp-web/link')
  startWhatsAppWebLink(
    @Body() payload: StartWhatsAppWebLinkDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.whatsAppWeb.startLink(payload, user.userId);
  }

  @Get('connections/:connectionId/whatsapp-web/status')
  whatsAppWebStatus(
    @Param('connectionId') connectionId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.whatsAppWeb.getStatus(connectionId, user.userId);
  }

  @Post('connections/:connectionId/whatsapp-web/logout')
  whatsAppWebLogout(
    @Param('connectionId') connectionId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.whatsAppWeb.logout(connectionId, user.userId);
  }

  /** List WhatsApp conversations (chats) across both channels for the workspace. */
  @Get('whatsapp/conversations')
  listWhatsAppConversations(
    @Query('organizationId') organizationId: string,
    @Query('workspaceId') workspaceId: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.whatsAppConversations.listConversations(
      { organizationId, workspaceId },
      user.userId,
    );
  }

  @Get('whatsapp/conversations/:conversationId/messages')
  listWhatsAppConversationMessages(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.whatsAppConversations.listMessages(conversationId, user.userId);
  }

  @Patch('whatsapp/conversations/:conversationId')
  updateWhatsAppConversation(
    @Param('conversationId') conversationId: string,
    @Body() body: { markRead?: boolean; autoReplyOverride?: boolean | null },
    @CurrentUser() user: JwtUser,
  ) {
    return this.whatsAppConversations.updateConversation(
      conversationId,
      body,
      user.userId,
    );
  }

  /** Fetch + persist the contact's profile picture on demand (linked device). */
  @Post('whatsapp/conversations/:conversationId/refresh-avatar')
  refreshWhatsAppAvatar(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.whatsAppWeb.refreshAvatarForOperator(
      conversationId,
      user.userId,
    );
  }

  // ── Google Drive (attachment source) ────────────────────────────────
  @Get('google-drive/files')
  listGoogleDriveFiles(
    @Query('organizationId') organizationId: string,
    @Query('workspaceId') workspaceId: string | undefined,
    @Query('query') query: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.listGoogleDriveFiles(
      { organizationId, workspaceId, query },
      user.userId,
    );
  }

  @Post('google-drive/import')
  importGoogleDriveFile(
    @Body()
    body: { organizationId: string; workspaceId?: string; fileId: string },
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.importGoogleDriveFile(body, user.userId);
  }

  // ── Email inbox (incoming mail per connected mailbox) ────────────────
  @Get('email/conversations')
  listEmailConversations(
    @Query('organizationId') organizationId: string,
    @Query('workspaceId') workspaceId: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.emailConversations.listConversations(
      { organizationId, workspaceId },
      user.userId,
    );
  }

  @Get('email/conversations/:conversationId/messages')
  listEmailConversationMessages(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.emailConversations.listMessages(conversationId, user.userId);
  }

  @Patch('email/conversations/:conversationId')
  updateEmailConversation(
    @Param('conversationId') conversationId: string,
    @Body() body: { markRead?: boolean; autoReplyOverride?: boolean | null },
    @CurrentUser() user: JwtUser,
  ) {
    return this.emailConversations.updateConversation(
      conversationId,
      body,
      user.userId,
    );
  }

  /** Approve + send a reply in a thread (used to send a coworker draft). */
  @Post('email/conversations/:conversationId/send')
  sendEmailReply(
    @Param('conversationId') conversationId: string,
    @Body() body: { bodyText: string; subject?: string },
    @CurrentUser() user: JwtUser,
  ) {
    return this.emailConversations.sendReply(
      conversationId,
      { bodyText: body.bodyText, subject: body.subject },
      user.userId,
    );
  }

  @RequireAccess({
    resource: 'integration',
    action: 'update',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  @Post('google/oauth/url')
  googleOAuthUrl(
    @Body() payload: GoogleOAuthUrlDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.googleOAuthUrl(payload, user.userId);
  }

  @Post('google/oauth/callback')
  googleOAuthCallback(
    @Body() payload: GoogleOAuthCallbackDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.completeGoogleOAuth(payload, user.userId);
  }

  @RequireAccess({
    resource: 'integration',
    action: 'update',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  @Post('meta/oauth/url')
  metaOAuthUrl(@Body() payload: MetaOAuthUrlDto, @CurrentUser() user: JwtUser) {
    return this.integrationsService.metaOAuthUrl(payload, user.userId);
  }

  @Post('meta/oauth/callback')
  metaOAuthCallback(
    @Body() payload: MetaOAuthCallbackDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.completeMetaOAuth(payload, user.userId);
  }

  @RequireAccess({
    resource: 'integration',
    action: 'update',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  @Post('quickbooks/oauth/url')
  quickBooksOAuthUrl(
    @Body() payload: QuickBooksOAuthUrlDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.quickBooksOAuthUrl(payload, user.userId);
  }

  @Post('quickbooks/oauth/callback')
  quickBooksOAuthCallback(
    @Body() payload: QuickBooksOAuthCallbackDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.completeQuickBooksOAuth(
      payload,
      user.userId,
    );
  }

  @RequireAccess({
    resource: 'integration',
    action: 'read',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  @Post('google/gmail/search')
  gmailSearch(@Body() payload: GmailSearchDto, @CurrentUser() user: JwtUser) {
    return this.integrationsService.gmailSearch(payload, user.userId);
  }

  @RequireAccess({
    resource: 'integration',
    action: 'update',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  @Post('google/gmail/draft')
  gmailDraft(@Body() payload: GmailDraftDto, @CurrentUser() user: JwtUser) {
    return this.integrationsService.gmailDraft(payload, user.userId);
  }

  @RequireAccess({
    resource: 'integration',
    action: 'update',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  @Post('google/gmail/send')
  gmailSend(@Body() payload: GmailSendDto, @CurrentUser() user: JwtUser) {
    return this.integrationsService.gmailSend(payload, user.userId);
  }

  @RequireAccess({
    resource: 'integration',
    action: 'update',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  @Post('google/calendar/events')
  googleCalendarEvent(
    @Body() payload: GoogleCalendarEventDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.googleCalendarEvent(payload, user.userId);
  }

  @RequireAccess({
    resource: 'integration',
    action: 'update',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  @Post('google/drive/open')
  googleOpenWorkspaceItem(
    @Body() payload: GoogleOpenWorkspaceItemDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.googleOpenWorkspaceItem(
      payload,
      user.userId,
    );
  }

  @Public()
  @Get('whatsapp/webhook')
  verifyWhatsAppWebhook(@Query() query: Record<string, string>) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    const expected = process.env.META_WHATSAPP_VERIFY_TOKEN;
    if (mode === 'subscribe' && token && expected && token === expected) {
      return challenge ?? 'ok';
    }
    return { ok: false };
  }

  @Public()
  @Post('whatsapp/webhook')
  receiveWhatsAppWebhook(
    @Query() query: WhatsAppWebhookQueryDto,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.integrationsService.receiveWhatsAppWebhook(query, payload);
  }

  @RequireAccess({
    resource: 'integration',
    action: 'read',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  @Post('whatsapp/draft-reply')
  draftWhatsAppReply(
    @Body() payload: WhatsAppDraftReplyDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.draftWhatsAppReply(payload, user.userId);
  }

  @Get('connections/:connectionId/whatsapp-phone-numbers')
  listWhatsAppPhoneNumbers(
    @Param('connectionId') connectionId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.listWhatsAppPhoneNumbers(
      connectionId,
      user.userId,
    );
  }

  @Post('connections/:connectionId/whatsapp-phone-number')
  selectWhatsAppPhoneNumber(
    @Param('connectionId') connectionId: string,
    @Body() payload: SelectWhatsAppPhoneNumberDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.selectWhatsAppPhoneNumber(
      connectionId,
      payload,
      user.userId,
    );
  }

  @RequireAccess({
    resource: 'organization',
    action: 'update',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  @Post('payments/paystack/initialize')
  initializePaystackPayment(
    @Body() payload: InitializePaymentDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.initializePaystackPayment(
      payload,
      user.userId,
    );
  }

  @RequireAccess({
    resource: 'organization',
    action: 'read',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  @Post('payments/paystack/verify')
  verifyPaystackPayment(
    @Body() payload: VerifyPaymentDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.integrationsService.verifyPaystackPayment(payload, user.userId);
  }

  @Public()
  @Post('payments/paystack/webhook')
  receivePaystackWebhook(
    @Query() query: { organizationId?: string; workspaceId?: string },
    @Body() payload: Record<string, unknown>,
    @Headers('x-paystack-signature') signature?: string,
  ) {
    return this.integrationsService.receivePaystackWebhook(
      query,
      payload,
      signature,
    );
  }
}
