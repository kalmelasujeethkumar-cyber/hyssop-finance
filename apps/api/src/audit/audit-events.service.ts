import { Injectable } from '@nestjs/common';
import type { AuditAction } from '@prisma/client';
import {
  AUDIT_REPORT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  isAuditEntityType,
  isAuditReportAction,
  list,
  TRANSACTION_PAGE_SIZE_DEFAULT,
  auditActionLabel,
  auditEntityTypeLabel,
  type AuditEventRow,
  type AuditHistoryFilters,
  type AuditHistoryResponse,
} from '@hyssop/contracts';
import { validationFailed } from '../common/errors/domain.errors';
import {
  endOfBusinessDay,
  parseBusinessDate,
  startOfBusinessDay,
} from '../common/time/business-date';
import {
  AuditEventRepository,
  type AuditHistoryFilter,
} from '../database/audit/audit-event.repository';
import { flattenSnapshot, isRecordedSnapshot } from './audit-detail';
import { assertRangeIsOrdered } from './dto/audit-events.dto';

/**
 * The Admin-wide audit history behind `GET /api/v1/audit-events`.
 *
 * Authority: `docs/06-API-SPEC.md` "Audit History - paginated, filterable audit history",
 * `docs/01-REQUIREMENTS.md` `REQ-AUDIT-001` and `REQ-AUDIT-002`, and `docs/07-SECURITY-RULES.md`.
 *
 * **This is a read over the trail that already exists, not a second audit system.** Phase 02
 * recorded every event into the append-only `audit_event` table and Phase 09 exposed the same
 * projection as the Audit report, and both reads go through
 * {@link AuditEventRepository.listHistory}. What is added here is only what a *screen* needs and
 * a report does not: a filter by entity type, plain-language labels, and a snapshot flattened
 * into safe display fields. There is no second writer, no second table, and no write path of any
 * kind in this service - the trail stays append-only and the runtime role still has no
 * `UPDATE` or `DELETE` grant on it.
 *
 * Three decisions are worth stating because they are the ones a reader could otherwise get
 * wrong:
 *
 * - **The date bounds are business days, not instants.** `from` and `to` are Asia/Kolkata
 *   `YYYY-MM-DD` dates, converted here to the first and last instant of that business day. A
 *   filter of "today" therefore includes an event recorded at 09:15, which a naive `>= 00:00Z`
 *   comparison would have dropped.
 * - **Filters are validated here as well as in the DTO.** The transport validates the shape; this
 *   validates the vocabulary, because a filter value the database cannot hold must be a
 *   `VALIDATION_FAILED` naming the accepted values rather than an empty page that reads as
 *   "nothing was recorded".
 * - **Labels are decided here.** `actionLabel` and `entityLabel` come from the shared tables so
 *   the screen renders text and cannot invent it; the raw code is still returned for support.
 */
@Injectable()
export class AuditEventsService {
  public constructor(private readonly audit: AuditEventRepository) {}

  public async list(request: AuditHistoryRequest): Promise<AuditHistoryResponse> {
    assertRangeIsOrdered(request.from, request.to);

    const filter = toHistoryFilter(request);
    const page = {
      page: request.page ?? 1,
      // An absent `pageSize` is the documented default, validated at the transport edge. No
      // clamping happens here: the DTO already rejected anything outside the shared bounds, so
      // a second, differently-bounded clamp would only create a second answer for one value.
      pageSize: request.pageSize ?? TRANSACTION_PAGE_SIZE_DEFAULT,
    };

    const [records, totalItems] = await Promise.all([
      this.audit.listHistory(filter, {
        limit: page.pageSize,
        offset: (page.page - 1) * page.pageSize,
      }),
      this.audit.countHistory(filter),
    ]);

    const rows: AuditEventRow[] = records.map((record) => ({
      id: record.id,
      action: record.action,
      actionLabel: auditActionLabel(record.action),
      entityType: record.entityType,
      entityLabel: auditEntityTypeLabel(record.entityType),
      entityReference: record.entityReference,
      actorDisplayName: record.actorDisplayName,
      occurredAt: record.occurredAt.toISOString(),
      reason: record.reason,
      requestId: record.requestId,
      before: flattenSnapshot(record.before),
      after: flattenSnapshot(record.after),
      beforeRecorded: isRecordedSnapshot(record.before),
      afterRecorded: isRecordedSnapshot(record.after),
    }));

    const filters: AuditHistoryFilters = {
      action: request.action ?? null,
      entityType: request.entityType ?? null,
      from: request.from ?? null,
      to: request.to ?? null,
    };

    return { filters, rows, pagination: list([], { ...page, totalItems }).pagination };
  }
}

/** The validated filters `GET /api/v1/audit-events` accepts. */
export interface AuditHistoryRequest {
  readonly action?: string;
  readonly entityType?: string;
  /** Inclusive Asia/Kolkata business date, `YYYY-MM-DD`. */
  readonly from?: string;
  /** Inclusive Asia/Kolkata business date, `YYYY-MM-DD`. */
  readonly to?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

/**
 * Narrows the transport filter into the repository filter.
 *
 * Every guard throws rather than cast silently, so an unvalidated caller - a test, or a future
 * route - gets the documented error instead of an empty result it would report as "no history".
 *
 * Only the date parsing is wrapped, and each boundary names its own field. An earlier version
 * wrapped the whole projection in one `catch` that always reported a bad business date, so an
 * unknown `entityType` or `action` was answered with a date message that named the wrong field -
 * the caller could not tell which filter the server had refused. The vocabulary guards keep their
 * own "Choose one of" message, and a genuine date fault still names `from` or `to`.
 */
function toHistoryFilter(request: AuditHistoryRequest): AuditHistoryFilter {
  return {
    ...(request.action === undefined ? {} : { action: requireAction(request.action) }),
    ...(request.entityType === undefined
      ? {}
      : { entityType: requireEntityType(request.entityType) }),
    ...(request.from === undefined ? {} : { from: parseBoundary(request.from, 'from') }),
    ...(request.to === undefined ? {} : { to: parseBoundary(request.to, 'to') }),
  };
}

/** Parses one inclusive Asia/Kolkata business-date boundary, naming the field on failure. */
function parseBoundary(value: string, field: 'from' | 'to'): Date {
  try {
    return field === 'from'
      ? startOfBusinessDay(parseBusinessDate(value))
      : endOfBusinessDay(parseBusinessDate(value));
  } catch {
    throw validationFailed('Choose a valid business date in YYYY-MM-DD format.', { field });
  }
}

/**
 * Narrows a validated action string to the generated `AuditAction` enum.
 *
 * The guard exists because `AUDIT_REPORT_ACTIONS` is a list of strings while the repository wants
 * the generated enum. Both describe the same fifteen values, so the narrowed type is already
 * assignable and no assertion is needed - which is the point: if the two ever drifted apart, this
 * would stop compiling rather than quietly querying for a value the column cannot hold.
 */
function requireAction(value: string): AuditAction {
  if (!isAuditReportAction(value)) {
    throw validationFailed(`Choose one of: ${AUDIT_REPORT_ACTIONS.join(', ')}.`, {
      field: 'action',
    });
  }

  return value;
}

function requireEntityType(value: string): string {
  if (!isAuditEntityType(value)) {
    throw validationFailed(`Choose one of: ${AUDIT_ENTITY_TYPES.join(', ')}.`, {
      field: 'entityType',
    });
  }

  return value;
}
