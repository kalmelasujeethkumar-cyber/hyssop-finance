import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * The dashboard read model.
 *
 * Authority: `docs/02-ARCHITECTURE.md` — a screen's figures come from the canonical
 * server-side calculation layer, so this module is a projection over `DatabaseModule`'s
 * aggregates rather than a place where queries are built.
 *
 * `DatabaseModule` is imported rather than having its repositories injected individually,
 * because every repository this service needs is already owned and exported there. Re-providing
 * any of them would create a second instance with its own lifecycle, and the dashboard would
 * then be able to disagree with the ledger it exists to summarise.
 *
 * `DashboardService` is exported so a later reports module can reuse the same projection instead
 * of recomputing the period movement and the ending balances a second way.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
