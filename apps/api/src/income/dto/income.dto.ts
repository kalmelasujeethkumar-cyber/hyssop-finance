import { Transform, Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import {
  INCOME_TYPES,
  PAYMENT_METHODS,
  TRANSACTION_DESCRIPTION_MAX_LENGTH,
  TRANSACTION_NOTES_MAX_LENGTH,
  type IncomeType,
  type PaymentMethod,
} from '@hyssop/contracts';
import {
  BUSINESS_DATE_VALIDATOR,
  ContributionPeriodRefDto,
  MONEY_VALIDATOR,
} from '../../transactions/dto/transaction.dto';

const trimmed = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  );

/**
 * The `POST /api/v1/income` body, matching the documented example contract.
 *
 * `amount` is a decimal INR string, never a JSON number, because `REQ-FIN-021` requires exact
 * paise arithmetic. `memberId` and `contributionPeriod` are optional *at the transport layer*
 * and required or forbidden by the service according to the income type: `Member Contribution`
 * needs both, `Offering` and `Donation` may take a member and must not take a period, and
 * `Anonymous Donation` must take neither.
 *
 * The service is the enforcement point rather than a conditional DTO, because the rule depends
 * on `incomeType` and a class-validator conditional cannot express "required only when another
 * field equals X" without duplicating the vocabulary. Encoding it once in the service keeps
 * `REQ-INCOME-003` and `REQ-INCOME-005` in a single readable place, and the browser mirrors it
 * with the shared contract helpers.
 */
export class CreateIncomeDto {
  @IsIn(INCOME_TYPES)
  public incomeType!: IncomeType;

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

  /**
   * The contributing member.
   *
   * Accepted for the three named income types and refused for an anonymous donation. The
   * refusal happens in the service so the error names the actual problem rather than reporting
   * an unexpected field.
   */
  @IsOptional()
  @IsString()
  public memberId?: string;

  /** The member-month, required only for a `Member Contribution`. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ContributionPeriodRefDto)
  public contributionPeriod?: ContributionPeriodRefDto;

  /**
   * The free-text description.
   *
   * Optional for the named income types, and *ignored in favour of the server-owned neutral
   * value* for an anonymous donation. It is accepted in the body so a form can post the same
   * shape for every income type, and the service replaces it rather than storing it, which is
   * what `REQ-INCOME-006` requires.
   */
  @IsOptional()
  @trimmed()
  @IsString()
  @MaxLength(TRANSACTION_DESCRIPTION_MAX_LENGTH)
  public description?: string;

  /**
   * The private note.
   *
   * Refused for an anonymous donation rather than silently dropped: an Admin who believes a
   * note was saved must be told it was not, because a note is the most natural place to type
   * a donor's name and `REQ-INCOME-005` forbids that from being stored.
   */
  @IsOptional()
  @trimmed()
  @IsString()
  @MaxLength(TRANSACTION_NOTES_MAX_LENGTH)
  public notes?: string;
}
