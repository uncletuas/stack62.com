import { Injectable, Logger } from '@nestjs/common';
import { IntegrationsService } from '../../integrations/integrations.service';
import { tool, type ToolDefinition } from './types';

interface GoogleCalendarEvent {
  id?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email?: string; responseStatus?: string }>;
  location?: string;
  htmlLink?: string;
}

/**
 * Calendar tools for the Coworker. Reads + writes Google Calendar
 * through the existing Google OAuth integration (the `google-workspace`
 * connection installed via Settings → Integrations).
 *
 * Requires an active Google integration on the org. Without it the
 * tools return a clear "not connected" message rather than failing
 * silently, so the Coworker can prompt the user to connect.
 */
@Injectable()
export class CalendarTools {
  private readonly logger = new Logger(CalendarTools.name);

  constructor(private readonly integrations: IntegrationsService) {}

  build(): ToolDefinition[] {
    return [
      tool(
        'calendar.list_events',
        'List Google Calendar events on the connected account between now and `daysAhead` days (default 14). Use this to answer "what\'s on my calendar?" / "when am I free next Tuesday?" / "do I have a meeting with Sarah this week?"',
        {
          properties: {
            daysAhead: {
              type: 'number',
              description: 'How many days into the future to scan. Defaults to 14, max 60.',
            },
            query: {
              type: 'string',
              description: 'Optional text filter — events whose title contains this string.',
            },
            maxResults: {
              type: 'number',
              description: 'Cap on returned events (default 25, max 100).',
            },
          },
        },
        async (input, ctx) => {
          const token = await this.getGoogleToken(ctx.organizationId);
          if (!token) {
            return {
              output: { connected: false, events: [] },
              summary: 'Google Calendar not connected.',
            };
          }
          const days = Math.min(60, Number(input.daysAhead) || 14);
          const max = Math.min(100, Number(input.maxResults) || 25);
          const now = new Date().toISOString();
          const until = new Date(Date.now() + days * 86400_000).toISOString();
          const params = new URLSearchParams({
            timeMin: now,
            timeMax: until,
            singleEvents: 'true',
            orderBy: 'startTime',
            maxResults: String(max),
          });
          if (input.query) params.set('q', String(input.query));
          const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!response.ok) {
            const text = await response.text().catch(() => '');
            this.logger.warn(`Calendar list failed: ${text.slice(0, 200)}`);
            return {
              output: { connected: true, events: [], error: response.status },
              summary: `Calendar API ${response.status}.`,
            };
          }
          const data = (await response.json()) as {
            items?: GoogleCalendarEvent[];
          };
          const events = (data.items ?? []).map((e) => ({
            id: e.id,
            title: e.summary || '(untitled)',
            start: e.start?.dateTime || e.start?.date,
            end: e.end?.dateTime || e.end?.date,
            location: e.location,
            attendees: (e.attendees ?? [])
              .map((a) => a.email)
              .filter(Boolean),
            url: e.htmlLink,
          }));
          return {
            output: { connected: true, events },
            summary: `${events.length} event${events.length === 1 ? '' : 's'} in next ${days} day${days === 1 ? '' : 's'}.`,
          };
        },
        { actionLevel: 1 },
      ),

      tool(
        'calendar.create_event',
        'Create a Google Calendar event on the connected primary calendar. Use only when the user has explicitly asked to schedule something. Includes attendees via email; Google sends them an invite automatically.',
        {
          properties: {
            title: { type: 'string' },
            startIso: {
              type: 'string',
              description: 'ISO-8601 start datetime (e.g. 2026-05-20T14:00:00-04:00).',
            },
            endIso: { type: 'string', description: 'ISO-8601 end datetime.' },
            description: { type: 'string' },
            location: { type: 'string' },
            attendeeEmails: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional list of attendee email addresses.',
            },
          },
          required: ['title', 'startIso', 'endIso'],
        },
        async (input, ctx) => {
          const token = await this.getGoogleToken(ctx.organizationId);
          if (!token) {
            return {
              output: { connected: false, created: false },
              summary: 'Google Calendar not connected.',
            };
          }
          const body: GoogleCalendarEvent = {
            summary: String(input.title),
            description: input.description ? String(input.description) : undefined,
            location: input.location ? String(input.location) : undefined,
            start: { dateTime: String(input.startIso) },
            end: { dateTime: String(input.endIso) },
            attendees: Array.isArray(input.attendeeEmails)
              ? (input.attendeeEmails as unknown[])
                  .filter((e): e is string => typeof e === 'string')
                  .map((email) => ({ email }))
              : undefined,
          };
          const response = await fetch(
            'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body),
            },
          );
          if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Calendar create failed (${response.status}): ${text.slice(0, 200)}`);
          }
          const created = (await response.json()) as GoogleCalendarEvent;
          return {
            output: {
              connected: true,
              created: true,
              id: created.id,
              url: created.htmlLink,
            },
            summary: `Created "${input.title}" on calendar.`,
          };
        },
        { actionLevel: 3, sensitive: true },
      ),
    ];
  }

  /**
   * Resolve the most recent active Google Workspace connection's
   * decrypted access token. Token refresh handled by the operator
   * for now (Google access tokens last ~1 hour; we surface a clear
   * error if expired so the user knows to re-auth).
   */
  private async getGoogleToken(
    organizationId: string,
  ): Promise<string | null> {
    try {
      const connection = await this.integrations.resolveConnection(
        organizationId,
        'google-workspace',
      );
      if (!connection) return null;
      const creds = this.integrations.decryptCredentials(connection);
      if (!creds) return null;
      // Credential shape from the Google OAuth callback: { accessToken,
      // refreshToken, expiresAt, ... }
      const token =
        (creds as Record<string, unknown>).accessToken ??
        (creds as Record<string, unknown>).access_token ??
        null;
      return typeof token === 'string' ? token : null;
    } catch (err) {
      this.logger.warn(
        `Calendar token resolve failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
