import {
  BadGatewayException,
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

/**
 * Real-time voice — OpenAI Realtime API bridge.
 *
 * The frontend opens a WebRTC connection directly to OpenAI's Realtime
 * endpoint using an ephemeral session token. This endpoint mints that
 * token so the user's browser never sees the long-lived OPENAI_API_KEY.
 *
 * Required operator env:
 *   - OPENAI_API_KEY        (your direct OpenAI key — separate from OpenRouter)
 *   - REALTIME_MODEL        (default: gpt-4o-realtime-preview)
 *
 * Without OPENAI_API_KEY this endpoint returns 503 and the frontend
 * silently falls back to the Web Speech API path (the current state).
 *
 * The actual session+SDP exchange is on the client; we just hand back
 * the ephemeral key. See https://platform.openai.com/docs/guides/realtime
 * for the protocol.
 */
@ApiTags('realtime-voice')
@ApiBearerAuth()
@Controller('realtime-voice')
export class RealtimeVoiceController {
  private readonly logger = new Logger(RealtimeVoiceController.name);

  constructor(private readonly config: ConfigService) {}

  @Get('session')
  async createSession() {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Real-time voice requires OPENAI_API_KEY (a direct OpenAI key, not OpenRouter). Set it on the API service and retry.',
      );
    }
    const model =
      this.config.get<string>('REALTIME_MODEL') || 'gpt-4o-realtime-preview';

    const response = await fetch(
      'https://api.openai.com/v1/realtime/sessions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          modalities: ['text', 'audio'],
          // Server-side defaults for the assistant's voice + instructions.
          // The client can override these per-session via the data channel.
          voice: 'verse',
          instructions:
            'You are the Stack62 Coworker. Be concise, friendly, and act on what the user asks. When the user wants to schedule something, capture the time clearly and confirm before scheduling.',
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.logger.error(`Realtime session create failed: ${text}`);
      throw new BadGatewayException(
        `OpenAI Realtime session creation failed (${response.status}).`,
      );
    }
    const data = (await response.json()) as {
      client_secret?: { value: string; expires_at: number };
      id?: string;
      model?: string;
    };
    return {
      sessionId: data.id,
      model: data.model,
      ephemeralKey: data.client_secret?.value,
      expiresAt: data.client_secret?.expires_at,
    };
  }
}
