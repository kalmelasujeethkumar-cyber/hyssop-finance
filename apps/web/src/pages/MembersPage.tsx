import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import {
  MEMBER_PAGE_SIZE_MAX,
  MEMBER_SORT_FIELDS,
  isMemberSortDirection,
  isMemberSortField,
  type MemberSortField,
  type MemberSummary,
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
  controlClassName,
} from '../components/ui';
import {
  EMPTY_MEMBER_FORM,
  MEMBER_LIST_DEFAULTS,
  clampPageSize,
  clampSearch,
  describeMemberFailure,
  fieldIssuesOf,
  hasFieldErrors,
  useCreateMember,
  useMemberList,
  validateMemberFields,
  type MemberFieldErrors,
  type MemberFormValues,
  type MemberListFilters,
} from '../features/members/member-api';
import { formatBusinessDate } from '../lib/money';
import { useUnsavedWork } from '../app/providers/UnsavedWorkProvider';

/**
 * The member list, search, and create screen.
 *
 * Authority: `docs/03-UI-UX-RULES.md` (search, sorting, and pagination must operate
 * against the real data source; the active filters and result count must be visible;
 * resetting filters must work; loading and empty search results must be distinguishable;
 * no dead controls) and `docs/phases/PHASE-04-MEMBERS.md` (create, read, search).
 *
 * Every criterion the Admin changes is held in the URL, so the browser's back button, a
 * reload, and a copied link all restore the same view, and no criterion is hidden in
 * component state where a refresh would silently discard it. The list itself always comes
 * from `GET /members`; nothing on this screen is derived from a stored fixture.
 */

const SORT_LABELS: Record<MemberSortField, string> = {
  name: 'Name',
  referenceId: 'Member ID',
  createdAt: 'Date added',
};

const PAGE_SIZE_CHOICES = [10, 20, 50, 100] as const;

const CREATE_FORM_ID = 'create-member-form';

