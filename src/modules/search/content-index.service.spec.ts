import { ContentIndexService } from './content-index.service';

describe('ContentIndexService', () => {
  function makeRepo() {
    const rows: Record<string, unknown>[] = [];
    return {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        const values = Array.isArray(value) ? value : [value];
        const saved = values.map((item) => ({
          id: `chunk-${rows.length + 1}`,
          updatedAt: new Date(),
          ...item,
        }));
        rows.push(...saved);
        return Array.isArray(value) ? saved : saved[0];
      }),
      delete: jest.fn(async (where) => {
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (
            rows[i].sourceType === where.sourceType &&
            rows[i].sourceId === where.sourceId
          ) {
            rows.splice(i, 1);
          }
        }
      }),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn(async () => rows),
      })),
      rows,
    };
  }

  it('indexes content into searchable chunks', async () => {
    const repo = makeRepo();
    const service = new ContentIndexService(repo as never);

    await service.index({
      organizationId: '447d8d35-53ca-4aba-b1a2-385d699bfeee',
      workspaceId: '912943f5-1589-4635-8250-f6c62d0dd248',
      sourceType: 'document',
      sourceId: '2b2e132d-31a7-4c86-a7a7-31b15ef8ce44',
      sourceTitle: 'Onboarding SOP',
      text: 'Sales reps should complete CRM training before calling customers.',
    });

    const results = await service.search({
      organizationId: '447d8d35-53ca-4aba-b1a2-385d699bfeee',
      workspaceId: '912943f5-1589-4635-8250-f6c62d0dd248',
      query: 'CRM training',
    });

    expect(repo.delete).toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      sourceType: 'document',
      sourceTitle: 'Onboarding SOP',
    });
  });
});
