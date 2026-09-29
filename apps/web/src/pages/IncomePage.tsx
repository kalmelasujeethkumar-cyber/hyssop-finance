import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import {
  INCOME_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  TRANSACTION_PAGE_SIZE_MAX,
  TRANSACTION_SORT_FIELDS,
  isIncomeType,
  isPaymentMethod,
  type IncomeType,
  type TransactionSortField,
  type TransactionSummary,
} from '@hyssop/contracts';
import type { ApiListPage } from '../lib/api-client';
import {
  Banner,
  EmptyState,
  FormField,
  LoadingBlock,
  PageHeader,
  Panel,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  TransactionStatusBadge,
  controlClassName,
} from '../components/ui';
import {
  EMPTY_INCOME_FORM,
  INCOME_TYPE_CHOICES,
  PAYMENT_METHOD_CHOICES,
  hasIncomeFieldErrors,
  showsMemberPicker,
  useCreateIncome,
  validateIncomeFields,
  type IncomeFieldErrors,
  type IncomeFormValues,
} from '../features/income/income-api';
import { useMemberList, MEMBER_LIST_DEFAULTS } from '../features/members/member-api';
import {
  TRANSACTION_LIST_DEFAULTS,
  clampTransactionPageSize,
  createIdempotencyKey,
  describeTransactionFailure,
  fieldIssuesByName,
  isTransactionSortFieldValue,
  isTransactionStatusValue,
  useTransactionList,
  type TransactionListFilters,
} from '../features/transactions/transaction-api';
import { formatBusinessDate, formatInr } from '../lib/money';

/**
 * The income list, filters, and record-income screen.
 *
 * Authority: `docs/phases/PHASE-05-INCOME.md`, `docs/01-REQUIREMENTS.md`
 * `REQ-INCOME-001` to `REQ-INCOME-006`, and `docs/03-UI-UX-RULES.md` (search, sorting, and
 * pagination must operate against the real data source; the active filters and the result count
 * must be visible; resetting must work; loading and empty results must be distinguishable; no
 * dead controls).
 *
 * Every criterion the Admin changes is held in the URL, so the back button, a reload, and a
 * copied link all restore the same view. The rows always come from the real transaction list
 * filtered to `type=INCOME`; no total on this screen is computed in the browser, and no figure
 * is presented as a balance that the API did not send.
 */

const SORT_LABELS: Record<TransactionSortField, string> = {
  businessDate: 'Business date',
  amount: 'Amount',
  referenceId: 'Reference',
  createdAt: 'Recorded on',
};

const PAGE_SIZE_CHOICES = [10, 20, 50, 100] as const;
const CREATE_FORM_ID = 'record-income-form';

