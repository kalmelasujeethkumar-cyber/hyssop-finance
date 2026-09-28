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
  CONTRIBUTION_STATUSES,
  MEMBER_PAGE_SIZE_MAX,
  MEMBER_SEARCH_MAX_LENGTH,
  MEMBER_SORT_FIELDS,
  type ContributionStatus,
  type MemberSortDirection,
  type MemberSortField,
} from '@hyssop/contracts';

/**
 * Query and body DTOs for the member routes.
 *
 * Authority: `docs/06-API-SPEC.md` ("Filters are validated and cannot inject arbitrary
 * query structure") and `docs/07-SECURITY-RULES.md` ("Validate all input on the
 * server"). The global `ValidationPipe` runs with `whitelist` and
 * `forbidNonWhitelisted`, so an unknown query key or body property is rejected rather
 * than silently dropped, which is what prevents a mass-assignment attempt.
 *
 * The list DTO also gives sorting a *stable* shape: `sort` is restricted to a closed set
 * of columns and `direction` to two values, so a caller cannot order by an unindexed or
 * sensitive column, and cannot inject a nested Prisma order.
 */

/**
 * Trims surrounding whitespace. Casing is deliberately left alone, because a search must
 * preserve what the Admin typed.
 */
const trimmed = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  );

export class MemberListQueryDto {
  @IsOptional()
  @trimmed()
  @IsString()
  @MaxLength(MEMBER_SEARCH_MAX_LENGTH)
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
  @Max(MEMBER_PAGE_SIZE_MAX)
  public pageSize?: number;

  @IsOptional()
  @IsIn(MEMBER_SORT_FIELDS)
  public sort?: MemberSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  public direction?: MemberSortDirection;
}

export class CreateMemberDto {
  @trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  public name!: string;

  @IsOptional()
  @trimmed()
  @IsString()
  @MaxLength(32)
  public phone?: string;

  @IsOptional()
  @trimmed()
  @IsString()
  @MaxLength(2000)
  public notes?: string;
}

/**
 * The `PATCH /members/:id` body.
 *
 * `docs/06-API-SPEC.md` requires the update to carry the current member `revision` so a
 * stale revision returns a conflict. The revision travels in `If-Match` rather than the
 * body so it cannot be confused with a field being edited, and the body therefore holds
 * only the three editable fields.
 *
 * `name` is required on a patch even though PATCH is nominally partial: a member must
 * always have a name, so omitting it would leave the record ambiguous. The UI always
 * submits the full editable set, which is honest about what the endpoint does.
 */
export class UpdateMemberDto {
  @trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  public name!: string;

  @IsOptional()
  @trimmed()
  @IsString()
  @MaxLength(32)
  public phone?: string;

  @IsOptional()
  @trimmed()
  @IsString()
  @MaxLength(2000)
  public notes?: string;
}

/**
 * The UUID shape used by every `:id` path parameter and the `memberId` filter.
 *
 * Shared so the path parameter and the filter cannot drift apart: one of them accepting a
 * reference string while the other rejects it would make the same identifier valid on one
 * route and invalid on another, which is exactly the inconsistency this constant removes.
 */
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const UUID_MESSAGE = 'A member identifier must be a UUID.';

/** Path parameter. A UUID shape is enforced so a reference like `HY-MEM-0001` is rejected. */
export class MemberIdParamDto {
  @IsString()
  @Matches(UUID_PATTERN, { message: UUID_MESSAGE })
  public id!: string;
}

export class MemberContributionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1970)
  @Max(9999)
  public year?: number;
}

/**
 * The `PUT /contribution-periods/:memberId/:year/:month` path.
 *
 * Bound as one DTO rather than three loose `@Param` strings so the same rules apply as on
 * every other member route: a reference like `HY-MEM-0001` is rejected as a malformed
 * identifier with a 400, instead of reaching persistence and being reported as a missing
 * member, which would tell the Admin their member does not exist. The year and month are
 * validated here for the same reason the `readIntegerPathParam` helper existed: one place
 * decides what a valid year and month are.
 */
export class ContributionPeriodPathDto {
  @IsString()
  @Matches(UUID_PATTERN, { message: UUID_MESSAGE })
  public memberId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1970)
  @Max(9999)
  public year!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  public month!: number;
}

export class ContributionPeriodFilterDto {
  /**
   * The same UUID shape as the `:id` path parameter.
   *
   * Enforced here too so a filter cannot be a silent no-op: an unvalidated `memberId`
   * would match nothing and return an empty list, which reads to the Admin as "this member
   * has no periods" rather than as "that is not a member identifier".
   */
  @IsOptional()
  @IsString()
  @Matches(UUID_PATTERN, { message: UUID_MESSAGE })
  public memberId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1970)
  @Max(9999)
  public year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  public month?: number;

  @IsOptional()
  @IsIn(CONTRIBUTION_STATUSES)
  public status?: ContributionStatus;
}

export class SetContributionPeriodDto {
  /**
   * The expected amount as a decimal INR string such as `"500.00"`.
   *
   * A string, never a number: `REQ-FIN-021` and `docs/05-DATABASE-SPEC.md` require exact
   * paise arithmetic, and JSON numbers cannot represent every paise value. Parsing is
   * done by the shared strict parser so an ambiguous value is rejected rather than
   * rounded.
   *
   * Optional, because `docs/phases/PHASE-04-MEMBERS.md` requires the initialized
   * `DEFAULT_MONTHLY_CONTRIBUTION_PAISE` setting to be used when a new period is opened.
   * Omitting it is accepted only for a period that does not exist yet; the service rejects
   * it for an existing one so a retry cannot silently reset the expected amount.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d+(?:\.\d{1,2})?$/, {
    message: 'The expected amount must be a positive amount with at most two decimal places.',
  })
  public expectedPaise?: string;
}
