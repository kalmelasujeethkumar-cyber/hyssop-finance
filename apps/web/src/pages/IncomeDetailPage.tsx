import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  INCOME_TYPE_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  VOID_REASON_MAX_LENGTH,
  isPaymentMethod,
  type AuditSnapshot,
  type AuditSnapshotValue,
  type IncomeType,
  type PaymentMethod,
  type TransactionSummary,
} from '@hyssop/contracts';
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
  createIdempotencyKey,
  describeTransactionFailure,
  fieldIssuesByName,
  useCorrectTransaction,
  useTransactionAudit,
  useTransactionDetail,
  useVoidTransaction,
  validateCorrectionFields,
  validateVoidReason,
  type CorrectionFieldErrors,
  type CorrectionFormValues,
} from '../features/transactions/transaction-api';
import {
  formatBusinessDate,
  formatInr,
  formatIstTimestamp,
  formatMonthYear,
  formatPaiseAsInr,
} from '../lib/money';
import { useUnsavedWork } from '../app/providers/UnsavedWorkProvider';

/**
 * One income record: its stored values, the audited correction, the reason-required void, the
 * generated receipt, and the full audit trail.
 *
 * Authority: `docs/phases/PHASE-05-INCOME.md` and `docs/01-REQUIREMENTS.md`
 * `REQ-FIN-015` to `REQ-FIN-020` (edit preserves history, delete means a reason-required void),
 * `REQ-DOC-010` to `REQ-DOC-014` (a generated receipt), and `docs/03-UI-UX-RULES.md`
 * (state honesty: the status and contribution status shown are the ones the API derived, and
 * this screen offers no control that does not work).
 *
 * Nothing here computes a financial figure. Every amount is rendered exactly as the API
 * returned it, and no "balance" is derived in the browser. A voided record keeps its own
 * screen, its receipt, and its history: `REQ-FIN-016` makes voiding a state change rather than
 * a deletion, so nothing here disappears when income is voided and the controls that would
 * change the record are withdrawn instead.
 */

