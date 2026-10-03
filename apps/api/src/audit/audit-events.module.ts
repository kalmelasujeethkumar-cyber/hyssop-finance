import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuditEventsController } from './audit-events.controller';
import { AuditEventsService } from './audit-events.service';

/**
 * Wires `GET /api/v1/audit-events`.
 *
 * `DatabaseModule` is imported rather than re-providing `AuditEventRepository`, exactly as
 * `ReportsModule` does. The repository is already owned and exported there, and it carries its own
 * dependency on `PrismaService`; re-providing it here would create a second instance with its own
 * lifecycle, which is the failure mode `docs/02-ARCHITECTURE.md` warns about.
 *
 * The global `SessionGuard` is not registered here. It is applied application-wide, so this route
 * cannot become reachable by forgetting a decorator on one method.
 *
 * There is no write route and no writer is provided, deliberately: the trail is append-only and
 * every event is written by the service that performed the change, inside that change's own
 * transaction. A writer reachable from an audit module would be a writer that could record
 * something that did not happen.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [AuditEventsController],
  providers: [AuditEventsService],
})
export class AuditEventsModule {}
