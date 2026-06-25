/**
 * Event emitted when an inbound email has been persisted to a conversation.
 * The email responder (in the engine module) listens for this and decides
 * whether to draft/send a reply — keeping the integrations module free of any
 * dependency on the AI engine (which would otherwise be a circular import).
 */
export const EMAIL_INBOUND_EVENT = 'email.inbound';

export interface EmailInboundEvent {
  conversationId: string;
  messageId: string;
  organizationId: string;
  workspaceId: string | null;
  connectionId: string;
  providerKey: string;
  counterpartyEmail: string;
  counterpartyName: string | null;
  subject: string | null;
  bodyText: string;
  /** User to notify (the mailbox owner / connection creator), if known. */
  notifyUserId: string | null;
}
