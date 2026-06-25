/**
 * Event emitted when an inbound WhatsApp message has been persisted to a
 * conversation. The auto-responder (in the engine module) listens for this and
 * decides whether/how to reply, keeping the integrations module free of any
 * dependency on the AI engine (which would otherwise be a circular import).
 */
export const WHATSAPP_INBOUND_EVENT = 'whatsapp.inbound';

export interface WhatsAppInboundEvent {
  conversationId: string;
  messageId: string;
  organizationId: string;
  workspaceId: string | null;
  connectionId: string;
  channel: 'web' | 'cloud';
  contactPhone: string;
  contactName: string | null;
  text: string;
}
