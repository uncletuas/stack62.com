import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const actorUserId = 'd5e8a8df-492c-4d95-a473-3adf57d6a4a0';
  const organizationId = '447d8d35-53ca-4aba-b1a2-385d699bfeee';
  const workspaceId = '912943f5-1589-4635-8250-f6c62d0dd248';

  function makeRepo(seed: Array<Record<string, unknown>> = []) {
    const rows = [...seed];
    return {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        const row = { id: value.id ?? `report-${rows.length + 1}`, ...value };
        rows.push(row);
        return row;
      }),
      findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((row) =>
          Object.entries(where).every(([key, value]) => row[key] === value),
        ) ?? null,
      ),
      find: jest.fn(async () => rows),
      createQueryBuilder: jest.fn(),
      rows,
    };
  }

  it('can save a report as a document', async () => {
    const reports = makeRepo([
      {
        id: 'report-1',
        organizationId,
        workspaceId,
        systemId: null,
        title: 'Weekly Ops',
        summary: 'All good.',
        sourceType: 'tasks',
        data: { counts: { tasks: 3, openTasks: 1, completedTasks: 2 } },
        metadata: null,
      },
    ]);
    const access = { assertResolvedAccess: jest.fn().mockResolvedValue(undefined), applyTenantScopeToQueryBuilder: jest.fn() };
    const documents = {
      create: jest.fn().mockResolvedValue({ id: 'document-1' }),
    };
    const service = new ReportsService(
      reports as never,
      makeRepo() as never,
      makeRepo() as never,
      makeRepo() as never,
      access as never,
      { log: jest.fn() } as never,
      { log: jest.fn() } as never,
      documents as never,
    );

    const document = await service.saveAsDocument('report-1', actorUserId);

    expect(document).toEqual({ id: 'document-1' });
    expect(documents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        workspaceId,
        title: 'Weekly Ops',
        format: 'markdown',
        metadata: expect.objectContaining({ sourceReportId: 'report-1' }),
      }),
      actorUserId,
    );
  });
});
