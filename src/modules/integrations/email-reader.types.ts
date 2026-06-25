/** A normalized inbound email returned by the Gmail/IMAP readers. */
export interface NormalizedInboundEmail {
  /** Provider message id (Gmail id) or IMAP uid — unique per connection. */
  externalId: string;
  threadId: string | null;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  bodyText: string;
  receivedAt: Date | null;
}
