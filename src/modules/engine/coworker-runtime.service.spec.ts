import { CoworkerRuntimeService } from './coworker-runtime.service';
import type { EngineEvent, EngineSessionInput } from './engine.service';

describe('CoworkerRuntimeService', () => {
  const input: EngineSessionInput = {
    ctx: {
      organizationId: '11111111-1111-1111-1111-111111111111',
      workspaceId: '22222222-2222-2222-2222-222222222222',
      actorUserId: '33333333-3333-3333-3333-333333333333',
    },
    prompt: 'build a coffee shop sales tracker',
  };

  it('runs build, deploy, and ready-for-feedback states', async () => {
    const service = new CoworkerRuntimeService(
      {
        findAll: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          system: { id: 'system-1', name: 'Coffee Shop Sales Tracker' },
        }),
      } as never,
      {
        generate: jest.fn().mockResolvedValue({
          dir: 'generated/systems/system-1',
          codebase: {
            summary: 'Coffee shop tracker',
            entrypoint: 'server.js',
            runtime: 'node',
            files: [{ path: 'server.js' }],
          },
        }),
      } as never,
      {
        deploy: jest.fn().mockResolvedValue({ id: 'deployment-1' }),
        findOne: jest.fn().mockResolvedValue({
          id: 'deployment-1',
          status: 'running',
          errorMessage: null,
        }),
        logs: jest.fn(),
      } as never,
      { create: jest.fn() } as never,
    );

    const events = await collect(service.runBuild(input, 'test-model'));
    expect(states(events)).toEqual(
      expect.arrayContaining([
        'queued',
        'thinking',
        'executing',
        'testing',
        'deploying',
        'ready_for_feedback',
      ]),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'session.complete',
        stopReason: 'ready',
      }),
    );
  });

  it('repairs after a crashed deployment and succeeds on the second attempt', async () => {
    const findOne = jest
      .fn()
      .mockResolvedValueOnce({
        id: 'deployment-1',
        status: 'crashed',
        errorMessage: 'Syntax error',
      })
      .mockResolvedValueOnce({
        id: 'deployment-2',
        status: 'running',
        errorMessage: null,
      });
    const service = new CoworkerRuntimeService(
      {
        findAll: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          system: { id: 'system-1', name: 'Coffee Shop Sales Tracker' },
        }),
      } as never,
      {
        generate: jest.fn().mockResolvedValue({
          dir: 'generated/systems/system-1',
          codebase: {
            summary: 'Coffee shop tracker',
            entrypoint: 'server.js',
            runtime: 'node',
            files: [{ path: 'server.js' }],
          },
        }),
      } as never,
      {
        deploy: jest
          .fn()
          .mockResolvedValueOnce({ id: 'deployment-1' })
          .mockResolvedValueOnce({ id: 'deployment-2' }),
        findOne,
        logs: jest.fn().mockResolvedValue({ lines: ['Syntax error'] }),
      } as never,
      { create: jest.fn() } as never,
    );

    const events = await collect(service.runBuild(input, 'test-model'));
    expect(states(events)).toContain('repairing');
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'session.complete',
        stopReason: 'ready',
      }),
    );
  });

  it('fails after repair attempts are exhausted', async () => {
    const service = new CoworkerRuntimeService(
      {
        findAll: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          system: { id: 'system-1', name: 'Coffee Shop Sales Tracker' },
        }),
      } as never,
      {
        generate: jest.fn().mockResolvedValue({
          dir: 'generated/systems/system-1',
          codebase: {
            summary: 'Coffee shop tracker',
            entrypoint: 'server.js',
            runtime: 'node',
            files: [{ path: 'server.js' }],
          },
        }),
      } as never,
      {
        deploy: jest.fn().mockResolvedValue({ id: 'deployment-1' }),
        findOne: jest.fn().mockResolvedValue({
          id: 'deployment-1',
          status: 'crashed',
          errorMessage: 'Crash',
        }),
        logs: jest.fn().mockResolvedValue({ lines: ['Crash'] }),
      } as never,
      { create: jest.fn() } as never,
    );

    const events = await collect(service.runBuild(input, 'test-model'));
    expect(states(events)).toContain('failed');
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'session.error',
        message: expect.stringContaining('Crash'),
      }),
    );
  });

  it('marks the operation stopped when cancellation is requested', async () => {
    const service = new CoworkerRuntimeService(
      {
        findAll: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          system: { id: 'system-1', name: 'Coffee Shop Sales Tracker' },
        }),
      } as never,
      {
        generate: jest
          .fn()
          .mockImplementation(
            () => new Promise((resolve) => setTimeout(resolve, 20)),
          ),
      } as never,
      {
        deploy: jest.fn(),
        findOne: jest.fn(),
        logs: jest.fn(),
      } as never,
      { create: jest.fn() } as never,
    );

    const stream = service.runBuild(input, 'test-model');
    const first = await stream.next();
    const operationId =
      first.value?.type === 'tool.result' &&
      typeof first.value.output === 'object' &&
      first.value.output !== null &&
      'operationId' in first.value.output
        ? String((first.value.output as { operationId: string }).operationId)
        : '';
    expect(service.stop(operationId)).toBe(true);

    const events: EngineEvent[] = first.value ? [first.value] : [];
    for await (const event of stream) events.push(event);
    expect(states(events)).toContain('stopped');
  });

  it('creates a schedule directly from a meeting prompt', async () => {
    const createSchedule = jest.fn().mockResolvedValue({
      id: 'schedule-1',
      title: 'Meeting with Mr Sagiru',
      startsAt: new Date('2026-05-06T19:30:00.000Z'),
      endsAt: new Date('2026-05-06T20:00:00.000Z'),
      status: 'scheduled',
    });
    const service = new CoworkerRuntimeService(
      {
        findAll: jest.fn(),
        create: jest.fn(),
      } as never,
      { generate: jest.fn() } as never,
      {
        deploy: jest.fn(),
        findOne: jest.fn(),
        logs: jest.fn(),
      } as never,
      { create: createSchedule } as never,
    );

    const events = await collect(
      service.runSchedule({
        ...input,
        prompt: 'I have a meeting with Mr Sagiru today at 8:30pm',
      }),
    );
    expect(createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Meeting with Mr Sagiru',
        kind: 'meeting',
      }),
      input.ctx.actorUserId,
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'session.complete',
        stopReason: 'scheduled',
      }),
    );
  });
});

async function collect(stream: AsyncGenerator<EngineEvent, void, void>) {
  const events: EngineEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function states(events: EngineEvent[]) {
  return events
    .filter((event) => event.type === 'tool.result')
    .map((event) =>
      event.type === 'tool.result' &&
      typeof event.output === 'object' &&
      event.output !== null &&
      'state' in event.output
        ? (event.output as { state: string }).state
        : null,
    )
    .filter(Boolean);
}
