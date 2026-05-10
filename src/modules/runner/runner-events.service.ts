import {
  Injectable,
  MessageEvent,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Observable, Subject } from 'rxjs';

export type RunnerEventLevel = 'info' | 'done' | 'error' | 'log';
export type RunnerEventPhase =
  | 'generation'
  | 'file'
  | 'install'
  | 'runtime'
  | 'deployment'
  | 'status';

export interface RunnerEvent {
  id: string;
  systemId: string;
  deploymentId?: string;
  phase: RunnerEventPhase;
  level: RunnerEventLevel;
  message: string;
  detail?: string;
  timestamp: string;
}

export type RunnerEventInput = Omit<RunnerEvent, 'id' | 'timestamp'> & {
  id?: string;
  timestamp?: string;
};

interface JwtPayload {
  sub?: string;
}

const MAX_BUFFERED_EVENTS = 150;

@Injectable()
export class RunnerEventsService {
  private readonly streams = new Map<string, Subject<RunnerEvent>>();
  private readonly buffers = new Map<string, RunnerEvent[]>();

  constructor(private readonly jwtService: JwtService) {}

  emit(input: RunnerEventInput) {
    const event: RunnerEvent = {
      ...input,
      id: input.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: input.timestamp ?? new Date().toISOString(),
    };

    const buffer = this.buffers.get(event.systemId) ?? [];
    buffer.push(event);
    this.buffers.set(event.systemId, buffer.slice(-MAX_BUFFERED_EVENTS));
    this.subjectFor(event.systemId).next(event);
    return event;
  }

  stream(systemId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      for (const event of this.buffers.get(systemId) ?? []) {
        subscriber.next(this.toMessageEvent(event));
      }

      const subscription = this.subjectFor(systemId).subscribe((event) => {
        subscriber.next(this.toMessageEvent(event));
      });

      const heartbeat = setInterval(() => {
        subscriber.next({
          type: 'heartbeat',
          data: { timestamp: new Date().toISOString() },
        });
      }, 15000);

      return () => {
        clearInterval(heartbeat);
        subscription.unsubscribe();
      };
    });
  }

  verifyStreamToken(token: string | undefined): string {
    if (!token) {
      throw new UnauthorizedException('Missing stream token.');
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token);
      if (!payload.sub) {
        throw new UnauthorizedException('Invalid stream token.');
      }
      return payload.sub;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid or expired stream token.');
    }
  }

  private subjectFor(systemId: string) {
    let subject = this.streams.get(systemId);
    if (!subject) {
      subject = new Subject<RunnerEvent>();
      this.streams.set(systemId, subject);
    }
    return subject;
  }

  private toMessageEvent(event: RunnerEvent): MessageEvent {
    return {
      id: event.id,
      type: 'runner-event',
      data: event,
    };
  }
}
