import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import {
  CATEGORY_STATUSES,
  EXPENSE_CATEGORY_NAME_MAX_LENGTH,
  PAYMENT_METHODS,
  TRANSACTION_DESCRIPTION_MAX_LENGTH,
  TRANSACTION_NOTES_MAX_LENGTH,
  type CategoryStatus,
  type PaymentMethod,
} from '@hyssop/contracts';
import {
  BUSINESS_DATE_VALIDATOR,
  MONEY_VALIDATOR,
  SharedTransactionFilterQueryDto,
} from '../../transactions/dto/transaction.dto';

const trimmed = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  );

/**
 * The UUID shape used by `categoryId` and the category `:id` route.
 *
 * The same pattern the transaction routes use, so one identifier cannot be accepted on one
 * route and rejected on another. The message names a category, because that is what the
 * Admin supplied on the route that rejects it.
 */
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const CATEGORY_UUID_MESSAGE = 'A category identifier must be a UUID.';

/**
 * `GET /api/v1/expenses`.
 *
 * The documented expense filters are the shared transaction filters, so this extends
 * `SharedTransactionFilterQueryDto` rather than restating a second vocabulary that could
 * drift from the ledger's.
 *
 * It deliberately adds no `type` and no `incomeType`. Those two keys exist only on
 * `GET /api/v1/transactions`, which is the one route that serves both sides of the ledger,
 * and the global pipe's `forbidNonWhitelisted` setting rejects them here with a field-level
 * 400 instead of quietly widening an expense list into an income list. The service
 * independently forces `type=EXPENSE`, so a caller that reaches the list another way still
 * cannot obtain income through this route.
 */
export class ExpenseListQueryDto extends SharedTransactionFilterQueryDto {}

/**
 * `POST /api/v1/expenses`.
 *
 * `REQ-EXP-004` requires exactly one existing active category, so `categoryId` is required
 * here and validated as a UUID. Whether that category is *active* is a data question rather
 * than a shape question, so it is answered by `requireActive` in the service: an inactive
 * category is a `400 VALIDATION_FAILED` naming the field, not a foreign-key failure the
 * Admin would read as a server fault.
 *
 * `amount` is a decimal INR string, never a JSON number, because `REQ-FIN-021` requires exact
 * paise arithmetic; the strict parser in the service turns it into `bigint` paise or refuses
 * it.
 *
 * `memberId` and `contributionPeriod` are absent by design: an expense belongs to the church,
 * not to a member, and the income-only member rules have no expense equivalent. Because the
 * global pipe rejects unknown body keys, a request that tries to attach a member to an
 * expense is refused at the transport boundary instead of being silently dropped.
 */
export class CreateExpenseDto {
  @trimmed()
  @IsString()
  @Matches(/^\d+(?:\.\d{1,2})?$/, MONEY_VALIDATOR)
  public amount!: string;

  @IsIn(PAYMENT_METHODS)
  public paymentMethod!: PaymentMethod;

  @trimmed()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, BUSINESS_DATE_VALIDATOR)
  public businessDate!: string;

  @trimmed()
  @IsString()
  @Matches(UUID_PATTERN, { message: CATEGORY_UUID_MESSAGE })
  public categoryId!: string;

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
}

/**
 * `POST /api/v1/expenses/categories`.
 *
 * `REQ-EXP-002`: a custom category is a plain name. `isSystem` is not accepted because the
 * initial set is a documented product set (`REQ-EXP-001`) that only the seed marks; an
 * Admin-created category is always custom, and accepting the flag would let a request claim
 * membership of the product set.
 */
export class CreateExpenseCategoryDto {
  @trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(EXPENSE_CATEGORY_NAME_MAX_LENGTH)
  public name!: string;
}

/**
 * `PATCH /api/v1/expenses/categories/:id`.
 *
 * `docs/05-DATABASE-SPEC.md` says a category is renamed or deactivated, never deleted, so the
 * only two changes are the name and the status. Both are optional and the service requires at
 * least one: a request that changes nothing would write an audit event with identical before
 * and after values, which makes the history misleading.
 *
 * `isSystem` is not accepted, for the same reason as on create.
 */
export class UpdateExpenseCategoryDto {
  @IsOptional()
  @trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(EXPENSE_CATEGORY_NAME_MAX_LENGTH)
  public name?: string;

  @IsOptional()
  @IsIn(CATEGORY_STATUSES)
  public status?: CategoryStatus;
}

/**
 * The `:id` path parameter of the category routes.
 *
 * A UUID is required, so a category *name* pasted into the URL is a malformed identifier
 * rather than a lookup that silently matched nothing.
 */
export class ExpenseCategoryIdParamDto {
  @IsString()
  @Matches(UUID_PATTERN, { message: CATEGORY_UUID_MESSAGE })
  public id!: string;
}
