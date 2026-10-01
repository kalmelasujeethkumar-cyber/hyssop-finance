import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  BUSINESS_DATE_FORMAT_MESSAGE,
  BUSINESS_DATE_PATTERN,
  INCOME_TYPES,
  MAX_BUSINESS_YEAR,
  MONEY_FORMAT_MESSAGE,
  MONEY_PATTERN,
  MIN_BUSINESS_YEAR,
  PAYMENT_METHODS,
  TRANSACTION_DESCRIPTION_MAX_LENGTH,
  TRANSACTION_NOTES_MAX_LENGTH,
  TRANSACTION_PAGE_SIZE_MAX,
  TRANSACTION_REFERENCE_PATTERN,
  TRANSACTION_SORT_FIELDS,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
  VOID_REASON_MAX_LENGTH,
  type IncomeType,
  type PaymentMethod,
  type TransactionSortDirection,
  type TransactionSortField,
  type TransactionStatus,
  type TransactionType,
} from '@hyssop/contracts';

/**
 * Query and body DTOs shared by the income, expense, and transaction routes.
 *
 * Authority: `docs/06-API-SPEC.md` ("filters are validated and cannot inject arbitrary query
 * structure") and `docs/07-SECURITY-RULES.md` ("validate all input on the server"). The
 * global `ValidationPipe` runs with `whitelist` and `forbidNonWhitelisted`, so an unknown
 * query key or body property is rejected rather than dropped, which is what closes the
 * mass-assignment path onto `financial_transaction`.
 */

/**
 * Trims surrounding whitespace.
 *
 * Casing is left alone deliberately: a search and a reference must preserve what the Admin
 * typed, and a reference is compared case-insensitively by the database anyway.
 */
const trimmed = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  );

/** The documented exact INR amount shape, checked before the strict paise parser runs. */
export const MONEY_VALIDATOR = { message: MONEY_FORMAT_MESSAGE };

/** The documented `YYYY-MM-DD` business-date shape. */
export const BUSINESS_DATE_VALIDATOR = { message: BUSINESS_DATE_FORMAT_MESSAGE };

/**
 * The UUID shape used by every `:id` path parameter and by the `memberId`/`categoryId`
 * filters.
 *
 * Shared with `docs/05-DATABASE-SPEC.md`'s `uuid` columns and matched the same way the
 * member routes already do, so the same identifier cannot be accepted on one route and
 * rejected on another.
 */
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const UUID_MESSAGE = 'A transaction identifier must be a UUID.';

/**
 * The `:id` path parameter of every transaction route.
 *
 * A UUID is required, so a human reference such as `HY-INC-000001` is rejected as a
 * malformed identifier with a 400 instead of being reported as a missing transaction, which
 * would tell the Admin their record does not exist. The reference is what the Admin reads
 * and searches; the UUID is what addresses the record.
 */
export class TransactionIdParamDto {
  @IsString()
  @Matches(UUID_PATTERN, { message: UUID_MESSAGE })
  public id!: string;
}

/**
 * The transaction list filters that mean the same thing on both sides of the ledger.
 *
 * Every key is optional and every value is drawn from a closed set or a bounded shape, so the
 * resulting `where` clause is composed from known columns only. `reference` is validated
 * against the documented format rather than accepted as free text, so it can only ever be an
 * exact match.
 *
 * The type filters are *not* here. `type` and `incomeType` are income/ledger-side concepts
 * that only `GET /api/v1/transactions` accepts, so they live on
 * `TransactionListQueryDto` below. Keeping them out of the base class is what makes
 * `ExpenseListQueryDto` structurally incapable of being widened into an income query, rather
 * than relying on the service to ignore a filter it happens to understand.
 */
export class SharedTransactionFilterQueryDto {
  @IsOptional()
  @trimmed()
  @IsString()
  @MaxLength(100)
  public search?: string;

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

  @IsOptional()
  @IsIn(TRANSACTION_SORT_FIELDS)
  public sort?: TransactionSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  public direction?: TransactionSortDirection;

  @IsOptional()
  @IsIn(TRANSACTION_STATUSES)
  public status?: TransactionStatus;

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  public paymentMethod?: PaymentMethod;

  @IsOptional()
  @trimmed()
  @IsString()
  @Matches(BUSINESS_DATE_PATTERN, BUSINESS_DATE_VALIDATOR)
  public from?: string;

  @IsOptional()
  @trimmed()
  @IsString()
  @Matches(BUSINESS_DATE_PATTERN, BUSINESS_DATE_VALIDATOR)
  public to?: string;

  @IsOptional()
  @trimmed()
  @IsString()
  @Matches(MONEY_PATTERN, MONEY_VALIDATOR)
  public minAmount?: string;

