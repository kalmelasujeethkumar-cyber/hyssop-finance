import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ANONYMOUS_DONATION_DESCRIPTION,
  BUSINESS_DATE_FORMAT_MESSAGE,
  INCOME_TYPES,
  MONEY_FORMAT_MESSAGE,
  PAYMENT_METHODS,
  TRANSACTION_DESCRIPTION_MAX_LENGTH,
  TRANSACTION_NOTES_MAX_LENGTH,
  incomeTypeRequiresMember,
  isAnonymousIncomeType,
  isIncomeType,
  type IncomeType,
  type PaymentMethod,
  type TransactionSummary,
} from '@hyssop/contracts';
import { useApiClient } from '../../app/providers/ApiClientProvider';
import { ApiTransportError } from '../../lib/api-client';
import { useSession } from '../auth/SessionProvider';
import { invalidateTransactionDependents } from '../transactions/transaction-api';

/**
 * Income form data access.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-INCOME-001` to `REQ-INCOME-006` and
 * `docs/phases/PHASE-05-INCOME.md`. Income is recorded through `POST /api/v1/income`; the
 * list, detail, correction, void, audit, and receipt behaviour is the shared transaction
 * contract and lives in `../transactions/transaction-api`, so none of it is reimplemented per
 * income type.
 *
 * The two privacy rules are enforced here as well as by the API, and the browser enforcement is
 * the visible one: the member control is not rendered for an anonymous donation, and the
 * description and notes of one are never placed in the request at all. That is deliberate — a
 * value that is never sent cannot be stored, displayed, searched, or exported, so the rule does
 * not depend on the server remembering to strip it.
 */

export interface IncomeFormValues {
  readonly incomeType: IncomeType;
  readonly amount: string;
  readonly paymentMethod: PaymentMethod;
  readonly businessDate: string;
  /** Empty means "no member named", which only Offering and Donation accept. */
  readonly memberId: string;
  readonly description: string;
  readonly notes: string;
}

export const EMPTY_INCOME_FORM: IncomeFormValues = {
  incomeType: 'MEMBER_CONTRIBUTION',
  amount: '',
  paymentMethod: 'CASH',
  businessDate: '',
  memberId: '',
  description: '',
  notes: '',
};

export interface IncomeFieldErrors {
  readonly incomeType?: string;
  readonly amount?: string;
  readonly paymentMethod?: string;
  readonly businessDate?: string;
  readonly memberId?: string;
  readonly description?: string;
  readonly notes?: string;
}

const ZERO_AMOUNTS: readonly string[] = ['0', '0.0', '0.00'];

export const INCOME_TYPE_CHOICES: readonly IncomeType[] = INCOME_TYPES;
export const PAYMENT_METHOD_CHOICES: readonly PaymentMethod[] = PAYMENT_METHODS;

/**
 * Validates the income fields in the browser.
 *
 * `incomeType` is the field that changes the other rules, so it is validated first and the
 * member, description, and notes checks read the type rather than assuming a shape. The API
 * validates everything again; this only saves a round trip and gives the message next to the
 * field that caused it.
 */
