import { Controller, Get, HttpCode, HttpStatus, Query, Version } from '@nestjs/common';
import { success, type AuditHistoryResponse } from '@hyssop/contracts';
import { AuditEventsService } from './audit-events.service';
import { AuditEventsQueryDto } from './dto/audit-events.dto';

/**
 * The Admin-wide audit history route of `docs/06-API-SPEC.md` "Audit History".
 *
 * Protected by the global `SessionGuard`: there is no `@Public()` here, so the trail cannot be
 * reached without a session. That is not a formality here. `audit_event` records who signed in,
 * which sign-ins were refused, and what was voided with a reason - the contents of that table are
 * an internal security record, and `docs/07-SECURITY-RULES.md` requires attribution to stay
 * inside the authenticated application.
 *
 * The controller binds HTTP and nothing else. Filtering, ordering, paging, the flattening of a
 * stored snapshot, and the decision about which fields are safe to show all belong to the
 * service, so a second route could not answer the same question differently.
 *
 * There is no `POST`, `PUT`, `PATCH`, or `DELETE` route here, and none may be added. The trail is
 * append-only: `docs/05-DATABASE-SPEC.md` gives the runtime role no `UPDATE` or `DELETE` grant on
 * `audit_event` and installs the `audit_event_append_only` trigger, so an edit route would not
 * merely be wrong, it would fail at the database.
 */
@Controller('audit-events')
export class AuditEventsController {
  public constructor(private readonly auditEvents: AuditEventsService) {}

  @Get()
  @Version('1')
  @HttpCode(HttpStatus.OK)
  public async list(@Query() query: AuditEventsQueryDto): Promise<{ data: AuditHistoryResponse }> {
    return success(await this.auditEvents.list(query));
  }
}
