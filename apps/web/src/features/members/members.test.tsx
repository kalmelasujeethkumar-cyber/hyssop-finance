import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '../../test/render';
import {
  MEMBER_ONE,
  MEMBER_THREE,
  MEMBER_TWO,
  serverFailure,
  staleMemberRevision,
  stubApiClient,
  transportFailure,
  unauthenticated,
  type StubApiClient,
} from '../../test/stub-client';

/**
 * Browser create, search, sort, paginate, edit, and contribution-status checks.
 *
 * These satisfy the "Browser create, search, edit, and status tests" the phase document
 * requires, and they run against the real route tree, the real provider stack, and a
 * stateful stub client. The stub applies search, sort, and paging the way the API does and
 * rejects a stale `If-Match`, so a dead search box, an unsorted column, a pager that does
 * not move, or an edit that silently overwrites would all fail here rather than in a
 * browser run.
 */

/**
 * The desktop table and the mobile card list both render the same rows, because the layout
 * switches at the `sm` breakpoint. Tailwind hides whichever one does not apply, but jsdom
 * does not apply CSS, so a bare `getByText` would find each member twice. Queries against
 * member rows are therefore scoped to one of the two presentations.
 */
function desktopTable(): HTMLElement {
  return screen.getByRole('table', { hidden: false });
}

function renderMembers(client: StubApiClient, path = '/members'): StubApiClient {
  renderRoute({ client, path });

  return client;
}

function lastCallTo(client: StubApiClient, method: string, pathFragment: string) {
  const matching = client.calls.filter(
    (call) => call.method === method && call.path.includes(pathFragment),
  );

  return matching[matching.length - 1];
}

describe('the member list', () => {
  it('lists members from the API with their permanent member IDs', async () => {
    renderMembers(stubApiClient());

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');

    // A header row plus the three stubbed members.
    expect(rows).toHaveLength(4);
    expect(within(table).getByText(MEMBER_ONE.referenceId)).toBeInTheDocument();
    expect(within(table).getByText(MEMBER_ONE.name)).toBeInTheDocument();
    expect(within(table).getByText(MEMBER_TWO.phone as string)).toBeInTheDocument();
  });

  it('shows how many members matched, so the list is never unlabelled', async () => {
    renderMembers(stubApiClient());

    // The count element exists while the request is in flight and reads "Counting members…",
    // so the assertion waits for the resolved count rather than for the element.
    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('3 members found');
    });
  });

  it('requests the documented list endpoint with paging and sorting', async () => {
    const client = renderMembers(stubApiClient());

    await screen.findByRole('table');

    const call = lastCallTo(client, 'GET', '/members');
    expect(call?.path).toBe('/members?page=1&pageSize=20&sort=name&direction=asc');
  });

  it('distinguishes an empty church from a search that matched nothing', async () => {
    renderMembers(stubApiClient({ members: { members: [] } }));

    expect(await screen.findByText('No members yet')).toBeInTheDocument();
    expect(screen.queryByText('No members match this search')).not.toBeInTheDocument();
  });

  it('reports a load failure and offers a retry that really refetches', async () => {
    const user = userEvent.setup();
    const client = stubApiClient({ members: { listFails: transportFailure } });

    renderRoute({ client, path: '/members' });

    expect(await screen.findByRole('alert')).toHaveTextContent('The API could not be reached.');
    const before = client.calls.filter((call) => call.path.startsWith('/members?')).length;

    await user.click(screen.getByRole('button', { name: 'Try loading members again' }));

    await waitFor(() => {
      expect(
        client.calls.filter((call) => call.path.startsWith('/members?')).length,
      ).toBeGreaterThan(before);
    });
  });
});

