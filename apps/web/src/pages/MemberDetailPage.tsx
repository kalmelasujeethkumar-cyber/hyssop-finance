import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ContributionPeriodView, MemberDetail } from '@hyssop/contracts';
import {
  Banner,
  ContributionStatusBadge,
  EmptyState,
  FormField,
  LoadingBlock,
  PageHeader,
  Panel,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  controlClassName,
} from '../components/ui';
import {
  describeMemberFailure,
  fieldIssuesOf,
  hasFieldErrors,
  MAX_PERIOD_YEAR,
  MIN_PERIOD_YEAR,
  parseExpectedAmount,
  parsePeriodYear,
  useMemberDetail,
  useSetContributionPeriod,
  useUpdateMember,
  validateMemberFields,
  type MemberFieldErrors,
  type MemberFormValues,
} from '../features/members/member-api';
import { useUnsavedWork } from '../app/providers/UnsavedWorkProvider';
import { RecordMemberPaymentForm } from '../features/income/RecordMemberPaymentForm';
import { formatBusinessDate, formatInr, formatIstTimestamp, formatMonthYear } from '../lib/money';

/**
 * One member: identity, the audited edit, monthly contribution expectations, and the
 * derived status and history that go with them.
 *
 * Authority: `docs/phases/PHASE-04-MEMBERS.md` (edit with the revision optimistic lock,
 * periods with an expected amount, derived PAID / PARTIALLY PAID / NOT PAID status, member
 * detail and history shells backed by real API data) and `docs/03-UI-UX-RULES.md` (state
 * honesty: the status shown is the one the API derived, and this screen offers no control
 * that does not work).
 *
 * Nothing here computes a financial figure. `expected`, `received`, and `remaining` are all
 * rendered exactly as the API returned them, and the status badge renders the status the
 * API derived from active transactions, because `REQ-CONTRIB-003` makes the ledger the
 * single source of truth. Writing a transaction is Phase 05 work, so the history below is
 * a read-only projection and deliberately offers no void or edit control.
 */
