import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { MONEY_FORMAT_MESSAGE, PAYMENT_METHODS, type PaymentMethod } from '@hyssop/contracts';
import { MONEY_VALIDATOR } from '../../transactions/dto/transaction.dto';

const trimmed = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  );

/**
 * The money pattern, shared with the transaction bodies.
 *
 * A decimal INR string such as `"500.00"`, never a JSON number. `REQ-FIN-021` requires exact paise
 * and `Number('500.10')` cannot represent it, so the string is parsed by the shared strict parser
 * in the service and never converted to a `number` anywhere in the request.
 */
const MONEY_PATTERN = /^\d+(?:\.\d{1,2})?$/;

/**
 * `PATCH /api/v1/settings` body.
 *
 * Every field is optional and a partial body is valid: `docs/06-API-SPEC.md` defines the route as
 * an update of the supplied settings, so a form that changes only the enabled methods must not have
 * to resend the contribution amount and risk overwriting it with a stale value. The service
 * refuses a body that supplies nothing at all, because a settings form that saved without changing
 * anything would report success for a request that was never checked.
 *
 * `enabledPaymentMethods` is validated as a list of documented methods with at least one entry and
 * no duplicates. The non-empty rule is `REQ-SETTINGS-002` - income must always be recordable - and
 * it is enforced here as well as in the repository's `app_setting` CHECK constraint, so the failure
 * arrives as a `VALIDATION_FAILED` naming the field instead of a constraint violation the Admin
 * cannot act on.
 */
export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @trimmed()
  @Matches(MONEY_PATTERN, MONEY_VALIDATOR)
  public defaultMonthlyContribution?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty({ message: 'Keep at least one payment method enabled.' })
  @ArrayUnique({ message: 'List each payment method only once.' })
  @IsIn(PAYMENT_METHODS, { each: true, message: `Choose from: ${PAYMENT_METHODS.join(', ')}.` })
  public enabledPaymentMethods?: PaymentMethod[];
}

/**
 * `POST /api/v1/settings/contribution-default` body.
 *
 * One field, required. `docs/06-API-SPEC.md` gives this route its own address because setting the
 * member expectation is a distinct intent from a general settings edit, and the two are audited
 * with the same `SETTING_UPDATED` action but reached by different screens. The field name is the
 * same as the `PATCH` field, so one concept has one name in the whole API.
 */
export class SetDefaultContributionDto {
  @IsString()
  @trimmed()
  @Matches(MONEY_PATTERN, { message: MONEY_FORMAT_MESSAGE })
  public defaultMonthlyContribution!: string;
}
