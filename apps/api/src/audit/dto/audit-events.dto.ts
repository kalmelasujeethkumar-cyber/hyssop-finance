import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import {
  AUDIT_ENTITY_TYPES,
  AUDIT_REPORT_ACTIONS,
  BUSINESS_DATE_FORMAT_MESSAGE,
  BUSINESS_DATE_PATTERN,
  TRANSACTION_PAGE_SIZE_MAX,
} from '@hyssop/contracts';
import { validationFailed } from '../../common/errors/domain.errors';

/**
 * Trims surrounding whitespace from a filter value.
 *
 * The same helper shape as `DashboardQueryDto` and `report.dto.ts`. A pasted filter with a stray
 * space is a typo, not an attempt to filter differently, and an untrimmed `action` would fail
 * `IsIn` with a message that does not explain what is wrong.
 */
const trimmed = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  );

/**
 * `GET /api/v1/audit-events` query.
 *
 * Every filter is validated rather than coerced, for the reason the rest of this API's filters
 * are: an unvalidated value that matches nothing returns an empty list, which the Admin reads as
 * "nothing happened" rather than as "that is not a real filter". So an unknown action, an unknown
 * entity type, and a malformed date are each a `VALIDATION_FAILED` naming the accepted values.
 *
 * The date bounds are `YYYY-MM-DD` Asia/Kolkata business dates rather than ISO instants, because
 * this is a screen filter typed by a person and every Admin-entered date in this application is a
 * business date. The service converts them to the inclusive instants bounding that business day,
 * so the morning of the first day is included. The Phase 09 Audit *report* takes ISO instants;
 * that is a report bound rather than a screen filter, and it is unchanged.
 */
export class AuditEventsQueryDto {
  /** Exact `action` match, for example `TRANSACTION_VOIDED`. */
  @IsOptional()
  @IsString()
  @trimmed()
  @IsIn(AUDIT_REPORT_ACTIONS, { message: `Choose one of: ${AUDIT_REPORT_ACTIONS.join(', ')}.` })
  public action?: string;

  /** Exact `entity_type` match, for example `member`. */
  @IsOptional()
  @IsString()
  @trimmed()
  @IsIn(AUDIT_ENTITY_TYPES, { message: `Choose one of: ${AUDIT_ENTITY_TYPES.join(', ')}.` })
  public entityType?: string;

  /** Inclusive lower bound, as an Asia/Kolkata business date. */
  @IsOptional()
  @IsString()
  @trimmed()
  @Matches(BUSINESS_DATE_PATTERN, { message: BUSINESS_DATE_FORMAT_MESSAGE })
  public from?: string;

  /** Inclusive upper bound, as an Asia/Kolkata business date. */
  @IsOptional()
  @IsString()
  @trimmed()
  @Matches(BUSINESS_DATE_PATTERN, { message: BUSINESS_DATE_FORMAT_MESSAGE })
  public to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public page?: number;

  /**
   * Bounded by the shared transaction bounds rather than a set of audit-specific ones, so the
   * audit list and every other list in the application page identically.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TRANSACTION_PAGE_SIZE_MAX)
  public pageSize?: number;
}

/**
 * Rejects a range that ends before it begins.
 *
 * Checked here rather than being allowed to return an empty page: an inverted range is a mistake
 * in the form, and an empty audit list in response looks like a claim that nothing was ever
 * recorded. The message names both bounds so the Admin can see which end is wrong.
 */
export function assertRangeIsOrdered(from: string | undefined, to: string | undefined): void {
  if (from !== undefined && to !== undefined && from > to) {
    throw validationFailed('The start date must not be after the end date.', {
      field: 'from',
      from,
      to,
    });
  }
}