export function IncomeDetailPage() {
  const { transactionId } = useParams<{ transactionId: string }>();
  const detail = useTransactionDetail(transactionId);
  // The confirmation of a successful write lives here rather than inside the edit or void
  // form. Both forms collapse when they succeed, so a confirmation owned by the form would be
  // unmounted at the exact moment it was needed and the Admin would never be told the write
  // worked.
  const [confirmation, setConfirmation] = useState<string | null>(null);

  if (detail.isPending) {
    return <LoadingBlock label="Loading income record…" />;
  }

  if (detail.isError) {
    const failure = describeTransactionFailure(detail.error);

    return (
      <div className="space-y-4">
        <PageHeader
          title="Income"
          description="The income record could not be loaded."
          action={<BackToIncomeLink />}
        />
        <Banner tone="danger">{failure.errorMessage}</Banner>
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS}
          onClick={() => {
            void detail.refetch();
          }}
        >
          Try loading the record again
        </button>
      </div>
    );
  }

  const record = detail.data;

  if (record === undefined) {
    return null;
  }

  if (record.type !== 'INCOME') {
    // The route is under the income section, so an expense reference here is a wrong link
    // rather than a missing record. Saying so is more honest than rendering an income screen
    // for an expense and leaving the Admin to guess why the fields do not fit.
    return (
      <div className="space-y-4">
        <PageHeader
          title="Income"
          description="This record is not an income record."
          action={<BackToIncomeLink />}
        />
        <Banner tone="warning">
          {record.referenceId} is an expense, not income. Open it from the Expenses section.
        </Banner>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${formatInr(record.amount)} received`}
        description={`Income ${record.referenceId}. Every value below is the stored record, not an estimate.`}
        action={<BackToIncomeLink />}
      />

      {confirmation === null ? null : <Banner tone="success">{confirmation}</Banner>}

      <IncomeSummaryPanel record={record} />

      {record.status === 'VOIDED' ? (
        <Banner tone="warning">
          This record was voided on {formatIstTimestamp(record.voidedAt ?? '')}. It is kept for
          audit and is no longer counted in any total. Reason: {record.voidReason ?? '—'}
        </Banner>
      ) : null}

      <EditIncomeForm record={record} onSaved={setConfirmation} />
      <VoidIncomeForm record={record} onVoided={setConfirmation} />
      <IncomeReceipt record={record} />
      <IncomeAuditTrail transactionId={record.id} />
    </div>
  );
}

function BackToIncomeLink() {
  return (
    <Link
      to="/income"
      className="inline-block rounded-md border border-border-strong bg-surface px-4 py-2 text-supporting font-semibold text-text-primary hover:bg-surface-subtle"
    >
      Back to all income
    </Link>
  );
}

/** The stored values, presented as a definition list so each is labelled and readable. */
function IncomeSummaryPanel({ record }: { readonly record: TransactionSummary }) {
  const member = record.member;
  const period = record.contributionPeriod;

  return (
    <Panel title="Recorded details">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Income reference" value={record.referenceId} />
        <Detail
          label="Income type"
          value={record.incomeType === null ? '—' : INCOME_TYPE_LABELS[record.incomeType]}
        />
        <Detail label="Amount" value={formatInr(record.amount)} emphasis />
        <Detail label="Business date" value={formatBusinessDate(record.businessDate)} />
        <Detail label="Payment method" value={PAYMENT_METHOD_LABELS[record.paymentMethod]} />
        <Detail
          label="Member"
          value={member === null ? 'No member recorded' : `${member.name} (${member.referenceId})`}
        />
        {period === null ? null : (
          <Detail label="Contribution month" value={formatMonthYear(period.year, period.month)} />
        )}
        <Detail label="Description" value={record.description ?? '—'} />
        <Detail label="Notes" value={record.notes ?? '—'} />
        <Detail label="Recorded on" value={formatIstTimestamp(record.createdAt)} />
        <Detail label="Last changed" value={formatIstTimestamp(record.updatedAt)} />
        <Detail label="Revision" value={`${record.revision}`} />
        <Detail
          label="Status"
          value={
            record.status === 'ACTIVE'
              ? 'Active — counted in totals'
              : 'Voided — not counted in totals'
          }
        />
      </dl>

      {member === null || period === null ? null : (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border-default pt-4">
          <span className="text-supporting text-text-secondary">
            This contribution counts toward {member.name}'s{' '}
            {formatMonthYear(period.year, period.month)} monthly target. Whether that month is now
            paid, partly paid, or unpaid is derived from the ledger and shown on the member's
            record.
          </span>
          <Link
            to={`/members/${member.id}`}
            className="text-supporting font-semibold text-blue-700 underline"
          >
            Open member
          </Link>
        </div>
      )}
    </Panel>
  );
}

function Detail({
  label,
  value,
  emphasis = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly emphasis?: boolean | undefined;
}) {
  return (
    <div>
      <dt className="text-supporting text-text-secondary">{label}</dt>
      <dd
        className={`mt-0.5 break-words text-supporting ${
          emphasis ? 'font-bold text-text-primary' : 'text-text-primary'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The audited correction.
 *
 * The revision the record was loaded with is sent as `If-Match` and is never an editable
 * field, so a correction made against a stale view is rejected by the API rather than silently
 * overwriting someone else's change. The form reports that rejection as "this record changed,
 * reload and re-enter the edit", because a `409` is a conflict, not a failed save.
 *
 * The income type and the amount are not both freely editable here in a way that could break
 * the invariants: the type is fixed once recorded (it is the fact *what kind* of income this
 * was) and the amount, method, date, description, and notes are corrected.
 */
function EditIncomeForm({
  record,
  onSaved,
}: {
  readonly record: TransactionSummary;
  readonly onSaved: (message: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);

  if (record.status === 'VOIDED') {
    // A voided record is not edited. Withdrawing the control is the honest expression of that;
    // a disabled button invites the question of why it cannot be used.
    return null;
  }

  if (!isEditing) {
    return (
      <Panel
        title="Correct this record"
        action={
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            aria-expanded={false}
            aria-controls="edit-income-form"
            onClick={() => {
              setIsEditing(true);
            }}
          >
            Edit amount or details
          </button>
        }
      >
        <p className="text-supporting text-text-secondary">
          A correction keeps the record and its history. It does not delete anything, and the
          previous values stay visible in the audit trail below.
        </p>
      </Panel>
    );
  }

  return <CorrectionForm record={record} onSaved={onSaved} onCancel={() => setIsEditing(false)} />;
}

function CorrectionForm({
  record,
  onSaved,
  onCancel,
}: {
  readonly record: TransactionSummary;
  readonly onSaved: (message: string) => void;
  readonly onCancel: () => void;
}) {
  const [baseline, setBaseline] = useState<CorrectionFormValues>({
    amount: record.amount,
    paymentMethod: record.paymentMethod,
    businessDate: record.businessDate,
    description: record.description ?? '',
    notes: record.notes ?? '',
  });
  const [values, setValues] = useState<CorrectionFormValues>(baseline);
  const [fieldErrors, setFieldErrors] = useState<CorrectionFieldErrors>({});
  // One key per correction intent: reused by a retry of the same intent and replaced after a
  // success, so a double submit cannot record two corrections.
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => createIdempotencyKey());
  const correct = useCorrectTransaction(record.id, idempotencyKey);

  // A correction that has not been saved is unsaved work; saving moves the baseline forward so a
  // completed write is not mistaken for unfinished editing (`REQ-RESP-008`).
  useUnsavedWork(JSON.stringify(values) !== JSON.stringify(baseline));

  function update<K extends keyof CorrectionFormValues>(
    key: K,
    value: CorrectionFormValues[K],
  ): void {
    setValues((previous) => ({ ...previous, [key]: value }));
    setFieldErrors((previous) => {
      if (previous[key] === undefined) {
        return previous;
      }

      const rest = { ...previous };
      delete rest[key];

      return rest;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (correct.isPending) {
      return;
    }

    const localErrors = validateCorrectionFields(values);

    if (
      localErrors.amount !== undefined ||
      localErrors.paymentMethod !== undefined ||
      localErrors.businessDate !== undefined
    ) {
      setFieldErrors(localErrors);

      return;
    }

    setFieldErrors({});
    correct.mutate(
      { ...values, revision: record.revision },
      {
        onSuccess: (updated) => {
          setBaseline(values);
          setIdempotencyKey(createIdempotencyKey());
          onSaved(`Correction saved. ${updated.referenceId} is now ${formatInr(updated.amount)}.`);
        },
        onError: (error) => {
          setFieldErrors(toCorrectionFieldErrors(error));
        },
      },
    );
  }

  const failure = correct.isError ? describeTransactionFailure(correct.error) : undefined;

  return (
    <Panel title="Correct this record">
      <form
        id="edit-income-form"
        noValidate
        aria-busy={correct.isPending}
        className="space-y-4"
        onSubmit={(event) => {
          handleSubmit(event);
        }}
      >
        <p className="text-supporting text-text-secondary">
          You are editing revision {record.revision} of {record.referenceId}. If someone else saves
          a change first, your save is refused rather than overwriting theirs.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="edit-income-amount" label="Amount" required error={fieldErrors.amount}>
            <input
              id="edit-income-amount"
              name="amount"
              type="text"
              inputMode="decimal"
              required
              value={values.amount}
              onChange={(event) => {
                update('amount', event.target.value);
              }}
              className={controlClassName()}
            />
          </FormField>

          <FormField
            id="edit-income-method"
            label="Payment method"
            required
            error={fieldErrors.paymentMethod}
          >
            <select
              id="edit-income-method"
              name="paymentMethod"
              className={controlClassName()}
              value={values.paymentMethod}
              onChange={(event) => {
                const value = event.target.value;

                if (isPaymentMethod(value)) {
                  update('paymentMethod', value);
                }
              }}
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {PAYMENT_METHOD_LABELS[method]}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            id="edit-income-date"
            label="Business date"
            required
            error={fieldErrors.businessDate}
          >
            <input
              id="edit-income-date"
              name="businessDate"
              type="date"
              required
              value={values.businessDate}
              onChange={(event) => {
                update('businessDate', event.target.value);
              }}
              className={controlClassName()}
            />
          </FormField>

          <FormField
            id="edit-income-description"
            label="Description"
            optional
            error={fieldErrors.description}
          >
            <input
              id="edit-income-description"
              name="description"
              type="text"
              maxLength={200}
              value={values.description}
              onChange={(event) => {
                update('description', event.target.value);
              }}
              className={controlClassName()}
            />
          </FormField>
        </div>

        <FormField id="edit-income-notes" label="Notes" optional error={fieldErrors.notes}>
          <textarea
            id="edit-income-notes"
            name="notes"
            rows={3}
            maxLength={2000}
            value={values.notes}
            onChange={(event) => {
              update('notes', event.target.value);
            }}
            className={controlClassName()}
          />
        </FormField>

        {failure?.conflict === true ? (
          <Banner tone="warning">
            {record.referenceId} was changed by someone else while this form was open, so your
            correction was not saved. Reload the record, check the current values, and re-enter your
            correction.
          </Banner>
        ) : null}
        {failure?.errorMessage === undefined ? null : (
          <Banner tone="danger">{failure.errorMessage}</Banner>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={correct.isPending} className={PRIMARY_BUTTON_CLASS}>
            {correct.isPending ? 'Saving correction…' : 'Save correction'}
          </button>
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            disabled={correct.isPending}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </form>
    </Panel>
  );
}

/**
 * The reason-required void.
 *
 * `REQ-FIN-017` requires a reason and `REQ-FIN-019` requires the record and its history to
 * survive. The wording says both plainly, because a control labelled only "Delete" would
 * describe something this application never does.
 */
function VoidIncomeForm({
  record,
  onVoided,
}: {
  readonly record: TransactionSummary;
  readonly onVoided: (message: string) => void;
}) {
  const [isVoiding, setIsVoiding] = useState(false);

  if (record.status === 'VOIDED') {
    return null;
  }

  if (!isVoiding) {
    return (
      <Panel
        title="Void this record"
        action={
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            aria-expanded={false}
            aria-controls="void-income-form"
            onClick={() => {
              setIsVoiding(true);
            }}
          >
            Void this income
          </button>
        }
      >
        <p className="text-supporting text-text-secondary">
          Voiding keeps {record.referenceId} and its full history. It stops counting toward totals
          and the receipt is marked voided. Nothing is erased.
        </p>
      </Panel>
    );
  }

  return <VoidForm record={record} onVoided={onVoided} onCancel={() => setIsVoiding(false)} />;
}

function VoidForm({
  record,
  onVoided,
  onCancel,
}: {
  readonly record: TransactionSummary;
  readonly onVoided: (message: string) => void;
  readonly onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => createIdempotencyKey());
  const voidTransaction = useVoidTransaction(record.id, idempotencyKey);

  // A typed void reason is unsaved work; leaving before saving it would lose the justification.
  useUnsavedWork(reason.trim() !== '');

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (voidTransaction.isPending) {
      return;
    }

    const localError = validateVoidReason(reason);

    if (localError !== undefined) {
      setReasonError(localError);

      return;
    }

    setReasonError(undefined);
    voidTransaction.mutate(reason, {
      onSuccess: (voided) => {
        setIdempotencyKey(createIdempotencyKey());
        onVoided(
          `${voided.referenceId} was voided. It is kept in the records and no longer counts toward any total.`,
        );
      },
    });
  }

  const failure = voidTransaction.isError
    ? describeTransactionFailure(voidTransaction.error)
    : undefined;

  return (
    <Panel title="Void this record">
      <form
        id="void-income-form"
        noValidate
        aria-busy={voidTransaction.isPending}
        className="space-y-4"
        onSubmit={(event) => {
          handleSubmit(event);
        }}
      >
        <Banner tone="warning">
          This does not delete anything. {record.referenceId} stays in the income list and in the
          audit trail, marked voided, and is excluded from every total.
        </Banner>

        <FormField
          id="void-income-reason"
          label="Reason for voiding"
          required
          error={reasonError}
          hint="For example recorded against the wrong member, or a duplicate entry."
        >
          <textarea
            id="void-income-reason"
            name="reason"
            rows={3}
            required
            maxLength={VOID_REASON_MAX_LENGTH}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setReasonError(undefined);
            }}
            className={controlClassName()}
          />
        </FormField>

        {failure?.errorMessage === undefined ? null : (
          <Banner tone="danger">{failure.errorMessage}</Banner>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={voidTransaction.isPending}
            className="rounded-md bg-danger-700 px-4 py-2 text-supporting font-semibold text-text-inverse hover:bg-danger-800 disabled:bg-border-strong"
          >
            {voidTransaction.isPending ? 'Voiding…' : 'Void this income'}
          </button>
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            disabled={voidTransaction.isPending}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </form>
    </Panel>
  );
}

/**
 * The generated receipt.
 *
 * `REQ-DOC-010` to `REQ-DOC-014` require a receipt generated from the persisted record, and a
 * voided receipt is still produced and marked voided rather than withheld. A voided income
 * still has a receipt: hiding it would imply the record never happened.
 */
function IncomeReceipt({ record }: { readonly record: TransactionSummary }) {
  return (
    <Panel
      title="Receipt"
      action={
        <Link
          to={`/transactions/${record.id}/receipt`}
          className="rounded-md border border-border-strong bg-surface px-4 py-2 text-supporting font-semibold text-blue-700 hover:bg-surface-subtle"
        >
          Open receipt
        </Link>
      }
    >
      <p className="text-supporting text-text-secondary">
        The receipt is generated from the stored record each time it is opened, so a corrected
        amount is reflected immediately and no stale copy is printed.
      </p>
    </Panel>
  );
}

/** The full history of the record, oldest first, from the real audit endpoint. */
function IncomeAuditTrail({ transactionId }: { readonly transactionId: string }) {
  const audit = useTransactionAudit(transactionId);

  return (
    <Panel title="History">
      {audit.isPending ? <LoadingBlock label="Loading history…" /> : null}
      {audit.isError ? (
        <Banner tone="danger">
          The history could not be loaded. {describeTransactionFailure(audit.error).errorMessage}
        </Banner>
      ) : null}
      {audit.isSuccess && audit.data.length === 0 ? (
        <p className="text-supporting text-text-secondary">
          No history has been recorded for this transaction yet.
        </p>
      ) : null}
      {audit.isSuccess && audit.data.length > 0 ? (
        <ol className="space-y-3">
          {audit.data.map((event) => (
            <li
              key={event.id}
              className="rounded-lg border border-border-default bg-surface-subtle p-4"
            >
              <p className="text-supporting font-semibold text-text-primary">{event.action}</p>
              <p className="text-supporting text-text-secondary">
                {formatIstTimestamp(event.occurredAt)}
                {event.actorDisplayName === null ? '' : ` · by ${event.actorDisplayName}`}
              </p>
              {event.reason === null ? null : (
                <p className="text-supporting text-text-primary">Reason: {event.reason}</p>
              )}
              {event.before === null && event.after === null ? null : (
                <p className="text-supporting text-text-secondary">
                  {describeChange(event.before, event.after)}
                </p>
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </Panel>
  );
}

/**
 * Summarises an audit event's before/after snapshots in one line.
 *
 * Only the fields that actually changed are named. Listing every field of every snapshot would
 * bury the one value the Admin needs to check, which is the previous amount on a correction.
 *
 * Each value is rendered through the field's own formatter rather than printed raw. The snapshot
 * is what the database row held, so `amountPaise` is a paise integer, `businessDate` is a plain
 * `YYYY-MM-DD`, and `occurredAt` is an ISO instant. Printing those directly would put
 * `amountPaise 80000 -> 95025` and `occurredAt 2026-09-28T00:00:00.000Z` in front of the Admin,
 * which `docs/03-UI-UX-RULES.md` forbids twice over: raw paise must not be shown as a financial
 * value, and a raw ISO timestamp must not be shown as a date.
 */
function describeChange(before: AuditSnapshot | null, after: AuditSnapshot | null): string {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  const changed = keys.filter((key) => (before ?? {})[key] !== (after ?? {})[key]);

  if (changed.length === 0) {
    return 'No recorded field values changed.';
  }

  return `Changed: ${changed
    .map(
      (key) =>
        `${AUDIT_FIELD_LABELS[key] ?? key} ${describeAuditValue(key, (before ?? {})[key])} → ${describeAuditValue(key, (after ?? {})[key])}`,
    )
    .join('; ')}`;
}

/**
 * How each snapshot field is named for the Admin, and which ones are not shown.
 *
 * The internal identifiers are listed as hidden rather than as blank, because a line that says
 * `memberId empty -> 6d1f9c2b...` teaches nothing about the change that was made and invites the
 * reader to believe a raw database key is something they should act on. `revision` is omitted for
 * the same reason: it is a concurrency token, and the screen already states the revision the
 * correction was made against.
 */
const AUDIT_FIELD_LABELS: Readonly<Record<string, string>> = {
  referenceId: 'reference',
  transactionType: 'type',
  amountPaise: 'amount',
  paymentMethod: 'payment method',
  status: 'status',
  businessDate: 'business date',
  occurredAt: 'recorded on',
  description: 'description',
  notes: 'notes',
  incomeType: 'income type',
  memberId: 'member',
  categoryId: 'category',
  contributionPeriodId: 'contribution month',
  voidReason: 'void reason',
};

const AUDIT_HIDDEN_FIELDS: readonly string[] = ['memberId', 'categoryId', 'contributionPeriodId'];

/** One snapshot value, formatted for the field it belongs to. */
function describeAuditValue(field: string, value: AuditSnapshotValue | undefined): string {
  if (value === null || value === undefined || value === '') {
    return 'empty';
  }

  if (AUDIT_HIDDEN_FIELDS.includes(field)) {
    // The change is still reported, so hiding the identifier does not hide that it happened.
    return value === '' ? 'empty' : 'set';
  }

  if (field === 'amountPaise' && typeof value === 'string') {
    return formatPaiseAsInr(value);
  }

  if (field === 'businessDate' && typeof value === 'string') {
    return formatBusinessDate(value);
  }

  if (field === 'occurredAt' && typeof value === 'string') {
    return formatIstTimestamp(value);
  }

  if (field === 'paymentMethod' && typeof value === 'string') {
    return PAYMENT_METHOD_LABELS[value as PaymentMethod] ?? value;
  }

  if (field === 'incomeType' && typeof value === 'string') {
    return INCOME_TYPE_LABELS[value as IncomeType] ?? value;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value.toString();
  }

  // Unreachable for a snapshot the API produces, which is flat by contract. Handled rather
  // than asserted so a future non-flat snapshot is reported as unknown instead of rendering
  // `[object Object]` in an audit line.
  return 'a value this page cannot display';
}

/** Maps a server-side validation failure onto the correction form's field names. */
function toCorrectionFieldErrors(error: unknown): CorrectionFieldErrors {
  const issues = fieldIssuesByName(error);
  const errors: {
    amount?: string;
    paymentMethod?: string;
    businessDate?: string;
    description?: string;
    notes?: string;
  } = {};

  for (const field of [
    'amount',
    'paymentMethod',
    'businessDate',
    'description',
    'notes',
  ] as const) {
    const message = issues[field];

    if (message !== undefined) {
      errors[field] = message;
    }
  }

  return errors;
}
