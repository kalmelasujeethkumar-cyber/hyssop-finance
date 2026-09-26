import { Test } from '@nestjs/testing';
import { HEALTH_SERVICE_NAME } from '@hyssop/contracts';
import { ApplicationMetadata } from './application-metadata';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('reports the running process without configuration or environment detail', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [HealthService, { provide: ApplicationMetadata, useValue: metadataStub() }],
    }).compile();

    const report = moduleRef.get(HealthService).getReport();

    expect(report.status).toBe('ok');
    expect(report.service).toBe(HEALTH_SERVICE_NAME);
    expect(report.version).toBe('1.2.3');
    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(report.timestamp))).toBe(false);
    expect(Object.keys(report).sort()).toEqual([
      'service',
      'status',
      'timestamp',
      'uptimeSeconds',
      'version',
    ]);
  });
});

function metadataStub() {
  return { version: '1.2.3', uptimeSeconds: () => 12.4 };
}
