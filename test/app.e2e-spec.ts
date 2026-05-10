import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { HealthModule } from './../src/modules/health/health.module';

interface HealthResponseBody {
  status: string;
  service: string;
}

describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect(({ body }) => {
        const typedBody = body as HealthResponseBody;
        expect(typedBody.status).toBe('ok');
        expect(typedBody.service).toBe('stack62-backend');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
