import * as fs from 'node:fs';
import * as path from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandTools } from './command.tools';

describe('CommandTools', () => {
  const sandboxRoot = path.resolve('generated/systems/command-tool-spec');
  let tools: ReturnType<CommandTools['build']>;

  beforeAll(() => {
    fs.mkdirSync(sandboxRoot, { recursive: true });
    const config = {
      get: jest.fn((key: string, fallback?: string) =>
        key === 'GENERATED_SYSTEMS_ROOT'
          ? path.resolve('generated/systems')
          : fallback,
      ),
    } as unknown as ConfigService;
    tools = new CommandTools(config).build();
  });

  it('allows safe commands inside the generated systems sandbox', async () => {
    const service = new CommandTools({
      get: jest.fn((key: string, fallback?: string) =>
        key === 'GENERATED_SYSTEMS_ROOT'
          ? path.resolve('generated/systems')
          : fallback,
      ),
    } as unknown as ConfigService);
    expect(
      service.validateSandboxCommand(sandboxRoot, 'node --version'),
    ).toMatchObject({
      cwd: sandboxRoot,
      command: 'node --version',
    });
  });

  it('denies commands outside the generated systems sandbox', async () => {
    const run = tools.find((tool) => tool.name === 'commands.run_sandboxed');
    await expect(
      run?.handler(
        { cwd: process.cwd(), command: 'node --version' },
        {
          organizationId: 'org',
          workspaceId: 'workspace',
          actorUserId: 'user',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('denies destructive commands', async () => {
    const run = tools.find((tool) => tool.name === 'commands.run_sandboxed');
    await expect(
      run?.handler(
        { cwd: sandboxRoot, command: 'rm -rf .' },
        {
          organizationId: 'org',
          workspaceId: 'workspace',
          actorUserId: 'user',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
