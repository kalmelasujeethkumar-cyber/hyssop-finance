import type { ReactNode } from 'react';
import {
  INCOME_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  isIncomeType,
  isPaymentMethod,
  TRANSACTION_DESCRIPTION_MAX_LENGTH,
  TRANSACTION_NOTES_MAX_LENGTH,
} from '@hyssop/contracts';
import { Banner, FormField, controlClassName } from '../../components/ui';
import {
  INCOME_TYPE_CHOICES,
  PAYMENT_METHOD_CHOICES,
  type IncomeFieldErrors,
  type IncomeFormValues,
} from './income-api';

/**
 * The income controls that both income forms share.
 *
 * Authority: `docs/03-UI-UX-RULES.md` (every form input marked required or optional, correct
 * input types, keyboard order, accessible inline errors) and `docs/01-REQUIREMENTS.md`
 * `REQ-INCOME-003` to `REQ-INCOME-006`.
 *
 * Amount, payment method, business date, description, and notes mean the same thing whether the
 * income is recorded from the income screen or as a payment against a member the Admin is
 * already looking at, so they are defined once here. Defining them twice is how a member payment
 * ends up with a slightly different amount hint than the general form, which is a defect a pastor
 * would notice and no test would catch.
 *
 * The field identifiers, labels, hints, and maximum lengths are carried over unchanged from
 * `IncomePage`'s own form. They are part of this screen's observable surface: the E2E suite
 * addresses these controls by label, `docs/04-DESIGN-TOKENS.md` treats them as the app's one
 * income vocabulary, and the API's maximum lengths are the same numbers.
 */

export interface IncomeFieldsProps {
  readonly values: IncomeFormValues;
  readonly fieldErrors: IncomeFieldErrors;
  /** Called with the changed field and its new value. */
  readonly onChange: <K extends keyof IncomeFormValues>(key: K, value: IncomeFormValues[K]) => void;
  /**
   * Whether the income type itself may be chosen.
   *
   * `true` on the income screen, where Offering, Donation, and Anonymous Donation are also
   * recordable income. `false` for a payment against a member: a payment is a member
   * contribution by definition (`REQ-INCOME-003`), and offering the other three types there would
   * let the Admin record something other than the payment they came to record. A fixed type is
   * stated in the form's own heading instead of being left implied.
   */
  readonly canChooseIncomeType: boolean;
  /**
   * Where the member control goes, when the form has one.
   *
   * Injected rather than chosen here because the two forms genuinely differ: the income screen
   * searches for a member, while a payment arrives knowing its member and shows it read-only.
   */
  readonly memberSlot?: ReactNode;
}

export function IncomeFields({
  values,
  fieldErrors,
  onChange,
  canChooseIncomeType,
  memberSlot,
}: IncomeFieldsProps) {
  // `REQ-INCOME-005` and `REQ-INCOME-006` must not be bypassable by typing into a control that
  // was merely disabled, so an anonymous donation removes the member, description, and notes
  // entirely rather than greying them out.
  const isAnonymous = values.incomeType === 'ANONYMOUS_DONATION';

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {canChooseIncomeType ? (
          <FormField
            id="income-type-input"
            label="Income type"
            required
            error={fieldErrors.incomeType}
            hint="Member Contribution needs a member. Anonymous Donation records no donor."
          >
            <select
              id="income-type-input"
              name="incomeType"
              className={controlClassName()}
              value={values.incomeType}
              onChange={(event) => {
                const value = event.target.value;

                if (isIncomeType(value)) {
                  onChange('incomeType', value);
                }
              }}
            >
              {INCOME_TYPE_CHOICES.map((type) => (
                <option key={type} value={type}>
                  {INCOME_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </FormField>
        ) : null}

        <FormField
          id="income-amount"
          label="Amount"
          required
          error={fieldErrors.amount}
          hint="In rupees, for example 500 or 500.00."
        >
          <input
            id="income-amount"
            name="amount"
            type="text"
            inputMode="decimal"
            required
            maxLength={18}
            value={values.amount}
            onChange={(event) => {
              onChange('amount', event.target.value);
            }}
            className={controlClassName()}
          />
        </FormField>

        <FormField
          id="income-method-input"
          label="Payment method"
          required
          error={fieldErrors.paymentMethod}
        >
          <select
            id="income-method-input"
            name="paymentMethod"
            className={controlClassName()}
            value={values.paymentMethod}
            onChange={(event) => {
              const value = event.target.value;

              if (isPaymentMethod(value)) {
                onChange('paymentMethod', value);
              }
            }}
          >
            {PAYMENT_METHOD_CHOICES.map((method) => (
              <option key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          id="income-business-date"
          label="Business date"
          required
          error={fieldErrors.businessDate}
          hint="The Asia/Kolkata calendar date this income belongs to."
        >
          <input
            id="income-business-date"
            name="businessDate"
            type="date"
            required
            value={values.businessDate}
            onChange={(event) => {
              onChange('businessDate', event.target.value);
            }}
            className={controlClassName()}
          />
        </FormField>

        {memberSlot}
      </div>

      {isAnonymous ? (
        <Banner tone="info">
          An anonymous donation records no donor, description, or note. The church receives the
          amount and nothing that could identify the person who gave it.
        </Banner>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="income-description"
            label="Description"
            optional
            error={fieldErrors.description}
            hint="For example Sunday offering or Thank-you donation."
          >
            <input
              id="income-description"
              name="description"
              type="text"
              maxLength={TRANSACTION_DESCRIPTION_MAX_LENGTH}
              value={values.description}
              onChange={(event) => {
                onChange('description', event.target.value);
              }}
              className={controlClassName()}
            />
          </FormField>

          <FormField
            id="income-notes"
            label="Notes"
            optional
            error={fieldErrors.notes}
            hint="Private. Not shown on a receipt and not included in searches."
          >
            <textarea
              id="income-notes"
              name="notes"
              rows={2}
              maxLength={TRANSACTION_NOTES_MAX_LENGTH}
              value={values.notes}
              onChange={(event) => {
                onChange('notes', event.target.value);
              }}
              className={controlClassName()}
            />
          </FormField>
        </div>
      )}
    </>
  );
}
