import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Wires the settings routes of `docs/06-API-SPEC.md`.
 *
 * `DatabaseModule` is imported rather than re-providing `AppSettingRepository`, exactly as
 * `ReportsModule` and `AuditEventsModule` do: the repository is already owned and exported there
 * and carries its own dependency on `PrismaService` and `AuditEventRepository`, so a second
 * instance here would be a second settings boundary with its own lifecycle.
 *
 * `IdempotentCommandRunner` also comes from there, by the reasoning recorded on
 * `DatabaseModule`: it is a shared command-replay utility backed by `IdempotencyRecordRepository`,
 * and a module that accepts a mutation needs it without importing an unrelated domain module.
 * `docs/06-API-SPEC.md` requires the key on every mutation, and this is the module that writes
 * two of them.
 *
 * The global `SessionGuard` is not registered here; it is applied application-wide, so no settings
 * route can become reachable by forgetting a decorator on one method.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
