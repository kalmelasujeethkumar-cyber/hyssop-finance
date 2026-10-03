import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { DemoSettings, PaymentMethod } from '@hyssop/contracts';
import {
  Banner,
  FormField,
  LoadingBlock,
  PageHeader,
  Panel,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  controlClassName,
} from '../components/ui';
import {
  SETTINGS_PAYMENT_METHOD_CHOICES,
  describeSettingsFailure,
  hasSettingsFieldErrors,
  settingsFieldErrors,
  useSetDefaultContribution,
  useSettings,
  useUpdateSettings,
  validateContributionAmount,
  type SettingsFieldErrors,
} from '../features/settings/settings-api';
import { createIdempotencyKey } from '../features/transactions/transaction-api';
import { formatInr } from '../lib/money';
import { useUnsavedWork } from '../app/providers/UnsavedWorkProvider';

/**
 * The Settings screen.
 *
 * Authority: `docs/phases/PHASE-10-AUDIT-SETTINGS.md`, `docs/01-REQUIREMENTS.md`
 * `REQ-SETTINGS-001` to `REQ-SETTINGS-009`, `docs/06-API-SPEC.md` ("Settings"), and
 * `docs/03-UI-UX-RULES.md`.
 *
 * This screen is deliberately small, and that is the requirement rather than a shortcut:
 * `REQ-SETTINGS-006` and `REQ-SETTINGS-007` make exactly two values editable, and `REQ-SETTINGS-001`
 * and `REQ-SETTINGS-008` keep church identity and a database reset out of the product entirely.
 *
 * Three rules shape what is rendered:
 *
 * - **A fixed value is shown, not offered.** The currency and the business timezone appear as
 *   read-only text because the API reports `editable.currency === false`. They are still displayed,
 *   because `REQ-SETTINGS-003` and `REQ-SETTINGS-004` are honoured visibly rather than by absence.
 *   Nothing here renders a control the API would refuse.
 * - **The browser does no financial arithmetic.** The stored amount arrives as an exact decimal
 *   string and is rendered through the shared `formatInr`, which formats text. No total, no
 *   conversion, no `Number()` on a money value: `REQ-FIN-021` requires exact paise and a double
 *   cannot represent every paise value.
 * - **The category lifecycle is presented, not duplicated.** `REQ-SETTINGS-002` requires a
 *   category-management entry point here, and Phase 06 owns the lifecycle itself. The destination
 *   is read from `expenseCategoryManagement.path` rather than hardcoded, so the link cannot point at
 *   a screen that no longer exists.
 *
 * The two editable values are saved by two different documented routes. A change to the amount
 * alone goes to `POST /api/v1/settings/contribution-default`, the narrower command that cannot
 * touch the payment methods; a change that touches the methods goes to
 * `PATCH /api/v1/settings`. Both carry an idempotency key that is created once per submission
 * intent and reused across retries, so a double submit or a retry after a timeout is recorded once.
 */
