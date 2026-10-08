import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import {
  PAYMENT_METHOD_LABELS,
  RECEIPT_MISSING_LABEL,
  TRANSACTION_PAGE_SIZE_MAX,
  TRANSACTION_SORT_FIELDS,
  VENDOR_MAX_LENGTH,
  isPaymentMethod,
  type ExpenseCategoryView,
  type ExpenseReasonView,
  type ExpenseSummary,
  type TransactionSortField,
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
  DOCUMENT_UPLOAD_ACCEPT,
  describeDocumentFailure,
  hasPathInFilename,
  useAttachDocument,
  validateDocumentFile,
} from '../features/documents/document-api';
import {
  EMPTY_EXPENSE_FORM,
  PAYMENT_METHOD_CHOICES,
  expenseCategoryLabel,
  expenseReasonLabel,
  hasExpenseFieldErrors,
  useCreateExpense,
  useCreateExpenseCategory,
  useCreateExpenseReason,
  useDownloadExpenseCsv,
  useExpenseCategories,
  useExpenseReasons,
  validateCategoryName,
  validateExpenseFields,
  validateReasonName,
  type ExpenseFieldErrors,
  type ExpenseFormValues,
} from '../features/expenses/expense-api';
import { useUnsavedWork } from '../app/providers/UnsavedWorkProvider';
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
 * The expense list, filters, and record-expense screen.
 *
 * Authority: `docs/phases/PHASE-06-EXPENSES.md`, `docs/01-REQUIREMENTS.md`
 * `REQ-EXP-001` to `REQ-EXP-004`, `REQ-DOC-003`, and `docs/03-UI-UX-RULES.md` (search,
 * filtering, sorting, and pagination must operate against the real data source; the active
 * filters and the result count must be visible; resetting must work; loading and empty results
 * must be distinguishable; no dead controls).
 *
 * Rows come from `GET /api/v1/expenses`, the real documented list, and every criterion the Admin
 * changes is held in the URL so the back button, a reload, and a copied link all restore the same
 * view. Nothing on this screen computes a financial total in the browser: the amount column shows
 * the exact string the API returned, and there is no "spent" figure derived here, because a
 * figure this application did not receive from the server could disagree with the ledger.
 *
 * The category criterion is the one expense-specific filter. It is offered as a dropdown of the
 * *active* categories because that is exactly what the API returns for this screen, and because
 * an expense recorded under a category since deactivated is still reachable from its own record
 * screen. The empty option is "All categories", not "No category": `REQ-EXP-004` makes an expense
 * without a category impossible, so there is nothing for that value to select.
 */

const SORT_LABELS: Record<TransactionSortField, string> = {
  businessDate: 'Business date',
  amount: 'Amount',
  referenceId: 'Reference',
  createdAt: 'Recorded on',
};

const PAGE_SIZE_CHOICES = [10, 20, 50, 100] as const;
const CREATE_FORM_ID = 'record-expense-form';

