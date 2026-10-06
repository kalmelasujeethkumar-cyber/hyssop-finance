import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  RECEIPT_MISSING_LABEL,
  VOID_REASON_MAX_LENGTH,
  isPaymentMethod,
  type ExpenseSummary,
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
import { TransactionDocumentsPanel } from '../features/documents/TransactionDocumentsPanel';
import {
  expenseCategoryLabel,
  expenseReasonLabel,
  isExpenseSummary,
  useExpenseCategories,
  useExpenseReasons,
} from '../features/expenses/expense-api';
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
import { formatBusinessDate, formatInr, formatIstTimestamp, formatPaiseAsInr } from '../lib/money';
import { useUnsavedWork } from '../app/providers/UnsavedWorkProvider';

/**
 * One expense record: its stored values, the audited correction, the reason-required void, the
 * receipt state, and the full audit trail.
 *
 * Authority: `docs/phases/PHASE-06-EXPENSES.md`, `docs/01-REQUIREMENTS.md`
 * `REQ-FIN-015` to `REQ-FIN-020` (edit preserves history, delete means a reason-required void),
 * `REQ-EXP-003` and `REQ-EXP-004` (category, retained on history), and `REQ-DOC-003` (an expense
 * without a receipt is shown as **Receipt Missing**, not as an empty control).
 *
 * Nothing here computes a financial figure. Every amount is rendered exactly as the API returned
 * it and no balance is derived in the browser. A voided expense keeps its own screen, its
 * category, and its history, because `REQ-FIN-016` makes voiding a state change rather than a
 * deletion; the controls that would change the record are withdrawn instead.
 *
 * The difference from the income record screen is deliberately narrow and is only these three
 * things: the category, the receipt state, and the fact that the correction may move the
 * category. Everything else is the same shared transaction behaviour, so a rule cannot be
 * implemented one way for income and another way for expenses.
 */

