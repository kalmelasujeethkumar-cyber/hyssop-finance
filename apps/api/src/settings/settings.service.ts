import { Injectable } from '@nestjs/common';
import { Prisma, type AppSetting } from '@prisma/client';
import {
  PAYMENT_METHODS,
  SETTINGS_BUSINESS_TIMEZONE,
  SETTINGS_CURRENCY,
  isPaymentMethod,
  type DemoSettings,
  type PaymentMethod,
} from '@hyssop/contracts';
import { validationFailed } from '../common/errors/domain.errors';
import { parsePositivePaise } from '../common/money/paise';
import { IdempotentCommandRunner, type IdempotencyKey } from '../common/http/idempotency';
import { AppSettingRepository } from '../database/settings/app-setting.repository';
import { formatPaiseSetting } from '../database/settings/app-setting.validation';
import type { SetDefaultContributionDto, UpdateSettingsDto } from './dto/settings.dto';

const UPDATE_ENDPOINT = 'PATCH /api/v1/settings';
const CONTRIBUTION_DEFAULT_ENDPOINT = 'POST /api/v1/settings/contribution-default';

/**
 * Who performed a settings change.
 *
 * The same two facts the transactions and documents domains record: the acting admin and the
 * correlation id of the request. Declared per domain rather than shared, so a settings audit event
 * carries its attribution from the controller to the repository without the settings module
 * depending on the transactions module for a two-field type.
 */
export interface SettingsActor {
  readonly adminUserId: string;
  readonly requestId: string | null;
}

/**
 * The settings behind `GET`, `PATCH /api/v1/settings`, and
 * `POST /api/v1/settings/contribution-default`.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-SETTINGS-001` to `REQ-SETTINGS-009`,
 * `docs/06-API-SPEC.md` "Settings", `docs/05-DATABASE-SPEC.md` (`app_setting`), and
 * `docs/07-SECURITY-RULES.md`.
 *
 * The persistence and the invariants are **not** reimplemented here. `AppSettingRepository`
 * already validates every value against the same rules the `app_setting` CHECK constraints
 * enforce, and already writes the `SETTING_UPDATED` audit event inside the same transaction as the
 * write. This service decides only three things the repository cannot: which settings the Admin
 * may change, what the whole settings state looks like for a screen, and how a multi-setting
 * change is made idempotent as one command.
 *
 * The rules that matter most, and where each one is enforced:
 *
 * - **Only two settings are editable.** `REQ-SETTINGS-006` and `REQ-SETTINGS-007` name the
 *   default monthly contribution and the enabled payment methods. `REQ-SETTINGS-003` and
 *   `REQ-SETTINGS-004` fix the currency and the business timezone, and this service has no code
 *   path that could write them: the request body has no fields for them, and the repository's
 *   validator refuses any other key.
 * - **At least one payment method stays enabled.** `REQ-SETTINGS-002` requires income to remain
 *   recordable. The request DTO rejects an empty list, the repository rejects an empty stored
 *   value, and the database CHECK constraint rejects it as well, so the invariant cannot be
 *   reached by any of the three layers failing.
 * - **Disabling a payment method changes nothing already recorded.** The setting decides which
 *   methods a *new* entry may use; it is not applied retroactively. Nothing here touches
 *   `financial_transaction`, `income`, or `payment_method_balance`, so a balance recorded through
 *   `UPI` before it was disabled keeps its `UPI` figures, which is what
 *   `docs/05-DATABASE-SPEC.md` requires of historical rows.
 * - **No reset, no church identity.** `REQ-SETTINGS-008` forbids a database reset and
 *   `REQ-SETTINGS-001` keeps church identity out of scope; there is no route, body field, or
 *   service method that could perform either.
 */
@Injectable()
export class SettingsService {
  public constructor(
    private readonly settings: AppSettingRepository,
    private readonly idempotency: IdempotentCommandRunner,
  ) {}

  /**
   * The complete settings state.
   *
   * Reads all four rows rather than only the editable ones, because the screen has to *show* the
   * fixed currency and timezone as fixed values. Hiding them would make `REQ-SETTINGS-003` and
   * `REQ-SETTINGS-004` invisible instead of visibly honoured.
   */
  public async read(): Promise<DemoSettings> {
    return toDemoSettings(await this.settings.findAll());
  }

  /**
   * Applies a partial settings update, at most once per idempotency key.
   *
   * `docs/06-API-SPEC.md` requires an idempotency key on every mutation. For a settings change it
   * matters less than for a contribution and matters just as much in principle: the retry has to
   * report the state that was actually stored, not apply the change a second time and report that.
   * The stored response is therefore the settings state read *inside* the same transaction as the
   * writes, so the two can never disagree.
   */
  public async update(
    input: UpdateSettingsDto,
    actor: SettingsActor,
    idempotency: IdempotencyKey,
  ): Promise<DemoSettings> {
    const entries = toSettingEntries(input);

    if (entries.length === 0) {
      throw validationFailed('Change the contribution amount, the payment methods, or both.', {
        field: 'defaultMonthlyContribution',
      });
    }

    const result = await this.idempotency.run<DemoSettings>({
      adminUserId: actor.adminUserId,
      endpoint: UPDATE_ENDPOINT,
      idempotencyKey: idempotency.key,
      // Only what was actually supplied, so a retry of the same form hashes identically and a
      // genuinely different request is caught as key reuse.
      request: entries,
      run: async (tx) => {
        await this.settings.updateManyWithin(tx, entries, actor.adminUserId, actor.requestId);

        return { status: 200, body: await readWithin(this.settings, tx) };
      },
    });

    return result.body;
  }

