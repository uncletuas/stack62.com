import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  getHealth() {
    return {
      status: 'ok',
      service: 'stack62-backend',
      timestamp: new Date().toISOString(),
      architecture: 'modular-monolith',
      platform: {
        multiTenant: true,
        aiGoverned: true,
        runtimeMode: 'configuration-driven',
      },
    };
  }
}
