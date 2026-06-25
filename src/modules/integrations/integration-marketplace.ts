export interface IntegrationProviderDefinition {
  key: string;
  name: string;
  category:
    | 'email'
    | 'messaging'
    | 'productivity'
    | 'payments'
    | 'accounting'
    | 'storage'
    | 'crm'
    | 'marketing'
    | 'meetings'
    | 'data'
    | 'webhook';
  description: string;
  capabilities: string[];
  credentialFields: string[];
  configFields: string[];
}

export const INTEGRATION_MARKETPLACE: IntegrationProviderDefinition[] = [
  {
    key: 'resend',
    name: 'Resend Email',
    category: 'email',
    description: 'Send transactional workflow email through Resend.',
    capabilities: ['send_email'],
    credentialFields: ['apiKey'],
    configFields: ['fromEmail'],
  },
  {
    key: 'smtp-email',
    name: 'SMTP Email',
    category: 'email',
    description:
      'Send workflow notifications through an SMTP-compatible relay.',
    capabilities: ['send_email'],
    credentialFields: [
      'host',
      'port',
      'username',
      'password',
      'imapHost',
      'imapPort',
    ],
    configFields: ['fromEmail', 'fromName'],
  },
  {
    key: 'whatsapp-cloud',
    name: 'WhatsApp Cloud API',
    category: 'messaging',
    description: 'Send WhatsApp workflow messages through Meta Cloud API.',
    capabilities: ['send_whatsapp'],
    credentialFields: ['accessToken', 'phoneNumberId'],
    configFields: ['defaultTemplate'],
  },
  {
    key: 'whatsapp-web',
    name: 'WhatsApp (Link a device)',
    category: 'messaging',
    description:
      'Link a personal or business WhatsApp account as a companion device using a phone-number pairing code, then send and receive messages.',
    capabilities: ['send_whatsapp', 'receive_whatsapp'],
    credentialFields: [],
    configFields: ['linkedPhoneNumber'],
  },
  {
    key: 'google-workspace',
    name: 'Google Workspace',
    category: 'productivity',
    description:
      'Prepare Google Drive, Calendar, Gmail, and Sheets connections.',
    capabilities: [
      'calendar_event',
      'drive_file',
      'gmail_message',
      'sheet_row',
    ],
    credentialFields: ['clientId', 'clientSecret', 'refreshToken'],
    configFields: ['defaultCalendarId', 'driveFolderId'],
  },
  {
    key: 'microsoft-365',
    name: 'Microsoft 365',
    category: 'productivity',
    description: 'Prepare Outlook, Teams, OneDrive, and Excel integrations.',
    capabilities: [
      'outlook_message',
      'teams_message',
      'onedrive_file',
      'excel_row',
    ],
    credentialFields: ['tenantId', 'clientId', 'clientSecret', 'refreshToken'],
    configFields: ['defaultTeamId', 'defaultDriveId'],
  },
  {
    key: 'paystack',
    name: 'Paystack',
    category: 'payments',
    description:
      'Accept Nigerian and international payments for SME workflows.',
    capabilities: ['payment_initialize', 'payment_verify'],
    credentialFields: ['secretKey', 'publicKey'],
    configFields: ['callbackUrl'],
  },
  {
    key: 'stripe',
    name: 'Stripe',
    category: 'payments',
    description: 'Payment and billing event connector for finance workflows.',
    capabilities: ['payment_link', 'customer_lookup', 'invoice_lookup'],
    credentialFields: ['secretKey'],
    configFields: ['webhookSecret'],
  },
  {
    key: 'quickbooks',
    name: 'QuickBooks',
    category: 'accounting',
    description: 'Accounting connector for customers, invoices, and expenses.',
    capabilities: ['invoice_create', 'expense_create', 'customer_lookup'],
    credentialFields: ['clientId', 'clientSecret', 'refreshToken', 'realmId'],
    configFields: ['defaultIncomeAccountId'],
  },
  {
    key: 'discord',
    name: 'Discord',
    category: 'messaging',
    description: 'Post to Discord channels via incoming webhook.',
    capabilities: ['post_message'],
    credentialFields: ['webhookUrl'],
    configFields: [],
  },
  {
    key: 'telegram',
    name: 'Telegram',
    category: 'messaging',
    description: 'Send Telegram messages from a bot.',
    capabilities: ['send_message'],
    credentialFields: ['botToken'],
    configFields: ['defaultChatId'],
  },
  {
    key: 'sms-twilio',
    name: 'Twilio SMS',
    category: 'messaging',
    description: 'Send SMS via Twilio.',
    capabilities: ['send_sms'],
    credentialFields: ['accountSid', 'authToken'],
    configFields: ['fromNumber'],
  },
  {
    key: 'aws-s3',
    name: 'Amazon S3',
    category: 'storage',
    description: 'Read and write objects to an S3 bucket.',
    capabilities: ['object_put', 'object_get', 'object_list'],
    credentialFields: ['accessKeyId', 'secretAccessKey'],
    configFields: ['bucket', 'region'],
  },
  {
    key: 'hubspot',
    name: 'HubSpot',
    category: 'crm',
    description: 'Sync contacts, companies, and deals with HubSpot CRM.',
    capabilities: ['contact_create', 'contact_lookup', 'deal_create'],
    credentialFields: ['accessToken'],
    configFields: [],
  },
  {
    key: 'salesforce',
    name: 'Salesforce',
    category: 'crm',
    description:
      'Read and write Salesforce objects (leads, accounts, opportunities).',
    capabilities: ['lead_create', 'account_lookup', 'opportunity_create'],
    credentialFields: ['accessToken', 'instanceUrl'],
    configFields: [],
  },
  {
    key: 'mailchimp',
    name: 'Mailchimp',
    category: 'marketing',
    description: 'Add subscribers and trigger marketing emails.',
    capabilities: ['subscriber_add', 'campaign_send'],
    credentialFields: ['apiKey', 'serverPrefix'],
    configFields: ['defaultListId'],
  },
  {
    key: 'notion',
    name: 'Notion',
    category: 'productivity',
    description: 'Read pages and append rows to Notion databases.',
    capabilities: ['page_read', 'database_query', 'database_row_create'],
    credentialFields: ['integrationToken'],
    configFields: [],
  },
  {
    key: 'airtable',
    name: 'Airtable',
    category: 'data',
    description: 'Sync records with Airtable bases.',
    capabilities: ['record_list', 'record_create', 'record_update'],
    credentialFields: ['personalAccessToken'],
    configFields: ['defaultBaseId'],
  },
  {
    key: 'calendly',
    name: 'Calendly',
    category: 'meetings',
    description: 'List and create scheduled events via Calendly.',
    capabilities: ['event_list', 'invitee_lookup'],
    credentialFields: ['personalAccessToken'],
    configFields: ['defaultEventTypeUri'],
  },
  {
    key: 'zoom',
    name: 'Zoom',
    category: 'meetings',
    description: 'Create Zoom meetings and read meeting metadata.',
    capabilities: ['meeting_create', 'meeting_lookup'],
    credentialFields: ['accountId', 'clientId', 'clientSecret'],
    configFields: ['defaultUserId'],
  },
  {
    key: 'google-meet',
    name: 'Google Meet',
    category: 'meetings',
    description: 'Generate Google Meet links via Google Workspace.',
    capabilities: ['meeting_create'],
    credentialFields: ['clientId', 'clientSecret', 'refreshToken'],
    configFields: [],
  },
  {
    key: 'webhook',
    name: 'Generic Webhook',
    category: 'webhook',
    description: 'Call any HTTPS endpoint from workflow automation.',
    capabilities: ['http_request'],
    credentialFields: ['secretHeaderName', 'secretHeaderValue'],
    configFields: ['url', 'method'],
  },
];

