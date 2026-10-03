import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AUDIT_ACTION_FILTER_OPTIONS,
  AUDIT_ENTITY_TYPE_FILTER_OPTIONS,
  TRANSACTION_PAGE_SIZE_DEFAULT,
  TRANSACTION_PAGE_SIZE_MAX,
  isAuditEntityType,
  type AuditDetailField,
  type AuditEventRow,
} from '@hyssop/contracts';
import {
  clampAuditPageSize,
  normalizeAuditPagination,
  useAuditHistory,
} from '../features/audit/audit-api';
import {
  Banner,
  EmptyState,
  FormField,
  LoadingBlock,
  PageHeader,
  Panel,
  SECONDARY_BUTTON_CLASS,
  controlClassName,
} from '../components/ui';
import { describeTransactionFailure } from '../features/transactions/transaction-api';
import { formatIstTimestamp } from '../lib/money';

/**
 * The Audit History screen.
 *
 * Authority: `docs/phases/PHASE-10-AUDIT-SETTINGS.md`, `docs/01-REQUIREMENTS.md`
 * `REQ-AUDIT-001` and `REQ-AUDIT-002`, `docs/06-API-SPEC.md`
 * ("`GET /api/v1/audit-events`"), `docs/07-SECURITY-RULES.md`, and `docs/03-UI-UX-RULES.md`.
 *
 * This screen is read-only by construction, which is the requirement and not a limitation:
 * `REQ-AUDIT-001` makes the trail append-only, so there is no route on the API that could create,
 * change, or delete an event, and therefore no button here that could offer one. Every control on
 * this page narrows or widens *the view*; none of them touches the record.
 *
 * Four rules shape the rendering:
 *
 * - **The server's words are shown, not invented ones.** `actionLabel` and `entityLabel` arrive
 *   from the API, which chose them through the shared label tables. The browser does not build
 *   "Transaction voided" from `TRANSACTION_VOIDED`, because a screen that translates the code
 *   itself is one more place the wording could drift from what the API and its tests mean. The raw
 *   code stays on the row for a support conversation.
 * - **Detail is shown only as the API prepared it.** `before` and `after` arrive as ordered,
 *   labelled, already-redacted string fields. This screen renders those strings; it never receives a
 *   raw snapshot and never stringifies one, so the decision about what an Admin may see stays in
 *   the layer with the authority to make it.
 * - **"Not recorded" is not "recorded as empty".** `beforeRecorded`/`afterRecorded` are read
 *   separately from the field lists, so a creation that had no prior state says so rather than
 *   presenting a blank panel that implies the change was empty.
 * - **The browser computes no financial figure.** Amounts inside a snapshot are shown as the exact
 *   strings the API returned. There is no total, no count of rupees, and no `Number()` on a money
 *   value anywhere on this screen.
 *
 * Every criterion lives in the URL, so the back button, a reload, and a pasted link all restore the
 * same view of the trail.
 */

const PAGE_SIZE_CHOICES = [10, 20, 50, 100] as const;

/** The audit criteria this screen reads from the URL. */
interface AuditHistoryFilters {
  readonly action: string;
  readonly entityType: string;
  readonly from: string;
  readonly to: string;
  readonly page: number;
  readonly pageSize: number;
}

