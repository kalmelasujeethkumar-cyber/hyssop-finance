/**
 * Shared demo-settings contract for the Settings screen.
 *
 * Owned by `docs/06-API-SPEC.md` ("Settings") and shaped by `docs/01-REQUIREMENTS.md`
 * `REQ-SETTINGS-001` to `REQ-SETTINGS-009`, `docs/05-DATABASE-SPEC.md` (`app_setting`), and
 * `docs/03-UI-UX-RULES.md`. Both applications depend on this module so the browser cannot
 * disagree with the API about which setting is editable, which is fixed, or what a valid
 * payment-method set looks like.
 *
 * The requirements make this a *deliberately small* screen, and the contract exists mostly to
 * say so in one place rather than four:
 *
 * - **Two settings are editable, two are fixed.** `REQ-SETTINGS-006` and `REQ-SETTINGS-007` make
 *   the default monthly contribution and the enabled payment methods changeable;
 *   `REQ-SETTINGS-003` and `REQ-SETTINGS-004` fix the currency to `INR` and the business
 *   timezone to `Asia/Kolkata`. {@link DemoSettings} carries an {@link SettingsEditable} map
 *   saying which is which, so the screen renders a fixed value as *shown, not editable* instead
 *   of presenting a control that the API would refuse - a visible control that does nothing is
 *   the failure `AGENTS.md` names first.
 * - **Currency and amounts cross the boundary as exact decimal strings.** `defaultMonthlyContribution`
 *   is `"500.00"`, never a JSON number, for the same reason as every other amount in this
 *   application: `REQ-FIN-021` requires exact paise and a double cannot represent every paise
 *   value. The stored form is integer paise; the decimal string is produced at this boundary and
 *   nowhere else.
 * - **The minimum-methods rule is data, not a hardcoded `1` in the browser.** `REQ-SETTINGS-002`
 *   requires at least one payment method to stay enabled so income can always be recorded.
 *   {@link DemoSettings.minimumEnabledPaymentMethods} lets the API state the number, so the last
 *   remaining checkbox is disabled for the documented reason instead of being rejected on save.
 * - **Expense categories are managed on the Expense screen, not here.** `REQ-SETTINGS-002`
 *   requires a category-management entry point in Settings, and Phase 10 is explicitly allowed
 *   to present it without duplicating the Phase 06 lifecycle. {@link SettingsReferenceLink}
 *   carries the destination from the API rather than hardcoding a route in the browser, so the
 *   link cannot point at a screen that no longer exists.
 * - **There is no church-identity or reset control.** `REQ-SETTINGS-001` keeps the scope to the
 *   church name, logo, and address, none of which this demo stores, and `REQ-SETTINGS-008`
 *   forbids a database reset. Nothing in this module can express one.
 */

import { CURRENCY, type PaymentMethod } from './transactions';

/** The Asia/Kolkata accounting timezone, fixed by `REQ-SETTINGS-004`. */
export const SETTINGS_BUSINESS_TIMEZONE = 'Asia/Kolkata';

/** The fixed currency, `REQ-SETTINGS-003`. */
export const SETTINGS_CURRENCY = CURRENCY;

/**
 * The `app_setting` keys an Admin may change.
 *
 * These are the keys the API validates and writes, in the exact spelling
 * `docs/05-DATABASE-SPEC.md` uses for the `app_setting.key` column. `CURRENCY` and
 * `BUSINESS_TIMEZONE` are deliberately absent: they exist in the table as rows so the values are
 * stated once and enforced by a CHECK constraint, and they are not editable.
 */
export const SETTINGS_EDITABLE_KEYS = [
  'DEFAULT_MONTHLY_CONTRIBUTION_PAISE',
  'ENABLED_PAYMENT_METHODS',
] as const;

export type SettingsEditableKey = (typeof SETTINGS_EDITABLE_KEYS)[number];

/**
 * Which values the screen may offer a control for.
 *
 * Sent as data rather than inferred in the browser. `false` on `currency` and
 * `businessTimezone` is the requirement being made visible: `REQ-SETTINGS-003` and
 * `REQ-SETTINGS-004` are honest when the value is shown as fixed, and dishonest the moment it is
 * shown as a field that could be typed into.
 */
export interface SettingsEditable {
  readonly defaultMonthlyContribution: boolean;
  readonly enabledPaymentMethods: boolean;
  readonly currency: false;
  readonly businessTimezone: false;
}

/** A destination the API states rather than the browser hardcoding. */
export interface SettingsReferenceLink {
  readonly label: string;
  /** The application route, relative to the API base, e.g. `/expenses`. */
  readonly path: string;
  readonly note: string;
}

/** `GET /api/v1/settings` - the complete, honest settings state. */
export interface DemoSettings {
  /** Fixed by `REQ-SETTINGS-003`; always `INR`. */
  readonly currency: typeof SETTINGS_CURRENCY;
  /** Fixed by `REQ-SETTINGS-004`; always `Asia/Kolkata`. */
  readonly businessTimezone: typeof SETTINGS_BUSINESS_TIMEZONE;
  /** Exact decimal INR string, for example `"500.00"`. Stored as integer paise. */
  readonly defaultMonthlyContribution: string;
  /** A validated, deduplicated, non-empty subset in the documented order. */
  readonly enabledPaymentMethods: readonly PaymentMethod[];
  readonly editable: SettingsEditable;
  /** `REQ-SETTINGS-002`: the smallest permitted enabled-method count. Always `1`. */
  readonly minimumEnabledPaymentMethods: number;
  /** `REQ-SETTINGS-002`: where expense categories are managed. */
  readonly expenseCategoryManagement: SettingsReferenceLink;
}

/** `PATCH /api/v1/settings` - a partial update; an omitted field is left unchanged. */
export interface UpdateSettingsRequest {
  /**
   * The new default monthly expectation, as an exact decimal INR string.
   *
   * A string, never a number. `Number('500.10')` is a float, and `REQ-FIN-021` forbids the
   * difference between 50010 and 50010.000000000004 paise. Parsing is done by the shared strict
   * parser so an ambiguous value is rejected rather than rounded.
   */
  readonly defaultMonthlyContribution?: string;
  /** The complete set of methods to enable. One at minimum, per `REQ-SETTINGS-002`. */
  readonly enabledPaymentMethods?: readonly PaymentMethod[];
}

/**
 * `POST /api/v1/settings/contribution-default` - the same change, addressed by purpose.
 *
 * Kept because `docs/06-API-SPEC.md` specifies the route, and because a form that sets the
 * member expectation is a different intent from a general settings edit: it can carry its own
 * idempotency scope and its own audit wording. The field name is the same
 * `defaultMonthlyContribution`, so one concept has one name across both routes.
 */
export interface SetDefaultContributionRequest {
  readonly defaultMonthlyContribution: string;
}
