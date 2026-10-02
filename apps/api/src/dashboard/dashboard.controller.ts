import { Controller, Get, HttpCode, HttpStatus, Query, Version } from '@nestjs/common';
import {
  success,
  type ApiSuccessEnvelope,
  type DashboardPeriodPreset,
  type DashboardView,
} from '@hyssop/contracts';
import { DashboardQueryDto } from './dto/dashboard.dto';
import { DashboardService } from './dashboard.service';
import { currentBusinessDate, resolvePeriod } from './period.resolver';

/**
 * The dashboard route of `docs/06-API-SPEC.md`.
 *
 * Protected by the global `SessionGuard`: there is no `@Public()` here, so the whole financial
 * summary is unreachable without a session.
 *
 * The controller binds HTTP and nothing else. The period is resolved by the canonical resolver
 * rather than here, so the boundaries are decided in the calculation layer and this route cannot
 * grow its own opinion about what "this month" means.
 */
@Controller('dashboard')
export class DashboardController {
  public constructor(private readonly dashboard: DashboardService) {}

  /**
   * The whole dashboard in one projection.
   *
   * `?period=thisMonth` and `?from=2026-09-01&to=2026-09-30` are both accepted, and omitting
   * every filter resolves to `thisMonth` — so a shared URL always produces the same figures.
   */
  @Get()
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async readDashboard(
    @Query() query: DashboardQueryDto,
  ): Promise<ApiSuccessEnvelope<DashboardView>> {
    const period = resolvePeriod(
      {
        // `@IsIn(DASHBOARD_PERIOD_PRESETS)` has already rejected anything outside the list, so
        // this narrowing cannot hide an unsupported value: an unknown period never reaches here.
        ...(query.period === undefined ? {} : { preset: query.period as DashboardPeriodPreset }),
        // A custom range needs *both* bounds. Forwarding them as possibly-blank strings lets the
        // resolver report which bound is missing and name that field, instead of silently
        // defaulting the absent one and answering with a range the Admin never asked for.
        ...(query.from === undefined && query.to === undefined
          ? {}
          : { custom: { from: query.from ?? '', to: query.to ?? '' } }),
      },
      // `currentBusinessDate` reduces the request instant to the Asia/Kolkata calendar day first.
      // Passing the raw instant would resolve `thisMonth` from the *UTC* month, which for the
      // first five and a half hours of an IST month would answer with the previous month.
      currentBusinessDate(),
    );

    return success(await this.dashboard.dashboard(period));
  }
}