export const USER_OAUTH_INTEGRATIONS: IntegrationProviderDefinition[] = [
  {
    key: 'google-workspace',
    name: 'Connect Gmail (Google)',
    category: 'email',
    description:
      'Sign in with Google so you and your coworker can send email from your own Gmail, plus work with Calendar, Meet, Docs, Sheets, and Drive after approval.',
    capabilities: [
      'gmail_message',
      'send_email',
      'calendar_event',
      'meeting_create',
      'drive_file',
      'document_edit',
      'sheet_edit',
    ],
    credentialFields: [],
    configFields: [],
  },
  {
    key: 'smtp-email',
    name: 'Connect email (SMTP)',
    category: 'email',
    description:
      'Connect any email account (Yahoo, Zoho, Outlook, cPanel, or Gmail with an app password) by entering its SMTP details. Add IMAP details too and your coworker can also read and reply to incoming mail.',
    capabilities: ['send_email'],
    credentialFields: [
      'host',
      'port',
      'username',
      'password',
      'imapHost',
      'imapPort',
    ],
    configFields: ['fromEmail', 'fromName'],
  },
  {
    key: 'whatsapp-web',
    name: 'WhatsApp (Link a device)',
    category: 'messaging',
    description:
      'Link a coworker’s WhatsApp by phone number: enter the number, get a one-time pairing code, type it into WhatsApp → Linked devices, and the account is connected for sending and receiving.',
    capabilities: ['whatsapp_message', 'whatsapp_receive'],
    credentialFields: [],
    configFields: [],
  },
  {
    key: 'quickbooks',
    name: 'QuickBooks',
    category: 'accounting',
    description:
      'Sign in with Intuit so the coworker can help with customers, invoices, and accounting records after approval.',
    capabilities: ['customer_lookup', 'invoice_create', 'expense_create'],
    credentialFields: [],
    configFields: [],
  },
];

export const USER_OAUTH_PROVIDER_KEYS = new Set(
  USER_OAUTH_INTEGRATIONS.map((provider) => provider.key),
);

export function findIntegrationProvider(providerKey: string) {
  return INTEGRATION_MARKETPLACE.find(
    (provider) => provider.key === providerKey,
  );
}
