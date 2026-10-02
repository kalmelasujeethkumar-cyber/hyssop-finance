import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  INCOME_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_TYPES,
  type SearchMemberResult,
  type SearchResult,
  type SearchTransactionResult,
} from '@hyssop/contracts';
import {
  Banner,
  EmptyState,
  FormField,
  LoadingBlock,
  PageHeader,
  Panel,
  SECONDARY_BUTTON_CLASS,
  TransactionStatusBadge,
  controlClassName,
} from '../components/ui';
import {
  SEARCH_DEFAULTS,
  SEARCH_TYPE_LABELS,
  clampReportPageSize,
  searchQueryKey,
  useGlobalSearch,
  type SearchFilters,
} from '../features/reports/reports-api';
import { formatBusinessDate, formatInr } from '../lib/money';

/**
 * The global search screen.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-SEARCH-001` and `REQ-SEARCH-002`, and
 * `docs/03-UI-UX-RULES.md` (a search that reports what it searched, what it found, and what it
 * did not cover).
 *
 * Four decisions are load-bearing here:
 *
 * - **Nothing is searched until it is asked for.** The search runs from the submitted term, so
 *   mounting the screen does not request every member and every transaction the church has. The
 *   count shown is the API's `pagination.totalItems` for the submitted term, never a count of the
 *   rows that happen to be on screen.
 * - **A result is labelled with what it is.** A member row and a transaction row are different
 *   things, and `kind` is the server's own distinction. Rendering both as "results" would leave the
 *   Admin guessing which is which.
 * - **Voided transactions stay, labelled.** `REQ-SEARCH-002` asks for the bounded, safe answer, and
 *   hiding a voided record from a search would make the search contradict the transaction list.
 * - **A transaction result carries no money of its own.** The amount shown is the stored
 *   transaction's own figure, sent by the API; the screen does not total it, and it does not treat
 *   the sum of results as a meaningful financial figure, because a search is not a period.
 */

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo<SearchFilters>(() => readFilters(searchParams), [searchParams]);
  // A controlled field holds what is being typed; the URL holds what has been searched. Merging the
  // two is what makes a search that fires on every keystroke, or a screen that cannot show what it
  // searched for.
  const [draft, setDraft] = useState<string | null>(null);
  const term = draft ?? filters.term;
  const results = useGlobalSearch(filters, filters.term !== '');
  const hasSearched = filters.term !== '';

  function apply(next: Partial<SearchFilters>): void {
    // A new term or scope starts at page 1 for the same reason a new filter does on the report
    // screen: page 4 of a one-page result set is an empty table that reads as "nothing found".
    setSearchParams(toSearchParams({ ...filters, ...next, page: 1 }));
    setDraft(null);
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    apply({ term: term.trim() });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Search"
        description="Find a member or any income or expense record by name, reference, phone number, category, or description. Search covers every record, including voided ones."
      />

      <Panel title="Search everything">
        <form role="search" className="space-y-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <FormField
                id="search-term"
                label="Search term"
                hint={`Up to ${SEARCH_QUERY_MAX_LENGTH} characters. Leave it blank and nothing is searched.`}
              >
                <input
                  id="search-term"
                  name="q"
                  type="search"
                  autoComplete="off"
                  maxLength={SEARCH_QUERY_MAX_LENGTH}
                  // `key` remounts the input when the searched term changes, so the field shows
                  // what was searched after a reset or a back navigation rather than text the
                  // Admin has abandoned.
                  key={filters.term}
                  defaultValue={filters.term}
                  onChange={(event) => {
                    setDraft(event.target.value);
                  }}
                  className={controlClassName()}
                />
              </FormField>
            </div>

            <FormField id="search-type" label="Search in">
              <select
                id="search-type"
                className={controlClassName()}
                value={filters.type}
                onChange={(event) => {
                  const value = event.target.value;

                  apply({ type: SEARCH_TYPES.includes(value as never) ? (value as never) : 'all' });
                }}
              >
                {SEARCH_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {SEARCH_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="submit" className={SECONDARY_BUTTON_CLASS}>
              Search
            </button>
            {hasSearched ? (
              <button
                type="button"
                className={SECONDARY_BUTTON_CLASS}
                onClick={() => {
                  setSearchParams(new URLSearchParams());
                  setDraft(null);
                }}
              >
                Clear search
              </button>
            ) : null}
          </div>
        </form>
      </Panel>

      {!hasSearched ? (
        <EmptyState
          title="Nothing searched yet"
          description="Enter a name, reference, phone number, category, or description above and choose Search. Nothing is loaded until you ask for it."
        />
      ) : (
        <Panel title="Results">
          <SearchResults
            state={results}
            filters={filters}
            onPageChange={(page) => apply({ page })}
          />
        </Panel>
      )}
    </div>
  );
}

function SearchResults({
  state,
  filters,
  onPageChange,
}: {
  readonly state: ReturnType<typeof useGlobalSearch>;
  readonly filters: SearchFilters;
  readonly onPageChange: (page: number) => void;
}) {
  const rows = state.data?.results ?? [];
  const members = rows.filter(isMemberResult);
  const transactions = rows.filter(isTransactionResult);

  return (
    <div className="space-y-4">
      <p data-testid="result-count" className="text-supporting text-text-secondary">
        {state.isPending
          ? 'Searching…'
          : state.isError
            ? 'Search results unavailable.'
            : `${state.data?.pagination.totalItems ?? 0} ${
                (state.data?.pagination.totalItems ?? 0) === 1 ? 'result' : 'results'
              } for “${state.data?.query ?? filters.term}” in ${SEARCH_TYPE_LABELS[
                state.data?.type ?? filters.type
              ].toLowerCase()}`}
      </p>

      {state.isPending ? <LoadingBlock label="Searching…" /> : null}

      {state.isError ? (
        <Banner
          tone="danger"
          action={
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASS}
              onClick={() => {
                void state.refetch();
              }}
            >
              Search again
            </button>
          }
        >
          {state.error instanceof Error
            ? state.error.message
            : 'The search could not be completed.'}
        </Banner>
      ) : null}

      {state.isSuccess && rows.length === 0 ? (
        <EmptyState
          title="Nothing matched that search"
          description="No member and no transaction matched. Check the spelling, try a shorter term, or search in both members and transactions."
        />
      ) : null}

      {state.isSuccess && members.length > 0 ? (
        <Panel title={`Members (${members.length} on this page)`}>
          <ul className="space-y-3">
            {members.map((member) => (
              <li
                key={member.id}
                className="rounded-lg border border-border-default bg-surface-subtle p-4"
              >
                <p className="text-supporting font-semibold text-text-primary">
                  <Link
                    to={`/members/${member.id}`}
                    className="font-semibold text-blue-700 underline"
                  >
                    {member.name}
                  </Link>{' '}
                  ({member.referenceId})
                </p>
                <p className="text-supporting text-text-secondary">
                  {member.phone === null ? 'No phone number recorded' : member.phone}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {state.isSuccess && transactions.length > 0 ? (
        <Panel title={`Transactions (${transactions.length} on this page)`}>
          <ul className="space-y-3">
            {transactions.map(({ transaction }) => (
              <li
                key={transaction.id}
                className="rounded-lg border border-border-default bg-surface-subtle p-4"
              >
                <p className="text-supporting font-semibold text-text-primary">
                  {transaction.referenceId}
                </p>
                <p className="text-supporting font-semibold text-text-primary">
                  {formatInr(transaction.amount)}
                </p>
                <p className="text-supporting text-text-secondary">
                  {transaction.incomeType === null
                    ? (transaction.category?.name ?? transaction.type)
                    : INCOME_TYPE_LABELS[transaction.incomeType]}{' '}
                  · {formatBusinessDate(transaction.businessDate)} ·{' '}
                  {PAYMENT_METHOD_LABELS[transaction.paymentMethod]}
                </p>
                <p className="text-supporting text-text-secondary">
                  {transaction.member === null
                    ? 'No member recorded'
                    : `${transaction.member.name} (${transaction.member.referenceId})`}
                </p>
                <p className="mt-2">
                  <TransactionStatusBadge status={transaction.status} />
                </p>
                <p className="mt-2">
                  <Link
                    to={
                      transaction.type === 'INCOME'
                        ? `/income/${transaction.id}`
                        : `/expenses/${transaction.id}`
                    }
                    className="inline-block rounded-md border border-border-strong bg-surface px-3 py-1 text-supporting font-semibold text-blue-700 hover:bg-surface-subtle"
                  >
                    Open {transaction.referenceId}
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {state.isSuccess && state.data !== undefined && state.data.pagination.totalPages > 1 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border-default pt-4">
          <p className="text-supporting text-text-secondary">
            Page {state.data.pagination.page} of {state.data.pagination.totalPages}
          </p>
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            disabled={state.data.pagination.page <= 1}
            onClick={() => {
              onPageChange(
                state.data?.pagination.page !== undefined ? state.data.pagination.page - 1 : 1,
              );
            }}
          >
            Previous
          </button>
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            disabled={state.data.pagination.page >= state.data.pagination.totalPages}
            onClick={() => {
              onPageChange(
                state.data?.pagination.page !== undefined ? state.data.pagination.page + 1 : 1,
              );
            }}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}

function isMemberResult(result: SearchResult): result is SearchMemberResult {
  return result.kind === 'member';
}

function isTransactionResult(result: SearchResult): result is SearchTransactionResult {
  return result.kind === 'transaction';
}

function readFilters(searchParams: URLSearchParams): SearchFilters {
  const type = searchParams.get('type');
  const rawPage = Number(searchParams.get('page'));
  const rawPageSize = Number(searchParams.get('pageSize'));

  return {
    term: (searchParams.get('q') ?? '').trim(),
    // An unrecognised `type` falls back to searching everything rather than to nothing, because a
    // stale link should not silently appear to find no results.
    type: SEARCH_TYPES.includes(type as never)
      ? (type as SearchFilters['type'])
      : SEARCH_DEFAULTS.type,
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : SEARCH_DEFAULTS.page,
    pageSize: clampReportPageSize(
      Number.isInteger(rawPageSize) && rawPageSize > 0 ? rawPageSize : SEARCH_DEFAULTS.pageSize,
    ),
  };
}

function toSearchParams(filters: SearchFilters): string {
  const params = new URLSearchParams();

  if (filters.term !== '') {
    params.set('q', filters.term);
  }
  if (filters.type !== SEARCH_DEFAULTS.type) {
    params.set('type', filters.type);
  }
  if (filters.page !== SEARCH_DEFAULTS.page) {
    params.set('page', String(filters.page));
  }
  if (filters.pageSize !== SEARCH_DEFAULTS.pageSize) {
    params.set('pageSize', String(filters.pageSize));
  }

  return params.toString();
}

export { searchQueryKey };
