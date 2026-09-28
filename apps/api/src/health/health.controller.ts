import { Controller, Get, HttpCode, HttpStatus, Version } from '@nestjs/common';
import { success } from '@hyssop/contracts';
import { Public } from '../auth/auth.decorators';
import { HealthService } from './health.service';

/**
 * The one public non-authentication route.
 *
 * Authority: `docs/06-API-SPEC.md` — `GET /api/v1/health` "requires no session" and
 * `docs/07-SECURITY-RULES.md` — health "must not disclose secrets or internal detail".
 * `@Public()` is explicit rather than implied, so the exemption is visible in review.
 */
@Controller('health')
export class HealthController {
  public constructor(private readonly health: HealthService) {}

  @Get()
  @Version('1')
  @Public()
  @HttpCode(HttpStatus.OK)
  public getHealth() {
    return success(this.health.getReport());
  }
}
