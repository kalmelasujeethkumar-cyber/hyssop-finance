import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MEMBER_PAGE_SIZE_MAX,
  MEMBER_SEARCH_MAX_LENGTH,
  type MemberSummary,
} from '@hyssop/contracts';
import { FormField, SECONDARY_BUTTON_CLASS, controlClassName } from '../../components/ui';
import type { MemberPaymentRef } from '../income/income-api';
import { useMemberList } from './member-api';

/**
 * Finding the member a payment belongs to.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-INCOME-003` (a member contribution requires a
 * member), `REQ-MEM-001` (a human-readable member ID and a name), and
 * `docs/03-UI-UX-RULES.md` (search must operate against the real data source, the result count
 * must be visible, loading and empty results must be distinguishable, and no control may be a
 * dead control).
 *
 * There is no member search here. `GET /api/v1/members?search=` already matches a name, a member
 * ID such as `HY-MEM-0001`, and a phone number in one query
 * (`MemberRepository.memberSearchWhere`), so the browser sends that term and renders what came
 * back. The control this replaces listed only the first page of members ordered by name, which
 * left a member past that page unselectable while the field's own hint promised a search.
 *
 * Two components live here rather than one with a flag. `MemberSearchField` is the only
 * searchable control and `LockedMemberSummary` renders no control at all, so there is no branch
 * in which an editable member control can appear beside a member that is already fixed.
 */

/** Below this a term matches most of the parish, so the list is not narrowed by anything. */
const MIN_SEARCH_LENGTH = 2;

/**
 * The pause between the last keystroke and the request.
 *
 * Without it every character of a member ID or a phone number is a separate round trip, and
 * `useMemberList` retains each one as its own cache entry.
 */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * The option text for a member: name, the permanent ID, and a phone when one is recorded.
 *
 * The phone is there because two members may share a name - nothing forbids it, and no
 * uniqueness constraint exists - and the mobile number is what tells them apart.
 */
export function memberOptionLabel(member: MemberPaymentRef): string {
  return member.phone === null || member.phone === ''
    ? `${member.name} (${member.referenceId})`
    : `${member.name} (${member.referenceId}) · ${member.phone}`;
}

export interface MemberSearchFieldProps {
  /** The chosen member's UUID, or `''` for none. */
  readonly selectedMemberId: string;
  /** Called with the chosen member's UUID. No member is ever created from here. */
  readonly onSelect: (memberId: string) => void;
  /** The label for the member selector, including its required/optional marker. */
  readonly label: string;
  readonly required?: boolean | undefined;
  readonly optional?: boolean | undefined;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly searchFieldId?: string | undefined;
  readonly selectFieldId?: string | undefined;
}

/**
 * The searchable member selector: a search box, then a native select of what matched.
 *
 * The native controls are deliberate. The UI rules target WCAG 2.2 AA and this project has no
 * custom combobox anywhere, so a hand-built listbox would carry keyboard, focus, and
 * screen-reader behaviour that then has to be proven by test. A `type="search"` input and a
 * `<select>` are keyboard-operable and announced correctly without any of that, and the Admin
 * already searches members this way on the member list.
 *
 * Once a member is chosen the selector is replaced by a read-only summary of them. The options
 * come from the current search, so keeping the select on screen after the search text changed
 * would risk showing a selected UUID whose name, ID, and phone were no longer in the list. The
 * summary cannot drift from what the API returned, and changing the choice is an explicit act.
 */