  /**
   * Sets the default monthly member expectation, at most once per idempotency key.
   *
   * A separate route because it is a separate intent with a separate audit scope, as
   * `docs/06-API-SPEC.md` specifies. It goes through the same validator, the same transactional
   * write, and the same `SETTING_UPDATED` event as the general update - one rule for the setting,
   * two ways to reach it.
   *
   * The new default applies to contribution periods opened *after* the change.
   * `docs/05-DATABASE-SPEC.md` stores each period's expectation on the period itself, so a member
   * already expecting `500.00` still expects `500.00`; the stored amount is the period's own
   * record, and overwriting it here would silently rewrite what the Admin agreed with a member.
   */
  public async setDefaultContribution(
    input: SetDefaultContributionDto,
    actor: SettingsActor,
    idempotency: IdempotencyKey,
  ): Promise<DemoSettings> {
    // The stored setting is an integer paise count, so the money string is converted here rather
    // than handed to the repository as typed. Passing the decimal through would be refused by
    // `parsePaiseSetting` as a non-paise value, which would make this documented route unable to
    // succeed at all. The conversion is the same one `toSettingEntries` performs, so both routes
    // store the identical representation of the identical amount.
    const paise = toStoredContributionPaise(input.defaultMonthlyContribution);

    const result = await this.idempotency.run<DemoSettings>({
      adminUserId: actor.adminUserId,
      endpoint: CONTRIBUTION_DEFAULT_ENDPOINT,
      idempotencyKey: idempotency.key,
      // The stored paise string, not the text the browser sent, so the hash identifies the
      // command that was applied. A retry of the same intent therefore replays even if the
      // browser reformatted the amount (`"650"` after `"650.00"`), while a genuinely different
      // amount is still caught as key reuse.
      request: { defaultMonthlyContribution: paise },
      run: async (tx) => {
        await this.settings.updateManyWithin(
          tx,
          [{ key: 'DEFAULT_MONTHLY_CONTRIBUTION_PAISE', value: paise }],
          actor.adminUserId,
          actor.requestId,
        );

        return { status: 200, body: await readWithin(this.settings, tx) };
      },
    });

    return result.body;
  }
}

/**
 * Converts the money string the Admin typed into the integer paise string the column stores.
 *
 * `docs/05-DATABASE-SPEC.md` stores `DEFAULT_MONTHLY_CONTRIBUTION_PAISE` as a positive integer
 * count of paise and `docs/06-API-SPEC.md` transports money as a decimal string, so the two
 * representations have to meet exactly once. That is here, and both routes call it: the value that
 * is validated, the value that is stored, and the value the idempotency hash is taken over are all
 * derived from this single paise count, so they cannot disagree. `REQ-FIN-021` requires exact paise,
 * and `parsePositivePaise` parses the decimal text without ever converting it to a `number`.
 *
 * A zero, negative, or malformed amount is refused as a `VALIDATION_FAILED` naming the request
 * field, because that is what the Admin sent wrong; the alternative - letting the repository reject
 * it against the *storage* key - would report a database detail instead of the form field.
 */
function toStoredContributionPaise(amount: string): string {
  try {
    return String(parsePositivePaise(amount));
  } catch {
    throw validationFailed('The contribution amount must be greater than zero.', {
      field: 'defaultMonthlyContribution',
    });
  }
}

/**
 * Turns a request body into the stored key/value pairs.
 *
 * The money string is parsed to paise here, once, and only so an unparseable amount is refused
 * before anything is written; the value handed to the repository is re-formatted from that paise
 * count as the integer string the `app_setting` column stores. So the value that is validated, the
 * value that is stored, and the value that is displayed are all derived from the same paise count
 * and cannot disagree - `REQ-FIN-021` requires exact paise and this is where exactness is kept.
 */
function toSettingEntries(input: UpdateSettingsDto): readonly { key: string; value: string }[] {
  const entries: { key: string; value: string }[] = [];

  if (input.defaultMonthlyContribution !== undefined) {
    entries.push({
      key: 'DEFAULT_MONTHLY_CONTRIBUTION_PAISE',
      value: toStoredContributionPaise(input.defaultMonthlyContribution),
    });
  }

  if (input.enabledPaymentMethods !== undefined) {
    entries.push({
      key: 'ENABLED_PAYMENT_METHODS',
      value: toStoredMethodList(input.enabledPaymentMethods),
    });
  }

  return entries;
}