export function ExpenseDetailPage() {
  const { transactionId } = useParams<{ transactionId: string }>();
  const detail = useTransactionDetail(transactionId);
  const categories = useExpenseCategories();
  // The reason list is scoped to the record's own category, so it is fetched from the record and
  // not from whatever the correction form has selected. That keeps the label on the summary panel
  // correct even while the Admin is moving the expense somewhere else. `expenseReason` is `null`
  // on an income, which is why the category is only read for a record that has one.
  const reasons = useExpenseReasons(
    detail.data?.type === 'EXPENSE'
      ? (detail.data.expenseReason?.categoryId ?? undefined)
      : undefined,
  );
  // The confirmation of a successful write lives here rather than inside the edit or void form.
  // Both forms collapse when they succeed, so a confirmation owned by the form would be unmounted
  // at the exact moment it was needed and the Admin would never be told the write worked.
  const [confirmation, setConfirmation] = useState<string | null>(null);

  if (detail.isPending) {
    return <LoadingBlock label="Loading expense record…" />;
  }

  if (detail.isError) {
    const failure = describeTransactionFailure(detail.error);

    return (
      <div className="space-y-4">
        <PageHeader
          title="Expenses"
          description="The expense record could not be loaded."
          action={<BackToExpensesLink />}
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

  if (record.type !== 'EXPENSE' || !isExpenseSummary(record)) {
    // The route is under the expenses section, so an income reference here is a wrong link rather
    // than a missing record. Saying so is more honest than rendering an expense screen for an
    // income and leaving the Admin to guess why the category is missing. A record that claims to
    // be an expense but carries no category is refused for the same reason: `REQ-EXP-004` and
    // `REQ-DOC-003` would both be unanswerable, and rendering it anyway would be a guess.
    return (
      <div className="space-y-4">
        <PageHeader
          title="Expenses"
          description="This record cannot be shown as an expense."
          action={<BackToExpensesLink />}
        />
        <Banner tone="warning">
          {record.type === 'EXPENSE'
            ? `${record.referenceId} is marked as an expense but is missing its category or receipt state, so it cannot be displayed safely.`
            : `${record.referenceId} is income, not an expense. Open it from the Income section.`}
        </Banner>
      </div>
    );
  }

  const expense = record;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${formatInr(record.amount)} spent`}
        description={`Expense ${record.referenceId} under ${expense.category.name}. Every value below is the stored record, not an estimate.`}
        action={<BackToExpensesLink />}
      />

      {confirmation === null ? null : <Banner tone="success">{confirmation}</Banner>}

      <ExpenseSummaryPanel
        record={expense}
        categoryLabel={expenseCategoryLabel(categories.data ?? [], expense.category)}
        reasonLabel={expenseReasonLabel(reasons.data ?? [], expense.expenseReason)}
      />

      {record.status === 'VOIDED' ? (
        <Banner tone="warning">
          This expense was voided on {formatIstTimestamp(record.voidedAt ?? '')}. It is kept for
          audit and is no longer counted in any total. Reason: {record.voidReason ?? '—'}
        </Banner>
      ) : null}

      <EditExpenseForm record={expense} onSaved={setConfirmation} />
      <VoidExpenseForm record={record} onVoided={setConfirmation} />
      <ExpenseReceiptState record={expense} />
      <ExpenseAuditTrail transactionId={record.id} />
    </div>
  );
}

function BackToExpensesLink() {
  return (
    <Link
      to="/expenses"
      className="inline-block rounded-md border border-border-strong bg-surface px-4 py-2 text-supporting font-semibold text-text-primary hover:bg-surface-subtle"
    >
      Back to all expenses
    </Link>
  );
}

/**
 * The stored values, presented as a definition list so each is labelled and readable.
 *
 * The category shows its *current* status, not only its name. A category that has been
 * deactivated keeps the expenses filed under it, and the Admin needs to be able to tell "this
 * expense is in Repairs" from "this expense is in Repairs and Repairs can no longer be chosen",
 * because the second fact is the reason a new expense cannot be filed there.
 *
 * The reason gets the same treatment for the same reason (`REQ-EXP-005`): it is what the money
 * was actually spent on, and a retired reason still has to stay readable, because an expense that
 * silently lost its reason would no longer explain itself.
 */
function ExpenseSummaryPanel({
  record,
  categoryLabel,
  reasonLabel,
}: {
  readonly record: ExpenseSummary;
  readonly categoryLabel: string;
  readonly reasonLabel: string;
}) {
  return (
    <Panel title="Recorded details">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Expense reference" value={record.referenceId} />
        <Detail label="Category" value={categoryLabel} />
        <Detail label="Reason" value={reasonLabel} />
        <Detail label="Amount" value={formatInr(record.amount)} emphasis />
        <Detail label="Business date" value={formatBusinessDate(record.businessDate)} />
        <Detail label="Payment method" value={PAYMENT_METHOD_LABELS[record.paymentMethod]} />
        <Detail label="Receipt" value={record.hasReceipt ? 'Attached' : RECEIPT_MISSING_LABEL} />
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
 * The audited correction, including moving the expense to a different category.
 *
 * The revision the record was loaded with is sent as `If-Match` and is never an editable field, so
 * a correction made against a stale view is refused by the API rather than silently overwriting
 * someone else's change. A `409` is reported as "this record changed, reload and re-enter the
 * edit", because a conflict is not a failed save.
 *
 * The category is the one association `REQ-EXP-004` allows a correction to change, so the picker
 * is offered here. It is built from the *active* categories, which means an expense whose
 * category has since been deactivated shows that category as its current value with a note, and
 * the Admin must choose an active one to move to it. Submitting the inactive category is not
 * possible, because the API would refuse it and the control would be dead.
 */
function EditExpenseForm({
  record,
  onSaved,
}: {
  readonly record: ExpenseSummary;
  readonly onSaved: (message: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);

  if (record.status === 'VOIDED') {
    // A voided record is not edited. Withdrawing the control is the honest expression of that; a
    // disabled button invites the question of why it cannot be used.
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
            aria-controls="edit-expense-form"
            onClick={() => {
              setIsEditing(true);
            }}
          >
            Edit amount, category, or details
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
  readonly record: ExpenseSummary;
  readonly onSaved: (message: string) => void;
  readonly onCancel: () => void;
}) {
  const categories = useExpenseCategories();
  const activeCategories = categories.data ?? [];
  const [baseline, setBaseline] = useState<CorrectionFormValues>({
    amount: record.amount,
    paymentMethod: record.paymentMethod,
    businessDate: record.businessDate,
    description: record.description ?? '',
    notes: record.notes ?? '',
    // Seeded with the expense's own category and reason, so saving an unrelated field cannot
    // silently move the expense to whichever option happens to be first in the list.
    categoryId: record.category.id,
    expenseReasonId: record.expenseReason.id,
  });
  const [values, setValues] = useState<CorrectionFormValues>(baseline);
  // The reasons offered depend on the category currently selected in *this* form, so the query key
  // follows the selection. That is what makes moving an expense a single coherent choice: the
  // Admin picks a category and then a reason of that category, never a stale list from the old one.
  const reasons = useExpenseReasons(values.categoryId);
  const [fieldErrors, setFieldErrors] = useState<CorrectionFieldErrors>({});
  // One key per correction intent: reused by a retry of the same intent and replaced after a
  // success, so a double submit cannot record two corrections.
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => createIdempotencyKey());
  const correct = useCorrectTransaction(record.id, idempotencyKey);

  // A correction that has not been saved is unsaved work; saving moves the baseline forward so a
  // completed write is not mistaken for unfinished editing (`REQ-RESP-008`).
  useUnsavedWork(JSON.stringify(values) !== JSON.stringify(baseline));

  // A category that has been deactivated since this expense was recorded is not in the active
  // list. It is still the expense's real category and is still shown as a selected option with a
  // note, so the form is not quietly offering a value the API would reject as its "current"
  // category. The server decides whether a move is legal.
  const currentCategoryIsActive = activeCategories.some(
    (category) => category.id === record.category.id,
  );

  // The same applies to the reason. A retired reason stays visible as the current value so the form
  // does not appear to have changed the expense just by being opened.
  const activeReasons = reasons.data ?? [];
  const currentReasonIsAvailable = activeReasons.some(
    (reason) => reason.id === record.expenseReason.id,
  );

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
      localErrors.businessDate !== undefined ||
      localErrors.categoryId !== undefined ||
      localErrors.expenseReasonId !== undefined
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
          // A correction response is the shared transaction shape, so the moved category is only
          // readable after the same narrowing the detail screen uses. If the API ever answered
          // without it, the confirmation says nothing about the category rather than claiming a
          // move that cannot be verified.
          const corrected = isExpenseSummary(updated) ? updated : undefined;
          const movedTo =
            corrected === undefined || corrected.category.id === record.category.id
              ? ''
              : ` The category is now ${corrected.category.name}, under the reason ${corrected.expenseReason.name}.`;

          onSaved(
            `Correction saved. ${updated.referenceId} is now ${formatInr(updated.amount)}.${movedTo}`,
          );
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
        id="edit-expense-form"
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

        {categories.isError ? (
          <Banner tone="danger">
            The category list could not be loaded, so the category cannot be changed right now.
          </Banner>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="edit-expense-amount" label="Amount" required error={fieldErrors.amount}>
            <input
              id="edit-expense-amount"
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
            id="edit-expense-category"
            label="Category"
            required
            error={fieldErrors.categoryId}
            hint="An expense always belongs to exactly one category. It can be moved, but not removed."
          >
            <select
              id="edit-expense-category"
              name="categoryId"
              className={controlClassName()}
              required
              value={values.categoryId}
              onChange={(event) => {
                update('categoryId', event.target.value);
                // The reason is meaningless outside its category, so changing the category clears
                // the reason instead of leaving a value the API would refuse. Clearing rather than
                // silently re-picking the first option is the honest expression: the Admin chooses
                // again, and the server never sees a pair it would reject.
                setValues((previous) => ({ ...previous, expenseReasonId: '' }));
                setFieldErrors((previous) => {
                  if (previous.expenseReasonId === undefined) {
                    return previous;
                  }

                  const rest = { ...previous };
                  delete rest.expenseReasonId;

                  return rest;
                });
              }}
            >
              {currentCategoryIsActive ? null : (
                <option value={record.category.id}>
                  {record.category.name} (current category, now inactive)
                </option>
              )}
              {activeCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            id="edit-expense-reason"
            label="Reason"
            required
            error={fieldErrors.expenseReasonId}
            hint="A reason always belongs to the category above. Both change together, or neither does."
          >
            <select
              id="edit-expense-reason"
              name="expenseReasonId"
              className={controlClassName()}
              required
              value={values.expenseReasonId ?? ''}
              onChange={(event) => {
                update('expenseReasonId', event.target.value);
              }}
            >
              {/*
                The empty option is what makes "nothing chosen" representable. Without it a select
                whose value is `''` silently falls back to whichever option is first, which would
                let a correction be submitted against a reason the Admin never chose.
              */}
              <option value="">
                {values.expenseReasonId === '' || values.expenseReasonId === undefined
                  ? 'Choose a reason'
                  : ''}
              </option>
              {/*
                The expense's own reason is kept as a visible option while the form still points at
                the expense's own category, so opening the form does not appear to change anything.
                Once the category moves, the old reason is dropped entirely: it belongs to the
                previous category and the API would refuse the pairing.
              */}
              {values.categoryId === record.category.id && !currentReasonIsAvailable ? (
                <option value={record.expenseReason.id}>
                  {record.expenseReason.name} (current reason, no longer available)
                </option>
              ) : null}
              {activeReasons.map((reason) => (
                <option key={reason.id} value={reason.id}>
                  {reason.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            id="edit-expense-method"
            label="Payment method"
            required
            error={fieldErrors.paymentMethod}
          >
            <select
              id="edit-expense-method"
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
            id="edit-expense-date"
            label="Business date"
            required
            error={fieldErrors.businessDate}
          >
            <input
              id="edit-expense-date"
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
            id="edit-expense-description"
            label="Description"
            optional
            error={fieldErrors.description}
          >
            <input
              id="edit-expense-description"
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

        <FormField id="edit-expense-notes" label="Notes" optional error={fieldErrors.notes}>
          <textarea
            id="edit-expense-notes"
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
 * survive. The wording says both plainly, because a control labelled only "Delete" would describe
 * something this application never does.
 */
function VoidExpenseForm({
  record,
  onVoided,
}: {
  readonly record: ExpenseSummary;
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
            aria-controls="void-expense-form"
            onClick={() => {
              setIsVoiding(true);
            }}
          >
            Void this expense
          </button>
        }
      >
        <p className="text-supporting text-text-secondary">
          Voiding keeps {record.referenceId} and its full history. It stops counting toward totals
          and nothing is erased.
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
  readonly record: ExpenseSummary;
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
        id="void-expense-form"
        noValidate
        aria-busy={voidTransaction.isPending}
        className="space-y-4"
        onSubmit={(event) => {
          handleSubmit(event);
        }}
      >
        <Banner tone="warning">
          This does not delete anything. {record.referenceId} stays in the expense list and in the
          audit trail, marked voided, and is excluded from every total.
        </Banner>

        <FormField
          id="void-expense-reason"
          label="Reason for voiding"
          required
          error={reasonError}
          hint="For example recorded twice, or filed under the wrong category."
        >
          <textarea
            id="void-expense-reason"
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
            {voidTransaction.isPending ? 'Voiding…' : 'Void this expense'}
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
 * The receipt state, stated rather than implied.
 *
 * `REQ-DOC-003` requires an expense with no receipt to clearly show **Receipt Missing**, and Phase
 * 07 now owns a control that actually works, so this renders the real document panel. The panel
 * states the missing state in words and reports every server decision — available, removed with a
 * reason, or awaiting cleanup — instead of inferring any of them from the expense's `hasReceipt`
 * flag or a document count.
 */
function ExpenseReceiptState({ record }: { readonly record: ExpenseSummary }) {
  return (
    <TransactionDocumentsPanel
      transactionId={record.id}
      transactionReferenceId={record.referenceId}
    />
  );
}

/** The full history of the record, oldest first, from the real audit endpoint. */
function ExpenseAuditTrail({ transactionId }: { readonly transactionId: string }) {
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
 * Summarises an audit event's before/after snapshots in one line, naming only what changed.
 *
 * Each value is rendered through the field's own formatter rather than printed raw. The snapshot is
 * what the database row held, so `amountPaise` is a paise integer and `businessDate` is a plain
 * `YYYY-MM-DD`. Printing those directly would put `amountPaise 80000 -> 95025` in front of the
 * Admin, which `docs/03-UI-UX-RULES.md` forbids: raw paise must not be shown as a financial
 * value.
 *
 * A category move appears here as `category set -> set`, because the raw snapshot holds the
 * category's id. The identifiers are reported as present or absent rather than as a database key:
 * the change is still visible, and a line reading
 * `categoryId empty -> 6d1f9c2b-…` teaches the Admin nothing they can act on.
 */
function describeChange(
  before: Readonly<Record<string, unknown>> | null,
  after: Readonly<Record<string, unknown>> | null,
): string {
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
  categoryId: 'category',
  voidReason: 'void reason',
};

const AUDIT_HIDDEN_FIELDS: readonly string[] = ['categoryId'];

/** One snapshot value, formatted for the field it belongs to. */
function describeAuditValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return 'empty';
  }

  if (AUDIT_HIDDEN_FIELDS.includes(field)) {
    // The change is still reported, so hiding the identifier does not hide that it happened.
    return 'set';
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
    return PAYMENT_METHOD_LABELS[value as keyof typeof PAYMENT_METHOD_LABELS] ?? value;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value.toString();
  }

  // Unreachable for a snapshot the API produces, which is flat by contract. Handled rather than
  // asserted so a future non-flat snapshot is reported as unknown instead of rendering
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
    categoryId?: string;
  } = {};

  for (const field of [
    'amount',
    'paymentMethod',
    'businessDate',
    'description',
    'notes',
    'categoryId',
  ] as const) {
    const message = issues[field];

    if (message !== undefined) {
      errors[field] = message;
    }
  }

  return errors;
}