export function SettingsPage() {
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const setDefaultContribution = useSetDefaultContribution();

  const [amount, setAmount] = useState<string | null>(null);
  const [enabledMethods, setEnabledMethods] = useState<readonly PaymentMethod[] | null>(null);
  const [fieldErrors, setFieldErrors] = useState<SettingsFieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  // Any edited, unsaved Settings value is unsaved work (`REQ-RESP-008`); leaving would discard it.
  // The comparison is hoisted above the loading/error returns because it must run on every render.
  useUnsavedWork(settings.isSuccess && settingsHaveChanges(amount, enabledMethods, settings.data));

  if (settings.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Settings"
          description="The two values you can change for this church account, and the two that are fixed."
        />
        <LoadingBlock label="Loading the current settings…" />
      </div>
    );
  }

  if (settings.isError) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Settings"
          description="The two values you can change for this church account, and the two that are fixed."
        />
        <Banner
          tone="danger"
          action={
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASS}
              onClick={() => {
                void settings.refetch();
              }}
            >
              Try again
            </button>
          }
        >
          The settings could not be loaded. {describeSettingsFailure(settings.error)}
        </Banner>
      </div>
    );
  }

  const current = settings.data;
  const isSaving = updateSettings.isPending || setDefaultContribution.isPending;

  // An untouched field stays `null`, which is what makes a partial save possible: the omitted
  // field is left alone by the server rather than resent with a stale value.
  const amountValue = amount ?? current.defaultMonthlyContribution;
  const methodsValue = enabledMethods ?? current.enabledPaymentMethods;

  const amountChanged = amountValue !== current.defaultMonthlyContribution;
  const methodsChanged =
    methodsValue.length !== current.enabledPaymentMethods.length ||
    methodsValue.some((method, index) => method !== current.enabledPaymentMethods[index]);
  const hasChanges = amountChanged || methodsChanged;

  // The last remaining method cannot be unticked: `REQ-SETTINGS-002` requires at least one method
  // to stay enabled so income can always be recorded. Disabling the control is the honest way to
  // express that rule - the alternative is a checkbox the Admin can clear and then be told no.
  const minimum = current.minimumEnabledPaymentMethods;
  const untickingWouldBreakMinimum = methodsValue.length <= minimum;

  function changeAmount(value: string): void {
    setAmount(value);
    setConfirmation(null);
    setFieldErrors((previous) => {
      if (previous.defaultMonthlyContribution === undefined) {
        return previous;
      }

      const rest = { ...previous };
      delete rest.defaultMonthlyContribution;

      return rest;
    });
  }

  function toggleMethod(method: PaymentMethod, checked: boolean): void {
    setConfirmation(null);
    setEnabledMethods((previous) => {
      const selected = previous ?? [...current.enabledPaymentMethods];

      return checked
        ? selected.includes(method)
          ? selected
          : // Kept in the documented order so the checkbox list never reorders itself as the
            // Admin ticks, which would make the control feel like it moved on its own.
            SETTINGS_PAYMENT_METHOD_CHOICES.map((choice) => choice.value).filter(
              (candidate) => candidate === method || selected.includes(candidate),
            )
        : selected.filter((candidate) => candidate !== method);
    });
    setFieldErrors((previous) => {
      if (previous.enabledPaymentMethods === undefined) {
        return previous;
      }

      const rest = { ...previous };
      delete rest.enabledPaymentMethods;

      return rest;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    // Duplicate-submission protection for the keyboard and programmatic paths that bypass a
    // disabled button.
    if (isSaving) {
      return;
    }

    setFailure(null);
    setConfirmation(null);

    const errors: { defaultMonthlyContribution?: string; enabledPaymentMethods?: string } = {};

    if (amountChanged) {
      const amountError = validateContributionAmount(amountValue);
      if (amountError !== undefined) {
        errors.defaultMonthlyContribution = amountError;
      }
    }

    if (methodsChanged && methodsValue.length < minimum) {
      errors.enabledPaymentMethods = 'Keep at least one payment method enabled.';
    }

    // A save that would change nothing is not sent. The API refuses such a body, and reporting
    // success for a request that was never checked is the dishonest outcome the UI rules forbid.
    if (!hasChanges) {
      setFieldErrors({});
      setFailure('Change the contribution amount, the payment methods, or both, then save.');

      return;
    }

    if (hasSettingsFieldErrors(errors)) {
      setFieldErrors(errors);

      return;
    }

    setFieldErrors({});

    const key = idempotencyKey === '' ? createIdempotencyKey() : idempotencyKey;

    if (idempotencyKey === '') {
      setIdempotencyKey(key);
    }

    const onSaved = (saved: { readonly defaultMonthlyContribution: string }): void => {
      // A completed save is a new intent, so the next submission gets a new key. Keeping this one
      // would make the API replay the previous response.
      setIdempotencyKey(createIdempotencyKey());
      setAmount(null);
      setEnabledMethods(null);
      const parts = [
        methodsChanged ? 'The available payment methods were saved.' : '',
        amountChanged
          ? `The monthly expectation is now ${formatInr(saved.defaultMonthlyContribution)}.`
          : '',
      ].filter((part) => part !== '');

      setConfirmation(parts.join(' '));
    };

    const onFailed = (error: unknown): void => {
      setFieldErrors(settingsFieldErrors(error));
      setFailure(describeSettingsFailure(error));
    };

    if (methodsChanged) {
      updateSettings.mutate(
        {
          idempotencyKey: key,
          ...(amountChanged ? { defaultMonthlyContribution: amountValue.trim() } : {}),
          enabledPaymentMethods: methodsValue,
        },
        { onSuccess: onSaved, onError: onFailed },
      );

      return;
    }

    setDefaultContribution.mutate(
      { idempotencyKey: key, defaultMonthlyContribution: amountValue.trim() },
      { onSuccess: onSaved, onError: onFailed },
    );
  }

  function resetForm(): void {
    setAmount(null);
    setEnabledMethods(null);
    setFieldErrors({});
    setFailure(null);
    setConfirmation(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="The two values you can change for this church account, and the two that are fixed."
      />

      {confirmation === null ? null : <Banner tone="success">{`Saved. ${confirmation}`}</Banner>}

      {failure === null ? null : <Banner tone="danger">{failure}</Banner>}

      <Panel title="Monthly member expectation">
        <p className="mb-4 text-supporting text-text-secondary">
          This is the amount every member is expected to give each month. It is applied to
          contribution periods opened from now on; a period that already has its own amount keeps
          it, so what you agreed with a member is never overwritten.
        </p>

        <form className="space-y-5" onSubmit={handleSubmit} noValidate>
          <FormField
            id="settings-default-contribution"
            label="Default monthly contribution"
            required
            hint="Rupees and paise, for example 500.00. Enter the amount exactly; it is stored without rounding."
            {...(fieldErrors.defaultMonthlyContribution === undefined
              ? {}
              : { error: fieldErrors.defaultMonthlyContribution })}
          >
            <input
              id="settings-default-contribution"
              className={controlClassName()}
              value={amountValue}
              inputMode="decimal"
              autoComplete="off"
              disabled={!current.editable.defaultMonthlyContribution || isSaving}
              onChange={(event) => {
                changeAmount(event.target.value);
              }}
            />
          </FormField>

          <fieldset
            className="space-y-2"
            disabled={!current.editable.enabledPaymentMethods || isSaving}
          >
            <legend className="block text-supporting font-semibold text-text-primary">
              Payment methods (required)
            </legend>
            <p className="text-supporting text-text-secondary">
              {`Keep at least ${minimum} enabled so income can always be recorded. Turning a method off affects new entries only: money already recorded under it, and any void, keeps its figures.`}
            </p>

            <div className="mt-2 space-y-2">
              {SETTINGS_PAYMENT_METHOD_CHOICES.map((choice) => {
                const isEnabled = methodsValue.includes(choice.value);
                const isLastEnabled =
                  isEnabled && methodsValue.length <= minimum && methodsValue.length === 1;

                return (
                  <label
                    key={choice.value}
                    className="flex items-center gap-2 text-supporting text-text-primary"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={isEnabled}
                      disabled={isLastEnabled}
                      onChange={(event) => {
                        toggleMethod(choice.value, event.target.checked);
                      }}
                    />
                    <span>{choice.label}</span>
                  </label>
                );
              })}
            </div>

            {untickingWouldBreakMinimum ? (
              <p className="text-supporting text-text-secondary">
                At least {minimum} payment method must stay enabled.
              </p>
            ) : null}

            {fieldErrors.enabledPaymentMethods === undefined ? null : (
              <p
                id="settings-enabled-payment-methods-error"
                role="alert"
                className="text-supporting font-semibold text-danger-700"
              >
                {fieldErrors.enabledPaymentMethods}
              </p>
            )}
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className={PRIMARY_BUTTON_CLASS}
              disabled={isSaving || !hasChanges}
            >
              {isSaving ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASS}
              disabled={isSaving || !hasChanges}
              onClick={resetForm}
            >
              Discard changes
            </button>
          </div>
        </form>
      </Panel>

      <Panel title="Fixed for this application">
        <p className="mb-4 text-supporting text-text-secondary">
          These are the same for every church account and cannot be changed here.
        </p>

        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border-default bg-surface-subtle p-4">
            <dt className="text-supporting font-semibold text-text-primary">Currency</dt>
            <dd className="mt-1 text-supporting text-text-secondary">
              {`${current.currency} (rupees). Every amount is recorded and shown in ${current.currency}.`}
            </dd>
          </div>
          <div className="rounded-lg border border-border-default bg-surface-subtle p-4">
            <dt className="text-supporting font-semibold text-text-primary">
              Business date timezone
            </dt>
            <dd className="mt-1 text-supporting text-text-secondary">
              {`${current.businessTimezone}. Every date you enter is read as a date in this timezone.`}
            </dd>
          </div>
        </dl>
      </Panel>

      <Panel title="Expense categories">
        <p className="text-supporting text-text-secondary">
          {current.expenseCategoryManagement.note}
        </p>
        <p className="mt-3">
          <Link to={current.expenseCategoryManagement.path} className={SECONDARY_BUTTON_CLASS}>
            {current.expenseCategoryManagement.label}
          </Link>
        </p>
      </Panel>
    </div>
  );
}

/**
 * Whether the Admin has edited either editable Settings value away from what the API reported.
 *
 * The null fields are the "untouched" markers the form uses for partial saves, so the comparison
 * falls back to the reported value exactly as `hasChanges` does for the visible controls.
 */
function settingsHaveChanges(
  amount: string | null,
  enabledMethods: readonly PaymentMethod[] | null,
  current: DemoSettings,
): boolean {
  const amountValue = amount ?? current.defaultMonthlyContribution;
  const methodsValue = enabledMethods ?? current.enabledPaymentMethods;

  return (
    amountValue !== current.defaultMonthlyContribution ||
    methodsValue.length !== current.enabledPaymentMethods.length ||
    methodsValue.some((method, index) => method !== current.enabledPaymentMethods[index])
  );
}