export function ExpensesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readFilters(searchParams);
  const list = useTransactionList<ExpenseSummary>(filters, '/expenses', {
    categoryId: filters.categoryId,
  });
  const categories = useExpenseCategories();
  const [isRecording, setIsRecording] = useState(false);
  const categoryList = categories.data ?? [];

  // Reasons are per category, so the list's label lookup needs the reasons of whichever category
  // is currently filtered. With no category filter there is no single reason list to fetch, so the
  // list renders the reason the API already sent on each row and this lookup is empty -- which is
  // correct rather than degraded, because `expenseReasonLabel` still has `reason.name` and only uses
  // the list to detect the inactive case.
  const filteredReasons = useExpenseReasons(
    filters.categoryId === '' ? undefined : filters.categoryId,
  );
  const reasonList = filteredReasons.data ?? [];
  const downloadCsv = useDownloadExpenseCsv();

  // The export route requires a category. Offering a download button that the API would refuse is
  // a dead control, so the control only exists once there is a category to export.
  const canDownloadCsv = filters.categoryId !== '' && list.data?.pagination.totalItems !== 0;
  const csvFilename = downloadCsv.data;
  const csvFailure =
    downloadCsv.isError === true ? describeTransactionFailure(downloadCsv.error) : undefined;

  // The category criterion is counted here, not only in the request. A list narrowed to one
  // category while the screen showed no active filter, offered no reset, and let the Admin
  // believe they were looking at all expenses is exactly the dishonesty the UI rules forbid.
  const hasActiveCriteria =
    filters.search !== '' ||
    filters.categoryId !== '' ||
    filters.status !== '' ||
    filters.paymentMethod !== '' ||
    filters.from !== '' ||
    filters.to !== '' ||
    filters.minAmount !== '' ||
    filters.maxAmount !== '' ||
    filters.pageSize !== TRANSACTION_LIST_DEFAULTS.pageSize ||
    filters.sort !== TRANSACTION_LIST_DEFAULTS.sort ||
    filters.direction !== TRANSACTION_LIST_DEFAULTS.direction;

  function applyFilters(next: Partial<ExpenseListFilters>): void {
    const merged = { ...filters, ...next };
    // Any change other than paging returns to page 1. Staying on page 7 of a result set that now
    // has one page would show an empty table and read as "no expenses match".
    const page = 'page' in next && next.page !== undefined ? next.page : 1;

    setSearchParams(toSearchParams({ ...merged, page }));
  }

  function resetFilters(): void {
    setSearchParams(new URLSearchParams());
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Every rupee the church spends, by category, with the receipt state shown honestly. Amounts are exact and shown in rupees."
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
            {isRecording ? 'Cancel recording expense' : 'Record expense'}
          </button>
        }
      />

      {isRecording ? (
        <RecordExpenseForm
          categories={categoryList}
          categoriesFailed={categories.isError}
          onDismiss={() => setIsRecording(false)}
        />
      ) : null}

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
                id="expense-search"
                label="Search expenses"
                hint="Matches a reference such as HY-EXP-000001, a description, a category name, or a reason."
              >
                <input
                  id="expense-search"
                  name="search"
                  type="search"
                  autoComplete="off"
                  maxLength={200}
                  // `key` remounts the input when the URL criterion changes, so the field shows
                  // the criterion actually in effect after a reset or a back navigation.
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

            <FormField
              id="expense-category"
              label="Category"
              hint="Only categories that can still be chosen for a new expense."
            >
              <select
                id="expense-category"
                className={controlClassName()}
                value={filters.categoryId}
                onChange={(event) => {
                  applyFilters({ categoryId: event.target.value });
                }}
              >
                <option value="">All categories</option>
                {categoryList.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField id="expense-status" label="Status">
              <select
                id="expense-status"
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

            <FormField id="expense-payment-method" label="Payment method">
              <select
                id="expense-payment-method"
                className={controlClassName()}
                value={filters.paymentMethod}
                onChange={(event) => {
                  const value = event.target.value;

                  applyFilters({ paymentMethod: isPaymentMethod(value) ? value : '' });
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

            <FormField id="expense-from" label="Business date from" optional>
              <input
                id="expense-from"
                type="date"
                className={controlClassName()}
                value={filters.from}
                onChange={(event) => {
                  applyFilters({ from: event.target.value });
                }}
              />
            </FormField>

            <FormField id="expense-to" label="Business date to" optional>
              <input
                id="expense-to"
                type="date"
                className={controlClassName()}
                value={filters.to}
                onChange={(event) => {
                  applyFilters({ to: event.target.value });
                }}
              />
            </FormField>

            <FormField
              id="expense-min-amount"
              label="Amount from"
              optional
              hint="In rupees, for example 500 or 500.00."
            >
              <input
                id="expense-min-amount"
                type="text"
                inputMode="decimal"
                className={controlClassName()}
                value={filters.minAmount}
                onChange={(event) => {
                  applyFilters({ minAmount: event.target.value.trim() });
                }}
              />
            </FormField>

            <FormField id="expense-max-amount" label="Amount to" optional>
              <input
                id="expense-max-amount"
                type="text"
                inputMode="decimal"
                className={controlClassName()}
                value={filters.maxAmount}
                onChange={(event) => {
                  applyFilters({ maxAmount: event.target.value.trim() });
                }}
              />
            </FormField>

            <FormField id="expense-sort" label="Sort by">
              <select
                id="expense-sort"
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

            <FormField id="expense-direction" label="Order">
              <select
                id="expense-direction"
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
                <ActiveFilterChips
                  filters={filters}
                  categories={categoryList}
                  onChange={applyFilters}
                />
                <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={resetFilters}>
                  Reset all filters
                </button>
              </>
            ) : null}
          </div>

          {/*
            The export follows the filters exactly, because the route receives the same criteria the
            list was built from. The copy states the requirement rather than hiding it, so an Admin
            understands why there is no download without a category.
          */}
          <div className="space-y-2 border-t border-border-default pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={SECONDARY_BUTTON_CLASS}
                disabled={!canDownloadCsv || downloadCsv.isPending}
                onClick={() => {
                  downloadCsv.mutate(expenseExportFiltersOf(filters));
                }}
              >
                {downloadCsv.isPending ? 'Preparing CSV…' : 'Download filtered expenses (CSV)'}
              </button>
              {filters.categoryId === '' ? (
                <span className="text-supporting text-text-secondary">
                  Choose a category to download; the export is per category.
                </span>
              ) : null}
            </div>
            {canDownloadCsv === false && filters.categoryId !== '' && list.data !== undefined ? (
              <p className="text-supporting text-text-secondary">
                Nothing matches these filters, so there is no file to download.
              </p>
            ) : null}
            {csvFailure?.errorMessage === undefined ? null : (
              <Banner tone="danger">{csvFailure.errorMessage}</Banner>
            )}
            {csvFilename === undefined ? null : (
              <Banner tone="success">
                Saved {csvFilename} to your downloads. It contains exactly the filtered rows shown
                above, up to 10,000.
              </Banner>
            )}
          </div>
        </div>
      </Panel>

      <Panel title="Expense records">
        <ExpenseTable
          state={list}
          categories={categoryList}
          reasons={reasonList}
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
  categories,
  onChange,
}: {
  readonly filters: ExpenseListFilters;
  readonly categories: readonly ExpenseCategoryView[];
  readonly onChange: (next: Partial<ExpenseListFilters>) => void;
}) {
  const chips: { key: string; label: string; clear: Partial<ExpenseListFilters> }[] = [];

  if (filters.search !== '') {
    chips.push({ key: 'search', label: `Search: ${filters.search}`, clear: { search: '' } });
  }
  if (filters.categoryId !== '') {
    chips.push({
      key: 'categoryId',
      // A category that has since been deactivated is no longer in the active list, so the chip
      // falls back to the id's own filter value rather than showing "undefined" as a label.
      label: `Category: ${
        categories.find((category) => category.id === filters.categoryId)?.name ??
        'no longer available'
      }`,
      clear: { categoryId: '' },
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
    chips.push({ key: 'to', label: `To: ${formatBusinessDate(filters.to)}`, clear: { to: '' } });
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

function ExpenseTable({
  state,
  categories,
  reasons,
  filters,
  onPageChange,
  onPageSizeChange,
  hasCriteria,
  onReset,
}: {
  readonly state: UseQueryResult<ApiListPage<ExpenseSummary>, Error>;
  readonly categories: readonly ExpenseCategoryView[];
  readonly reasons: readonly ExpenseReasonView[];
  readonly filters: ExpenseListFilters;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
  readonly hasCriteria: boolean;
  readonly onReset: () => void;
}) {
  if (state.isPending) {
    return <LoadingBlock label="Loading expenses…" />;
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
          Try loading expenses again
        </button>
      </div>
    );
  }

  const rows = state.data?.items ?? [];

  if (rows.length === 0) {
    // A filter that matched nothing is a different situation from a church that has recorded no
    // expenses, and saying so is the difference between working filters and broken ones.
    return hasCriteria ? (
      <EmptyState
        title="No expenses match these filters"
        description="No expense record matches the criteria you set. Widen the date range, clear a filter, or reset everything to see all expenses."
        action={
          <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={onReset}>
            Reset all filters
          </button>
        }
      />
    ) : (
      <EmptyState
        title="No expenses recorded yet"
        description="Record the first expense. Each one is given a permanent reference such as HY-EXP-000001 and a category."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* The table scrolls inside its own bounded container at narrow widths rather than pushing
          the page sideways. Below the `sm` breakpoint the same rows become cards, because
          squeezing eight columns into a phone width is what produces unreadable tables. */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            Expense records with reference, date, category, reason, vendor, amount, payment method,
            receipt, and status
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
                Category
              </th>
              <th scope="col" className="px-3 py-2 text-supporting font-semibold text-text-primary">
                Reason
              </th>
              <th scope="col" className="px-3 py-2 text-supporting font-semibold text-text-primary">
                Vendor
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
                Receipt
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
                  {expenseCategoryLabel(categories, row.category)}
                </td>
                <td className="px-3 py-2 text-supporting text-text-secondary">
                  {expenseReasonLabel(reasons, row.expenseReason)}
                </td>
                <td className="px-3 py-2 text-supporting text-text-secondary">
                  {/* An absent vendor is shown as an em dash, not a blank cell, so an empty column
                      reads as "not recorded" rather than a rendering fault. */}
                  {row.vendor ?? '—'}
                </td>
                <td className="px-3 py-2 text-right text-supporting font-semibold text-text-primary">
                  {formatInr(row.amount)}
                </td>
                <td className="px-3 py-2 text-supporting text-text-secondary">
                  {PAYMENT_METHOD_LABELS[row.paymentMethod]}
                </td>
                <td className="px-3 py-2 text-supporting text-text-secondary">
                  {/* `REQ-DOC-003` requires the words "Receipt Missing" rather than a blank
                      cell or a disabled upload control. `hasReceipt` is derived by the API on
                      every read, so this cannot claim a receipt that does not exist. */}
                  {row.hasReceipt ? 'Attached' : RECEIPT_MISSING_LABEL}
                </td>
                <td className="px-3 py-2">
                  <TransactionStatusBadge status={row.status} />
                </td>
                <td className="px-3 py-2 text-right">
                  <ViewExpenseLink row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sm:hidden">
        <ExpenseCards rows={rows} categories={categories} reasons={reasons} />
      </div>

      <ExpensePagination
        pagination={state.data?.pagination}
        filters={filters}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}

function ViewExpenseLink({ row }: { readonly row: ExpenseSummary }) {
  return (
    <Link
      to={`/expenses/${row.id}`}
      className="inline-block rounded-md border border-border-strong bg-surface px-3 py-1 text-supporting font-semibold text-blue-700 hover:bg-surface-subtle"
      aria-label={`View expense ${row.referenceId} for ${formatInr(row.amount)}`}
    >
      View
    </Link>
  );
}

function ExpenseCards({
  rows,
  categories,
  reasons,
}: {
  readonly rows: readonly ExpenseSummary[];
  readonly categories: readonly ExpenseCategoryView[];
  readonly reasons: readonly ExpenseReasonView[];
}) {
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.id} className="rounded-lg border border-border-default bg-surface-subtle p-4">
          <p className="text-supporting font-semibold text-text-primary">
            {formatInr(row.amount)} · {row.referenceId}
          </p>
          <p className="text-supporting text-text-secondary">
            {expenseCategoryLabel(categories, row.category)} ·{' '}
            {expenseReasonLabel(reasons, row.expenseReason)}
          </p>
          {row.vendor === null ? null : (
            <p className="text-supporting text-text-secondary">Vendor: {row.vendor}</p>
          )}
          <p className="text-supporting text-text-secondary">
            {formatBusinessDate(row.businessDate)}
          </p>
          <p className="text-supporting text-text-secondary">
            {PAYMENT_METHOD_LABELS[row.paymentMethod]} ·{' '}
            {row.hasReceipt ? 'Receipt attached' : RECEIPT_MISSING_LABEL}
          </p>
          <p className="mt-2">
            <TransactionStatusBadge status={row.status} />
          </p>
          <div className="mt-3">
            <ViewExpenseLink row={row} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ExpensePagination({
  pagination,
  filters,
  onPageChange,
  onPageSizeChange,
}: {
  readonly pagination:
    { page: number; pageSize: number; totalItems: number; totalPages: number } | undefined;
  readonly filters: ExpenseListFilters;
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
        <label htmlFor="expense-page-size" className="text-supporting text-text-secondary">
          Per page
        </label>
        <select
          id="expense-page-size"
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
 * The state of the form-level receipt attachment.
 *
 * `uploading` and `failed` both carry the created expense, because once it exists the record must
 * never be created again. The distinction is only whether the upload is still in flight or has
 * failed and can be retried (`REQ-DOC-018`, `REQ-DOC-019`).
 */
type PendingReceiptAttach =
  | { readonly kind: 'idle' }
  | { readonly kind: 'uploading'; readonly created: ExpenseSummary }
  | { readonly kind: 'failed'; readonly created: ExpenseSummary; readonly errorMessage: string };

/**
 * What the browser can honestly know about a chosen receipt before it is sent.
 *
 * The same answer is needed when the file is picked and again at submit, because the selection can
 * change in between. `undefined` means the browser has found nothing to object to; it never claims
 * the bytes are sound, which is the server's judgement from the content (`REQ-DOC-016`).
 */
function receiptProblemFor(file: File | undefined): string | undefined {
  if (file === undefined) {
    return undefined;
  }

  return hasPathInFilename(file.name)
    ? 'Remove the folder path from the filename and choose the file again.'
    : validateDocumentFile(file);
}

/**
 * The record-expense form, with the inline custom-category path.
 *
 * Authority: `docs/03-UI-UX-RULES.md` (required/optional indication, server-backed validation
 * with accessible inline errors, correct input types and keyboard order, a disabled state during
 * submission, duplicate-submission protection, success and failure feedback, a clear cancel
 * path), `REQ-EXP-002` (the Admin can add a category the initial set does not contain), and
 * `REQ-EXP-005` (every expense carries a reason belonging to its category, and the Admin can add a
 * reason that category does not yet contain).
 *
 * The reference is not an input. The API allocates the permanent `HY-EXP-000001`, so offering a
 * field for it would make an Admin believe they can choose it.
 *
 * A receipt may be chosen here, but it is stored only after the expense exists, because a document
 * belongs to a transaction (`REQ-DOC-017`). The control is therefore a *selection*, and the form
 * attaches it in a second step against the record the API just created. If that attach fails the
 * expense stays recorded and is reported as such, so `REQ-DOC-003`'s "Receipt Missing" state is
 * honest rather than a surprise, and a retry targets the same record (`REQ-DOC-019`).
 */
function RecordExpenseForm({
  categories,
  categoriesFailed,
  onDismiss,
}: {
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  readonly categoriesFailed: boolean;
  readonly onDismiss: () => void;
}) {
  const create = useCreateExpense();
  // The business date is pre-filled with today in Asia/Kolkata, because the most common entry is
  // today's expense and a pastor should not have to know the date format. The baseline keeps that
  // pre-fill from reading as unsaved work while still detecting a genuine change.
  const [initialValues] = useState<ExpenseFormValues>(() => ({
    ...EMPTY_EXPENSE_FORM,
    businessDate: todayInKolkata(),
  }));
  const [values, setValues] = useState<ExpenseFormValues>(initialValues);
  const [fieldErrors, setFieldErrors] = useState<ExpenseFieldErrors>({});
  const [confirmation, setConfirmation] = useState<string | null>(null);
  // One key per submission intent. It is created lazily on the first submit and replaced only
  // after a *new* intent begins, so a double submit or a retry of the same intent is recognised
  // by the API as one expense rather than two.
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [isAddingReason, setIsAddingReason] = useState(false);

  // The optional receipt chosen in the form (`REQ-DOC-015`). It is held as a *pending selection*
  // and only becomes a stored document after the expense exists, because a document must belong to
  // a transaction (`REQ-DOC-017`).
  const attach = useAttachDocument();
  const [receipt, setReceipt] = useState<File | undefined>(undefined);
  const [receiptError, setReceiptError] = useState<string | undefined>(undefined);
  // One key per attach intent, reused across retries for the same reason the create key is: a
  // request that reached the server before the connection dropped must not store a second receipt
  // (`REQ-DOC-018`).
  const [receiptKey, setReceiptKey] = useState(createIdempotencyKey);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | undefined>(undefined);
  // The two-step state machine. `uploading` and `failed` both mean the expense already exists, so
  // the form must not create it again; the record is only offered for retry, never re-created.
  const [pendingAttach, setPendingAttach] = useState<PendingReceiptAttach>({ kind: 'idle' });

  // An image preview is offered while it is available (`REQ-DOC-015`); a PDF simply keeps its file
  // state because a browser cannot render one inline. The object URL is revoked as soon as the
  // selection changes, so a long-lived tab does not pin the bytes in memory.
  useEffect(() => {
    if (
      receipt === undefined ||
      !receipt.type.startsWith('image/') ||
      typeof URL.createObjectURL !== 'function'
    ) {
      setReceiptPreviewUrl(undefined);

      return;
    }

    // A preview is an enhancement, never a requirement: if the browser cannot make an object URL
    // for this file, the form still records the expense and attaches the receipt unchanged.
    let url: string;

    try {
      url = URL.createObjectURL(receipt);
    } catch {
      setReceiptPreviewUrl(undefined);

      return;
    }

    setReceiptPreviewUrl(url);

    return () => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Releasing an already-released URL is harmless; there is nothing to report.
      }
    };
  }, [receipt]);

  // The reasons for the chosen category only. `undefined` while no category is chosen, which is
  // why the hook is told `undefined` rather than an empty string: it must not issue a request the
  // API documents as invalid.
  const reasonsQuery = useExpenseReasons(values.categoryId === '' ? undefined : values.categoryId);
  const reasons = useMemo(
    () => reasonsQuery.data ?? [],
    // `data` is replaced wholesale per category, so depending on the identity of the array is
    // enough and avoids re-running on every render while a request is in flight.
    [reasonsQuery.data],
  );
  const reasonsFailed = reasonsQuery.isError;
  const isSubmitting = create.isPending || attach.isPending;

  // `REQ-RESP-008`/`REQ-RESP-009`: warn before a navigation or sign-out discards typed input. A
  // chosen receipt counts as unfinished work as well as a changed field.
  useUnsavedWork(JSON.stringify(values) !== JSON.stringify(initialValues) || receipt !== undefined);

  function update<K extends keyof ExpenseFormValues>(key: K, value: ExpenseFormValues[K]): void {
    setValues((previous) => ({ ...previous, [key]: value }));
    setFieldErrors((previous) => {
      if (previous[key] === undefined) {
        return previous;
      }

      // Retyping clears the complaint about the very field being corrected. Leaving a stale
      // message after a fix reads as "still invalid". `ExpenseFormValues` and `ExpenseFieldErrors`
      // hold the same keys, so the field being edited always exists on the error record.
      const rest = { ...previous };
      delete rest[key];

      return rest;
    });
  }

  /** Commits a chosen file, validating only what the browser can honestly know. */
  function onChooseReceipt(chosen: File | undefined): void {
    setReceipt(chosen);
    setReceiptError(receiptProblemFor(chosen));
  }

  /**
   * Attaches the chosen receipt to the expense that was just created.
   *
   * This is the *only* place the receipt is uploaded, and it runs strictly after the create has
   * succeeded (`REQ-DOC-017`). A failed attach leaves the expense intact and keeps the same
   * idempotency key, so a retry reuses one request rather than storing a second receipt
   * (`REQ-DOC-018`).
   */
  function attachReceipt(created: ExpenseSummary): void {
    if (receipt === undefined) {
      return;
    }

    setPendingAttach({ kind: 'uploading', created });
    attach.mutate(
      { transactionId: created.id, file: receipt, idempotencyKey: receiptKey },
      {
        onSuccess: () => {
          // The intent is complete, so the next submission is genuinely new.
          setPendingAttach({ kind: 'idle' });
          setReceipt(undefined);
          setReceiptError(undefined);
          setReceiptKey(createIdempotencyKey());
          setValues({ ...EMPTY_EXPENSE_FORM, businessDate: todayInKolkata() });
          setConfirmation(
            `${formatInr(created.amount)} was recorded as ${created.referenceId} under ${created.category.name} — ${created.expenseReason.name}, with the receipt attached.`,
          );
        },
        onError: (error) => {
          // The expense exists and only the receipt is missing, so this reports exactly that.
          const failure = describeDocumentFailure(error);

          setPendingAttach({
            kind: 'failed',
            created,
            errorMessage:
              failure.errorMessage ??
              'The receipt could not be attached. The expense is recorded without it.',
          });
        },
      },
    );
  }

  /** Records the expense first, then attaches the receipt only if one was chosen. */
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    // Duplicate-submission protection: the button is disabled, and this guards the keyboard and
    // programmatic paths that bypass a disabled attribute. While an attach is pending or awaiting
    // retry the expense already exists, so a second submit must never create another one.
    if (isSubmitting || pendingAttach.kind !== 'idle') {
      return;
    }

    const localErrors = validateExpenseFields(values);

    // The request is not sent while a value the browser already knows is invalid is present.
    if (hasExpenseFieldErrors(localErrors)) {
      setFieldErrors(localErrors);
      setConfirmation(null);

      return;
    }

    // The receipt is optional, so an invalid file is reported rather than silently dropped; the
    // expense itself could still be recorded, so this stops the submission and says why.
    const receiptProblem = receiptProblemFor(receipt);

    if (receiptProblem !== undefined) {
      setReceiptError(receiptProblem);

      return;
    }

    setFieldErrors({});
    setReceiptError(undefined);
    setConfirmation(null);
    // The key is created once and stored, then reused by every retry of this same intent. A
    // failed request is retried under the *same* key so the API can recognise it as the same
    // operation rather than a second expense; it is replaced only after a success, which is when
    // the next submission becomes a genuinely new intent.
    const key = idempotencyKey === '' ? createIdempotencyKey() : idempotencyKey;

    if (idempotencyKey === '') {
      setIdempotencyKey(key);
    }

    create.mutate(
      { values, idempotencyKey: key },
      {
        onSuccess: (created) => {
          // A new submission is a new intent, so the next one gets a new key. Keeping the old key
          // would make the API replay the *previous* expense's response.
          setIdempotencyKey(createIdempotencyKey());
          setCreatedId(created.id);

          if (receipt !== undefined) {
            attachReceipt(created);

            return;
          }

          setValues({ ...EMPTY_EXPENSE_FORM, businessDate: todayInKolkata() });
          setConfirmation(
            `${formatInr(created.amount)} was recorded as ${created.referenceId} under ${created.category.name} — ${created.expenseReason.name}. Attach the receipt from the record.`,
          );
        },
        onError: (error) => {
          // The expense was not created, so nothing was attached and the chosen file is kept for
          // the next attempt.
          setFieldErrors(toExpenseFieldErrors(error));
        },
      },
    );
  }

  /** Retries the receipt upload against the same expense, never creating a second one. */
  function retryReceiptAttach(): void {
    if (pendingAttach.kind !== 'failed' || attach.isPending) {
      return;
    }

    attachReceipt(pendingAttach.created);
  }

  /**
   * Abandons the failed attach.
   *
   * The expense is already recorded, so this confirms it and returns the form to a clean state.
   * It never states the expense has a receipt it does not have (`REQ-DOC-019`).
   */
  function finishWithoutReceipt(): void {
    const created = pendingAttach.kind === 'idle' ? undefined : pendingAttach.created;

    setPendingAttach({ kind: 'idle' });
    setReceipt(undefined);
    setReceiptError(undefined);
    setReceiptKey(createIdempotencyKey());
    setValues({ ...EMPTY_EXPENSE_FORM, businessDate: todayInKolkata() });

    if (created !== undefined) {
      setConfirmation(
        `${formatInr(created.amount)} was recorded as ${created.referenceId} under ${created.category.name} — ${created.expenseReason.name}. Attach the receipt from the record.`,
      );
    }
  }

  const failure = create.isError ? describeTransactionFailure(create.error) : undefined;

  return (
    <Panel title="Record expense">
      <form
        id={CREATE_FORM_ID}
        noValidate
        aria-busy={isSubmitting}
        className="space-y-4"
        onSubmit={(event) => {
          handleSubmit(event);
        }}
      >
        <p className="text-supporting text-text-secondary">
          The expense reference is allocated automatically and never changes. Submitting twice
          records one expense, not two.
        </p>

        {categoriesFailed ? (
          <Banner tone="danger">
            The category list could not be loaded, so no expense can be recorded yet. Reload the
            page and try again.
          </Banner>
        ) : null}

        {/*
          A reason-list failure is stated plainly rather than left as an empty dropdown. The form
          stays usable otherwise, but the expense cannot be submitted without a reason, so the Admin
          needs to know the real cause instead of discovering it at the submit button.
        */}
        {reasonsFailed ? (
          <Banner tone="danger">
            The reasons for this category could not be loaded, so this expense cannot be recorded
            yet. Reload the page and try again, or choose a different category.
          </Banner>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="expense-category-input"
            label="Category"
            required
            error={fieldErrors.categoryId}
            hint="Every expense belongs to exactly one category."
          >
            <select
              id="expense-category-input"
              name="categoryId"
              className={controlClassName()}
              value={values.categoryId}
              required
              onChange={(event) => {
                const categoryId = event.target.value;

                update('categoryId', categoryId);
                // The reason is scoped to its category, so a reason chosen under the previous
                // category is no longer a valid selection. Clearing it here is not a convenience:
                // keeping it would let the form submit a category/reason pair the API refuses, which
                // is exactly the dead control `docs/03-UI-UX-RULES.md` forbids. The Admin is told
                // why through the reason field's own hint and error.
                update('expenseReasonId', '');
              }}
            >
              <option value="">Choose a category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            id="expense-reason-input"
            label="Reason"
            required
            error={fieldErrors.expenseReasonId}
            hint={
              values.categoryId === ''
                ? 'Choose a category first; reasons belong to exactly one category.'
                : 'The purpose of this spend within its category.'
            }
          >
            {/*
              Disabled rather than absent until a category is chosen. A select whose options are
              loaded per category cannot be filled in beforehand, and showing an empty enabled
              dropdown would invite the Admin to look for reasons that do not exist yet.
            */}
            <select
              id="expense-reason-input"
              name="expenseReasonId"
              className={controlClassName()}
              value={values.expenseReasonId}
              required
              disabled={values.categoryId === '' || reasonsFailed}
              onChange={(event) => {
                update('expenseReasonId', event.target.value);
              }}
            >
              <option value="">
                {values.categoryId === ''
                  ? 'Choose a category first'
                  : reasonsFailed
                    ? 'Reasons unavailable'
                    : 'Choose a reason'}
              </option>
              {reasons.map((reason) => (
                <option key={reason.id} value={reason.id}>
                  {reason.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            id="expense-amount"
            label="Amount"
            required
            error={fieldErrors.amount}
            hint="In rupees, for example 500 or 500.00."
          >
            <input
              id="expense-amount"
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
            id="expense-method-input"
            label="Payment method"
            required
            error={fieldErrors.paymentMethod}
          >
            <select
              id="expense-method-input"
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
            id="expense-business-date"
            label="Business date"
            required
            error={fieldErrors.businessDate}
            hint="The Asia/Kolkata calendar date this expense belongs to."
          >
            <input
              id="expense-business-date"
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
            id="expense-vendor"
            label="Vendor"
            optional
            error={fieldErrors.vendor}
            hint="Who did the church buy the item or service from?"
          >
            <input
              id="expense-vendor"
              name="vendor"
              type="text"
              maxLength={VENDOR_MAX_LENGTH}
              placeholder="e.g. ABC Electricals"
              value={values.vendor}
              onChange={(event) => {
                update('vendor', event.target.value);
              }}
              className={controlClassName()}
            />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="expense-description"
            label="Description"
            optional
            error={fieldErrors.description}
            hint="For example September electricity bill or choir sound system repair."
          >
            <input
              id="expense-description"
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
            id="expense-notes"
            label="Notes"
            optional
            error={fieldErrors.notes}
            hint="Private. Not included in searches."
          >
            <textarea
              id="expense-notes"
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

        <ExpenseReceiptField
          file={receipt}
          error={receiptError}
          previewUrl={receiptPreviewUrl}
          disabled={isSubmitting || pendingAttach.kind !== 'idle'}
          onChoose={onChooseReceipt}
        />

        {pendingAttach.kind === 'uploading' ? (
          <Banner tone="info">The expense is saved. Attaching the receipt to it now.</Banner>
        ) : null}

        {pendingAttach.kind === 'failed' ? (
          <div className="space-y-3">
            <Banner tone="warning">
              {pendingAttach.errorMessage} The expense{' '}
              <strong>{pendingAttach.created.referenceId}</strong> is saved and will show{' '}
              <strong>{RECEIPT_MISSING_LABEL}</strong> until the receipt is attached. Trying again
              uses the same record, so no second expense is created.
            </Banner>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={PRIMARY_BUTTON_CLASS}
                disabled={attach.isPending}
                onClick={retryReceiptAttach}
              >
                {attach.isPending ? 'Attaching receipt…' : 'Attach the receipt again'}
              </button>
              <button
                type="button"
                className={SECONDARY_BUTTON_CLASS}
                disabled={attach.isPending}
                onClick={finishWithoutReceipt}
              >
                Finish without the receipt
              </button>
              <Link
                className="text-supporting font-semibold text-brand-primary underline"
                to={`/expenses/${pendingAttach.created.id}`}
              >
                Open the expense record
              </Link>
            </div>
          </div>
        ) : null}

        {isAddingCategory ? (
          <AddCategoryForm
            onCreated={(category) => {
              // The new category is selected immediately, so the Admin does not have to find it
              // in a list they did not know they had just extended. The reason is cleared with it,
              // because the reasons list is about to change category.
              update('categoryId', category.id);
              update('expenseReasonId', '');
              setIsAddingCategory(false);
            }}
            onCancel={() => {
              setIsAddingCategory(false);
            }}
          />
        ) : (
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            onClick={() => {
              setIsAddingCategory(true);
            }}
          >
            Add a category not listed above
          </button>
        )}

        {/*
          The reason path is conditional on a category existing, because `POST /expenses/reasons`
          requires `categoryId`. Showing "+ Add reason" before a category is chosen would offer a
          control that cannot succeed.
        */}
        {values.categoryId === '' ? null : isAddingReason ? (
          <AddReasonForm
            categoryId={values.categoryId}
            onCreated={(reason) => {
              // Selected immediately, for the same reason the category path does this: the Admin
              // just typed this name and should not have to find it in a list again.
              update('expenseReasonId', reason.id);
              setIsAddingReason(false);
            }}
            onCancel={() => {
              setIsAddingReason(false);
            }}
          />
        ) : (
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            onClick={() => {
              setIsAddingReason(true);
            }}
          >
            Add a reason not listed above
          </button>
        )}

        {confirmation === null ? null : (
          <Banner tone="success">
            {confirmation}
            {createdId === null ? null : (
              <>
                {' '}
                <Link
                  to={`/expenses/${createdId}`}
                  className="font-semibold text-blue-700 underline"
                >
                  Open the expense record
                </Link>
              </>
            )}
          </Banner>
        )}
        {failure?.errorMessage === undefined ? null : (
          <Banner tone="danger">{failure.errorMessage}</Banner>
        )}

        {pendingAttach.kind === 'idle' ? (
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={isSubmitting} className={PRIMARY_BUTTON_CLASS}>
              {isSubmitting ? 'Recording expense…' : 'Record expense'}
            </button>
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASS}
              disabled={isSubmitting}
              onClick={() => {
                setValues({ ...EMPTY_EXPENSE_FORM, businessDate: todayInKolkata() });
                setFieldErrors({});
                setReceipt(undefined);
                setReceiptError(undefined);
                setConfirmation(null);
                setIdempotencyKey(createIdempotencyKey());
                setReceiptKey(createIdempotencyKey());
                create.reset();
                onDismiss();
              }}
            >
              Cancel
            </button>
          </div>
        ) : null}
      </form>
    </Panel>
  );
}

/**
 * The optional receipt picker inside the Record Expense form.
 *
 * The file is chosen here but stored only after the expense exists, so this control is honest about
 * what it is: a *selection*. The record shows `Receipt Missing` until the attach step succeeds, and
 * the image preview and replace/remove before submission never claim the receipt is already filed
 * (`REQ-DOC-015`).
 */
function ExpenseReceiptField({
  file,
  error,
  previewUrl,
  disabled,
  onChoose,
}: {
  readonly file: File | undefined;
  readonly error: string | undefined;
  readonly previewUrl: string | undefined;
  readonly disabled: boolean;
  readonly onChoose: (file: File | undefined) => void;
}) {
  return (
    <div className="space-y-2">
      {/*
        `FormField` clones exactly one control so it can attach the label, hint, and error
        associations to that control. The preview and its Remove control therefore live beside the
        field rather than inside it, which keeps the file input the single element `FormField` sees.
      */}
      <FormField
        id="expense-receipt"
        label="Receipt / Document"
        optional
        error={error}
        hint="JPG, JPEG, PNG, WEBP or PDF, within the receipt size limit. If none is chosen the record will show Receipt Missing, and one can be attached afterwards."
      >
        <input
          id="expense-receipt"
          name="receipt"
          type="file"
          accept={DOCUMENT_UPLOAD_ACCEPT}
          disabled={disabled}
          onChange={(event) => {
            onChoose(event.target.files?.[0]);
          }}
          className="block w-full text-supporting text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-supporting file:font-semibold file:text-slate-700"
        />
      </FormField>
      {file === undefined ? (
        <p className="text-supporting text-slate-600">
          No file chosen. A receipt is optional; the expense is recorded either way.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-supporting text-slate-600">
            Selected: <span className="font-medium text-slate-800">{file.name}</span>
          </p>
          {previewUrl === undefined ? null : (
            <img
              src={previewUrl}
              alt={`Preview of the receipt ${file.name}`}
              className="max-h-48 rounded-md border border-slate-200"
            />
          )}
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            disabled={disabled}
            onClick={() => {
              onChoose(undefined);
            }}
          >
            Remove receipt
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Adding a custom category without leaving the expense form.
 *
 * `REQ-EXP-002` permits the Admin to add a category, and the API route exists in Phase 06. The
 * full category-management screen belongs to Phase 10's Settings section and is deliberately not
 * built here; this is the minimum needed so an expense is never blocked by a missing category.
 *
 * The control is inline and collapsible rather than a route, because the Admin is in the middle of
 * recording an expense and would lose the form.
 */
function AddCategoryForm({
  onCreated,
  onCancel,
}: {
  readonly onCreated: (category: { readonly id: string; readonly name: string }) => void;
  readonly onCancel: () => void;
}) {
  const create = useCreateExpenseCategory();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  // A typed but unsaved custom category is unfinished work worth warning about.
  useUnsavedWork(name.trim() !== '');

  function handleSubmit(): void {
    if (create.isPending) {
      return;
    }

    const localError = validateCategoryName(name);

    if (localError !== undefined) {
      setNameError(localError);

      return;
    }

    setNameError(undefined);
    const key = idempotencyKey === '' ? createIdempotencyKey() : idempotencyKey;

    if (idempotencyKey === '') {
      setIdempotencyKey(key);
    }

    create.mutate(
      { name, idempotencyKey: key },
      {
        onSuccess: (created) => {
          setIdempotencyKey(createIdempotencyKey());
          onCreated(created);
        },
        onError: (error) => {
          // A name that is already in use is answered `409 CONFLICT`, and the shared failure
          // helper deliberately reserves that status for "this record moved, reload it" and
          // therefore carries no message of its own. Here the name field is exactly where the
          // Admin can act, so the field-level issue is shown against it — otherwise a duplicate
          // name would be refused by the API and the form would sit there saying nothing, which
          // is worse than the dead control the rule forbids.
          setNameError(
            fieldIssuesByName(error).name ?? describeTransactionFailure(error).errorMessage,
          );
        },
      },
    );
  }

  return (
    // A `<fieldset>` rather than a `<form>`. This control is rendered *inside* the record form,
    // and a form inside a form is invalid HTML: the outer submit handler then also receives the
    // event, so adding a category would run the record form's submit as well and report errors
    // for expense fields the Admin never touched. Enter-to-submit is kept by wiring the key
    // press to this control explicitly, which is what a separate `<form>` would have provided.
    <fieldset
      disabled={create.isPending}
      aria-busy={create.isPending}
      className="space-y-3 rounded-lg border border-border-default bg-surface-subtle p-4"
      onKeyDown={(event) => {
        // Enter submits, which is what a separate `<form>` would have given the Admin for free.
        if (event.key === 'Enter') {
          event.preventDefault();
          handleSubmit();
        }
      }}
    >
      <FormField
        id="expense-new-category"
        label="New category name"
        required
        error={nameError}
        hint="A name that differs only by case or spacing is the same category and will be refused."
      >
        <input
          id="expense-new-category"
          name="newCategoryName"
          type="text"
          required
          maxLength={80}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(undefined);
          }}
          className={controlClassName()}
        />
      </FormField>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={create.isPending}
          onClick={() => {
            handleSubmit();
          }}
          className={SECONDARY_BUTTON_CLASS}
        >
          {create.isPending ? 'Adding category…' : 'Add category'}
        </button>
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS}
          disabled={create.isPending}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </fieldset>
  );
}

/**
 * Adding a custom reason without leaving the expense form.
 *
 * The exact counterpart of `AddCategoryForm`, and deliberately built the same way: a reason without
 * a category is meaningless, so this control only appears once a category is chosen, and the
 * category id travels with the request rather than being inferred.
 *
 * A `<fieldset>` for the same reason as the category form above: a `<form>` inside the record form
 * is invalid HTML and would make adding a reason submit the whole expense as well.
 */
function AddReasonForm({
  categoryId,
  onCreated,
  onCancel,
}: {
  readonly categoryId: string;
  readonly onCreated: (reason: ExpenseReasonView) => void;
  readonly onCancel: () => void;
}) {
  const create = useCreateExpenseReason();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  // A typed but unsaved custom reason is unfinished work worth warning about.
  useUnsavedWork(name.trim() !== '');

  function handleSubmit(): void {
    if (create.isPending) {
      return;
    }

    const localError = validateReasonName(name);

    if (localError !== undefined) {
      setNameError(localError);

      return;
    }

    setNameError(undefined);
    const key = idempotencyKey === '' ? createIdempotencyKey() : idempotencyKey;

    if (idempotencyKey === '') {
      setIdempotencyKey(key);
    }

    create.mutate(
      { categoryId, name, idempotencyKey: key },
      {
        onSuccess: (created) => {
          setIdempotencyKey(createIdempotencyKey());
          onCreated(created);
        },
        onError: (error) => {
          // Same reasoning as `AddCategoryForm`: a duplicate name within this category is
          // `409 CONFLICT`, and that status carries no generic message, so the complaint belongs
          // on the name field where the Admin can act on it.
          setNameError(
            fieldIssuesByName(error).name ?? describeTransactionFailure(error).errorMessage,
          );
        },
      },
    );
  }

  return (
    <fieldset
      disabled={create.isPending}
      aria-busy={create.isPending}
      className="space-y-3 rounded-lg border border-border-default bg-surface-subtle p-4"
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          handleSubmit();
        }
      }}
    >
      <FormField
        id="expense-new-reason"
        label="New reason name"
        required
        error={nameError}
        hint="Added to the chosen category only. The same name may exist under a different category."
      >
        <input
          id="expense-new-reason"
          name="newReasonName"
          type="text"
          required
          maxLength={80}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(undefined);
          }}
          className={controlClassName()}
        />
      </FormField>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={create.isPending}
          onClick={() => {
            handleSubmit();
          }}
          className={SECONDARY_BUTTON_CLASS}
        >
          {create.isPending ? 'Adding reason…' : 'Add reason'}
        </button>
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS}
          disabled={create.isPending}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </fieldset>
  );
}

/**
 * The list filters as export criteria.
 *
 * A direct projection rather than a remapping at the call site, so the two cannot drift: the
 * download sends exactly the criteria the table was built from, which is what makes the promise
 * "the same rows you are looking at" true instead of aspirational. `page` and `pageSize` are
 * deliberately absent -- the export is not paginated, and sending them would cap a 10,000-row
 * export at one page.
 */
function expenseExportFiltersOf(filters: ExpenseListFilters): {
  readonly categoryId: string;
  readonly search: string;
  readonly status: string;
  readonly paymentMethod: string;
  readonly from: string;
  readonly to: string;
  readonly minAmount: string;
  readonly maxAmount: string;
  readonly sort: string;
  readonly direction: string;
} {
  const {
    categoryId,
    search,
    status,
    paymentMethod,
    from,
    to,
    minAmount,
    maxAmount,
    sort,
    direction,
  } = filters;

  return {
    categoryId,
    search,
    status,
    paymentMethod,
    from,
    to,
    minAmount,
    maxAmount,
    sort,
    direction,
  };
}

function resultCountText(
  totalItems: number | undefined,
  isPending: boolean,
  isFetching: boolean,
): string {
  if (isPending) {
    return 'Counting expense records…';
  }

  if (isFetching) {
    return 'Updating results…';
  }

  if (totalItems === undefined) {
    return 'Expense count unavailable.';
  }

  if (totalItems === 0) {
    return 'No expenses to show';
  }

  return `${totalItems} ${totalItems === 1 ? 'record' : 'records'} found`;
}

/** Today's calendar date in Asia/Kolkata, as `YYYY-MM-DD`. */
function todayInKolkata(): string {
  // IST is a fixed +05:30 offset with no daylight saving, so the shift is exact arithmetic and
  // needs no time-zone database. `Date` is used only to *display* today; no financial value ever
  // passes through it.
  const now = new Date(Date.now() + 330 * 60_000);

  return now.toISOString().slice(0, 10);
}

/** Maps a server-side validation failure onto the expense form's own field names. */
function toExpenseFieldErrors(error: unknown): ExpenseFieldErrors {
  const issues = fieldIssuesByName(error);
  const errors: {
    categoryId?: string;
    amount?: string;
    paymentMethod?: string;
    businessDate?: string;
    description?: string;
    notes?: string;
    vendor?: string;
  } = {};

  // Only the fields this form owns are mapped. An unrecognised field keeps its own name in the
  // general error banner rather than being attached to the wrong input, which would be a lie
  // about where the problem is.
  for (const field of EXPENSE_FIELD_NAMES) {
    const message = issues[field];

    if (message !== undefined) {
      errors[field] = message;
    }
  }

  return errors;
}

const EXPENSE_FIELD_NAMES = [
  'categoryId',
  'amount',
  'paymentMethod',
  'businessDate',
  'description',
  'notes',
  'vendor',
] as const satisfies readonly (keyof ExpenseFieldErrors)[];

/** The expense list criteria, including the category filter this screen adds. */
interface ExpenseListFilters extends TransactionListFilters {
  readonly categoryId: string;
}

function readFilters(searchParams: URLSearchParams): ExpenseListFilters {
  const page = Number(searchParams.get('page') ?? '1');
  const pageSize = Number(
    searchParams.get('pageSize') ?? String(TRANSACTION_LIST_DEFAULTS.pageSize),
  );
  const sort = searchParams.get('sort') ?? TRANSACTION_LIST_DEFAULTS.sort;
  const direction = searchParams.get('direction') ?? TRANSACTION_LIST_DEFAULTS.direction;
  const status = searchParams.get('status') ?? TRANSACTION_LIST_DEFAULTS.status;
  const paymentMethod = searchParams.get('paymentMethod') ?? '';

  return {
    search: (searchParams.get('search') ?? '').trim(),
    page: Number.isInteger(page) && page > 0 ? page : TRANSACTION_LIST_DEFAULTS.page,
    pageSize: clampTransactionPageSize(pageSize),
    sort: isTransactionSortFieldValue(sort) ? sort : TRANSACTION_LIST_DEFAULTS.sort,
    direction: direction === 'asc' || direction === 'desc' ? direction : 'desc',
    status: isTransactionStatusValue(status) ? status : '',
    paymentMethod: isPaymentMethod(paymentMethod) ? paymentMethod : '',
    // The category criterion is a bare UUID in the URL and is sent as-is. The API validates the
    // shape and refuses anything else, so the browser does not duplicate that rule with a second
    // pattern that could drift from it.
    categoryId: searchParams.get('categoryId') ?? '',
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
    minAmount: (searchParams.get('minAmount') ?? '').trim(),
    maxAmount: (searchParams.get('maxAmount') ?? '').trim(),
  };
}

function toSearchParams(filters: ExpenseListFilters): URLSearchParams {
  const params = new URLSearchParams();

  // Only non-default criteria are written, so a shared link stays short and readable and the
  // API's documented defaults apply when nothing is specified.
  if (filters.search !== '') {
    params.set('search', filters.search);
  }
  if (filters.categoryId !== '') {
    params.set('categoryId', filters.categoryId);
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
