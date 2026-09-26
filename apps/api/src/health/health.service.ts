import { Injectable } from '@nestjs/common';
import { HEALTH_SERVICE_NAME, type HealthReport } from '@hyssop/contracts';
import { ApplicationMetadata } from './application-metadata';

@Injectable()
export class HealthService {
  public constructor(private readonly metadata: ApplicationMetadata) {}

  public getReport(): HealthReport {
    return {
      status: 'ok',
      service: HEALTH_SERVICE_NAME,
      version: this.metadata.version,
      uptimeSeconds: Math.floor(this.metadata.uptimeSeconds()),
      timestamp: new Date().toISOString(),
    };
  }
}
