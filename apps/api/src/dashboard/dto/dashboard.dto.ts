import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import {
  BUSINESS_DATE_FORMAT_MESSAGE,
  BUSINESS_DATE_PATTERN,
  DASHBOARD_PERIOD_PRESETS,
} from '@hyssop/contracts';

/**
 * Trims surrounding whitespace from a query value.
 *
 * A hand-copied `?period=%20thisMonth%20` is a typo, not an attempt to filter differently, so
 * the surrounding blanks are removed before validation rather than reported as an unknown
 * period.
 */
const trimmed = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  );

/**
 * `GET /api/v1/dashboard` query.
 *
 * Authority: `docs/06-API-SPEC.md` "Dashboard and reports" — the route accepts either
 * `period` or an explicit `from`/`to` pair, and `docs/07-SECURITY-RULES.md` requires every
 * input to be validated before it reaches a query.
 *
 * Both fields are optional here and the *combination* is enforced by the period resolver rather
 * than by a decorator on this class. `class-validator` cannot express "exactly one of these two",
 * and a rule spread across the DTO and the resolver is the kind that quietly allows
 * `?period=thisMonth&from=…&to=…` to pick whichever it saw last. The resolver makes the
 * conflict an explicit, documented validation error instead.
 *
 * `period` is constrained to the preset list here so an unknown value is rejected with a
 * field-level 400 naming the accepted choices, rather than reaching the resolver as a free
 * string.
 */
export class DashboardQueryDto {
  /**
   * One of the seven documented named periods.
   *
   * Not defaulted to `thisMonth` at this level, so an absent `period` and an absent
   * `from`/`to` reach the resolver as one unambiguous case and are resolved in one place.
   */
  @IsOptional()
  @IsString()
  @trimmed()
  @IsIn(DASHBOARD_PERIOD_PRESETS, {
    message: `Choose one of: ${DASHBOARD_PERIOD_PRESETS.join(', ')}.`,
  })
  public period?: string;

  /**
   * The first business date of a custom range.
   *
   * Shape-checked only. Whether the date exists (`2026-02-30`) and whether it precedes `to`
   * are resolved by the period resolver, because both answers depend on the other bound.
   */
  @IsOptional()
  @IsString()
  @trimmed()
  @Matches(BUSINESS_DATE_PATTERN, { message: BUSINESS_DATE_FORMAT_MESSAGE })
  public from?: string;

  /** The last business date of a custom range, inclusive. Shape-checked only. */
  @IsOptional()
  @IsString()
  @trimmed()
  @Matches(BUSINESS_DATE_PATTERN, { message: BUSINESS_DATE_FORMAT_MESSAGE })
  public to?: string;
}
