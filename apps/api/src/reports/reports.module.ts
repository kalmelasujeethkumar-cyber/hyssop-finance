import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ReportsController, SearchController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * Wires the report and global-search routes of `docs/06-API-SPEC.md`.
 *
 * `DatabaseModule` is imported rather than re-providing the repositories, exactly as
 * `DashboardModule` does. Every repository this module's projections need is already owned and
 * exported there, and several of them carry their own dependencies — `TransactionRepository` needs
 * `ReferenceAllocatorService`, for example. Re-providing them here would both fail to resolve those
 * dependencies and create a second instance of each repository with its own lifecycle, which is the
 * failure mode `docs/02-ARCHITECTURE.md` warns about: a second instance could disagree with the
 * ledger the reports exist to summarise.
 *
 * Importing the one data boundary instead of listing repositories keeps that widening visible. A
 * future report needing a new table is a deliberate edit here, rather than a provider list that
 * every feature quietly extends.
 *
 * The global `SessionGuard` is not registered here. It is applied application-wide, so no report
 * route can become reachable by forgetting a decorator on one method.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [ReportsController, SearchController],
  providers: [ReportsService],
})
export class ReportsModule {}
