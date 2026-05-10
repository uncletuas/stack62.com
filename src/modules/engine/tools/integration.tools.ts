import { Injectable } from '@nestjs/common';
import { IntegrationsService } from '../../integrations/integrations.service';
import { ProviderRuntimeService } from '../../integrations/provider-runtime.service';
import { tool, type ToolDefinition } from './types';

@Injectable()
export class IntegrationTools {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly runtime: ProviderRuntimeService,
  ) {}

  build(): ToolDefinition[] {
    return [
      tool(
        'integrations.list',
        'List active integration connections (email, messaging, payments, storage, etc.) available in this workspace.',
        {
          properties: {
            providerKey: { type: 'string' },
          },
        },
        async (input, ctx) => {
          const rows = await this.integrations.listConnections(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId ?? undefined,
              providerKey:
                typeof input.providerKey === 'string'
                  ? input.providerKey
                  : undefined,
            },
            ctx.actorUserId,
          );
          return {
            output: rows.map((c) => ({
              id: c.id,
              name: c.name,
              providerKey: c.providerKey,
              status: c.status,
              workspaceScoped: c.workspaceId !== null,
            })),
            summary: `${rows.length} connection${rows.length === 1 ? '' : 's'}.`,
          };
        },
      ),
      tool(
        'integrations.send_email',
        'Send a transactional email via the connected email provider.',
        {
          properties: {
            to: {
              type: 'array',
              items: { type: 'string' },
              description: 'Recipient email addresses.',
            },
            subject: { type: 'string' },
            text: { type: 'string', description: 'Plain-text body.' },
            html: { type: 'string', description: 'Optional HTML body.' },
          },
          required: ['to', 'subject'],
        },
        async (input, ctx) => {
          const result = await this.runtime.sendEmail(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              actorUserId: ctx.actorUserId,
              source: 'engine',
            },
            {
              to: (input.to as string[]) ?? [],
              subject: String(input.subject ?? ''),
              text: typeof input.text === 'string' ? input.text : undefined,
              html: typeof input.html === 'string' ? input.html : undefined,
            },
          );
          return {
            output: result,
            summary: `Email sent to ${(input.to as string[])?.length ?? 0} recipient(s).`,
          };
        },
      ),
      tool(
        'integrations.send_whatsapp',
        'Send a WhatsApp message via the connected WhatsApp Cloud account.',
        {
          properties: {
            to: { type: 'string', description: 'Phone number with country code (no +).' },
            message: { type: 'string' },
          },
          required: ['to', 'message'],
        },
        async (input, ctx) => {
          const result = await this.runtime.sendWhatsApp(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              actorUserId: ctx.actorUserId,
              source: 'engine',
            },
            { to: String(input.to), message: String(input.message) },
          );
          return { output: result, summary: 'WhatsApp message sent.' };
        },
      ),
      tool(
        'integrations.send_sms',
        'Send an SMS via Twilio.',
        {
          properties: {
            to: { type: 'string', description: 'E.164 phone number.' },
            body: { type: 'string' },
          },
          required: ['to', 'body'],
        },
        async (input, ctx) => {
          const result = await this.runtime.sendSms(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              actorUserId: ctx.actorUserId,
              source: 'engine',
            },
            { to: String(input.to), body: String(input.body) },
          );
          return { output: result, summary: 'SMS sent.' };
        },
      ),
      tool(
        'integrations.post_slack',
        'Post a message to a Slack channel via the connected Slack workspace.',
        {
          properties: {
            channel: {
              type: 'string',
              description: 'Channel ID or name (e.g. "#general"). Falls back to default channel.',
            },
            text: { type: 'string' },
          },
          required: ['text'],
        },
        async (input, ctx) => {
          const result = await this.runtime.postSlack(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              actorUserId: ctx.actorUserId,
              source: 'engine',
            },
            {
              channel:
                typeof input.channel === 'string' ? input.channel : undefined,
              text: String(input.text),
            },
          );
          return { output: result, summary: 'Slack message posted.' };
        },
      ),
      tool(
        'integrations.post_discord',
        'Post a message to Discord via the connected webhook.',
        {
          properties: {
            text: { type: 'string' },
          },
          required: ['text'],
        },
        async (input, ctx) => {
          const result = await this.runtime.postDiscord(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              actorUserId: ctx.actorUserId,
              source: 'engine',
            },
            { text: String(input.text) },
          );
          return { output: result, summary: 'Discord message posted.' };
        },
      ),
      tool(
        'integrations.send_telegram',
        'Send a Telegram message via the connected bot.',
        {
          properties: {
            to: { type: 'string', description: 'Chat id (overrides default).' },
            message: { type: 'string' },
          },
          required: ['message'],
        },
        async (input, ctx) => {
          const result = await this.runtime.sendTelegram(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              actorUserId: ctx.actorUserId,
              source: 'engine',
            },
            {
              to: typeof input.to === 'string' ? input.to : '',
              message: String(input.message),
            },
          );
          return { output: result, summary: 'Telegram message sent.' };
        },
      ),
      tool(
        'integrations.http_request',
        'Make an outbound HTTP request via the connected webhook (or a one-off URL when no connection is set).',
        {
          properties: {
            url: { type: 'string' },
            method: {
              type: 'string',
              enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
            },
            headers: { type: 'object' },
            body: {},
            query: { type: 'object' },
          },
        },
        async (input, ctx) => {
          const result = await this.runtime.httpRequest(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              actorUserId: ctx.actorUserId,
              source: 'engine',
            },
            {
              url: typeof input.url === 'string' ? input.url : undefined,
              method:
                typeof input.method === 'string' ? input.method : undefined,
              headers: (input.headers ?? undefined) as
                | Record<string, string>
                | undefined,
              body: input.body,
              query: (input.query ?? undefined) as
                | Record<string, string>
                | undefined,
            },
          );
          return {
            output: result,
            summary: `HTTP ${result.status} ${result.statusText}.`,
          };
        },
      ),
      tool(
        'integrations.s3_put',
        'Upload an object to the connected S3 bucket. Body is sent as UTF-8 text — base64 encode binaries first.',
        {
          properties: {
            key: { type: 'string', description: 'Object key (path inside the bucket).' },
            body: { type: 'string' },
            contentType: { type: 'string' },
          },
          required: ['key', 'body'],
        },
        async (input, ctx) => {
          const result = await this.runtime.s3Put(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              actorUserId: ctx.actorUserId,
              source: 'engine',
            },
            {
              key: String(input.key),
              body: String(input.body),
              contentType:
                typeof input.contentType === 'string'
                  ? input.contentType
                  : undefined,
            },
          );
          return { output: result, summary: `Uploaded to S3.` };
        },
      ),
      tool(
        'integrations.api_call',
        'Make an authenticated API call against any connected provider (HubSpot, Notion, Airtable, Calendly, Mailchimp, Salesforce, Slack, etc.). Use when there is no dedicated tool for the action you need. Path is provider-relative (e.g. "crm/v3/objects/contacts" for HubSpot).',
        {
          properties: {
            providerKey: {
              type: 'string',
              description:
                'Provider key as listed by integrations.list (e.g. "hubspot", "notion").',
            },
            path: { type: 'string', description: 'Provider-relative path or full URL.' },
            method: {
              type: 'string',
              enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
            },
            body: {},
            query: { type: 'object' },
            headers: { type: 'object' },
          },
          required: ['providerKey', 'path'],
        },
        async (input, ctx) => {
          const result = await this.runtime.apiCall(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              actorUserId: ctx.actorUserId,
              source: 'engine',
            },
            {
              providerKey: String(input.providerKey),
              path: String(input.path),
              method:
                typeof input.method === 'string' ? input.method : undefined,
              body: input.body,
              query: (input.query ?? undefined) as
                | Record<string, string>
                | undefined,
              headers: (input.headers ?? undefined) as
                | Record<string, string>
                | undefined,
            },
          );
          return {
            output: result,
            summary: `${input.providerKey}: ${result.status}`,
          };
        },
      ),
      tool(
        'integrations.gmail_search',
        'Search the connected Gmail mailbox using Gmail query syntax (e.g. "from:client@x.com newer_than:7d").',
        {
          properties: {
            q: { type: 'string', description: 'Gmail search query.' },
          },
          required: ['q'],
        },
        async (input, ctx) => {
          const result = await this.integrations.gmailSearch(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId ?? undefined,
              q: String(input.q),
            },
            ctx.actorUserId,
          );
          return {
            output: result,
            summary: `Gmail search returned ${result.messages?.length ?? 0} message(s).`,
          };
        },
      ),
      tool(
        'integrations.gmail_draft',
        'Create a draft Gmail email — does not send it. Use gmail_send to dispatch after the user confirms.',
        {
          properties: {
            to: { type: 'array', items: { type: 'string' } },
            subject: { type: 'string' },
            body: { type: 'string' },
            threadId: { type: 'string' },
          },
          required: ['to', 'subject', 'body'],
        },
        async (input, ctx) => {
          const result = await this.integrations.gmailDraft(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId ?? undefined,
              to: (input.to as string[]) ?? [],
              subject: String(input.subject),
              body: String(input.body),
              threadId:
                typeof input.threadId === 'string' ? input.threadId : undefined,
            },
            ctx.actorUserId,
          );
          return { output: result, summary: 'Gmail draft created.' };
        },
      ),
      tool(
        'integrations.gmail_send',
        'Send an email through the connected Gmail account. Sensitive — destination is external. The runtime gates this for confirmation when not in autopilot.',
        {
          properties: {
            to: { type: 'array', items: { type: 'string' } },
            subject: { type: 'string' },
            body: { type: 'string' },
            threadId: { type: 'string' },
          },
          required: ['to', 'subject', 'body'],
        },
        async (input, ctx) => {
          const result = await this.integrations.gmailSend(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId ?? undefined,
              to: (input.to as string[]) ?? [],
              subject: String(input.subject),
              body: String(input.body),
              threadId:
                typeof input.threadId === 'string' ? input.threadId : undefined,
              confirmed: true,
            },
            ctx.actorUserId,
          );
          return {
            output: result,
            summary: `Gmail sent to ${(input.to as string[])?.length ?? 0} recipient(s).`,
          };
        },
      ),
      tool(
        'integrations.calendar_create_event',
        'Create a Google Calendar event on the connected calendar. Times are ISO-8601. Optionally attach attendees and a Google Meet link.',
        {
          properties: {
            summary: { type: 'string' },
            start: { type: 'string', description: 'ISO-8601 start.' },
            end: { type: 'string', description: 'ISO-8601 end.' },
            attendees: { type: 'array', items: { type: 'string' } },
            createMeetLink: { type: 'boolean' },
          },
          required: ['summary', 'start', 'end'],
        },
        async (input, ctx) => {
          const result = await this.integrations.googleCalendarEvent(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId ?? undefined,
              summary: String(input.summary),
              start: String(input.start),
              end: String(input.end),
              attendees: (input.attendees as string[] | undefined) ?? undefined,
              createMeetLink:
                typeof input.createMeetLink === 'boolean'
                  ? input.createMeetLink
                  : undefined,
            },
            ctx.actorUserId,
          );
          return {
            output: result,
            summary: result.htmlLink
              ? `Calendar event created: ${result.htmlLink}`
              : 'Calendar event created.',
          };
        },
      ),
      tool(
        'integrations.drive_open',
        'Push a Stack62 document/file into Google Drive (Doc, Sheet, Slides, or text). Returns the Drive web link.',
        {
          properties: {
            title: { type: 'string' },
            content: { type: 'string', description: 'Document body.' },
            kind: {
              type: 'string',
              enum: ['document', 'spreadsheet', 'presentation', 'text'],
            },
            sourceId: { type: 'string' },
            sourceType: { type: 'string', enum: ['document', 'file'] },
          },
          required: ['title', 'content', 'kind'],
        },
        async (input, ctx) => {
          const result = await this.integrations.googleOpenWorkspaceItem(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId ?? undefined,
              title: String(input.title),
              content: String(input.content),
              kind: String(input.kind) as
                | 'document'
                | 'spreadsheet'
                | 'presentation'
                | 'text',
              sourceId:
                typeof input.sourceId === 'string' ? input.sourceId : undefined,
              sourceType:
                typeof input.sourceType === 'string'
                  ? (input.sourceType as 'document' | 'file')
                  : undefined,
            },
            ctx.actorUserId,
          );
          return {
            output: result,
            summary: `Opened in Drive: ${result.webViewLink}`,
          };
        },
      ),
      tool(
        'integrations.whatsapp_draft_reply',
        'Draft a WhatsApp reply to an inbound message. Returns the suggested reply text — does not send. Pair with integrations.send_whatsapp after the user confirms.',
        {
          properties: {
            from: { type: 'string', description: 'Sender phone number.' },
            message: { type: 'string', description: 'The inbound message text.' },
            context: { type: 'object' },
          },
          required: ['from', 'message'],
        },
        async (input, ctx) => {
          const result = await this.integrations.draftWhatsAppReply(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId ?? undefined,
              from: String(input.from),
              message: String(input.message),
              context: (input.context as Record<string, unknown>) ?? undefined,
            },
            ctx.actorUserId,
          );
          return { output: result, summary: 'WhatsApp reply drafted.' };
        },
      ),
      tool(
        'integrations.quickbooks_query',
        'Run a QuickBooks SQL-like query against the connected company. Use the QBO Query Language (e.g. "select * from Customer where DisplayName like \'%Acme%\'").',
        {
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
        async (input, ctx) => {
          const result = await this.runtime.apiCall(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              actorUserId: ctx.actorUserId,
              source: 'engine',
            },
            {
              providerKey: 'quickbooks',
              path: 'query',
              method: 'GET',
              query: { query: String(input.query) },
            },
          );
          return {
            output: result,
            summary: `QuickBooks query: ${result.status}`,
          };
        },
      ),
      tool(
        'integrations.quickbooks_list_customers',
        'List customers from the connected QuickBooks company. Returns name, email, balance.',
        {
          properties: {
            limit: { type: 'number', description: 'Max rows (default 25).' },
          },
        },
        async (input, ctx) => {
          const limit = Math.min(
            Math.max(Number(input.limit ?? 25) || 25, 1),
            100,
          );
          const result = await this.runtime.apiCall(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              actorUserId: ctx.actorUserId,
              source: 'engine',
            },
            {
              providerKey: 'quickbooks',
              path: 'query',
              method: 'GET',
              query: {
                query: `select Id,DisplayName,PrimaryEmailAddr,Balance from Customer order by DisplayName startposition 1 maxresults ${limit}`,
              },
            },
          );
          return {
            output: result,
            summary: `QuickBooks customers: ${result.status}`,
          };
        },
      ),
      tool(
        'integrations.quickbooks_list_invoices',
        'List recent invoices from the connected QuickBooks company.',
        {
          properties: {
            limit: { type: 'number' },
          },
        },
        async (input, ctx) => {
          const limit = Math.min(
            Math.max(Number(input.limit ?? 25) || 25, 1),
            100,
          );
          const result = await this.runtime.apiCall(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              actorUserId: ctx.actorUserId,
              source: 'engine',
            },
            {
              providerKey: 'quickbooks',
              path: 'query',
              method: 'GET',
              query: {
                query: `select Id,DocNumber,TxnDate,DueDate,Balance,TotalAmt,CustomerRef from Invoice order by TxnDate desc startposition 1 maxresults ${limit}`,
              },
            },
          );
          return {
            output: result,
            summary: `QuickBooks invoices: ${result.status}`,
          };
        },
      ),
      tool(
        'integrations.quickbooks_create_customer',
        'Create a customer in QuickBooks. Sensitive — modifies the connected accounting system.',
        {
          properties: {
            displayName: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
          },
          required: ['displayName'],
        },
        async (input, ctx) => {
          const body: Record<string, unknown> = {
            DisplayName: String(input.displayName),
          };
          if (typeof input.email === 'string') {
            body.PrimaryEmailAddr = { Address: input.email };
          }
          if (typeof input.phone === 'string') {
            body.PrimaryPhone = { FreeFormNumber: input.phone };
          }
          const result = await this.runtime.apiCall(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              actorUserId: ctx.actorUserId,
              source: 'engine',
            },
            {
              providerKey: 'quickbooks',
              path: 'customer',
              method: 'POST',
              body,
            },
          );
          return {
            output: result,
            summary: `QuickBooks customer create: ${result.status}`,
          };
        },
      ),
      tool(
        'integrations.quickbooks_create_invoice',
        'Create an invoice in QuickBooks for a given customer. lineAmount is in dollars.',
        {
          properties: {
            customerId: { type: 'string', description: 'QuickBooks Customer Id.' },
            lineAmount: { type: 'number' },
            description: { type: 'string' },
            itemId: {
              type: 'string',
              description: 'QuickBooks Item Id (defaults to "1" — the standard service item).',
            },
          },
          required: ['customerId', 'lineAmount'],
        },
        async (input, ctx) => {
          const body = {
            Line: [
              {
                Amount: Number(input.lineAmount),
                Description:
                  typeof input.description === 'string'
                    ? input.description
                    : 'Stack62 invoice line',
                DetailType: 'SalesItemLineDetail',
                SalesItemLineDetail: {
                  ItemRef: {
                    value:
                      typeof input.itemId === 'string' ? input.itemId : '1',
                  },
                },
              },
            ],
            CustomerRef: { value: String(input.customerId) },
          };
          const result = await this.runtime.apiCall(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              actorUserId: ctx.actorUserId,
              source: 'engine',
            },
            {
              providerKey: 'quickbooks',
              path: 'invoice',
              method: 'POST',
              body,
            },
          );
          return {
            output: result,
            summary: `QuickBooks invoice create: ${result.status}`,
          };
        },
      ),
      tool(
        'integrations.paystack_initialize',
        'Internal-only: initialize a Paystack transaction for Stack62 subscription/payment processing.',
        {
          properties: {
            email: { type: 'string' },
            amountKobo: { type: 'number' },
            reference: { type: 'string' },
            callbackUrl: { type: 'string' },
            metadata: { type: 'object' },
          },
          required: ['email', 'amountKobo'],
        },
        async (input, ctx) => {
          const result = await this.runtime.paystackInitialize(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              actorUserId: ctx.actorUserId,
              source: 'engine',
            },
            {
              email: String(input.email),
              amountKobo: Number(input.amountKobo),
              reference:
                typeof input.reference === 'string'
                  ? input.reference
                  : undefined,
              callbackUrl:
                typeof input.callbackUrl === 'string'
                  ? input.callbackUrl
                  : undefined,
              metadata: (input.metadata ?? {}) as Record<string, unknown>,
            },
          );
          return { output: result, summary: 'Paystack initialized.' };
        },
      ),
    ];
  }
}
