import { Controller, Get, HttpCode, HttpStatus, Version } from '@nestjs/common';
import { success } from '@hyssop/contracts';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  public constructor(private readonly health: HealthService) {}

  @Get()
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public getHealth() {
    return success(this.health.getReport());
  }
}