export function IncomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readFilters(searchParams);
  // Income is read through the one canonical transaction list, narrowed by `type=INCOME`,
  // because `docs/06-API-SPEC.md` defines no separate income read endpoint. The income-type
  // criterion this screen owns is part of that narrowing: it is passed as an extra query key so
  // it actually reaches the API, and an empty value is omitted rather than sent as a filter that
  // matches nothing.
  const list = useTransactionList<TransactionSummary>(filters, '/transactions', {
    type: 'INCOME',
    incomeType: filters.incomeType,
  });
  const [isRecording, setIsRecording] = useState(false);

  // Every criterion this screen owns has to appear here. The income type is a criterion like any
  // other: it reaches the API through the extra query key above, so leaving it out of this sum
  // let the list narrow to one type while the screen showed no active filter, offered no
  // "Reset all filters" button, and let the Admin believe they were looking at all income.
  const hasActiveCriteria =
    filters.search !== '' ||
    filters.incomeType !== '' ||
    filters.status !== '' ||
    filters.paymentMethod !== '' ||
    filters.from !== '' ||
    filters.to !== '' ||
    filters.minAmount !== '' ||
    filters.maxAmount !== '' ||
    filters.pageSize !== TRANSACTION_LIST_DEFAULTS.pageSize ||
    filters.sort !== TRANSACTION_LIST_DEFAULTS.sort ||
    filters.direction !== TRANSACTION_LIST_DEFAULTS.direction;

  function applyFilters(next: Partial<IncomeListFilters>): void {
    const merged = { ...filters, ...next };
    // Any change other than paging returns to page 1. Staying on page 7 of a result set that
    // now has one page would show an empty table and read as "no income matches".
    const page = 'page' in next && next.page !== undefined ? next.page : 1;

    setSearchParams(toSearchParams({ ...merged, page }));
  }

  function resetFilters(): void {
    setSearchParams(new URLSearchParams());
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Income"
        description="Every rupee received: member contributions, offerings, donations, and anonymous donations. Amounts are exact and shown in rupees."
        action={
          <button
            type="button"
            className={isRecording ? SECONDARY_BUTTON_CLASS : PRIMARY_BUTTON_CLASS}
            aria-expanded={isRecording}
            aria-controls={CREATE_FORM_ID}
            onClick={() => {
              setIsRecording((previous) => !previous);
            }}
          >
            {isRecording ? 'Cancel recording income' : 'Record income'}
          </button>
        }
      />

      {isRecording ? <RecordIncomeForm onDismiss={() => setIsRecording(false)} /> : null}

      <Panel title="Search and filter">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <form
              className="sm:col-span-2"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                const value = new FormData(event.currentTarget).get('search');

                applyFilters({ search: typeof value === 'string' ? value.trim() : '' });
              }}
            >
              <FormField
                id="income-search"
                label="Search income"
                hint="Matches a reference such as HY-INC-000001, a description, or a member name."
              >
                <input
                  id="income-search"
                  name="search"
                  type="search"
                  autoComplete="off"
                  maxLength={200}
                  // `key` remounts the input when the URL criterion changes, so the field
                  // shows the criterion actually in effect after a reset or a back navigation
                  // rather than a value the Admin has abandoned.
                  key={filters.search}
                  defaultValue={filters.search}
                  className={controlClassName()}
                />
              </FormField>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="submit" className={SECONDARY_BUTTON_CLASS}>
                  Search
                </button>
                {filters.search === '' ? null : (
                  <button
                    type="button"
                    className={SECONDARY_BUTTON_CLASS}
                    onClick={() => {
                      applyFilters({ search: '' });
                    }}
                  >
                    Clear search
                  </button>
                )}
              </div>
            </form>

            <FormField id="income-type" label="Income type">
              <select
                id="income-type"
                className={controlClassName()}
                value={filters.incomeType}
                onChange={(event) => {
                  const value = event.target.value;

                  applyFilters({ incomeType: isIncomeType(value) ? value : '' });
                }}
              >
                <option value="">All income types</option>
                {INCOME_TYPE_CHOICES.map((type) => (
                  <option key={type} value={type}>
                    {INCOME_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField id="income-status" label="Status">
              <select
                id="income-status"
                className={controlClassName()}
                value={filters.status}
                onChange={(event) => {
                  const value = event.target.value;

                  applyFilters({ status: isTransactionStatusValue(value) ? value : '' });
                }}
              >
                <option value="">Active and voided</option>
                <option value="ACTIVE">Active only</option>
                <option value="VOIDED">Voided only</option>
              </select>
            </FormField>

            <FormField id="income-payment-method" label="Payment method">
              <select
                id="income-payment-method"
                className={controlClassName()}
                value={filters.paymentMethod}
                onChange={(event) => {
                  const value = event.target.value;

                  applyFilters({
                    paymentMethod: isPaymentMethod(value) ? value : '',
                  });
                }}
              >
                <option value="">Any payment method</option>
                {PAYMENT_METHOD_CHOICES.map((method) => (
                  <option key={method} value={method}>
                    {PAYMENT_METHOD_LABELS[method]}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField id="income-from" label="Business date from" optional>
              <input
                id="income-from"
                type="date"
                className={controlClassName()}
                value={filters.from}
                onChange={(event) => {
                  applyFilters({ from: event.target.value });
                }}
              />
            </FormField>

            <FormField id="income-to" label="Business date to" optional>
              <input
                id="income-to"
                type="date"
                className={controlClassName()}
                value={filters.to}
                onChange={(event) => {
                  applyFilters({ to: event.target.value });
                }}
              />
            </FormField>

            <FormField
              id="income-min-amount"
              label="Amount from"
              optional
              hint="In rupees, for example 500 or 500.00."
            >
              <input
                id="income-min-amount"
                type="text"
                inputMode="decimal"
                className={controlClassName()}
                value={filters.minAmount}
                onChange={(event) => {
                  applyFilters({ minAmount: event.target.value.trim() });
                }}
              />
            </FormField>

            <FormField id="income-max-amount" label="Amount to" optional>
              <input
                id="income-max-amount"
                type="text"
                inputMode="decimal"
                className={controlClassName()}
                value={filters.maxAmount}
                onChange={(event) => {
                  applyFilters({ maxAmount: event.target.value.trim() });
                }}
              />
            </FormField>

            <FormField id="income-sort" label="Sort by">
              <select
                id="income-sort"
                className={controlClassName()}
                value={filters.sort}
                onChange={(event) => {
                  const value = event.target.value;

                  if (isTransactionSortFieldValue(value)) {
                    applyFilters({ sort: value });
                  }
                }}
              >
                {TRANSACTION_SORT_FIELDS.map((field) => (
                  <option key={field} value={field}>
                    {SORT_LABELS[field]}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField id="income-direction" label="Order">
              <select
                id="income-direction"
                className={controlClassName()}
                value={filters.direction}
                onChange={(event) => {
                  const value = event.target.value;

                  if (value === 'asc' || value === 'desc') {
                    applyFilters({ direction: value });
                  }
                }}
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </FormField>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <p data-testid="result-count" className="text-supporting text-text-secondary">
              {resultCountText(list.data?.pagination.totalItems, list.isPending, list.isFetching)}
            </p>
            {hasActiveCriteria ? (
              <>
                <span className="text-supporting text-text-secondary">Active filters:</span>
                <ActiveFilterChips filters={filters} onChange={applyFilters} />
                <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={resetFilters}>
                  Reset all filters
                </button>
              </>
            ) : null}
          </div>
        </div>
      </Panel>

      <Panel title="Income records">
        <IncomeTable
          state={list}
          filters={filters}
          onPageChange={(page) => {
            applyFilters({ page });
          }}
          onPageSizeChange={(pageSize) => {
            applyFilters({ pageSize });
          }}
          hasCriteria={hasActiveCriteria}
          onReset={resetFilters}
        />
      </Panel>
    </div>
  );
}

function ActiveFilterChips({
  filters,
  onChange,
}: {
  readonly filters: IncomeListFilters;
  readonly onChange: (next: Partial<IncomeListFilters>) => void;
}) {
  const chips: { key: string; label: string; clear: Partial<IncomeListFilters> }[] = [];

  if (filters.search !== '') {
    chips.push({ key: 'search', label: `Search: ${filters.search}`, clear: { search: '' } });
  }
  if (filters.incomeType !== '') {
    chips.push({
      key: 'incomeType',
      label: `Type: ${INCOME_TYPE_LABELS[filters.incomeType]}`,
      clear: { incomeType: '' },
    });
  }
  if (filters.status !== '') {
    chips.push({ key: 'status', label: `Status: ${filters.status}`, clear: { status: '' } });
  }
  if (filters.paymentMethod !== '') {
    chips.push({
      key: 'paymentMethod',
      label: `Method: ${PAYMENT_METHOD_LABELS[filters.paymentMethod]}`,
      clear: { paymentMethod: '' },
    });
  }
  if (filters.from !== '') {
    chips.push({
      key: 'from',
      label: `From: ${formatBusinessDate(filters.from)}`,
      clear: { from: '' },
    });
  }
  if (filters.to !== '') {
    chips.push({
      key: 'to',
      label: `To: ${formatBusinessDate(filters.to)}`,
      clear: { to: '' },
    });
  }
  if (filters.minAmount !== '') {
    chips.push({ key: 'min', label: `At least ₹${filters.minAmount}`, clear: { minAmount: '' } });
  }
  if (filters.maxAmount !== '') {
    chips.push({ key: 'max', label: `At most ₹${filters.maxAmount}`, clear: { maxAmount: '' } });
  }
  if (filters.sort !== TRANSACTION_LIST_DEFAULTS.sort) {
    chips.push({
      key: 'sort',
      label: `Sort: ${SORT_LABELS[filters.sort]} ${filters.direction === 'asc' ? 'ascending' : 'descending'}`,
      clear: {
        sort: TRANSACTION_LIST_DEFAULTS.sort,
        direction: TRANSACTION_LIST_DEFAULTS.direction,
      },
    });
  }
  if (filters.pageSize !== TRANSACTION_LIST_DEFAULTS.pageSize) {
    chips.push({
      key: 'pageSize',
      label: `Per page: ${filters.pageSize}`,
      clear: { pageSize: TRANSACTION_LIST_DEFAULTS.pageSize },
    });
  }

  return (
    <>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className="rounded-full border border-blue-600 bg-blue-100 px-3 py-1 text-supporting font-semibold text-blue-700"
          onClick={() => {
            onChange(chip.clear);
          }}
        >
          <span aria-hidden="true">{chip.label} ×</span>
          <span className="sr-only">Remove filter: {chip.label}</span>
        </button>
      ))}
    </>
  );
}

function IncomeTable({
  state,
  filters,
  onPageChange,
  onPageSizeChange,
  hasCriteria,
  onReset,
}: {
  readonly state: UseQueryResult<ApiListPage<TransactionSummary>, Error>;
  readonly filters: IncomeListFilters;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
  readonly hasCriteria: boolean;
  readonly onReset: () => void;
}) {
  if (state.isPending) {
    return <LoadingBlock label="Loading income…" />;
  }

  if (state.isError) {
    return (
      <div className="space-y-3">
        <Banner tone="danger">{describeTransactionFailure(state.error).errorMessage}</Banner>
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS}
          onClick={() => {
            void state.refetch();
          }}
        >
          Try loading income again
        </button>
      </div>
    );
  }

  const rows = state.data?.items ?? [];

  if (rows.length === 0) {
    // A filter that matched nothing is a different situation from a church that has recorded
    // no income, and saying so is the difference between working filters and broken ones.
    return hasCriteria ? (
      <EmptyState
        title="No income matches these filters"
        description="No income record matches the criteria you set. Widen the date range, clear a filter, or reset everything to see all income."
        action={
          <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={onReset}>
            Reset all filters
          </button>
        }
      />
    ) : (
      <EmptyState
        title="No income recorded yet"
        description="Record the first contribution, offering, or donation. Each one is given a permanent reference such as HY-INC-000001."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* The table scrolls inside its own bounded container at narrow widths rather than
          pushing the page sideways. Below the `sm` breakpoint the same rows become cards,
          because squeezing nine columns into a phone width is what produces unreadable
          tables. */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            Income records with reference, date, type, member, amount, payment method, and status
          </caption>
          <thead>
            <tr className="border-b border-border-default">
              <th scope="col" className="px-3 py-2 text-supporting font-semibold text-text-primary">
                Reference
              </th>
              <th scope="col" className="px-3 py-2 text-supporting font-semibold text-text-primary">
                Date
              </th>
              <th scope="col" className="px-3 py-2 text-supporting font-semibold text-text-primary">
                Type
              </th>
              <th scope="col" className="px-3 py-2 text-supporting font-semibold text-text-primary">
                Member
              </th>
              <th
                scope="col"
                className="px-3 py-2 text-right text-supporting font-semibold text-text-primary"
              >
                Amount
              </th>
              <th scope="col" className="px-3 py-2 text-supporting font-semibold text-text-primary">
                Method
              </th>
              <th scope="col" className="px-3 py-2 text-supporting font-semibold text-text-primary">
                Status
              </th>
              <th
                scope="col"
                className="px-3 py-2 text-right text-supporting font-semibold text-text-primary"
              >
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border-default last:border-0">
                <td className="px-3 py-2 text-supporting font-semibold text-text-primary">
                  {row.referenceId}
                </td>
                <td className="px-3 py-2 text-supporting text-text-secondary">
                  {formatBusinessDate(row.businessDate)}
                </td>
                <td className="px-3 py-2 text-supporting text-text-primary">
                  {row.incomeType === null ? '—' : INCOME_TYPE_LABELS[row.incomeType]}
                </td>
                <td className="px-3 py-2 text-supporting text-text-secondary">
                  {row.member === null ? '—' : `${row.member.name} (${row.member.referenceId})`}
                </td>
                <td className="px-3 py-2 text-right text-supporting font-semibold text-text-primary">
                  {formatInr(row.amount)}
                </td>
                <td className="px-3 py-2 text-supporting text-text-secondary">
                  {PAYMENT_METHOD_LABELS[row.paymentMethod]}
                </td>
                <td className="px-3 py-2">
                  <TransactionStatusBadge status={row.status} />
                </td>
                <td className="px-3 py-2 text-right">
                  <ViewIncomeLink row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sm:hidden">
        <IncomeCards rows={rows} />
      </div>

      <IncomePagination
        pagination={state.data?.pagination}
        filters={filters}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}

function ViewIncomeLink({ row }: { readonly row: TransactionSummary }) {
  return (
    <Link
      to={`/income/${row.id}`}
      className="inline-block rounded-md border border-border-strong bg-surface px-3 py-1 text-supporting font-semibold text-blue-700 hover:bg-surface-subtle"
      aria-label={`View income ${row.referenceId} for ${formatInr(row.amount)}`}
    >
      View
    </Link>
  );
}

function IncomeCards({ rows }: { readonly rows: readonly TransactionSummary[] }) {
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.id} className="rounded-lg border border-border-default bg-surface-subtle p-4">
          <p className="text-supporting font-semibold text-text-primary">
            {formatInr(row.amount)} · {row.referenceId}
          </p>
          <p className="text-supporting text-text-secondary">
            {row.incomeType === null ? 'Income' : INCOME_TYPE_LABELS[row.incomeType]} ·{' '}
            {formatBusinessDate(row.businessDate)}
          </p>
          <p className="text-supporting text-text-secondary">
            {row.member === null
              ? 'No member recorded'
              : `${row.member.name} (${row.member.referenceId})`}
          </p>
          <p className="text-supporting text-text-secondary">
            {PAYMENT_METHOD_LABELS[row.paymentMethod]}
          </p>
          <p className="mt-2">
            <TransactionStatusBadge status={row.status} />
          </p>
          <div className="mt-3">
            <ViewIncomeLink row={row} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function IncomePagination({
  pagination,
  filters,
  onPageChange,
  onPageSizeChange,
}: {
  readonly pagination:
    { page: number; pageSize: number; totalItems: number; totalPages: number } | undefined;
  readonly filters: IncomeListFilters;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
}) {
  if (pagination === undefined) {
    return null;
  }

  const { page, pageSize, totalItems, totalPages } = pagination;
  // `totalPages` is 0 for an empty result, so the last reachable page is at least 1. A "next"
  // control pointing at page 0 would be a dead control.
  const lastPage = Math.max(1, totalPages);
  const firstRow = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex flex-col gap-3 border-t border-border-default pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-supporting text-text-secondary">
        Showing {firstRow}–{lastRow} of {totalItems} {totalItems === 1 ? 'record' : 'records'}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="income-page-size" className="text-supporting text-text-secondary">
          Per page
        </label>
        <select
          id="income-page-size"
          className={controlClassName('w-auto')}
          value={filters.pageSize}
          onChange={(event) => {
            onPageSizeChange(clampTransactionPageSize(Number(event.target.value)));
          }}
        >
          {PAGE_SIZE_CHOICES.map((size) => (
            <option key={size} value={size} disabled={size > TRANSACTION_PAGE_SIZE_MAX}>
              {size}
            </option>
          ))}
        </select>

        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS}
          disabled={page <= 1}
          onClick={() => {
            onPageChange(page - 1);
          }}
        >
          Previous
        </button>
        <span className="text-supporting text-text-primary">
          Page {page} of {lastPage}
        </span>
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS}
          disabled={page >= lastPage}
          onClick={() => {
            onPageChange(page + 1);
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/**
 * The record-income form.
 *
 * Authority: `docs/03-UI-UX-RULES.md` (required/optional indication, server-backed validation
 * with accessible inline errors, correct input types and keyboard order, a disabled state
 * during submission, duplicate-submission protection, success and failure feedback, a clear
 * cancel path).
 *
 * The income type drives the rest of the form: choosing Member Contribution requires a member,
 * and choosing Anonymous Donation removes the member, description, and note controls entirely
 * because `REQ-INCOME-005` and `REQ-INCOME-006` must not be bypassable by typing into a box
 * that was merely disabled.
 *
 * The reference is not an input. The API allocates the permanent `HY-INC-000001`, so offering a
 * field for it would make an Admin believe they can choose it.
 */
function RecordIncomeForm({ onDismiss }: { readonly onDismiss: () => void }) {
  const create = useCreateIncome();
  const [values, setValues] = useState<IncomeFormValues>({
    ...EMPTY_INCOME_FORM,
    // The business date is pre-filled with today in Asia/Kolkata, because the most common
    // entry is today's income and a pastor should not have to know the date format. The Admin
    // can change it, and the value is still an explicit, visible, editable field.
    businessDate: todayInKolkata(),
  });
  const [fieldErrors, setFieldErrors] = useState<IncomeFieldErrors>({});
  const [confirmation, setConfirmation] = useState<string | null>(null);
  // One key per submission intent. It is created lazily on the first submit and replaced only
  // after a *new* intent begins, so a double submit or a retry of the same intent is recognised
  // by the API as one contribution rather than two.
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [createdId, setCreatedId] = useState<string | null>(null);

  const members = useMemberList({
    search: '',
    page: 1,
    pageSize: MEMBER_LIST_DEFAULTS.pageSize,
    sort: MEMBER_LIST_DEFAULTS.sort,
    direction: MEMBER_LIST_DEFAULTS.direction,
  });

  const showMember = showsMemberPicker(values.incomeType);

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

    // Duplicate-submission protection: the button is disabled, and this guards the keyboard
    // and programmatic paths that bypass a disabled attribute.
    if (create.isPending) {
      return;
    }

    const localErrors = validateIncomeFields(values);

    // The request is not sent while a value the browser already knows is invalid is present.
    if (hasIncomeFieldErrors(localErrors)) {
      setFieldErrors(localErrors);
      setConfirmation(null);

      return;
    }

    setFieldErrors({});
    setConfirmation(null);
    // The key is created once and stored, then reused by every retry of this same intent. A
    // failed request is retried under the *same* key so the API can recognise it as the same
    // operation rather than a second contribution; it is replaced only after a success, which
    // is when the next submission becomes a genuinely new intent.
    const key = idempotencyKey === '' ? createIdempotencyKey() : idempotencyKey;

    if (idempotencyKey === '') {
      setIdempotencyKey(key);
    }

    create.mutate(
      { values, idempotencyKey: key },
      {
        onSuccess: (created) => {
          // A new submission is a new intent, so the next one gets a new key. Keeping the old
          // key would make the API replay the *previous* contribution's response.
          setIdempotencyKey(createIdempotencyKey());
          setCreatedId(created.id);
          setValues({ ...EMPTY_INCOME_FORM, businessDate: todayInKolkata() });
          setConfirmation(
            `${formatInr(created.amount)} was recorded as ${created.referenceId}. Open the record to print a receipt.`,
          );
        },
        onError: (error) => {
          setFieldErrors(toIncomeFieldErrors(error));
        },
      },
    );
  }

  const failure = create.isError ? describeTransactionFailure(create.error) : undefined;

  return (
    <Panel title="Record income">
      <form
        id={CREATE_FORM_ID}
        noValidate
        aria-busy={create.isPending}
        className="space-y-4"
        onSubmit={(event) => {
          handleSubmit(event);
        }}
      >
        <p className="text-supporting text-text-secondary">
          The income reference is allocated automatically and never changes. Submitting twice
          records one contribution, not two.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
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
                  update('incomeType', value);
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
                update('amount', event.target.value);
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
                  update('paymentMethod', value);
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
                update('businessDate', event.target.value);
              }}
              className={controlClassName()}
            />
          </FormField>

          {showMember ? (
            <FormField
              id="income-member"
              label="Member"
              {...(values.incomeType === 'MEMBER_CONTRIBUTION'
                ? { required: true }
                : { optional: true })}
              error={fieldErrors.memberId}
              hint="Search by name or member ID. Leave empty for an offering or donation from a visitor."
            >
              <select
                id="income-member"
                name="memberId"
                className={controlClassName()}
                value={values.memberId}
                onChange={(event) => {
                  update('memberId', event.target.value);
                }}
              >
                <option value="">No member</option>
                {(members.data?.items ?? []).map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} ({member.referenceId})
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}
        </div>

        {showMember ? (
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
                maxLength={200}
                value={values.description}
                onChange={(event) => {
                  update('description', event.target.value);
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
                maxLength={2000}
                value={values.notes}
                onChange={(event) => {
                  update('notes', event.target.value);
                }}
                className={controlClassName()}
              />
            </FormField>
          </div>
        ) : (
          <Banner tone="info">
            An anonymous donation records no donor, description, or note. The church receives the
            amount and nothing that could identify the person who gave it.
          </Banner>
        )}

        {confirmation === null ? null : (
          <Banner tone="success">
            {confirmation}
            {createdId === null ? null : (
              <>
                {' '}
                <Link to={`/income/${createdId}`} className="font-semibold text-blue-700 underline">
                  Open {`HY-INC record`}
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
            {create.isPending ? 'Recording income…' : 'Record income'}
          </button>
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            disabled={create.isPending}
            onClick={() => {
              setValues({ ...EMPTY_INCOME_FORM, businessDate: todayInKolkata() });
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

function resultCountText(
  totalItems: number | undefined,
  isPending: boolean,
  isFetching: boolean,
): string {
  if (isPending) {
    return 'Counting income records…';
  }

  if (isFetching) {
    return 'Updating results…';
  }

  if (totalItems === undefined) {
    return 'Income count unavailable.';
  }

  if (totalItems === 0) {
    return 'No income to show';
  }

  return `${totalItems} ${totalItems === 1 ? 'record' : 'records'} found`;
}

/** Today's calendar date in Asia/Kolkata, as `YYYY-MM-DD`. */
function todayInKolkata(): string {
  // IST is a fixed +05:30 offset with no daylight saving, so the shift is exact arithmetic
  // and needs no time-zone database. `Date` is used only to *display* today; no financial
  // value ever passes through it.
  const now = new Date(Date.now() + 330 * 60_000);

  return now.toISOString().slice(0, 10);
}

/** Maps a server-side validation failure onto the income form's own field names. */
function toIncomeFieldErrors(error: unknown): IncomeFieldErrors {
  const issues = fieldIssuesByName(error);
  const errors: {
    incomeType?: string;
    amount?: string;
    paymentMethod?: string;
    businessDate?: string;
    memberId?: string;
    description?: string;
    notes?: string;
  } = {};

  // Only the fields this form owns are mapped. An unrecognised field keeps its own name in the
  // general error banner rather than being attached to the wrong input, which would be a lie
  // about where the problem is.
  for (const field of INCOME_FIELD_NAMES) {
    const message = issues[field];

    if (message !== undefined) {
      errors[field] = message;
    }
  }

  return errors;
}

const INCOME_FIELD_NAMES = [
  'incomeType',
  'amount',
  'paymentMethod',
  'businessDate',
  'memberId',
  'description',
  'notes',
] as const satisfies readonly (keyof IncomeFieldErrors)[];

/** The income list criteria, including the income-type filter this screen adds. */
interface IncomeListFilters extends TransactionListFilters {
  readonly incomeType: IncomeType | '';
}

function readFilters(searchParams: URLSearchParams): IncomeListFilters {
  const page = Number(searchParams.get('page') ?? '1');
  const pageSize = Number(
    searchParams.get('pageSize') ?? String(TRANSACTION_LIST_DEFAULTS.pageSize),
  );
  const sort = searchParams.get('sort') ?? TRANSACTION_LIST_DEFAULTS.sort;
  const direction = searchParams.get('direction') ?? TRANSACTION_LIST_DEFAULTS.direction;
  const status = searchParams.get('status') ?? TRANSACTION_LIST_DEFAULTS.status;
  const paymentMethod = searchParams.get('paymentMethod') ?? '';
  const incomeType = searchParams.get('incomeType') ?? '';

  return {
    search: (searchParams.get('search') ?? '').trim(),
    page: Number.isInteger(page) && page > 0 ? page : TRANSACTION_LIST_DEFAULTS.page,
    pageSize: clampTransactionPageSize(pageSize),
    sort: isTransactionSortFieldValue(sort) ? sort : TRANSACTION_LIST_DEFAULTS.sort,
    direction: direction === 'asc' || direction === 'desc' ? direction : 'desc',
    status: isTransactionStatusValue(status) ? status : '',
    paymentMethod: isPaymentMethod(paymentMethod) ? paymentMethod : '',
    incomeType: isIncomeType(incomeType) ? incomeType : '',
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
    minAmount: (searchParams.get('minAmount') ?? '').trim(),
    maxAmount: (searchParams.get('maxAmount') ?? '').trim(),
  };
}

function toSearchParams(filters: IncomeListFilters): URLSearchParams {
  const params = new URLSearchParams();

  // Only non-default criteria are written, so a shared link stays short and readable and the
  // API's documented defaults apply when nothing is specified.
  if (filters.search !== '') {
    params.set('search', filters.search);
  }
  if (filters.incomeType !== '') {
    params.set('incomeType', filters.incomeType);
  }
  if (filters.status !== '') {
    params.set('status', filters.status);
  }
  if (filters.paymentMethod !== '') {
    params.set('paymentMethod', filters.paymentMethod);
  }
  if (filters.from !== '') {
    params.set('from', filters.from);
  }
  if (filters.to !== '') {
    params.set('to', filters.to);
  }
  if (filters.minAmount !== '') {
    params.set('minAmount', filters.minAmount);
  }
  if (filters.maxAmount !== '') {
    params.set('maxAmount', filters.maxAmount);
  }
  if (filters.page !== TRANSACTION_LIST_DEFAULTS.page) {
    params.set('page', String(filters.page));
  }
  if (filters.pageSize !== TRANSACTION_LIST_DEFAULTS.pageSize) {
    params.set('pageSize', String(filters.pageSize));
  }
  if (filters.sort !== TRANSACTION_LIST_DEFAULTS.sort) {
    params.set('sort', filters.sort);
  }
  if (filters.direction !== TRANSACTION_LIST_DEFAULTS.direction) {
    params.set('direction', filters.direction);
  }

  return params;
}
