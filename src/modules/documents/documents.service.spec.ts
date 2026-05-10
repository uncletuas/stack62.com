import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentsService } from './documents.service';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { FilesService } from '../files/files.service';
import { OpenRouterService } from '../ai/openrouter.service';
import { OrganizationsService } from '../organizations/organizations.service';

describe('DocumentsService access control', () => {
  it('checks tenant access before rendering or registering generated files', async () => {
    const register = jest.fn();
    const assertResolvedAccess = jest
      .fn()
      .mockRejectedValue(new ForbiddenException('nope'));
    const filesService = {
      register,
    } as unknown as FilesService;
    const accessControlService = {
      assertResolvedAccess,
    } as unknown as AccessControlService;
    const repo = {
      create: jest.fn((value) => value),
      save: jest.fn((value) => value),
      findOne: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    const service = new DocumentsService(
      repo as never,
      repo as never,
      repo as never,
      {
        get: jest.fn((_key: string, fallback: string) => fallback),
      } as unknown as ConfigService,
      filesService,
      {} as OpenRouterService,
      {} as OrganizationsService,
      accessControlService,
      { log: jest.fn() } as never,
      { log: jest.fn() } as never,
      { create: jest.fn() } as never,
      { create: jest.fn() } as never,
      { index: jest.fn() } as never,
    );

    await expect(
      service.generate(
        {
          organizationId: '447d8d35-53ca-4aba-b1a2-385d699bfeee',
          workspaceId: '912943f5-1589-4635-8250-f6c62d0dd248',
          format: 'md',
          title: 'Sensitive document',
          blocks: [{ type: 'paragraph', text: 'secret' }],
        },
        'd5e8a8df-492c-4d95-a473-3adf57d6a4a0',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(assertResolvedAccess).toHaveBeenCalledWith(
      'd5e8a8df-492c-4d95-a473-3adf57d6a4a0',
      expect.objectContaining({
        resource: 'system',
        action: 'create',
        organizationId: '447d8d35-53ca-4aba-b1a2-385d699bfeee',
        workspaceId: '912943f5-1589-4635-8250-f6c62d0dd248',
      }),
    );
    expect(register).not.toHaveBeenCalled();
  });
});