export function MemberSearchField({
  selectedMemberId,
  onSelect,
  label,
  required,
  optional,
  hint,
  error,
  searchFieldId = 'member-picker-search',
  selectFieldId = 'member-picker-select',
}: MemberSearchFieldProps) {
  const [term, setTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [chosen, setChosen] = useState<MemberSummary | null>(null);

  // The results the current select was built from, so choosing one can record the very row the
  // API returned for it. A ref rather than state because it is a lookup for an event handler, not
  // a value that should render, and writing state here would re-render on every search response.
  const resultsRef = useRef<readonly MemberSummary[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTerm(term.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [term]);

  const handleResults = useCallback((results: readonly MemberSummary[]): void => {
    resultsRef.current = results;
  }, []);

  const choose = useCallback(
    (memberId: string): void => {
      setChosen(
        memberId === ''
          ? null
          : (resultsRef.current.find((member) => member.id === memberId) ?? null),
      );
      onSelect(memberId);
    },
    [onSelect],
  );

  // The form owns the choice; this follows it. A successful submission resets the form's member to
  // none, and the summary has to go with it — otherwise the next contribution would appear to be
  // for the member the previous one was recorded against.
  useEffect(() => {
    if (selectedMemberId === '') {
      setChosen(null);
    }
  }, [selectedMemberId]);

  const isSearchable = chosen === null && debouncedTerm.length >= MIN_SEARCH_LENGTH;

  return (
    <div className="space-y-3">
      <FormField
        id={searchFieldId}
        label="Search members"
        hint="Matches a name, a member ID such as HY-MEM-0001, or a phone number."
      >
        <input
          id={searchFieldId}
          name="memberSearch"
          type="search"
          autoComplete="off"
          maxLength={MEMBER_SEARCH_MAX_LENGTH}
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
          }}
          className={controlClassName()}
        />
      </FormField>

      {chosen !== null ? (
        <div className="space-y-2">
          <LockedMemberSummary
            lockedMember={chosen}
            label="Selected member"
            note="This payment will be recorded against the member above."
          />
          {/* The API refuses a contribution for a member that does not exist, and that refusal
              lands on this field. Once a member is chosen the select is gone, so the message is
              stated here — a rejection the Admin cannot see is a submission that appears to do
              nothing. */}
          {error === undefined ? null : (
            <p
              role="alert"
              className="text-supporting font-semibold text-danger-700"
              data-testid="member-error"
            >
              {error}
            </p>
          )}
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            onClick={() => {
              setTerm('');
              setDebouncedTerm('');
              setChosen(null);
              onSelect('');
            }}
          >
            Choose a different member
          </button>
        </div>
      ) : isSearchable ? (
        <MemberSelectSection
          term={debouncedTerm}
          label={label}
          required={required}
          optional={optional}
          hint={hint}
          error={error}
          selectFieldId={selectFieldId}
          onResults={handleResults}
          onChoose={choose}
        />
      ) : (
        // Before a search there is no select, so a member-validation message has nowhere to
        // appear. Submitting without a member does exactly that, so the message is shown here
        // instead of silently blocking the request.
        <div role={error === undefined ? undefined : 'alert'} className="space-y-1">
          <p className="text-supporting text-text-secondary" data-testid="member-picker-prompt">
            {`Type at least ${MIN_SEARCH_LENGTH} characters to search every member.`}
          </p>
          {error === undefined ? null : (
            <p className="text-supporting font-semibold text-danger-700" data-testid="member-error">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The matching members and the outcome of the search.
 *
 * Rendered only once the term is long enough to narrow the list, so no request is made for a
 * term that would return most of the parish and no unfiltered page of members is ever presented
 * as though it were a search result. The list arrives through a callback rather than as children
 * because a `<select>` may contain only options: the options and the status text are siblings on
 * the page, not parent and child.
 */
function MemberSelectSection({
  term,
  label,
  required,
  optional,
  hint,
  error,
  selectFieldId,
  onResults,
  onChoose,
}: {
  readonly term: string;
  readonly label: string;
  readonly required: boolean | undefined;
  readonly optional: boolean | undefined;
  readonly hint: string | undefined;
  readonly error: string | undefined;
  readonly selectFieldId: string;
  readonly onResults: (results: readonly MemberSummary[]) => void;
  readonly onChoose: (memberId: string) => void;
}) {
  const list = useMemberList({
    search: term,
    page: 1,
    pageSize: MEMBER_PAGE_SIZE_MAX,
    sort: 'name',
    direction: 'asc',
  });

  const matches = list.data?.items ?? [];

  // Reported in an effect rather than during render: `onResults` stores what the select is built
  // from, and a state update during another component's render is not allowed.
  useEffect(() => {
    onResults(matches);
  }, [matches, onResults]);

  // `useMemberList` keeps the previous page on screen while a new search is in flight, so without
  // this the select would show one search's members under another search's search box. Saying so
  // is the state-honesty rule: the Admin is told the results are moving rather than shown a
  // stale list as the answer.
  const isShowingPreviousResults = list.isPlaceholderData || list.isFetching;

  return (
    <div className="space-y-2">
      <FormField
        id={selectFieldId}
        label={label}
        {...(required === true ? { required: true } : {})}
        {...(optional === true ? { optional: true } : {})}
        {...(hint === undefined ? {} : { hint })}
        {...(error === undefined ? {} : { error })}
      >
        <select
          id={selectFieldId}
          name="memberId"
          className={controlClassName()}
          value=""
          onChange={(event) => {
            onChoose(event.target.value);
          }}
        >
          <option value="">Choose a member</option>
          {isShowingPreviousResults
            ? null
            : matches.map((member) => (
                <option key={member.id} value={member.id}>
                  {memberOptionLabel(member)}
                </option>
              ))}
        </select>
      </FormField>

      <p className="text-supporting text-text-secondary" data-testid="member-picker-count">
        {resultCountText(
          list.isPending,
          isShowingPreviousResults,
          list.data?.pagination.totalItems,
        )}
      </p>

      {isShowingPreviousResults ? (
        <p className="text-supporting text-text-secondary" data-testid="member-picker-updating">
          Updating results…
        </p>
      ) : null}

      {!isShowingPreviousResults && list.isError ? (
        <p
          className="text-supporting font-semibold text-danger-700"
          data-testid="member-picker-error"
        >
          The member list could not be searched. Try the search again.
        </p>
      ) : null}

      {!isShowingPreviousResults && !list.isError && matches.length === 0 ? (
        <p className="text-supporting text-text-secondary" data-testid="member-picker-empty">
          {`No member matches “${term}”. If this person is new, add the member from the Members screen first, then search for them here.`}
        </p>
      ) : null}
    </div>
  );
}

function resultCountText(
  isPending: boolean,
  isShowingPreviousResults: boolean,
  totalItems: number | undefined,
): string {
  if (isPending) {
    return 'Searching members…';
  }

  if (isShowingPreviousResults) {
    return 'Counting matching members…';
  }

  if (totalItems === undefined) {
    return '';
  }

  return totalItems === 1 ? '1 member matches.' : `${totalItems} members match.`;
}

export interface LockedMemberSummaryProps {
  /** The member, as the server identified it. Nothing here is editable. */
  readonly lockedMember: MemberPaymentRef;
  /** The heading for the summary. */
  readonly label: string;
  /** Optional sentence explaining why the member cannot be changed here. */
  readonly note?: string | undefined;
}

/**
 * The read-only identity of the member a payment is for.
 *
 * `REQ-INCOME-003` requires a member for a member contribution, and the API resolves the UUID
 * against a real member (`IncomeService.create`) and refuses an unknown one with `404`. A payment
 * form that already knows its member therefore shows that member's name, permanent ID, and
 * phone, and offers no control that could change it: the three facts the Admin needs to confirm
 * they are paying the right person are the three facts shown, and the mobile number is the one
 * that distinguishes two people who share a name.
 *
 * The identifier is not rendered as a hidden input. The form state carries it, seeded from the
 * record the server returned, so there is nothing on screen to edit.
 */
export function LockedMemberSummary({ lockedMember, label, note }: LockedMemberSummaryProps) {
  return (
    <div className="space-y-2" data-testid="locked-member">
      <p className="text-supporting font-semibold text-text-primary">{label}</p>
      <dl className="grid gap-3 rounded-md border border-border-default bg-surface-subtle p-3 sm:grid-cols-3">
        <div>
          <dt className="text-supporting text-text-secondary">Member name</dt>
          <dd className="text-supporting font-semibold text-text-primary">{lockedMember.name}</dd>
        </div>
        <div>
          <dt className="text-supporting text-text-secondary">Member ID</dt>
          <dd className="text-supporting font-semibold text-text-primary">
            {lockedMember.referenceId}
          </dd>
        </div>
        <div>
          <dt className="text-supporting text-text-secondary">Phone number</dt>
          <dd className="text-supporting font-semibold text-text-primary">
            {lockedMember.phone === null || lockedMember.phone === ''
              ? 'Not recorded'
              : lockedMember.phone}
          </dd>
        </div>
      </dl>
      {note === undefined ? null : <p className="text-supporting text-text-secondary">{note}</p>}
    </div>
  );
}
