import { BadRequestException } from '@nestjs/common';
import { RecordsService } from './records.service';

describe('RecordsService product collections', () => {
  const actorUserId = 'd5e8a8df-492c-4d95-a473-3adf57d6a4a0';
  const organizationId = '447d8d35-53ca-4aba-b1a2-385d699bfeee';
  const workspaceId = '912943f5-1589-4635-8250-f6c62d0dd248';

  function repo<
    T extends { id?: string } = Record<string, unknown> & { id?: string },
  >(seed: T[] = []) {
    const rows = [...seed];
    return {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        const row = { id: value.id ?? `id-${rows.length + 1}`, ...value };
        rows.push(row);
        return row;
      }),
      findOne: jest.fn(
        async ({ where }: { where: Partial<T> }) =>
          rows.find((row) =>
            Object.entries(where).every(
              ([key, value]) => row[key as keyof T] === value,
            ),
          ) ?? null,
      ),
      find: jest.fn(async ({ where }: { where?: Partial<T> } = {}) =>
        where
          ? rows.filter((row) =>
              Object.entries(where).every(
                ([key, value]) => row[key as keyof T] === value,
              ),
            )
          : rows,
      ),
      count: jest.fn(async ({ where }: { where?: Partial<T> } = {}) =>
        where
          ? rows.filter((row) =>
              Object.entries(where).every(
                ([key, value]) => row[key as keyof T] === value,
              ),
            ).length
          : rows.length,
      ),
      createQueryBuilder: jest.fn(),
      rows,
    };
  }

  function makeService() {
    const runtimeRecords = repo();
    const collections = repo();
    const fields = repo();
    const items = repo();
    const entities = repo();
    const systemFields = repo();
    const access = {
      assertResolvedAccess: jest.fn().mockResolvedValue(undefined),
      applyTenantScopeToQueryBuilder: jest.fn().mockResolvedValue(undefined),
    };
    const activity = { log: jest.fn().mockResolvedValue(undefined) };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new RecordsService(
      runtimeRecords as never,
      collections as never,
      fields as never,
      items as never,
      entities as never,
      systemFields as never,
      access as never,
      activity as never,
      audit as never,
    );
    return { service, collections, fields, items, access, activity, audit };
  }

  it('creates a collection with fields and records activity', async () => {
    const { service, fields, access, activity } = makeService();

    const created = await service.createCollection(
      {
        organizationId,
        workspaceId,
        name: 'Customers',
        fields: [
          { name: 'Name', dataType: 'text', required: true },
          { name: 'Email', dataType: 'email' },
        ],
      },
      actorUserId,
    );

    expect(created).toMatchObject({ name: 'Customers', key: 'customers' });
    expect(fields.save).toHaveBeenCalledTimes(2);
    expect(access.assertResolvedAccess).toHaveBeenCalledWith(
      actorUserId,
      expect.objectContaining({ resource: 'record', action: 'create' }),
    );
    expect(activity.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'record_collection.create' }),
    );
  });

  it('validates required fields before creating an item', async () => {
    const { service, collections, fields } = makeService();
    collections.rows.push({
      id: 'collection-1',
      organizationId,
      workspaceId,
      systemId: null,
      name: 'Customers',
    });
    fields.rows.push({
      id: 'field-1',
      collectionId: 'collection-1',
      name: 'Name',
      key: 'name',
      dataType: 'text',
      required: true,
      position: 0,
    });

    await expect(
      service.createCollectionItem(
        'collection-1',
        { data: { email: 'ada@example.com' } },
        actorUserId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