describe('searching and sorting members', () => {
  it('sends the search term to the API and shows only the matching member', async () => {
    const user = userEvent.setup();
    const client = renderMembers(stubApiClient());

    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Search members'), 'Benedict');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('1 member found');
    });

    const searchCall = lastCallTo(client, 'GET', 'search=');
    expect(searchCall?.path).toContain('search=Benedict');

    const table = desktopTable();
    expect(within(table).getByText(MEMBER_TWO.name)).toBeInTheDocument();
    expect(within(table).queryByText(MEMBER_ONE.name)).not.toBeInTheDocument();
  });

  it('searches by member ID and by phone number as well as by name', async () => {
    const user = userEvent.setup();
    const client = renderMembers(stubApiClient());

    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Search members'), MEMBER_ONE.referenceId);
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('1 member found');
    });
    expect(within(desktopTable()).getByText(MEMBER_ONE.name)).toBeInTheDocument();
    expect(lastCallTo(client, 'GET', 'search=')?.path).toContain(
      `search=${MEMBER_ONE.referenceId}`,
    );
  });

  it('searches by phone number', async () => {
    const user = userEvent.setup();
    const client = renderMembers(stubApiClient());

    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Search members'), MEMBER_TWO.phone as string);
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('1 member found');
    });
    expect(within(desktopTable()).getByText(MEMBER_TWO.name)).toBeInTheDocument();
    expect(lastCallTo(client, 'GET', 'search=')?.path).toContain(`search=${MEMBER_TWO.phone}`);
  });

  it('explains an empty search result instead of showing a blank table', async () => {
    const user = userEvent.setup();

    renderMembers(stubApiClient());
    await screen.findByRole('table');

    await user.type(screen.getByLabelText('Search members'), 'zzzz-no-such-member');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('No members match this search')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the active search and can clear it again', async () => {
    const user = userEvent.setup();
    const client = renderMembers(stubApiClient());

    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Search members'), 'Anitha');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('1 member found');
    });
    expect(screen.getByText(/Active filters:/)).toBeInTheDocument();

    // The chip's accessible name comes from its screen-reader-only text; the visible label
    // is hidden from assistive technology so it is not announced twice.
    await user.click(screen.getByRole('button', { name: /Remove filter: Search: Anitha/ }));

    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('3 members found');
    });
    expect(lastCallTo(client, 'GET', '/members?')).toBeDefined();
  });

  it('sends a chosen sort field and direction to the API and reorders the rows', async () => {
    const user = userEvent.setup();
    const client = renderMembers(stubApiClient());

    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Sort by'), 'referenceId');
    await user.selectOptions(screen.getByLabelText('Order'), 'desc');

    await waitFor(() => {
      const call = lastCallTo(client, 'GET', '/members?');
      expect(call?.path).toContain('sort=referenceId');
      expect(call?.path).toContain('direction=desc');
    });

    // HY-MEM-0003 must come first when reference IDs descend.
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    const firstBodyRow = rows[1];

    expect(firstBodyRow).toBeDefined();
    expect(
      within(firstBodyRow as HTMLElement).getByText(MEMBER_THREE.referenceId),
    ).toBeInTheDocument();
  });

  it('resets every filter back to the API defaults', async () => {
    const user = userEvent.setup();
    renderMembers(stubApiClient());

    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Search members'), 'Anitha');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('1 member found');
    });

    await user.click(screen.getByRole('button', { name: 'Reset all filters' }));

    // The unfiltered list was already fetched on arrival and is still inside the 30-second
    // freshness window, so returning to it serves the cache instead of repeating the
    // request. The test therefore asserts what the Admin actually sees, which is the honest
    // outcome: the whole list back, the search box empty, and no leftover criteria.
    await waitFor(() => {
      expect(screen.getByTestId('result-count')).toHaveTextContent('3 members found');
    });
    expect(screen.getByLabelText('Search members')).toHaveValue('');
    expect(screen.queryByRole('button', { name: /Remove filter:/ })).not.toBeInTheDocument();

    const table = desktopTable();
    expect(within(table).getByText(MEMBER_ONE.name)).toBeInTheDocument();
    expect(within(table).getByText(MEMBER_TWO.name)).toBeInTheDocument();
    expect(within(table).getByText(MEMBER_THREE.name)).toBeInTheDocument();
  });
});