  @IsOptional()
  @trimmed()
  @IsString()
  @Matches(MONEY_PATTERN, MONEY_VALIDATOR)
  public maxAmount?: string;

  @IsOptional()
  @trimmed()
  @IsString()
  @Matches(UUID_PATTERN, { message: 'A member filter must be a UUID.' })
  public memberId?: string;

  @IsOptional()
  @trimmed()
  @IsString()
  @Matches(UUID_PATTERN, { message: 'A category filter must be a UUID.' })
  public categoryId?: string;

  /**
   * An exact transaction reference.
   *
   * Validated against the documented `HY-INC-`/`HY-EXP-` shape rather than treated as free
   * text, so the filter is an equality match on the unique `reference_id` column and cannot
   * be widened into a scan.
   */
  @IsOptional()
  @trimmed()
  @IsString()
  @Matches(TRANSACTION_REFERENCE_PATTERN, {
    message: 'A transaction reference looks like HY-INC-000001 or HY-EXP-000001.',
  })
  public reference?: string;
}

/**
 * `GET /api/v1/transactions` — the shared filters plus the two type selectors.
 *
 * This is the only query that may ask for both sides of the ledger, because it is the only
 * route that serves both. `docs/06-API-SPEC.md` describes the side selector as `type`, which
 * is mapped to the internal `transactionType` rather than reused as the field name, because
 * `type` is ambiguous in a query that also accepts `incomeType` and a document `type`, and
 * the storage column is already unambiguous.
 */
export class TransactionListQueryDto extends SharedTransactionFilterQueryDto {
  @IsOptional()
  @IsIn(TRANSACTION_TYPES)
  public type?: TransactionType;

  @IsOptional()
  @IsIn(INCOME_TYPES)
  public incomeType?: IncomeType;
}

/**
 * The `PATCH /transactions/:id` body.
 *
 * `docs/06-API-SPEC.md` allows editing only the amount, payment method, business date,
 * description, notes, and the type-specific associations the transaction type permits.
 * Identity, reference, transaction type, creator, creation timestamp, status, and void
 * fields are not in this DTO at all, and the global pipe's `forbidNonWhitelisted` setting
 * rejects them with a field-level 400 instead of silently ignoring an attempt to change
 * them.
 *
 * `amount` is optional so a correction can move only the business date. The service still
 * rejects a request that changes nothing, because a no-op edit would write an audit event
 * with identical before and after values and make the history misleading.
 */
export class CorrectTransactionDto {
  @IsOptional()
  @trimmed()
  @IsString()
  @Matches(MONEY_PATTERN, MONEY_VALIDATOR)
  public amount?: string;

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  public paymentMethod?: PaymentMethod;

  @IsOptional()
  @trimmed()
  @IsString()
  @Matches(BUSINESS_DATE_PATTERN, BUSINESS_DATE_VALIDATOR)
  public businessDate?: string;

  @IsOptional()
  @trimmed()
  @IsString()
  @MaxLength(TRANSACTION_DESCRIPTION_MAX_LENGTH)
  public description?: string;

  @IsOptional()
  @trimmed()
  @IsString()
  @MaxLength(TRANSACTION_NOTES_MAX_LENGTH)
  public notes?: string;

  /**
   * The member association for a correction.
   *
   * `string | null` is meaningful: `null` detaches the member, which is how an Offering or
   * Donation recorded against a member is made anonymous again. The service rejects it for a
   * Member Contribution, which cannot exist without one, and for an anonymous donation,
   * which must never carry one (`REQ-INCOME-005`).
   */
  @IsOptional()
  @IsString()
  @Matches(UUID_PATTERN, { message: 'A member identifier must be a UUID.' })
  public memberId?: string | null;

  /**
   * The expense category for a correction.
   *
   * Permitted only on an expense, which is the one association its transaction type allows
   * to change; the service rejects it on income, because `financial_transaction` forbids a
   * category on an income row. `null` is rejected too, because `REQ-EXP-004` requires an
   * expense to reference exactly one category, so a correction cannot strip it.
   */
  @IsOptional()
  @IsString()
  @Matches(UUID_PATTERN, { message: 'A category identifier must be a UUID.' })
  public categoryId?: string | null;
}

/** The `POST /transactions/:id/void` body. `REQ-FIN-017` requires a non-empty reason. */
export class VoidTransactionDto {
  @trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(VOID_REASON_MAX_LENGTH)
  public reason!: string;
}

/** The year and month pair used by the contribution-period fields of an income request. */
export class ContributionPeriodRefDto {
  @Type(() => Number)
  @IsInt()
  @Min(MIN_BUSINESS_YEAR)
  @Max(MAX_BUSINESS_YEAR)
  public year!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  public month!: number;
}
