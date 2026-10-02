import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import {
  AUDIT_REPORT_ACTIONS,
  BUSINESS_DATE_FORMAT_MESSAGE,
  BUSINESS_DATE_PATTERN,
  DASHBOARD_PERIOD_PRESETS,
  REPORT_IDS,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_TYPES,
  TRANSACTION_PAGE_SIZE_MAX,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
} from '@hyssop/contracts';

/**
 * Trims surrounding whitespace from a query value.
 *
 * Mirrors `DashboardQueryDto`'s helper. A hand-copied `?period=%20thisMonth%20` is a typo, not an
 * attempt to filter differently, so the blanks are removed before validation.
 */
const trimmed = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  );

/**
 * The shared period query for the period-bounded reports.
 *
 * Authority: `docs/06-API-SPEC.md` "Dashboard and reports": a report accepts either `period` or an
 * explicit `from`/`to` pair, and boundaries are inclusive and defined once by the canonical
 * resolver.
 *
 * This mirrors `DashboardQueryDto` field for field on purpose. The *semantics* of a period are
 * decided only by `resolvePeriod`, so both DTO classes are shape validators over the same shared
 * preset list and date pattern — duplicating the fields does not duplicate the rule, whereas
 * reusing a class literally named for the dashboard on a report route would be a lie about what
 * it owns.
 *
 * `period` and `from`/`to` are individually optional and their combination is enforced by the
 * resolver, which reports the conflict as a documented `VALIDATION_FAILED` naming the field.
 */
export class ReportQueryDto {
  /** One of the documented named periods. Constrained here so an unknown value is a 400. */
  @IsOptional()
  @IsString()
  @trimmed()
  @IsIn(DASHBOARD_PERIOD_PRESETS, {
    message: `Choose one of: ${DASHBOARD_PERIOD_PRESETS.join(', ')}.`,
  })
  public period?: string;

  /** First business date of a custom range, `YYYY-MM-DD`. Shape-checked only. */
  @IsOptional()
  @IsString()
  @trimmed()
  @Matches(BUSINESS_DATE_PATTERN, { message: BUSINESS_DATE_FORMAT_MESSAGE })
  public from?: string;

  /** Last business date of a custom range, inclusive. Shape-checked only. */
  @IsOptional()
  @IsString()
  @trimmed()
  @Matches(BUSINESS_DATE_PATTERN, { message: BUSINESS_DATE_FORMAT_MESSAGE })
  public to?: string;
}

/**
 * `GET /api/v1/reports/transactions` — the Complete Transaction report.
 *
 * Adds the documented `type` and `status` filters on top of the period. Each is constrained to a
 * closed list so an unknown value is rejected with a field-level message rather than becoming a
 * silently-empty report.
 */
export class TransactionReportQueryDto extends ReportQueryDto {
  @IsOptional()
  @IsString()
  @trimmed()
  @IsIn(TRANSACTION_TYPES, { message: `Choose one of: ${TRANSACTION_TYPES.join(', ')}.` })
  public type?: string;

  /** Retaining history means `VOIDED` is a legal filter here, unlike the active reports. */
  @IsOptional()
  @IsString()
  @trimmed()
  @IsIn(TRANSACTION_STATUSES, { message: `Choose one of: ${TRANSACTION_STATUSES.join(', ')}.` })
  public status?: string;

  /**
   * This report lists rows rather than only summing them, so it is paginated.
   *
   * The page size is capped at `TRANSACTION_PAGE_SIZE_MAX`, the same ceiling the transaction list
   * already enforces, so the Admin is never offered one huge page of history to scroll past.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TRANSACTION_PAGE_SIZE_MAX)
  public pageSize?: number;
}

/**
 * `GET /api/v1/reports/audit` — the Audit report.
 *
 * This report is history, so its window is an explicit `from`/`to` rather than a period preset:
 * an audit event happened at an instant, not within a business month.
 *
 * `occurred_at` is a `TIMESTAMPTZ`, so the bounds are full ISO instants rather than `YYYY-MM-DD`
 * dates. That is a deliberate difference from the period reports and is why this DTO does not
 * reuse `ReportQueryDto`.
 */
export class AuditReportQueryDto {
  /** Inclusive `occurred_at` lower bound, as an ISO instant. */
  @IsOptional()
  @IsString()
  @trimmed()
  public from?: string;

  /** Inclusive `occurred_at` upper bound, as an ISO instant. */
  @IsOptional()
  @IsString()
  @trimmed()
  public to?: string;

  /** Exact audit action. Constrained to the database's `AuditAction` enum. */
  @IsOptional()
  @IsString()
  @trimmed()
  @IsIn(AUDIT_REPORT_ACTIONS, { message: `Choose one of: ${AUDIT_REPORT_ACTIONS.join(', ')}.` })
  public action?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TRANSACTION_PAGE_SIZE_MAX)
  public pageSize?: number;
}

/** The `:reportId` path parameter of `GET /api/v1/reports/:reportId/export.csv`. */
export class ReportIdParamDto {
  /** Constrained to the eleven documented reports so an unknown id is a 400, not a filename. */
  @IsString()
  @trimmed()
  @IsIn(REPORT_IDS, { message: `Choose one of: ${REPORT_IDS.join(', ')}.` })
  public reportId!: string;
}

/**
 * `GET /api/v1/search` — global search.
 *
 * `q` is bounded in length, which is the `REQ-SEARCH-002` "bounded results / safe query" rule at
 * the transport edge; the repository then matches only names, IDs, references, categories, and
 * types.
 */
export class SearchQueryDto {
  @IsString()
  @trimmed()
  @MaxLength(SEARCH_QUERY_MAX_LENGTH, {
    message: `Enter at most ${SEARCH_QUERY_MAX_LENGTH} characters to search.`,
  })
  public q!: string;

  /** `all`, `member`, or `transaction`. Defaults to `all` in the service. */
  @IsOptional()
  @IsString()
  @trimmed()
  @IsIn(SEARCH_TYPES, { message: `Choose one of: ${SEARCH_TYPES.join(', ')}.` })
  public type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TRANSACTION_PAGE_SIZE_MAX)
  public pageSize?: number;
}