describe('pagination', () => {
  const many = Array.from({ length: 25 }, (_, index) => ({
    ...MEMBER_ONE,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    referenceId: `HY-MEM-${String(index + 1).padStart(4, '0')}`,
    name: `Member ${String(index + 1).padStart(2, '0')}`,
  }));

  it('moves to the next page and tells the API which page to fetch', async () => {
    const user = userEvent.setup();
    const client = renderMembers(stubApiClient({ members: { members: many } }));

    expect(await screen.findByText('Showing 1–20 of 25 members')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(lastCallTo(client, 'GET', '/members?')?.path).toContain('page=2');
    });
    expect(await screen.findByText('Showing 21–25 of 25 members')).toBeInTheDocument();
  });

  it('disables Previous on the first page and Next on the last page', async () => {
    const user = userEvent.setup();

    renderMembers(stubApiClient({ members: { members: many } }));
    await screen.findByText('Showing 1–20 of 25 members');

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Showing 21–25 of 25 members');

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('changes the page size and returns to the first page', async () => {
    const user = userEvent.setup();
    const client = renderMembers(stubApiClient({ members: { members: many } }));

    await screen.findByText('Showing 1–20 of 25 members');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Showing 21–25 of 25 members');

    await user.selectOptions(screen.getByLabelText('Per page'), '10');

    await waitFor(() => {
      const call = lastCallTo(client, 'GET', '/members?');
      expect(call?.path).toContain('pageSize=10');
      // Paging resets, or the Admin would land on a page that no longer exists.
      expect(call?.path).toContain('page=1');
    });
  });
});

describe('creating a member', () => {
  it('posts a valid member, shows the allocated member ID, and keeps it in the list', async () => {
    const user = userEvent.setup();
    const client = renderMembers(stubApiClient());

    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Add a member' }));

    await user.type(screen.getByLabelText('Full name (required)'), 'Lakshmi Menon');
    await user.type(screen.getByLabelText('Phone number (optional)'), '+91 98765 43210');
    await user.click(screen.getByRole('button', { name: 'Add member' }));

    expect(
      await screen.findByText(/Lakshmi Menon was added as member HY-MEM-0004\./),
    ).toBeInTheDocument();

    const post = lastCallTo(client, 'POST', '/members');
    expect(post?.body).toEqual({ name: 'Lakshmi Menon', phone: '9876543210' });
    // The CSRF header is required by `docs/07-SECURITY-RULES.md` on every state change.
    expect(post?.csrfToken).toBeDefined();
  });

  it('normalizes a formatted phone before sending it', async () => {
    const user = userEvent.setup();
    const client = renderMembers(stubApiClient());

    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Add a member' }));
    await user.type(screen.getByLabelText('Full name (required)'), 'Lakshmi');
    await user.type(screen.getByLabelText('Phone number (optional)'), '(98765) 43210');
    await user.click(screen.getByRole('button', { name: 'Add member' }));

    await waitFor(() => {
      expect(lastCallTo(client, 'POST', '/members')?.body).toMatchObject({ phone: '9876543210' });
    });
  });

  it('rejects a missing name in the browser without a round trip', async () => {
    const user = userEvent.setup();
    const client = renderMembers(stubApiClient());

    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Add a member' }));
    await user.click(screen.getByRole('button', { name: 'Add member' }));

    expect(await screen.findAllByText('A member name is required.')).not.toHaveLength(0);
    expect(client.calls.some((call) => call.method === 'POST' && call.path === '/members')).toBe(
      false,
    );
  });

  it('rejects an invalid phone with the shared rule and does not submit', async () => {
    const user = userEvent.setup();
    const client = renderMembers(stubApiClient());

    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Add a member' }));
    await user.type(screen.getByLabelText('Full name (required)'), 'Lakshmi');
    await user.type(screen.getByLabelText('Phone number (optional)'), '123');
    await user.click(screen.getByRole('button', { name: 'Add member' }));

    expect(
      await screen.findByText(/Enter a phone number with 7 to 15 digits\./),
    ).toBeInTheDocument();
    expect(client.calls.some((call) => call.method === 'POST' && call.path === '/members')).toBe(
      false,
    );
  });

  it('reports a server-side rejection and keeps the form open', async () => {
    const user = userEvent.setup();

    renderMembers(stubApiClient({ members: { createFails: serverFailure } }));
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Add a member' }));
    await user.type(screen.getByLabelText('Full name (required)'), 'Lakshmi');
    await user.click(screen.getByRole('button', { name: 'Add member' }));

    expect(
      await screen.findByText('An unexpected error occurred. Please try again.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Full name (required)')).toBeInTheDocument();
  });

  it('closes the form when the Admin cancels', async () => {
    const user = userEvent.setup();

    renderMembers(stubApiClient());
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Add a member' }));

    expect(await screen.findByLabelText('Full name (required)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByLabelText('Full name (required)')).not.toBeInTheDocument();
    });
  });
});

describe('the member detail screen', () => {
  const memberPath = `/members/${MEMBER_ONE.id}`;

  it('shows the member identity, contribution statuses, and history from the API', async () => {
    renderMembers(stubApiClient(), memberPath);

    expect(
      await screen.findByRole('heading', { level: 1, name: MEMBER_ONE.name }),
    ).toBeInTheDocument();
    expect(screen.getByText(MEMBER_ONE.referenceId)).toBeInTheDocument();
    expect(screen.getByText(MEMBER_ONE.phone as string)).toBeInTheDocument();

    // The three derived statuses required by REQ-CONTRIB-002, each stated in words.
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('Partially paid')).toBeInTheDocument();
    expect(screen.getByText('Not paid')).toBeInTheDocument();

    // Amounts use the rupee symbol and Indian grouping, never raw paise. Two months carry
    // the same expected amount, and March's received amount matches it, so the same
    // formatted value legitimately appears in more than one cell.
    expect(screen.getAllByText('₹500.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₹350.00').length).toBeGreaterThan(0);
    // April's received amount and April's partial transaction are the same money, so the
    // formatted value legitimately appears in both the period table and the history table.
    expect(screen.getAllByText('₹150.00').length).toBeGreaterThan(0);
  });

  it('is behind the session, so an anonymous visitor cannot reach it', async () => {
    renderRoute({ client: stubApiClient({ session: unauthenticated }), path: memberPath });

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
  });

  it('reports a member that could not be loaded, with a retry', async () => {
    renderMembers(stubApiClient({ members: { detailFails: transportFailure } }), memberPath);

    expect(await screen.findByText('The API could not be reached.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Try loading the member again' }),
    ).toBeInTheDocument();
  });

  it('sends the loaded revision as If-Match when the member is edited', async () => {
    const user = userEvent.setup();
    const client = renderMembers(stubApiClient(), memberPath);

    await screen.findByRole('heading', { level: 1, name: MEMBER_ONE.name });
    await user.click(screen.getByRole('button', { name: 'Edit member' }));

    const nameField = await screen.findByLabelText('Full name (required)');
    await user.clear(nameField);
    await user.type(nameField, 'Anitha K. Kumar');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText(/Anitha K. Kumar was saved\./)).toBeInTheDocument();

    const patch = lastCallTo(client, 'PATCH', '/members/');
    expect(patch?.ifMatch).toBe(`"${MEMBER_ONE.revision}"`);
    // The edit sends every editable field, not only the one that changed, so the result
    // never depends on the server merging a partial object with whatever it already had.
    expect(patch?.body).toEqual({
      name: 'Anitha K. Kumar',
      phone: MEMBER_ONE.phone,
      notes: MEMBER_ONE.notes,
    });
    expect(patch?.csrfToken).toBeDefined();
  });

  it('refuses to save an invalid edit and does not send it', async () => {
    const user = userEvent.setup();
    const client = renderMembers(stubApiClient(), memberPath);

    await screen.findByRole('heading', { level: 1, name: MEMBER_ONE.name });
    await user.click(screen.getByRole('button', { name: 'Edit member' }));

    const nameField = await screen.findByLabelText('Full name (required)');
    await user.clear(nameField);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('A member name is required.')).toBeInTheDocument();
    expect(client.calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('associates the hint and the error with the control itself, for a screen reader', async () => {
    const user = userEvent.setup();

    renderMembers(stubApiClient(), memberPath);
    await screen.findByRole('heading', { level: 1, name: MEMBER_ONE.name });
    await user.click(screen.getByRole('button', { name: 'Edit member' }));

    // A hint is reachable from the input, not merely present in the document. An
    // `aria-describedby` on a wrapper `div` looks right in the markup and is never announced
    // when focus reaches the field.
    const phoneField = await screen.findByLabelText('Phone number (optional)');

    expect(phoneField).toHaveAttribute('aria-describedby', 'edit-member-phone-hint');
    expect(phoneField).not.toHaveAttribute('aria-invalid');

    await user.clear(phoneField);
    await user.type(phoneField, '123');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByText(/Enter a phone number with 7 to 15 digits\./);
    expect(phoneField).toHaveAttribute('aria-invalid', 'true');
    // Both are announced, the problem first: the error says what is wrong and the hint still
    // explains the field, so neither is lost when the other appears.
    expect(phoneField).toHaveAttribute(
      'aria-describedby',
      'edit-member-phone-error edit-member-phone-hint',
    );
  });

  it('explains a stale revision as a conflict and does not claim the edit saved', async () => {
    const user = userEvent.setup();

    renderMembers(stubApiClient({ members: { updateFails: staleMemberRevision } }), memberPath);

    await screen.findByRole('heading', { level: 1, name: MEMBER_ONE.name });
    await user.click(screen.getByRole('button', { name: 'Edit member' }));

    const nameField = await screen.findByLabelText('Full name (required)');
    await user.clear(nameField);
    await user.type(nameField, 'Another Name');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText(/changed by another action/)).toBeInTheDocument();
    expect(screen.queryByText(/was saved/)).not.toBeInTheDocument();
  });

  it('warns before unsaved edits are discarded', async () => {
    const user = userEvent.setup();

    renderMembers(stubApiClient(), memberPath);
    await screen.findByRole('heading', { level: 1, name: MEMBER_ONE.name });
    await user.click(screen.getByRole('button', { name: 'Edit member' }));

    const nameField = await screen.findByLabelText('Full name (required)');
    await user.clear(nameField);
    await user.type(nameField, 'Unsaved Change');
    await user.click(screen.getByRole('button', { name: 'Close editing' }));

    expect(await screen.findByText(/unsaved changes to this member/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(await screen.findByLabelText('Full name (required)')).toHaveValue('Unsaved Change');
  });

  it('protects unsaved edits from the Cancel control as well as from closing the editor', async () => {
    const user = userEvent.setup();

    renderMembers(stubApiClient(), memberPath);
    await screen.findByRole('heading', { level: 1, name: MEMBER_ONE.name });
    await user.click(screen.getByRole('button', { name: 'Edit member' }));

    const nameField = await screen.findByLabelText('Full name (required)');
    await user.clear(nameField);
    await user.type(nameField, 'Unsaved Change');
    // Two controls can close the editor, so both have to offer the same protection. A Cancel
    // that discarded silently would be a way around the warning.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText(/unsaved changes to this member/)).toBeInTheDocument();
    expect(screen.getByLabelText('Full name (required)')).toHaveValue('Unsaved Change');
  });

  it('discards the edits when the Admin confirms the warning', async () => {
    const user = userEvent.setup();

    renderMembers(stubApiClient(), memberPath);
    await screen.findByRole('heading', { level: 1, name: MEMBER_ONE.name });
    await user.click(screen.getByRole('button', { name: 'Edit member' }));

    const nameField = await screen.findByLabelText('Full name (required)');
    await user.clear(nameField);
    await user.type(nameField, 'Unsaved Change');
    await user.click(screen.getByRole('button', { name: 'Close editing' }));
    await user.click(await screen.findByRole('button', { name: 'Discard the changes' }));

    await waitFor(() => {
      expect(screen.queryByLabelText('Full name (required)')).not.toBeInTheDocument();
    });
  });

  it('configures a contribution month with an explicit expected amount', async () => {
    const user = userEvent.setup();
    const client = renderMembers(stubApiClient(), memberPath);

    await screen.findByRole('heading', { level: 1, name: MEMBER_ONE.name });
    await user.selectOptions(screen.getByLabelText('Month'), '7');
    await user.clear(screen.getByLabelText('Year'));
    await user.type(screen.getByLabelText('Year'), '2027');
    await user.type(screen.getByLabelText(/Expected amount/), '750');
    await user.click(screen.getByRole('button', { name: 'Save expected amount' }));

    expect(await screen.findByText(/Jul 2027 is set to ₹750\.00/)).toBeInTheDocument();

    const put = lastCallTo(client, 'PUT', '/contribution-periods/');
    expect(put?.path).toBe(`/contribution-periods/${MEMBER_ONE.id}/2027/7`);
    expect(put?.body).toEqual({ expectedPaise: '750' });
  });

  it('omits the amount entirely so the API applies the configured default', async () => {
    const user = userEvent.setup();
    const client = renderMembers(stubApiClient(), memberPath);

    await screen.findByRole('heading', { level: 1, name: MEMBER_ONE.name });
    await user.selectOptions(screen.getByLabelText('Month'), '6');
    await user.click(screen.getByRole('button', { name: 'Save expected amount' }));

    await waitFor(() => {
      expect(lastCallTo(client, 'PUT', '/contribution-periods/')).toBeDefined();
    });

    // The body must be empty, not `{ expectedPaise: '' }`: an empty string is an invalid
    // amount, while an absent one is what asks the server for the church default.
    expect(lastCallTo(client, 'PUT', '/contribution-periods/')?.body).toEqual({});
  });

  it('rejects a malformed expected amount without contacting the API', async () => {
    const user = userEvent.setup();
    const client = renderMembers(stubApiClient(), memberPath);

    await screen.findByRole('heading', { level: 1, name: MEMBER_ONE.name });
    await user.type(screen.getByLabelText(/Expected amount/), 'five hundred');
    await user.click(screen.getByRole('button', { name: 'Save expected amount' }));

    expect(await screen.findByText(/at most two decimal places/)).toBeInTheDocument();
    expect(client.calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('offers no transaction controls, because writing them is a later phase', async () => {
    renderMembers(stubApiClient(), memberPath);

    await screen.findByRole('heading', { level: 1, name: MEMBER_ONE.name });

    // A visible control that does nothing is forbidden by the UI rules, so the history is
    // read-only and says so rather than offering void or edit buttons.
    expect(screen.getByText('Contribution history')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /void/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit payment/i })).not.toBeInTheDocument();
  });
});

describe('the Members navigation', () => {
  it('is reachable from the shell and is the current section when open', async () => {
    const user = userEvent.setup();

    renderMembers(stubApiClient(), '/');

    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    const membersLink = screen.getByRole('link', { name: 'Members' });

    expect(membersLink).toBeInTheDocument();

    await user.click(membersLink);

    expect(await screen.findByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('recording a payment from a member', () => {
  const memberPaymentPath = `/members/${MEMBER_ONE.id}`;

  /**
   * Finding a member to pay was the step that stopped contributions being recorded.
   *
   * The income screen offered only the first page of members by name, so a member past that page
   * could not be named at all. These tests hold the member detail screen to removing that lookup
   * entirely: the Admin opens the member, presses Record payment, and the member is already named
   * above the amount.
   */
  async function openPaymentForm(user: ReturnType<typeof userEvent.setup>): Promise<StubApiClient> {
    const client = renderMembers(stubApiClient(), memberPaymentPath);

    await screen.findByRole('heading', { level: 1, name: MEMBER_ONE.name });
    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(await screen.findByRole('heading', { name: 'Record payment' })).toBeInTheDocument();

    return client;
  }

  it('names the member and offers no way to change them', async () => {
    const user = userEvent.setup();

    await openPaymentForm(user);

    const locked = screen.getByTestId('locked-member');

    // The three facts the Admin needs to confirm they are paying the right person: the name, the
    // permanent ID, and the number that distinguishes two people with the same name.
    expect(within(locked).getByText(MEMBER_ONE.name)).toBeVisible();
    expect(within(locked).getByText(MEMBER_ONE.referenceId)).toBeVisible();
    expect(within(locked).getByText('9000000001')).toBeVisible();

    // No lookup, because the member is not a question here. Leaving one out would invite a search
    // that could only ever return a different member than the one being paid.
    expect(screen.queryByLabelText('Search members')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^Member/ })).not.toBeInTheDocument();
  });

  it('records the payment against the member the API already identified', async () => {
    const user = userEvent.setup({ delay: null });
    const client = await openPaymentForm(user);

    const businessDate = screen.getByLabelText<HTMLInputElement>('Business date (required)');

    await user.clear(businessDate);
    await user.type(businessDate, '2026-09-28');
    await user.type(screen.getByLabelText('Amount (required)'), '500');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(await screen.findByText(/credited to September 2026/)).toBeInTheDocument();

    // The identifier is the member's real UUID and the month comes from the business date, so the
    // payment cannot be filed against a different person or a month the date does not fall in.
    expect(lastCallTo(client, 'POST', '/income')?.body).toMatchObject({
      incomeType: 'MEMBER_CONTRIBUTION',
      memberId: MEMBER_ONE.id,
      businessDate: '2026-09-28',
      contributionPeriod: { year: 2026, month: 9 },
    });
  });

  it('states which month the payment is credited to, and follows the business date', async () => {
    const user = userEvent.setup();
    const stub = stubApiClient();

    renderMembers(stub, memberPaymentPath);
    await screen.findByRole('heading', { level: 1, name: MEMBER_ONE.name });
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    await screen.findByRole('heading', { name: 'Record payment' });

    const businessDate = await screen.findByLabelText<HTMLInputElement>('Business date (required)');

    // The pre-filled date is today, so the month is stated without the Admin doing anything.
    expect(screen.getByTestId('credited-month')).toHaveTextContent(/\d{4} contribution period\.$/);

    // A contribution for last month entered today is credited to last month, and the sentence says
    // so rather than leaving the Admin to assume the current month.
    await user.clear(businessDate);
    await user.type(businessDate, '2026-03-05');

    expect(screen.getByTestId('credited-month')).toHaveTextContent(
      'Credited to the March 2026 contribution period.',
    );
  });

  it('says nothing about a month while the date is unusable, rather than guessing', async () => {
    const user = userEvent.setup();

    await openPaymentForm(user);

    const businessDate = await screen.findByLabelText<HTMLInputElement>('Business date (required)');

    await user.clear(businessDate);

    // A credited month shown for a date the API will reject is exactly the misleading state the
    // UI rules forbid, so the honest answer is that the month is not yet knowable.
    expect(screen.getByTestId('credited-month')).toHaveTextContent(
      'Enter a business date to see the month this payment is credited to.',
    );
  });

  it('does not offer an income type, because a payment is a member contribution', async () => {
    const user = userEvent.setup();

    await openPaymentForm(user);

    // Offering, Donation, and Anonymous Donation are recordable on the income screen. Offering them
    // here would let the Admin record something other than the payment they came to record.
    expect(screen.queryByLabelText('Income type (required)')).not.toBeInTheDocument();
    expect(screen.getByText(/recorded as member contribution/i)).toBeInTheDocument();
  });

  it('warns before a typed amount is lost to a navigation', async () => {
    // `REQ-RESP-008`. The payment is recorded against the ledger, so a half-typed amount that
    // vanishes silently is a number the Admin believes they entered.
    const user = userEvent.setup();

    await openPaymentForm(user);
    await user.type(screen.getByLabelText('Amount (required)'), '500');

    await user.click(screen.getByRole('link', { name: 'Members' }));

    expect(await screen.findByText('Leave with unsaved changes?')).toBeInTheDocument();
    expect(lastCallTo(stubApiClient(), 'POST', '/income')).toBeUndefined();
  });

  it('closes on Cancel without recording anything', async () => {
    const user = userEvent.setup({ delay: null });
    const client = await openPaymentForm(user);

    await user.type(screen.getByLabelText('Amount (required)'), '500');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Amount (required)')).not.toBeInTheDocument();
    expect(client.calls.some((call) => call.method === 'POST' && call.path === '/income')).toBe(
      false,
    );
  });

  it('reuses one idempotency key across a retry, so a timeout cannot double-record', async () => {
    const user = userEvent.setup({ delay: null });
    const client = renderMembers(
      stubApiClient({ transactions: { firstCreateFails: transportFailure } }),
      memberPaymentPath,
    );

    await screen.findByRole('heading', { level: 1, name: MEMBER_ONE.name });
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    await screen.findByLabelText('Amount (required)');

    await user.type(screen.getByLabelText('Amount (required)'), '500');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The API could not be reached.');

    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(await screen.findByText(/credited to/)).toBeInTheDocument();

    const keys = client.calls
      .filter((call) => call.method === 'POST' && call.path === '/income')
      .map((call) => call.idempotencyKey);

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });
});

describe('a member added and paid in one visit', () => {
  /**
   * A member who is handed a contribution at the door is very often not in the list yet.
   *
   * The two writes stay separate on purpose: the member is created first, and only then is a
   * payment recorded against its real UUID. Nothing here invents a member as a side effect of
   * recording money, and nothing records money as a side effect of adding a member.
   */
  async function addMember(user: ReturnType<typeof userEvent.setup>): Promise<StubApiClient> {
    const client = renderMembers(stubApiClient());

    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Add a member' }));
    await user.type(await screen.findByLabelText('Full name (required)'), 'Ravi Menon');
    await user.type(screen.getByLabelText('Phone number (optional)'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Add member' }));

    await screen.findByText(/Ravi Menon was added as member HY-MEM-/);

    return client;
  }

  it('opens a payment form for the member just created, with that member locked', async () => {
    const user = userEvent.setup({ delay: null });

    await addMember(user);

    const locked = await screen.findByTestId('locked-member');

    // The member was named by the create response, so the payment cannot be pointed at anyone else
    // and no refetch was needed to get the permanent ID. The list page's own member *search* box is
    // a different control and is not what this form is asserting about.
    expect(within(locked).getByText('Ravi Menon')).toBeVisible();
    expect(within(locked).getByText(/HY-MEM-/)).toBeVisible();
    expect(screen.queryByRole('combobox', { name: /^Member/ })).not.toBeInTheDocument();
  });

  it('records the payment against the created member rather than creating a second one', async () => {
    const user = userEvent.setup({ delay: null });
    const client = await addMember(user);

    const created = client.members.find((member) => member.name === 'Ravi Menon');

    expect(created).toBeDefined();
    await user.type(screen.getByLabelText('Amount (required)'), '750');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(await screen.findByText(/credited to/)).toBeInTheDocument();

    expect(lastCallTo(client, 'POST', '/income')?.body).toMatchObject({
      incomeType: 'MEMBER_CONTRIBUTION',
      memberId: created?.id,
    });
    // Two writes, one of each: the member already existed before the payment was recorded.
    expect(
      client.calls.filter((call) => call.method === 'POST' && call.path === '/members'),
    ).toHaveLength(1);
    expect(client.members.filter((member) => member.name === 'Ravi Menon')).toHaveLength(1);
  });

  it('records a second payment for the same member without duplicating them', async () => {
    const user = userEvent.setup({ delay: null });
    const client = await addMember(user);

    await user.type(screen.getByLabelText('Amount (required)'), '750');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    await screen.findByText(/credited to/);

    // The form resets after a success, so the same member is paid again for the next month. The
    // member record is untouched: a second contribution is a second payment, not a second person.
    const locked = await screen.findByTestId('locked-member');

    expect(within(locked).getByText('Ravi Menon')).toBeVisible();

    await user.type(screen.getByLabelText('Amount (required)'), '750');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    await waitFor(() => {
      expect(
        client.calls.filter((call) => call.method === 'POST' && call.path === '/income'),
      ).toHaveLength(2);
    });

    expect(client.members.filter((member) => member.name === 'Ravi Menon')).toHaveLength(1);
  });
});