export function validateIncomeFields(values: IncomeFormValues): IncomeFieldErrors {
  const errors: {
    incomeType?: string;
    amount?: string;
    paymentMethod?: string;
    businessDate?: string;
    memberId?: string;
    description?: string;
    notes?: string;
  } = {};

  if (!isIncomeType(values.incomeType)) {
    errors.incomeType = 'Choose an income type.';
  }

  const amount = values.amount.trim();

  if (amount === '') {
    errors.amount = 'Enter an amount.';
  } else if (ZERO_AMOUNTS.includes(amount)) {
    errors.amount = 'The amount must be greater than zero.';
  } else if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) {
    errors.amount = MONEY_FORMAT_MESSAGE;
  }

  if (!PAYMENT_METHODS.includes(values.paymentMethod)) {
    errors.paymentMethod = 'Choose a payment method.';
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.businessDate.trim())) {
    errors.businessDate = BUSINESS_DATE_FORMAT_MESSAGE;
  }

  // `REQ-INCOME-003` requires a member for a contribution; `REQ-INCOME-005` forbids one for
  // an anonymous donation. An anonymous donation has no member control at all, so a stale
  // value left in the form by a previous type change must not be sent; dropping it is what
  // keeps the record anonymous.
  if (incomeTypeRequiresMember(values.incomeType) && values.memberId.trim() === '') {
    errors.memberId = 'Choose the member this contribution is for.';
  }

  if (
    !isAnonymousIncomeType(values.incomeType) &&
    values.description.trim().length > TRANSACTION_DESCRIPTION_MAX_LENGTH
  ) {
    errors.description = `Description must be ${TRANSACTION_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }

  if (
    !isAnonymousIncomeType(values.incomeType) &&
    values.notes.trim().length > TRANSACTION_NOTES_MAX_LENGTH
  ) {
    errors.notes = `Notes must be ${TRANSACTION_NOTES_MAX_LENGTH} characters or fewer.`;
  }

  return errors;
}

export function hasIncomeFieldErrors(errors: IncomeFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Builds the create body.
 *
 * An anonymous donation sends no member, no description, and no notes, and the server assigns
 * its own neutral description. Nothing that could identify a donor is put in the request, so
 * `REQ-INCOME-005` and `REQ-INCOME-006` hold for every path into the API, not only the one the
 * Admin happens to take through this form.
 */
export function incomeRequestBody(values: IncomeFormValues): {
  incomeType: IncomeType;
  amount: string;
  paymentMethod: PaymentMethod;
  businessDate: string;
  memberId?: string;
  contributionPeriod?: { readonly year: number; readonly month: number };
  description?: string;
  notes?: string;
} {
  const amount = values.amount.trim();
  const businessDate = values.businessDate.trim();

  if (isAnonymousIncomeType(values.incomeType)) {
    return {
      incomeType: values.incomeType,
      amount,
      paymentMethod: values.paymentMethod,
      businessDate,
    };
  }

  const memberId = values.memberId.trim();
  const description = values.description.trim();
  const notes = values.notes.trim();
  // `docs/phases/PHASE-05-INCOME.md` requires a member *and* a contribution period for a Member
  // Contribution, and the API refuses the write without one. The month is derived from the
  // business date the Admin already entered rather than asked for separately: the business date
  // states which Asia/Kolkata day the money belongs to, so a second control could only ever
  // disagree with it. The other three types must not carry a period, and Offering and Donation
  // would be rejected if they did.
  const period = contributionMonthOf(businessDate);

  return {
    incomeType: values.incomeType,
    amount,
    paymentMethod: values.paymentMethod,
    businessDate,
    ...(memberId === '' ? {} : { memberId }),
    ...(values.incomeType === 'MEMBER_CONTRIBUTION' && period !== undefined
      ? { contributionPeriod: period }
      : {}),
    ...(description === '' ? {} : { description }),
    ...(notes === '' ? {} : { notes }),
  };
}

/**
 * The `year` and `month` of a `YYYY-MM-DD` business date.
 *
 * Exact string slicing of the date the API already validated, deliberately: constructing a `Date`
 * here would put a time zone and an implicit instant in the middle of a value that decides which
 * member-month a payment is counted against, and a date at a month boundary could be shifted a
 * month by that conversion. `undefined` means the value is not a `YYYY-MM-DD` date, which
 * `validateIncomeFields` has already reported, so no period is guessed and the API stays the
 * authority on rejecting the malformed date itself.
 */
export function contributionMonthOf(
  businessDate: string,
): { year: number; month: number } | undefined {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(businessDate.trim());

  if (match === null) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (month < 1 || month > 12) {
    return undefined;
  }

  return { year, month };
}

/**
 * Whether the member picker should be shown for an income type.
 *
 * Offering and Donation may identify a member, so the control is offered; an anonymous donation
 * must not, so it is absent rather than disabled. A disabled control invites the question of
 * why it is greyed out, and a required-then-forbidden field is a contradiction.
 */
export function showsMemberPicker(incomeType: IncomeType): boolean {
  return !isAnonymousIncomeType(incomeType);
}

/** The placeholder text for the description of an anonymous donation, for the disabled form. */
export const ANONYMOUS_DESCRIPTION_PLACEHOLDER = ANONYMOUS_DONATION_DESCRIPTION;

export function useCreateIncome() {
  const client = useApiClient();
  const { withCsrf } = useSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { readonly values: IncomeFormValues; readonly idempotencyKey: string }) => {
      if (input.idempotencyKey === '') {
        return Promise.reject(new ApiTransportError('No idempotency key was prepared.'));
      }

      return withCsrf((csrfToken) =>
        client.post<TransactionSummary>('/income', incomeRequestBody(input.values), {
          csrfToken,
          // Sent on every create, as `docs/06-API-SPEC.md` requires. The key belongs to this
          // one submission, so a double submit or a retry records one contribution, not two.
          idempotencyKey: input.idempotencyKey,
        }),
      );
    },
    onSuccess: () => {
      // A new income row changes the list, the counts, the receipt and audit views, and the
      // member's derived contribution status, so every cached view that depends on the ledger is
      // invalidated rather than patched and no screen is left showing a total that is now wrong.
      invalidateTransactionDependents(queryClient);
    },
  });
}