export function MemberDetailPage() {
  const { memberId } = useParams<{ memberId: string }>();
  const detail = useMemberDetail(memberId);
  // The confirmation of a saved edit lives here, on the screen, rather than inside the edit
  // form. A successful edit closes the form, so a confirmation owned by the form would be
  // unmounted at the exact moment it was needed and the Admin would never be told the save
  // worked. `docs/03-UI-UX-RULES.md` requires the outcome of an action to be stated, and it
  // cannot be stated by a component that no longer exists.
  const [confirmation, setConfirmation] = useState<string | null>(null);
  // The payment panel lives on this screen rather than behind a jump to the income screen,
  // because the two facts an Admin needs to record a contribution — who is paying and how much —
  // are both already here. Making them re-find the member in a list is the step that stopped
  // contributions being recorded at all.
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);

  if (detail.isPending) {
    return <LoadingBlock label="Loading member…" />;
  }

  if (detail.isError) {
    const failure = describeMemberFailure(detail.error);

    return (
      <div className="space-y-4">
        <PageHeader
          title="Member"
          description="The member could not be loaded."
          action={<BackToMembersLink />}
        />
        <Banner tone="danger">{failure.errorMessage}</Banner>
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS}
          onClick={() => {
            void detail.refetch();
          }}
        >
          Try loading the member again
        </button>
      </div>
    );
  }

  const member = detail.data;

  if (member === undefined) {
    return null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={member.name}
        description={`Member ${member.referenceId}. The member ID is permanent and cannot be changed.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={isRecordingPayment ? SECONDARY_BUTTON_CLASS : PRIMARY_BUTTON_CLASS}
              aria-expanded={isRecordingPayment}
              aria-controls="record-member-payment-panel"
              onClick={() => {
                setIsRecordingPayment((previous) => !previous);
              }}
            >
              {isRecordingPayment ? 'Cancel recording payment' : 'Record payment'}
            </button>
            <BackToMembersLink />
          </div>
        }
      />

      {confirmation === null ? null : <Banner tone="success">{confirmation}</Banner>}

      <MemberIdentity member={member} />
      <EditMemberForm member={member} onSaved={setConfirmation} />
      <div id="record-member-payment-panel">
        {isRecordingPayment ? (
          <RecordMemberPaymentForm
            member={member}
            origin="member-detail"
            onDismiss={() => {
              setIsRecordingPayment(false);
            }}
          />
        ) : null}
      </div>
      <ContributionPeriods member={member} />
      <MemberHistory member={member} />
    </div>
  );
}

function BackToMembersLink() {
  return (
    <Link
      to="/members"
      className="inline-block rounded-md border border-border-strong bg-surface px-4 py-2 text-supporting font-semibold text-text-primary hover:bg-surface-subtle"
    >
      Back to all members
    </Link>
  );
}

function MemberIdentity({ member }: { readonly member: MemberDetail }) {
  return (
    <Panel title="Member details">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Member ID" value={member.referenceId} emphasis />
        <Field label="Full name" value={member.name} />
        <Field label="Phone number" value={member.phone ?? 'Not recorded'} />
        <Field label="Added" value={formatBusinessDate(member.createdAt.slice(0, 10))} />
        <Field label="Last changed" value={formatIstTimestamp(member.updatedAt)} />
        <Field
          label="Notes"
          value={member.notes === null || member.notes === '' ? 'None recorded' : member.notes}
        />
      </dl>
    </Panel>
  );
}

function Field({
  label,
  value,
  emphasis,
}: {
  readonly label: string;
  readonly value: string;
  readonly emphasis?: boolean;
}) {
  return (
    <div className="space-y-1">
      <dt className="text-supporting text-text-secondary">{label}</dt>
      <dd
        className={`text-supporting ${emphasis === true ? 'font-semibold text-text-primary' : 'text-text-primary'}`}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The audited edit.
 *
 * `If-Match` carries `member.revision`, the value the API just returned, so the browser
 * cannot claim a revision it did not read. A `409` is presented as what it is — the record
 * changed underneath this form — and the only action offered is to reload, because
 * resubmitting the stale form would be the one thing guaranteed to overwrite the other
 * edit. `docs/03-UI-UX-RULES.md` also requires unsaved work to be protected, so a dirty
 * form warns before navigating away or reloading.
 */
function EditMemberForm({
  member,
  onSaved,
}: {
  readonly member: MemberDetail;
  readonly onSaved: (message: string) => void;
}) {
  const update = useUpdateMember(member.id);
  const [values, setValues] = useState<MemberFormValues>(toFormValues(member));
  const [fieldErrors, setFieldErrors] = useState<MemberFieldErrors>({});
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);

  // The form follows the member it is showing. A successful edit returns a new revision,
  // and re-seeding from it is what makes the *next* edit send a current `If-Match`; without
  // this the form would immediately resubmit the revision that has just been superseded and
  // conflict with itself.
  useEffect(() => {
    setValues(toFormValues(member));
  }, [member]);

  const isDirty = JSON.stringify(values) !== JSON.stringify(toFormValues(member));
  // The in-page discard warning only covers the editor toggle and Cancel; this registers the same
  // edit with the shell so leaving the route or signing out is warned about too (`REQ-RESP-008`).
  useUnsavedWork(isDirty);
  const failure = update.isError ? describeMemberFailure(update.error) : undefined;
  const hasConflict = failure?.conflict === true;

  function closeEditor(): void {
    setValues(toFormValues(member));
    setFieldErrors({});
    setIsConfirmingDiscard(false);
    update.reset();
    setIsEditing(false);
  }

  function requestClose(): void {
    // `docs/03-UI-UX-RULES.md` requires a warning before unsaved work is lost. It is an
    // in-page confirmation rather than a native dialog so it is keyboard reachable, styled
    // like the rest of the screen, and drivable by an automated test.
    if (isDirty) {
      setIsConfirmingDiscard(true);

      return;
    }

    closeEditor();
  }

  function setField<K extends keyof MemberFormValues>(key: K, value: MemberFormValues[K]): void {
    setValues((previous) => ({ ...previous, [key]: value }));
    setFieldErrors((previous) => {
      if (previous[key] === undefined) {
        return previous;
      }

      // Retyping clears the complaint about the very field the Admin is correcting. Leaving a
      // stale message on screen after a fix reads as "still invalid" and invites them to
      // re-check a value that is now accepted.
      const rest = { ...previous };
      delete rest[key];

      return rest;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (update.isPending) {
      return;
    }

    const localErrors = validateMemberFields(values);

    if (hasFieldErrors(localErrors)) {
      setFieldErrors(localErrors);

      return;
    }

    setFieldErrors({});
    update.mutate(
      { ...values, revision: member.revision },
      {
        onSuccess: (updated) => {
          setValues(toFormValues(updated));
          setIsConfirmingDiscard(false);
          setIsEditing(false);
          onSaved(`${updated.name} was saved. The change was recorded in the audit history.`);
        },
        onError: (error) => {
          setFieldErrors(fieldIssuesOf(error));
        },
      },
    );
  }

  return (
    <Panel
      title="Edit member details"
      action={
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS}
          aria-expanded={isEditing}
          aria-controls="edit-member-form"
          onClick={() => {
            if (isEditing) {
              requestClose();

              return;
            }

            // Re-opening the editor clears the failure state, so a previous error is never
            // shown against values the Admin has not seen yet.
            update.reset();
            setFieldErrors({});
            setIsEditing(true);
          }}
        >
          {isEditing ? 'Close editing' : 'Edit member'}
        </button>
      }
    >
      {isEditing ? (
        <form
          id="edit-member-form"
          noValidate
          aria-busy={update.isPending}
          className="space-y-4"
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
        >
          <p className="text-supporting text-text-secondary">
            Changes are recorded with your Admin identity. The member ID cannot be edited.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="edit-member-name" label="Full name" required error={fieldErrors.name}>
              <input
                id="edit-member-name"
                name="name"
                type="text"
                autoComplete="name"
                required
                maxLength={120}
                value={values.name}
                onChange={(event) => {
                  setField('name', event.target.value);
                }}
                className={controlClassName()}
              />
            </FormField>

            <FormField
              id="edit-member-phone"
              label="Phone number"
              optional
              hint="Leave blank to remove the recorded number."
              error={fieldErrors.phone}
            >
              <input
                id="edit-member-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                maxLength={32}
                value={values.phone}
                onChange={(event) => {
                  setField('phone', event.target.value);
                }}
                className={controlClassName()}
              />
            </FormField>
          </div>

          <FormField id="edit-member-notes" label="Notes" optional error={fieldErrors.notes}>
            <textarea
              id="edit-member-notes"
              name="notes"
              rows={3}
              maxLength={2000}
              value={values.notes}
              onChange={(event) => {
                setField('notes', event.target.value);
              }}
              className={controlClassName()}
            />
          </FormField>

          {isConfirmingDiscard ? (
            <div className="space-y-3 rounded-lg border border-warning-700 bg-warning-100 p-4">
              <p role="alert" className="text-supporting font-semibold text-warning-700">
                You have unsaved changes to this member. Closing now will discard them.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={closeEditor}>
                  Discard the changes
                </button>
                <button
                  type="button"
                  className={SECONDARY_BUTTON_CLASS}
                  onClick={() => {
                    setIsConfirmingDiscard(false);
                  }}
                >
                  Keep editing
                </button>
              </div>
            </div>
          ) : null}

          {hasConflict ? (
            <Banner tone="warning">
              This member was changed by another action after you opened it, so your edit was not
              saved. Reload the member to see the current details, then make your change again.
            </Banner>
          ) : null}
          {failure?.errorMessage === undefined ? null : (
            <Banner tone="danger">{failure.errorMessage}</Banner>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={update.isPending} className={PRIMARY_BUTTON_CLASS}>
              {update.isPending ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASS}
              disabled={update.isPending}
              onClick={requestClose}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p className="text-supporting text-text-secondary">
          Use “Edit member” to change the name, phone number, or notes. Every change is audited with
          your Admin identity and the previous values.
        </p>
      )}
    </Panel>
  );
}

function toFormValues(member: {
  readonly name: string;
  readonly phone: string | null;
  readonly notes: string | null;
}): MemberFormValues {
  return {
    name: member.name,
    phone: member.phone ?? '',
    notes: member.notes ?? '',
  };
}

/**
 * Monthly contribution expectations and the derived status beside them.
 *
 * The status column is the point of this screen, so it is stated in words and never left to
 * colour. The expected amount is the only value a form here can change: received and
 * remaining are computed by the API from active transactions and are rendered as returned.
 */
function ContributionPeriods({ member }: { readonly member: MemberDetail }) {
  const periods = member.contributionPeriods;

  return (
    <Panel title="Monthly contributions">
      <div className="space-y-4">
        <SetPeriodForm member={member} />

        {periods.length === 0 ? (
          <EmptyState
            title="No contribution months configured"
            description="Set an expected amount above to open a month. Leave the amount blank to use the monthly amount the church configured as its default."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">
                Expected, received, and remaining contribution amounts by month
              </caption>
              <thead>
                <tr className="border-b border-border-default">
                  <th
                    scope="col"
                    className="px-3 py-2 text-supporting font-semibold text-text-primary"
                  >
                    Month
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-supporting font-semibold text-text-primary"
                  >
                    Expected
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-supporting font-semibold text-text-primary"
                  >
                    Received
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-supporting font-semibold text-text-primary"
                  >
                    Remaining
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-supporting font-semibold text-text-primary"
                  >
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => (
                  <tr key={period.id} className="border-b border-border-default last:border-0">
                    <th
                      scope="row"
                      className="px-3 py-2 text-left text-supporting font-semibold text-text-primary"
                    >
                      {formatMonthYear(period.year, period.month)}
                    </th>
                    <td className="px-3 py-2 text-supporting text-text-primary">
                      {formatInr(period.expectedPaise)}
                    </td>
                    <td className="px-3 py-2 text-supporting text-text-primary">
                      {formatInr(period.receivedPaise)}
                    </td>
                    <td className="px-3 py-2 text-supporting text-text-primary">
                      {formatInr(period.remainingPaise)}
                    </td>
                    <td className="px-3 py-2 text-supporting">
                      <ContributionStatusBadge status={period.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
}

/**
 * Opens or updates one member-month's expected amount.
 *
 * The write is idempotent by design, so submitting the same amount again is safe, and the
 * year and month are chosen from real controls rather than typed, so a period cannot be
 * written for a month that does not exist. The endpoint returns the recalculated row, and
 * the detail query is invalidated so the table above reflects the server's own arithmetic
 * rather than a locally predicted one.
 */
function SetPeriodForm({ member }: { readonly member: MemberDetail }) {
  const setPeriod = useSetContributionPeriod(member.id);
  const now = new Date();
  // The year is held as text so an intermediate edit — clearing the field, or replacing one
  // digit of a year the Admin mistyped — is a state the field can actually show. A
  // controlled number that rejects everything outside the accepted range would snap back
  // and make the year impossible to correct.
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState<string | undefined>(undefined);
  const [yearError, setYearError] = useState<string | undefined>(undefined);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  // The amount last written, so a saved expectation is not mistaken for unfinished work. An empty
  // field is never unsaved work.
  const [savedAmount, setSavedAmount] = useState<string | null>(null);

  useUnsavedWork(amount !== '' && amount !== savedAmount);

  const failure = setPeriod.isError ? describeMemberFailure(setPeriod.error) : undefined;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (setPeriod.isPending) {
      return;
    }

    const parsedYear = parsePeriodYear(year);

    if (typeof parsedYear === 'string') {
      setYearError(parsedYear);
      setConfirmation(null);

      return;
    }

    const parsed = parseExpectedAmount(amount);

    if (parsed.kind === 'invalid') {
      setYearError(undefined);
      setAmountError(parsed.message);
      setConfirmation(null);

      return;
    }

    setYearError(undefined);
    setAmountError(undefined);
    setConfirmation(null);
    setPeriod.mutate(
      {
        year: parsedYear,
        month,
        ...(parsed.kind === 'blank' ? {} : { expectedPaise: parsed.value }),
      },
      {
        onSuccess: (period: ContributionPeriodView) => {
          setSavedAmount(amount);
          setConfirmation(
            `${formatMonthYear(period.year, period.month)} is set to ${formatInr(period.expectedPaise)} per member. Received ${formatInr(period.receivedPaise)}; status ${statusWords(period)}.`,
          );
        },
      },
    );
  }

  return (
    <form
      noValidate
      aria-busy={setPeriod.isPending}
      className="space-y-4 rounded-lg border border-border-default bg-surface-subtle p-4"
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
    >
      <h3 className="text-supporting font-semibold text-text-primary">
        Set or change an expected monthly amount
      </h3>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id="period-month" label="Month">
          <select
            id="period-month"
            className={controlClassName()}
            value={month}
            onChange={(event) => {
              setMonth(Number(event.target.value));
            }}
          >
            {MONTH_NAMES.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField id="period-year" label="Year" error={yearError}>
          <input
            id="period-year"
            type="number"
            inputMode="numeric"
            min={MIN_PERIOD_YEAR}
            max={MAX_PERIOD_YEAR}
            value={year}
            onChange={(event) => {
              setYearError(undefined);
              setYear(event.target.value);
            }}
            className={controlClassName()}
          />
        </FormField>

        <FormField
          id="period-amount"
          label="Expected amount (₹)"
          optional
          hint="Leave blank to use the church's configured monthly default."
          error={amountError}
        >
          <input
            id="period-amount"
            type="text"
            inputMode="decimal"
            placeholder="For example 500"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setAmountError(undefined);
            }}
            className={controlClassName()}
          />
        </FormField>
      </div>

      {confirmation === null ? null : <Banner tone="success">{confirmation}</Banner>}
      {failure?.errorMessage === undefined ? null : (
        <Banner tone="danger">{failure.errorMessage}</Banner>
      )}

      <button type="submit" disabled={setPeriod.isPending} className={PRIMARY_BUTTON_CLASS}>
        {setPeriod.isPending ? 'Saving…' : 'Save expected amount'}
      </button>
    </form>
  );
}

const MONTH_NAMES = [
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

/** The status in words, for a sentence. The badge component is for the table cell. */
function statusWords(period: ContributionPeriodView): string {
  if (period.status === 'PAID') {
    return 'is paid in full';
  }

  return period.status === 'PARTIALLY PAID'
    ? `is partially paid, with ${formatInr(period.remainingPaise)} still due`
    : 'is not paid';
}

/**
 * The member's own contribution history.
 *
 * Read-only. `GET /members/:id/transactions` returns this projection, and Phase 05 owns
 * creating, editing, and voiding transactions, so offering such controls here would create
 * exactly the dead controls the UI rules forbid. A voided row is shown with its status
 * rather than hidden, so the Admin can see that a payment exists but is not counted, which
 * is why it is absent from the derived totals above.
 */
function MemberHistory({ member }: { readonly member: MemberDetail }) {
  const transactions = member.transactions;

  return (
    <Panel title="Contribution history">
      {transactions.length === 0 ? (
        <EmptyState
          title="No contribution payments recorded"
          description="Use “Record payment” above to record this member's contribution. Every payment recorded here appears below, and the month statuses above update from the ledger."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Contribution payments recorded against this member
            </caption>
            <thead>
              <tr className="border-b border-border-default">
                <th
                  scope="col"
                  className="px-3 py-2 text-supporting font-semibold text-text-primary"
                >
                  Transaction
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-supporting font-semibold text-text-primary"
                >
                  Date
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-supporting font-semibold text-text-primary"
                >
                  Method
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-supporting font-semibold text-text-primary"
                >
                  Amount
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-supporting font-semibold text-text-primary"
                >
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id} className="border-b border-border-default last:border-0">
                  <th
                    scope="row"
                    className="px-3 py-2 text-left text-supporting font-semibold text-text-primary"
                  >
                    {transaction.referenceId}
                  </th>
                  <td className="px-3 py-2 text-supporting text-text-primary">
                    {formatBusinessDate(transaction.businessDate)}
                  </td>
                  <td className="px-3 py-2 text-supporting text-text-secondary">
                    {readablePaymentMethod(transaction.paymentMethod)}
                  </td>
                  <td className="px-3 py-2 text-supporting text-text-primary">
                    {formatInr(transaction.amountPaise)}
                  </td>
                  <td className="px-3 py-2 text-supporting">
                    <TransactionStatusBadge status={transaction.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {transactions.some((transaction) => transaction.status === 'VOIDED') ? (
        <p className="mt-4 text-supporting text-text-secondary">
          A voided payment is kept for the audit record and is not counted in any received or
          remaining amount above.
        </p>
      ) : null}
    </Panel>
  );
}

/** The stored method is an enum token; the screen shows words rather than the raw value. */
function readablePaymentMethod(method: string): string {
  const words = method.replace(/_/g, ' ').toLowerCase();

  return words.charAt(0).toUpperCase() + words.slice(1);
}

function TransactionStatusBadge({ status }: { readonly status: 'ACTIVE' | 'VOIDED' }) {
  if (status === 'ACTIVE') {
    return (
      <span className="inline-block rounded-full border border-success-700 bg-success-100 px-2 py-0.5 text-supporting font-semibold text-success-700">
        Counted
      </span>
    );
  }

  return (
    <span className="inline-block rounded-full border border-border-strong bg-surface-subtle px-2 py-0.5 text-supporting font-semibold text-text-secondary">
      Voided, not counted
    </span>
  );
}