export function MembersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readFilters(searchParams);
  const list = useMemberList(filters);
  const [isCreating, setIsCreating] = useState(false);

  const hasActiveCriteria =
    filters.search !== '' ||
    filters.pageSize !== MEMBER_LIST_DEFAULTS.pageSize ||
    filters.sort !== MEMBER_LIST_DEFAULTS.sort ||
    filters.direction !== MEMBER_LIST_DEFAULTS.direction;

  function applyFilters(next: Partial<MemberListFilters>): void {
    const merged = { ...filters, ...next };
    // Any change other than paging returns to page 1. Staying on page 7 of a result set
    // that now has one page would show an empty table and read as "no members match".
    const page = 'page' in next && next.page !== undefined ? next.page : 1;

    setSearchParams(toSearchParams({ ...merged, page }));
  }

  function resetFilters(): void {
    setSearchParams(new URLSearchParams());
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members"
        description="Church members, their permanent member IDs, and their monthly contribution records. Search by name, member ID, or phone number."
        action={
          <button
            type="button"
            className={isCreating ? SECONDARY_BUTTON_CLASS : PRIMARY_BUTTON_CLASS}
            aria-expanded={isCreating}
            aria-controls={CREATE_FORM_ID}
            onClick={() => {
              setIsCreating((previous) => !previous);
            }}
          >
            {isCreating ? 'Cancel adding a member' : 'Add a member'}
          </button>
        }
      />

      {isCreating ? <CreateMemberForm onDismiss={() => setIsCreating(false)} /> : null}

      <Panel title="Search and filter">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <form
              className="sm:col-span-2"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                const value = new FormData(event.currentTarget).get('search');

                applyFilters({ search: clampSearch(typeof value === 'string' ? value : '') });
              }}
            >
              <FormField
                id="member-search"
                label="Search members"
                hint="Matches a name, a member ID such as HY-MEM-0001, or a phone number."
              >
                <input
                  id="member-search"
                  name="search"
                  type="search"
                  autoComplete="off"
                  maxLength={100}
                  // `key` remounts the input when the URL criterion changes, so the field
                  // shows the criterion that is actually in effect after a reset or a
                  // back-button navigation rather than a value the Admin has abandoned.
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

            <FormField id="member-sort" label="Sort by">
              <select
                id="member-sort"
                className={controlClassName()}
                value={filters.sort}
                onChange={(event) => {
                  const value = event.target.value;

                  if (isMemberSortField(value)) {
                    applyFilters({ sort: value });
                  }
                }}
              >
                {MEMBER_SORT_FIELDS.map((field) => (
                  <option key={field} value={field}>
                    {SORT_LABELS[field]}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField id="member-direction" label="Order">
              <select
                id="member-direction"
                className={controlClassName()}
                value={filters.direction}
                onChange={(event) => {
                  const value = event.target.value;

                  if (isMemberSortDirection(value)) {
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

      <Panel title="Member records">
        <MemberTable
          state={list}
          filters={filters}
          onPageChange={(page) => {
            applyFilters({ page });
          }}
          onPageSizeChange={(pageSize) => {
            applyFilters({ pageSize });
          }}
          hasCriteria={filters.search !== ''}
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
  readonly filters: MemberListFilters;
  readonly onChange: (next: Partial<MemberListFilters>) => void;
}) {
  const chips: { key: string; label: string; clear: Partial<MemberListFilters> }[] = [];

  if (filters.search !== '') {
    chips.push({ key: 'search', label: `Search: ${filters.search}`, clear: { search: '' } });
  }
  if (filters.sort !== MEMBER_LIST_DEFAULTS.sort) {
    chips.push({
      key: 'sort',
      label: `Sort: ${SORT_LABELS[filters.sort]} ${filters.direction === 'asc' ? 'ascending' : 'descending'}`,
      clear: { sort: MEMBER_LIST_DEFAULTS.sort, direction: MEMBER_LIST_DEFAULTS.direction },
    });
  }
  if (filters.pageSize !== MEMBER_LIST_DEFAULTS.pageSize) {
    chips.push({
      key: 'pageSize',
      label: `Per page: ${filters.pageSize}`,
      clear: { pageSize: MEMBER_LIST_DEFAULTS.pageSize },
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

function MemberTable({
  state,
  filters,
  onPageChange,
  onPageSizeChange,
  hasCriteria,
  onReset,
}: {
  readonly state: UseQueryResult<ApiListPage<MemberSummary>, Error>;
  readonly filters: MemberListFilters;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
  readonly hasCriteria: boolean;
  readonly onReset: () => void;
}) {
  if (state.isPending) {
    return <LoadingBlock label="Loading members…" />;
  }

  if (state.isError) {
    return (
      <div className="space-y-3">
        <Banner tone="danger">{describeMemberFailure(state.error).errorMessage}</Banner>
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS}
          onClick={() => {
            void state.refetch();
          }}
        >
          Try loading members again
        </button>
      </div>
    );
  }

  const members = state.data?.items ?? [];

  if (members.length === 0) {
    // A search that matched nothing is a different situation from a church with no
    // members, and saying so is the difference between a working search and a broken one.
    return hasCriteria ? (
      <EmptyState
        title="No members match this search"
        description="No member name, member ID, or phone number contains what you searched for. Check the spelling, or clear the search to see every member."
        action={
          <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={onReset}>
            Clear search and filters
          </button>
        }
      />
    ) : (
      <EmptyState
        title="No members yet"
        description="Add the first member to start recording monthly contributions. Every member is given a permanent member ID such as HY-MEM-0001."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/*
        The table scrolls inside its own bounded container at narrow widths rather than
        pushing the page sideways, which `docs/03-UI-UX-RULES.md` requires. Below the
        `sm` breakpoint the same rows are rendered as cards by `MemberCards`, because
        squeezing seven columns into a phone width is what produces unreadable tables.
      */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            Church members with their member ID, name, phone number, and date added
          </caption>
          <thead>
            <tr className="border-b border-border-default">
              <th scope="col" className="px-3 py-2 text-supporting font-semibold text-text-primary">
                Member ID
              </th>
              <th scope="col" className="px-3 py-2 text-supporting font-semibold text-text-primary">
                Name
              </th>
              <th scope="col" className="px-3 py-2 text-supporting font-semibold text-text-primary">
                Phone
              </th>
              <th scope="col" className="px-3 py-2 text-supporting font-semibold text-text-primary">
                Added
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
            {members.map((member) => (
              <tr key={member.id} className="border-b border-border-default last:border-0">
                <td className="px-3 py-2 text-supporting font-semibold text-text-primary">
                  {member.referenceId}
                </td>
                <td className="px-3 py-2 text-supporting text-text-primary">{member.name}</td>
                <td className="px-3 py-2 text-supporting text-text-secondary">
                  {member.phone ?? '—'}
                </td>
                <td className="px-3 py-2 text-supporting text-text-secondary">
                  {formatBusinessDate(member.createdAt.slice(0, 10))}
                </td>
                <td className="px-3 py-2 text-right">
                  <ViewMemberLink member={member} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sm:hidden">
        <MemberCards members={members} />
      </div>

      <MemberPagination
        pagination={state.data?.pagination}
        filters={filters}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}

function ViewMemberLink({ member }: { readonly member: MemberSummary }) {
  return (
    <Link
      to={`/members/${member.id}`}
      className="inline-block rounded-md border border-border-strong bg-surface px-3 py-1 text-supporting font-semibold text-blue-700 hover:bg-surface-subtle"
      aria-label={`View ${member.name}, member ${member.referenceId}`}
    >
      View
    </Link>
  );
}

function MemberCards({ members }: { readonly members: readonly MemberSummary[] }) {
  return (
    <ul className="space-y-3">
      {members.map((member) => (
        <li
          key={member.id}
          className="rounded-lg border border-border-default bg-surface-subtle p-4"
        >
          <p className="text-supporting font-semibold text-text-primary">{member.name}</p>
          <p className="text-supporting text-text-secondary">
            Member ID: <span className="font-semibold text-text-primary">{member.referenceId}</span>
          </p>
          <p className="text-supporting text-text-secondary">Phone: {member.phone ?? '—'}</p>
          <p className="text-supporting text-text-secondary">
            Added: {formatBusinessDate(member.createdAt.slice(0, 10))}
          </p>
          <div className="mt-3">
            <ViewMemberLink member={member} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function MemberPagination({
  pagination,
  filters,
  onPageChange,
  onPageSizeChange,
}: {
  readonly pagination:
    { page: number; pageSize: number; totalItems: number; totalPages: number } | undefined;
  readonly filters: MemberListFilters;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
}) {
  if (pagination === undefined) {
    return null;
  }

  const { page, pageSize, totalItems, totalPages } = pagination;
  // `totalPages` is 0 for an empty result, so the last reachable page is at least 1. A
  // "next" control pointing at page 0 would be a dead control.
  const lastPage = Math.max(1, totalPages);
  const firstRow = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex flex-col gap-3 border-t border-border-default pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-supporting text-text-secondary">
        Showing {firstRow}–{lastRow} of {totalItems} {totalItems === 1 ? 'member' : 'members'}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="member-page-size" className="text-supporting text-text-secondary">
          Per page
        </label>
        <select
          id="member-page-size"
          className={controlClassName('w-auto')}
          value={filters.pageSize}
          onChange={(event) => {
            onPageSizeChange(clampPageSize(Number(event.target.value)));
          }}
        >
          {PAGE_SIZE_CHOICES.map((size) => (
            <option key={size} value={size} disabled={size > MEMBER_PAGE_SIZE_MAX}>
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
 * The create form.
 *
 * Authority: `docs/03-UI-UX-RULES.md` (required/optional indication, server-backed
 * validation with accessible inline errors, correct input type and keyboard order, a
 * disabled state during submission, duplicate-submission protection, success and failure
 * feedback, a clear cancel path). The member ID is not an input: the API allocates the
 * permanent `HY-MEM-0001` reference, so offering a field for it would make an Admin
 * believe they can choose it.
 *
 * The form stays open after a successful create so the confirmation naming the new member
 * ID is actually visible; closing it on success would show a "nothing happened" moment.
 */
function CreateMemberForm({ onDismiss }: { readonly onDismiss: () => void }) {
  const create = useCreateMember();
  const [values, setValues] = useState<MemberFormValues>(EMPTY_MEMBER_FORM);
  const [fieldErrors, setFieldErrors] = useState<MemberFieldErrors>({});
  const [confirmation, setConfirmation] = useState<string | null>(null);

  // `REQ-RESP-008`/`REQ-RESP-009`: warn before a navigation or sign-out discards typed input.
  useUnsavedWork(values.name !== '' || values.phone !== '' || values.notes !== '');

  // Editing a field clears its own error, so a message about a value the Admin has already
  // corrected does not sit next to the corrected field.
  function update<K extends keyof MemberFormValues>(key: K, value: MemberFormValues[K]): void {
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

    // Duplicate-submission protection: the button is disabled, and this guards the
    // keyboard and programmatic paths that bypass a disabled attribute.
    if (create.isPending) {
      return;
    }

    const localErrors = validateMemberFields(values);

    // The request is not sent while a value the browser already knows is invalid is
    // present, so an avoidable round trip cannot be made.
    if (hasFieldErrors(localErrors)) {
      setFieldErrors(localErrors);
      setConfirmation(null);

      return;
    }

    setFieldErrors({});
    setConfirmation(null);
    create.mutate(values, {
      onSuccess: (created) => {
        setValues(EMPTY_MEMBER_FORM);
        setConfirmation(
          `${created.name} was added as member ${created.referenceId}. Open the member to configure a monthly contribution.`,
        );
      },
      onError: (error) => {
        setFieldErrors(fieldIssuesOf(error));
      },
    });
  }

  const failure = create.isError ? describeMemberFailure(create.error) : undefined;

  return (
    <Panel title="Add a member">
      <form
        id={CREATE_FORM_ID}
        noValidate
        aria-busy={create.isPending}
        className="space-y-4"
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <p className="text-supporting text-text-secondary">
          The member ID is allocated automatically and never changes.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="new-member-name" label="Full name" required error={fieldErrors.name}>
            <input
              id="new-member-name"
              name="name"
              type="text"
              autoComplete="name"
              required
              maxLength={120}
              value={values.name}
              onChange={(event) => {
                update('name', event.target.value);
              }}
              className={controlClassName()}
            />
          </FormField>

          <FormField
            id="new-member-phone"
            label="Phone number"
            optional
            hint="Spaces, hyphens, brackets, and a leading +91 are removed automatically."
            error={fieldErrors.phone}
          >
            <input
              id="new-member-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              maxLength={32}
              value={values.phone}
              onChange={(event) => {
                update('phone', event.target.value);
              }}
              className={controlClassName()}
            />
          </FormField>
        </div>

        <FormField
          id="new-member-notes"
          label="Notes"
          optional
          hint="Optional. For example a preferred payment method or a contact note."
          error={fieldErrors.notes}
        >
          <textarea
            id="new-member-notes"
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

        {confirmation === null ? null : <Banner tone="success">{confirmation}</Banner>}
        {failure?.errorMessage === undefined ? null : (
          <Banner tone="danger">{failure.errorMessage}</Banner>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={create.isPending} className={PRIMARY_BUTTON_CLASS}>
            {create.isPending ? 'Adding member…' : 'Add member'}
          </button>
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            disabled={create.isPending}
            onClick={() => {
              setValues(EMPTY_MEMBER_FORM);
              setFieldErrors({});
              setConfirmation(null);
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
    return 'Counting members…';
  }

  if (isFetching) {
    return 'Updating results…';
  }

  if (totalItems === undefined) {
    return 'Member count unavailable.';
  }

  if (totalItems === 0) {
    return 'No members to show';
  }

  return `${totalItems} ${totalItems === 1 ? 'member' : 'members'} found`;
}

/**
 * Reads the list criteria from the URL.
 *
 * Every value is validated here, because a hand-edited or stale URL is still input: an
 * unknown sort field or a page of zero would otherwise be sent to the API as a `400` the
 * Admin cannot act on. An unrecognised value falls back to the documented default.
 */
function readFilters(searchParams: URLSearchParams): MemberListFilters {
  const search = searchParams.get('search') ?? '';
  const page = Number(searchParams.get('page') ?? '1');
  const pageSize = Number(searchParams.get('pageSize') ?? String(MEMBER_LIST_DEFAULTS.pageSize));
  const sort = searchParams.get('sort') ?? MEMBER_LIST_DEFAULTS.sort;
  const direction = searchParams.get('direction') ?? MEMBER_LIST_DEFAULTS.direction;

  return {
    search: clampSearch(search),
    page: Number.isInteger(page) && page > 0 ? page : MEMBER_LIST_DEFAULTS.page,
    pageSize: clampPageSize(pageSize),
    sort: isMemberSortField(sort) ? sort : MEMBER_LIST_DEFAULTS.sort,
    direction: isMemberSortDirection(direction) ? direction : MEMBER_LIST_DEFAULTS.direction,
  };
}

function toSearchParams(filters: MemberListFilters): URLSearchParams {
  const params = new URLSearchParams();

  // Only non-default criteria are written, so a shared link is short and readable and the
  // API's own documented defaults apply when nothing is specified.
  if (filters.search !== '') {
    params.set('search', filters.search);
  }
  if (filters.page !== MEMBER_LIST_DEFAULTS.page) {
    params.set('page', String(filters.page));
  }
  if (filters.pageSize !== MEMBER_LIST_DEFAULTS.pageSize) {
    params.set('pageSize', String(filters.pageSize));
  }
  if (filters.sort !== MEMBER_LIST_DEFAULTS.sort) {
    params.set('sort', filters.sort);
  }
  if (filters.direction !== MEMBER_LIST_DEFAULTS.direction) {
    params.set('direction', filters.direction);
  }

  return params;
}
