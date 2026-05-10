import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [HealthService],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('returns platform health metadata', () => {
    const result = controller.getHealth();

    expect(result.status).toBe('ok');
    expect(result.platform.multiTenant).toBe(true);
    expect(result.platform.aiGoverned).toBe(true);
  });
});
