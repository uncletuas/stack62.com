import { EngineRuntimeService } from './engine-runtime.service';
import { tool } from './tools/types';

describe('EngineRuntimeService', () => {
  const ctx = {
    organizationId: '447d8d35-53ca-4aba-b1a2-385d699bfeee',
    workspaceId: '912943f5-1589-4635-8250-f6c62d0dd248',
    actorUserId: 'd5e8a8df-492c-4d95-a473-3adf57d6a4a0',
  };

  function makeService() {
    const saved: Record<string, unknown>[] = [];
    const repository = {
      create: jest.fn((value) => ({ id: `log-${saved.length + 1}`, ...value })),
      save: jest.fn(async (value) => {
        saved.push(value);
        return value;
      }),
    };
    const accessControl = {
      assertResolvedAccess: jest.fn().mockResolvedValue(undefined),
    };
    const activity = { log: jest.fn().mockResolvedValue(undefined) };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new EngineRuntimeService(
      repository as never,
      accessControl as never,
      activity as never,
      audit as never,
    );
    return { service, repository, accessControl, activity, audit };
  }

  it('blocks level 3 tools until confirmation is present', async () => {
    const { service, accessControl, activity, audit } = makeService();
    const handler = jest.fn();
    const createTask = tool(
      'tasks.create',
      'Create task',
      { properties: { title: { type: 'string' } }, required: ['title'] },
      handler,
      { actionLevel: 3, requiresConfirmation: true },
    );

    const result = await service.execute({
      tool: createTask,
      input: { title: 'Follow up' },
      ctx,
    });

    expect(handler).not.toHaveBeenCalled();
    expect(accessControl.assertResolvedAccess).toHaveBeenCalledWith(
      ctx.actorUserId,
      expect.objectContaining({
        resource: 'task',
        action: 'create',
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
      }),
    );
    expect(result.output).toMatchObject({
      confirmationRequired: true,
      tool: 'tasks.create',
      confirmationToken: 'confirmed',
    });
    expect(activity.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tool.blocked' }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tool.tasks.create.blocked' }),
    );
  });

  it('executes confirmed tools and writes a succeeded trace', async () => {
    const { service, accessControl, activity, audit } = makeService();
    const handler = jest
      .fn()
      .mockResolvedValue({ output: { id: 'task-1' }, summary: 'Created.' });
    const createTask = tool(
      'tasks.create',
      'Create task',
      { properties: { title: { type: 'string' } }, required: ['title'] },
      handler,
      { actionLevel: 3, requiresConfirmation: true },
    );

    const result = await service.execute({
      tool: createTask,
      input: { title: 'Follow up', confirmationToken: 'confirmed' },
      ctx,
    });

    expect(handler).toHaveBeenCalledWith(
      { title: 'Follow up', confirmationToken: 'confirmed' },
      ctx,
    );
    expect(result.output).toEqual({ id: 'task-1' });
    expect(accessControl.assertResolvedAccess).toHaveBeenCalled();
    expect(activity.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tool.succeeded' }),
    );
    expect(audit.log).not.toHaveBeenCalled();
  });
});