/**
 * Validates the requested methods and renders them in the documented order.
 *
 * Sorted into `PAYMENT_METHODS` order rather than stored in the order the browser sent, so
 * `["UPI","CASH"]` and `["CASH","UPI"]` are the same setting and the audit history cannot show a
 * change that did not happen. An empty or duplicated list is refused with the documented rule.
 */
function toStoredMethodList(methods: readonly PaymentMethod[]): string {
  const requested = [...new Set(methods)];

  if (requested.length === 0) {
    throw validationFailed('Keep at least one payment method enabled.', {
      field: 'enabledPaymentMethods',
    });
  }

  if (requested.some((method) => !isPaymentMethod(method))) {
    throw validationFailed(`Choose from: ${PAYMENT_METHODS.join(', ')}.`, {
      field: 'enabledPaymentMethods',
    });
  }

  return PAYMENT_METHODS.filter((method) => requested.includes(method)).join(',');
}

/**
 * Reads the settings state inside the caller's write transaction.
 *
 * `AppSettingRepository` owns the query, so the read goes through it rather than reaching for
 * `PrismaService` from the service layer. Reading inside the transaction is what makes the
 * returned state the one that was actually committed; reading afterwards would be a second round
 * trip that could observe a concurrent change and report settings the Admin never chose.
 */
async function readWithin(
  settings: AppSettingRepository,
  tx: Prisma.TransactionClient,
): Promise<DemoSettings> {
  return toDemoSettings(await settings.findAllWithin(tx));
}

/**
 * Projects the stored rows into the screen-facing settings state.
 *
 * `findAll` orders by key, so this reads the rows as a map rather than by position.
 *
 * `defaultContributionPaise` re-validates the stored value rather than trusting it: a stored row
 * that is not a positive paise count is a server fault, and the alternative - falling back to a
 * default amount - is exactly the disagreement between environments that
 * `app-setting.validation.ts` refuses to allow. A missing key is reported by the repository as a
 * `NOT_FOUND` naming the key, rather than being defaulted.
 *
 * `formatPaiseSetting` performs that validation and the conversion together, so the stored paise
 * string becomes the exact decimal string the screen shows through one call and cannot be
 * formatted twice from two different parses.
 */
function toDemoSettings(rows: readonly AppSetting[]): DemoSettings {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const methods = requireConfiguredKey(byKey, 'ENABLED_PAYMENT_METHODS');

  const enabledPaymentMethods = methods
    .split(',')
    .map((method) => method.trim())
    .filter(isPaymentMethod);

  // The stored value is trusted to be a non-empty documented subset because the column's CHECK
  // constraint enforces it; this re-check exists so a broken environment produces a clear fault
  // rather than a settings screen offering no payment method at all.
  if (enabledPaymentMethods.length === 0) {
    throw notConfigured('ENABLED_PAYMENT_METHODS');
  }

  return {
    currency: SETTINGS_CURRENCY,
    businessTimezone: SETTINGS_BUSINESS_TIMEZONE,
    defaultMonthlyContribution: formatPaiseSetting(
      requireConfiguredKey(byKey, 'DEFAULT_MONTHLY_CONTRIBUTION_PAISE'),
    ),
    enabledPaymentMethods,
    editable: {
      defaultMonthlyContribution: true,
      enabledPaymentMethods: true,
      // `REQ-SETTINGS-003` and `REQ-SETTINGS-004` are fixed. Reporting them as `false` is what
      // stops the screen from rendering a control the API would refuse.
      currency: false,
      businessTimezone: false,
    },
    minimumEnabledPaymentMethods: 1,
    expenseCategoryManagement: {
      label: 'Manage expense categories',
      path: '/expenses',
      note:
        'Categories are added, renamed, and retired on the Expense screen. A retired category stays ' +
        'on the expenses already recorded under it.',
    },
  };
}

/**
 * Reports an absent or unusable seeded setting as a server fault.
 *
 * `docs/05-DATABASE-SPEC.md` writes the four required `app_setting` rows in a forward migration, so
 * a missing row means the environment is not correctly set up. Throwing a plain `Error` produces the
 * documented `500 INTERNAL_ERROR` envelope with a fixed client message, and writes the reason to
 * the structured log - which is the honest pair of facts.
 *
 * The alternative would be a `DomainError`, and it is deliberately rejected: `NOT_FOUND` becomes a
 * `404` and `VALIDATION_FAILED` becomes a `400`, and both would tell the Admin the *request* was
 * wrong. It was not. Falling back to a built-in default is rejected for a stronger reason: two
 * environments would then disagree about what a member owes, which is exactly what
 * `app-setting.validation.ts` says must not happen.
 */
function requireConfiguredKey(byKey: ReadonlyMap<string, string>, key: string): string {
  const value = byKey.get(key);

  if (value === undefined) {
    throw notConfigured(key);
  }

  return value;
}

function notConfigured(key: string): Error {
  return new Error(
    `${key} is not configured on this server. The app_setting rows are seeded by a migration, so ` +
      'this environment has not been prepared.',
  );
}
