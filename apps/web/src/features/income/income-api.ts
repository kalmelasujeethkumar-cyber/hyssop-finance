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
import {
  fieldIssuesByName,
  invalidateTransactionDependents,
} from '../transactions/transaction-api';

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
 * The income type a member payment always is.
 *
 * A payment recorded from a member is a member contribution by definition: `REQ-INCOME-003`
 * requires a member, and the contribution month is derived from the payment date. Naming the
 * literal in one place keeps the member-payment forms from each restating the wire vocabulary,
 * and keeps a future reader from wondering whether a payment could be any other income type.
 */
export const MEMBER_PAYMENT_INCOME_TYPE: IncomeType = 'MEMBER_CONTRIBUTION';

/**
 * The minimum a locked payment form needs to identify the member it is paying.
 *
 * Structural rather than a named contract type, so both `MemberSummary` (the response of
 * `POST /api/v1/members`) and `MemberDetail` (the member screen's own projection) satisfy it
 * without either being widened. A newly created member therefore needs no refetch before a
 * payment can be recorded against it.
 */
export interface MemberPaymentRef {
  readonly id: string;
  readonly name: string;
  readonly referenceId: string;
  readonly phone: string | null;
}

/**
 * Full month names, for a sentence that names the month a payment is credited to.
 *
 * `lib/money.ts` deliberately abbreviates (`Sep 2026`) because it formats table cells and
 * period labels where width matters. This sentence is read rather than scanned, so the full
 * name is used, and it lives here beside `contributionMonthOf` rather than being imported from
 * a page that happens to own a month selector.
 */
const MEMBER_PAYMENT_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * The month a payment will be credited to, in words, or `undefined` when it cannot be known.
 *
 * Derived from `contributionMonthOf`, which is the single derivation the request itself uses,
 * so the sentence the Admin reads and the `contributionPeriod` the API receives cannot disagree.
 * There is no `Date` here and no time zone: the business date is already the Asia/Kolkata
 * calendar date the API validates, so slicing it is the whole computation.
 *
 * `undefined` is returned for an empty or malformed date rather than a guess. A credited month
 * shown for a date the API will reject is exactly the misleading state the UI rules forbid.
 */
export function creditedMonthLabel(businessDate: string): string | undefined {
  const period = contributionMonthOf(businessDate);

  if (period === undefined) {
    return undefined;
  }

  const name = MEMBER_PAYMENT_MONTH_NAMES[period.month - 1];

  return name === undefined ? undefined : `${name} ${period.year}`;
}

/**
 * The starting values for recording a payment against one already-identified member.
 *
 * `MEMBER_CONTRIBUTION` is fixed rather than chosen, because a payment for a member is that
 * income type; Offering and Donation remain optional-membership income types chosen on the
 * general income screen, and the Admin is not offered the wrong vocabulary here. The member is
 * seeded from the record the server already returned, so the identifier sent is the real UUID
 * rather than anything typed or invented.
 *
 * `businessDate` is supplied by the caller because only the caller knows "today" for the
 * screen's own locale default, exactly as the general income form passes it in.
 */
export function memberPaymentFormValues(
  member: MemberPaymentRef,
  businessDate: string,
): IncomeFormValues {
  return {
    ...EMPTY_INCOME_FORM,
    incomeType: MEMBER_PAYMENT_INCOME_TYPE,
    memberId: member.id,
    businessDate,
  };
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

/** The income fields the API may report a validation problem against. */
const INCOME_FIELD_NAMES = [
  'incomeType',
  'amount',
  'paymentMethod',
  'businessDate',
  'memberId',
  'description',
  'notes',
] as const satisfies readonly (keyof IncomeFieldErrors)[];

/**
 * Maps a server-side validation failure onto the income form's own field names.
 *
 * Both income forms need this and neither may invent its own mapping: a message attached to the
 * wrong input is a lie about where the problem is, and an unrecognised field has to stay in the
 * general error banner rather than being pinned to some input the Admin did not fill in.
 */
export function incomeFieldErrorsFrom(error: unknown): IncomeFieldErrors {
  const issues = fieldIssuesByName(error);
  // Mutable while it is being assembled, then returned as the read-only shape the forms hold.
  const errors: {
    incomeType?: string;
    amount?: string;
    paymentMethod?: string;
    businessDate?: string;
    memberId?: string;
    description?: string;
    notes?: string;
  } = {};

  for (const field of INCOME_FIELD_NAMES) {
    const message = issues[field];

    if (message !== undefined) {
      errors[field] = message;
    }
  }

  return errors;
}

/**
 * Today's calendar date in Asia/Kolkata, as `YYYY-MM-DD`.
 *
 * Both income forms pre-fill the business date with it, because the common case is today's income
 * and a pastor should not have to know the date format. The value stays visible and editable, so
 * the pre-fill is a convenience rather than a default the Admin cannot see.
 *
 * IST is a fixed +05:30 offset with no daylight saving, so the shift is exact arithmetic and
 * needs no time-zone database. `Date` is used only to *display* today; no financial value ever
 * passes through it.
 */
export function businessDateToday(): string {
  const now = new Date(Date.now() + 330 * 60_000);

  return now.toISOString().slice(0, 10);
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
