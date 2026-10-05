import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { INCOME_TYPE_LABELS } from '@hyssop/contracts';
import { Banner, Panel, PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../../components/ui';
import { useUnsavedWork } from '../../app/providers/UnsavedWorkProvider';
import { formatInr } from '../../lib/money';
import { LockedMemberSummary } from '../members/MemberSearchField';
import { createIdempotencyKey, describeTransactionFailure } from '../transactions/transaction-api';
import { IncomeFields } from './IncomeFields';
import {
  MEMBER_PAYMENT_INCOME_TYPE,
  businessDateToday,
  creditedMonthLabel,
  hasIncomeFieldErrors,
  incomeFieldErrorsFrom,
  memberPaymentFormValues,
  useCreateIncome,
  validateIncomeFields,
  type IncomeFieldErrors,
  type IncomeFormValues,
  type MemberPaymentRef,
} from './income-api';

/**
 * Recording a payment against one member the Admin is already looking at.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-INCOME-003` (a member contribution requires a
 * member; the contribution period is the business date's month) and `docs/03-UI-UX-RULES.md`
 * (required/optional indication, server-backed validation, a disabled submit while the request
 * is in flight, duplicate-submission protection, success and failure feedback, unsaved-work
 * warning, and a clear cancel path).
 *
 * This is the same financial operation as the income screen's Member Contribution branch — one
 * `POST /api/v1/income`, one `contributionPeriod` derived from the business date, one reference
 * allocated by the API — with the member already decided. Nothing here adds a rule the income
 * screen does not already enforce: the member is required because a payment to a member is
 * `MEMBER_CONTRIBUTION`, and the amount is a real amount validated against the same contract.
 *
 * Reaching a member is the hard part of this job for a pastor. The member is often a family
 * member who gives cash at the door and is not in front of the list yet, and the previous
 * income screen offered only the first page of members by name, so recording their contribution
 * meant not being able to find them. This form removes the lookup entirely: the Admin opens the
 * member, presses Record Payment, and the member is already named above the amount.
 *
 * A member who does not exist yet is *not* created here. The member record and the payment are
 * separate facts, and a form that quietly invented a member would hide a real master-data gap
 * behind a silent write. The empty-search message points at the Members screen instead.
 */

const PAYMENT_FORM_ID = 'record-member-payment-form';

export interface RecordMemberPaymentFormProps {
  /** The member being paid, as the server identified them. Never editable from here. */
  readonly member: MemberPaymentRef;
  /** Where the payment is being recorded from, for the confirmation sentence. */
  readonly origin: 'member-detail' | 'member-created';
  readonly onDismiss: () => void;
}

export function RecordMemberPaymentForm({
  member,
  origin,
  onDismiss,
}: RecordMemberPaymentFormProps) {
  const create = useCreateIncome();

  // The form starts from the record the server already returned, so the identifier sent is the
  // real UUID rather than anything typed or invented, and the date is pre-filled for the same
  // reason as the income screen's form: today's contribution is the common case.
  const [initialValues] = useState<IncomeFormValues>(() =>
    memberPaymentFormValues(member, businessDateToday()),
  );
  const [values, setValues] = useState<IncomeFormValues>(initialValues);
  const [fieldErrors, setFieldErrors] = useState<IncomeFieldErrors>({});
  const [confirmation, setConfirmation] = useState<string | null>(null);
  // One key per submission intent, created lazily on the first submit and reused by every retry
  // of that intent, so a double submit or a retry is recognised by the API as one payment.
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [createdId, setCreatedId] = useState<string | null>(null);

  // `REQ-RESP-008`/`REQ-RESP-009`: warn before a navigation or sign-out discards a typed amount.
  useUnsavedWork(JSON.stringify(values) !== JSON.stringify(initialValues));

  const creditedMonth = creditedMonthLabel(values.businessDate);

  function update<K extends keyof IncomeFormValues>(key: K, value: IncomeFormValues[K]): void {
    setValues((previous) => ({ ...previous, [key]: value }));
    setFieldErrors((previous) => {
      if (previous[key] === undefined) {
        return previous;
      }

      // Retyping clears the complaint about the very field being corrected. Leaving a stale
      // message after a fix reads as "still invalid".
      const rest = { ...previous };
      delete rest[key];

      return rest;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    // Duplicate-submission protection: the button is disabled, and this guards the keyboard and
    // programmatic paths that bypass a disabled attribute.
    if (create.isPending) {
      return;
    }

    const localErrors = validateIncomeFields(values);

    if (hasIncomeFieldErrors(localErrors)) {
      setFieldErrors(localErrors);
      setConfirmation(null);

      return;
    }

    setFieldErrors({});
    setConfirmation(null);
    const key = idempotencyKey === '' ? createIdempotencyKey() : idempotencyKey;

    if (idempotencyKey === '') {
      setIdempotencyKey(key);
    }

    create.mutate(
      { values, idempotencyKey: key },
      {
        onSuccess: (created) => {
          // A new submission is a new intent, so the next one gets a new key. Keeping the old key
          // would make the API replay the *previous* payment's response.
          setIdempotencyKey(createIdempotencyKey());
          setCreatedId(created.id);
          setValues(memberPaymentFormValues(member, businessDateToday()));
          setConfirmation(
            `${formatInr(created.amount)} was recorded for ${member.name} as ${created.referenceId}, credited to ${creditedMonthLabel(created.businessDate) ?? 'the business date you entered'}.`,
          );
        },
        onError: (error) => {
          setFieldErrors(incomeFieldErrorsFrom(error));
        },
      },
    );
  }

  const failure = create.isError ? describeTransactionFailure(create.error) : undefined;

  return (
    <Panel title="Record payment">
      <form
        id={PAYMENT_FORM_ID}
        noValidate
        aria-busy={create.isPending}
        className="space-y-4"
        onSubmit={(event) => {
          handleSubmit(event);
        }}
      >
        <div className="space-y-2">
          <p className="text-supporting font-semibold text-text-primary">
            {`This payment is recorded as ${INCOME_TYPE_LABELS[MEMBER_PAYMENT_INCOME_TYPE].toLowerCase()}`}
          </p>
          <p className="text-supporting text-text-secondary">
            The reference is allocated automatically and never changes. Submitting twice records one
            payment, not two.
          </p>
        </div>

        <LockedMemberSummary
          lockedMember={member}
          label="Paying"
          note="The member is fixed by where this payment was started, so it cannot be changed here."
        />

        {/* The credited month is stated, and derived from the same function the request uses, so
            the month the Admin reads is the month the API will credit. It follows the business
            date: a contribution for last month entered today is credited to last month. */}
        <p className="text-supporting text-text-secondary" data-testid="credited-month">
          {creditedMonth === undefined
            ? 'Enter a business date to see the month this payment is credited to.'
            : `Credited to the ${creditedMonth} contribution period.`}
        </p>

        <IncomeFields
          values={values}
          fieldErrors={fieldErrors}
          onChange={update}
          canChooseIncomeType={false}
        />

        {origin === 'member-created' ? (
          <Banner tone="info">
            {`${member.name} was added to the member list. Recording this payment now keeps the member record and the contribution as two separate entries.`}
          </Banner>
        ) : null}

        {confirmation === null ? null : (
          <Banner tone="success">
            {confirmation}
            {createdId === null ? null : (
              <>
                {' '}
                <Link to={`/income/${createdId}`} className="font-semibold text-blue-700 underline">
                  Open the payment record
                </Link>
              </>
            )}
          </Banner>
        )}
        {failure?.errorMessage === undefined ? null : (
          <Banner tone="danger">{failure.errorMessage}</Banner>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={create.isPending} className={PRIMARY_BUTTON_CLASS}>
            {create.isPending ? 'Recording payment…' : 'Record payment'}
          </button>
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            disabled={create.isPending}
            onClick={() => {
              setValues(initialValues);
              setFieldErrors({});
              setConfirmation(null);
              setIdempotencyKey(createIdempotencyKey());
              create.reset();
              onDismiss();
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    </Panel>
  );
}
