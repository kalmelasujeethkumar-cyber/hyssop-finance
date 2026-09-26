import { Module } from '@nestjs/common';
import { ApplicationMetadata } from './application-metadata';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [ApplicationMetadata, HealthService],
})
export class HealthModule {}