export function AuditHistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readFilters(searchParams);
  const history = useAuditHistory({
    action: filters.action === '' ? null : filters.action,
    entityType: filters.entityType === '' ? null : filters.entityType,
    from: filters.from === '' ? null : filters.from,
    to: filters.to === '' ? null : filters.to,
    page: filters.page,
    pageSize: filters.pageSize,
  });

  const hasActiveCriteria =
    filters.action !== '' || filters.entityType !== '' || filters.from !== '' || filters.to !== '';

  function applyFilters(next: Partial<AuditHistoryFilters>): void {
    const merged = { ...filters, ...next };
    // Any change other than paging returns to page 1: staying on page 7 of a result set that now
    // has one page would show an empty table and read as "nothing matches".
    const page = 'page' in next && next.page !== undefined ? next.page : 1;

    setSearchParams(toSearchParams({ ...merged, page }));
  }

  function resetFilters(): void {
    setSearchParams(new URLSearchParams());
  }

  const rows = history.data?.rows ?? [];
  const pagination =
    history.data === undefined ? undefined : normalizeAuditPagination(history.data.pagination);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit History"
        description="Every recorded change to this church's records, newest first, with who made it and when. Entries are added automatically and cannot be edited or removed."
      />

      <Panel title="Find an entry">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <FormField id="audit-action" label="What happened">
            <select
              id="audit-action"
              className={controlClassName()}
              value={filters.action}
              onChange={(event) => {
                applyFilters({ action: event.target.value });
              }}
            >
              <option value="">All changes</option>
              {AUDIT_ACTION_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField id="audit-entity-type" label="What was changed">
            <select
              id="audit-entity-type"
              className={controlClassName()}
              value={filters.entityType}
              onChange={(event) => {
                applyFilters({ entityType: event.target.value });
              }}
            >
              <option value="">Everything</option>
              {AUDIT_ENTITY_TYPE_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField id="audit-from" label="From date" hint="Format: 2026-01-31">
            <input
              id="audit-from"
              type="date"
              className={controlClassName()}
              value={filters.from}
              onChange={(event) => {
                applyFilters({ from: event.target.value });
              }}
            />
          </FormField>

          <FormField id="audit-to" label="To date" hint="Both dates are included.">
            <input
              id="audit-to"
              type="date"
              className={controlClassName()}
              value={filters.to}
              onChange={(event) => {
                applyFilters({ to: event.target.value });
              }}
            />
          </FormField>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            disabled={!hasActiveCriteria}
            onClick={resetFilters}
          >
            Clear all filters
          </button>
          <p className="text-supporting text-text-secondary">
            {hasActiveCriteria
              ? 'Showing only the entries that match the filters above.'
              : 'Showing every recorded change.'}
          </p>
        </div>
      </Panel>

      {history.isPending ? <LoadingBlock label="Loading the audit history…" /> : null}

      {history.isError ? (
        <Banner
          tone="danger"
          action={
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASS}
              onClick={() => {
                void history.refetch();
              }}
            >
              Try again
            </button>
          }
        >
          The audit history could not be loaded.{' '}
          {describeTransactionFailure(history.error).errorMessage}
        </Banner>
      ) : null}

      {history.isSuccess && rows.length === 0 ? (
        <EmptyState
          title={hasActiveCriteria ? 'No entries match these filters' : 'No changes recorded yet'}
          description={
            hasActiveCriteria
              ? 'Widen the date range or clear a filter to see more of the history.'
              : 'Entries appear here as soon as something is recorded, corrected, voided, or attached.'
          }
          {...(hasActiveCriteria
            ? {
                action: (
                  <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={resetFilters}>
                    Clear all filters
                  </button>
                ),
              }
            : {})}
        />
      ) : null}

      {history.isSuccess && rows.length > 0 ? (
        <Panel title="Recorded changes">
          <ol className="space-y-4">
            {rows.map((row) => (
              <li key={row.id}>
                <AuditEventEntry row={row} />
              </li>
            ))}
          </ol>

          <div className="mt-5 flex flex-col gap-3 border-t border-border-default pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-supporting text-text-secondary">
              {pagination === undefined
                ? ''
                : `Showing ${firstRowLabel(pagination.page, pagination.pageSize, pagination.totalItems)} of ${
                    pagination.totalItems
                  } ${pagination.totalItems === 1 ? 'entry' : 'entries'}`}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="audit-page-size" className="text-supporting text-text-secondary">
                Per page
              </label>
              <select
                id="audit-page-size"
                className={controlClassName('w-auto')}
                value={filters.pageSize}
                onChange={(event) => {
                  applyFilters({ pageSize: clampAuditPageSize(Number(event.target.value)) });
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
                disabled={pagination === undefined || filters.page <= 1}
                onClick={() => {
                  applyFilters({ page: filters.page - 1 });
                }}
              >
                Previous
              </button>
              <span className="text-supporting text-text-primary">
                {pagination === undefined
                  ? ''
                  : `Page ${filters.page} of ${Math.max(1, pagination.totalPages)}`}
              </span>
              <button
                type="button"
                className={SECONDARY_BUTTON_CLASS}
                disabled={
                  pagination === undefined || filters.page >= Math.max(1, pagination.totalPages)
                }
                onClick={() => {
                  applyFilters({ page: filters.page + 1 });
                }}
              >
                Next
              </button>
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

/**
 * One audit event: the sentence a viewer reads first, then the detail behind it.
 *
 * The heading is composed from the server's own labels rather than from the raw codes, because
 * `REQ-AUDIT-002` asks a viewer to be able to tell what changed without learning the system's
 * vocabulary. The reference, the reason, and the actor are shown as separate facts rather than
 * folded into the sentence, because a void's reason and a transaction's reference are different
 * kinds of information and merging them would make one unreadable.
 */
function AuditEventEntry({ row }: { readonly row: AuditEventRow }) {
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border-default bg-surface-subtle p-4">
      <div className="flex flex-col gap-2">
        <p className="text-supporting font-semibold text-text-primary">
          <span>{row.actionLabel}</span>
          <span className="font-normal text-text-secondary">{` · ${row.entityLabel}`}</span>
          {row.entityReference === null ? null : (
            <span className="font-normal text-text-secondary">{` · ${row.entityReference}`}</span>
          )}
        </p>

        <dl className="grid gap-x-6 gap-y-1 text-supporting text-text-secondary sm:grid-cols-3">
          <div className="flex gap-2">
            <dt className="font-semibold">When</dt>
            <dd>{formatIstTimestamp(row.occurredAt)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold">Who</dt>
            <dd>{row.actorDisplayName ?? 'System'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold">Recorded as</dt>
            <dd>{row.action}</dd>
          </div>
        </dl>

        {row.reason === null ? null : (
          <p className="text-supporting text-text-primary">
            <span className="font-semibold">Reason given: </span>
            {row.reason}
          </p>
        )}
      </div>

      <button
        type="button"
        className={`${SECONDARY_BUTTON_CLASS} mt-3`}
        aria-expanded={isDetailOpen}
        onClick={() => {
          setIsDetailOpen((open) => !open);
        }}
      >
        {isDetailOpen ? 'Hide the details' : 'Show the details'}
      </button>

      {isDetailOpen ? (
        <div className="mt-3 space-y-4">
          <AuditSnapshot
            title="Before this change"
            fields={row.before}
            recorded={row.beforeRecorded}
          />
          <AuditSnapshot
            title="After this change"
            fields={row.after}
            recorded={row.afterRecorded}
          />

          {row.requestId === null ? null : (
            <p className="text-supporting text-text-secondary">
              <span className="font-semibold text-text-primary">Request reference: </span>
              {row.requestId}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One side of a change: what it was, and what it became.
 *
 * The three states are kept distinct because collapsing them would mislead. `recorded === false`
 * means the operation had no such snapshot - a creation has no prior state - and says that
 * plainly. `recorded === true` with no fields means a snapshot *was* taken and was empty, which is
 * a different fact. The redaction marker arrives as the field's own value from the API, so a
 * withheld field is visible as withheld rather than silently absent, which would misrepresent the
 * snapshot as incomplete.
 */
function AuditSnapshot({
  title,
  fields,
  recorded,
}: {
  readonly title: string;
  readonly fields: readonly AuditDetailField[];
  readonly recorded: boolean;
}) {
  return (
    <div>
      <h3 className="text-supporting font-semibold text-text-primary">{title}</h3>

      {recorded ? (
        fields.length === 0 ? (
          <p className="text-supporting text-text-secondary">
            A record was kept for this change and contained no values.
          </p>
        ) : (
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-supporting sm:grid-cols-2">
            {fields.map((field) => (
              <div key={field.key} className="flex gap-2">
                <dt className="font-semibold text-text-secondary">{field.label}</dt>
                <dd className="text-text-primary">
                  {field.value === null ? 'Not set' : field.value}
                </dd>
              </div>
            ))}
          </dl>
        )
      ) : (
        <p className="text-supporting text-text-secondary">
          Not recorded, because there was nothing to compare against.
        </p>
      )}
    </div>
  );
}

/**
 * The range of rows on the current page, as "first–last".
 *
 * An empty result is labelled "0" rather than "1–0", and the range is clamped to the total so a
 * page that runs past the end of the trail cannot claim rows that do not exist.
 */
function firstRowLabel(page: number, pageSize: number, totalItems: number): string {
  if (totalItems === 0) {
    return '0';
  }

  const first = (page - 1) * pageSize + 1;

  return `${first}–${Math.min(page * pageSize, totalItems)}`;
}

/**
 * Reads the criteria from the URL.
 *
 * An unknown `action` or `entityType` is treated as no filter rather than sent on, because the API
 * refuses a value outside its documented vocabulary with a `VALIDATION_FAILED`. Sending it would
 * turn a stale bookmarked link into an error screen; treating it as unset shows the whole trail and
 * leaves the dropdown honest about what is selected.
 */
function readFilters(searchParams: URLSearchParams): AuditHistoryFilters {
  const page = Number(searchParams.get('page') ?? '1');
  const pageSize = Number(searchParams.get('pageSize') ?? String(TRANSACTION_PAGE_SIZE_DEFAULT));
  const action = searchParams.get('action') ?? '';
  const entityType = searchParams.get('entityType') ?? '';

  return {
    action: AUDIT_ACTION_FILTER_OPTIONS.some((option) => option.value === action) ? action : '',
    entityType: isAuditEntityType(entityType) ? entityType : '',
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: clampAuditPageSize(pageSize),
  };
}

/** Only non-default criteria are written, so a shared link stays short and readable. */
function toSearchParams(filters: AuditHistoryFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.action !== '') {
    params.set('action', filters.action);
  }
  if (filters.entityType !== '') {
    params.set('entityType', filters.entityType);
  }
  if (filters.from !== '') {
    params.set('from', filters.from);
  }
  if (filters.to !== '') {
    params.set('to', filters.to);
  }
  if (filters.page !== 1) {
    params.set('page', String(filters.page));
  }
  if (filters.pageSize !== TRANSACTION_PAGE_SIZE_DEFAULT) {
    params.set('pageSize', String(filters.pageSize));
  }

  return params;
}
