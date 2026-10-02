import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SEARCH_QUERY_MAX_LENGTH, SEARCH_TYPES } from '@hyssop/contracts';
import { renderRoute } from '../../test/render';
import {
  INCOME_VOIDED,
  MEMBER_ONE,
  SEARCH_RESPONSE,
  stubApiClient,
  transportFailure,
  type StubApiClient,
} from '../../test/stub-client';

/**
 * Browser tests for the global search screen.
 *
 * They satisfy the `TEST-SEARCH-*` browser cases: nothing is requested until it is asked for, the
 * count shown is the API's rather than the page's, a voided transaction is labelled rather than
 * hidden, each result kind is identified, and every state is distinguishable.
 *
 * A search is not a period, so nothing here asserts a total: summing the results would produce a
 * figure `docs/02-ARCHITECTURE.md` does not allow the browser to decide.
 */

/** The search paths the stub was actually asked for, in order. */
function searchPaths(client: StubApiClient): readonly string[] {
  return client.calls.filter((call) => call.path.startsWith('/search')).map((call) => call.path);
}

async function renderSearch(
  path = '/search',
  client: StubApiClient = stubApiClient(),
): Promise<StubApiClient> {
  renderRoute({ path, client });

  await screen.findByRole('heading', { level: 1, name: 'Search' });

  return client;
}

describe('nothing is searched until it is asked for', () => {
  it('sends no request on arrival', async () => {
    const client = await renderSearch();

    expect(screen.getByText('Nothing searched yet')).toBeVisible();
    expect(searchPaths(client)).toEqual([]);
  });

  it('does not search for a blank term, because the API requires one', async () => {
    const user = userEvent.setup();
    const client = await renderSearch();

    await user.type(screen.getByLabelText('Search term'), '   ');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    // A trimmed empty term is not a search that matches nothing; it is a request the API rejects.
    expect(searchPaths(client)).toEqual([]);
    expect(screen.getByText('Nothing searched yet')).toBeVisible();
  });
});

describe('the results', () => {
  it('searches for the submitted term and reports the API count, not the page count', async () => {
    const user = userEvent.setup();
    const client = await renderSearch();

    await user.type(screen.getByLabelText('Search term'), 'HY');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(searchPaths(client)).toEqual(['/search?q=HY&type=all']);
    // The fixture has 2 results across 2 rows, so the count and the row count happen to agree. The
    // assertion is on the API's own `totalItems`, which is what a later page must keep showing.
    expect(await screen.findByTestId('result-count')).toHaveTextContent('2 results for “HY”');
  });

  it('identifies each result kind rather than calling both of them results', async () => {
    const user = userEvent.setup();

    await renderSearch();

    await user.type(screen.getByLabelText('Search term'), 'HY');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('region', { name: 'Members (1 on this page)' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Transactions (1 on this page)' })).toBeVisible();
  });

  it('keeps a voided transaction in the results and labels it, rather than hiding it', async () => {
    const user = userEvent.setup();

    await renderSearch();

    await user.type(screen.getByLabelText('Search term'), 'HY');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    const panel = await screen.findByRole('region', { name: 'Transactions (1 on this page)' });

    // `REQ-SEARCH-002` asks for the bounded, safe answer. Hiding a voided record would make the
    // search contradict the transaction list, so it stays and says what it is.
    expect(within(panel).getByText(INCOME_VOIDED.referenceId)).toBeVisible();
    expect(within(panel).getByText('Voided')).toBeVisible();
  });

  it('shows the stored amount and the member a transaction belongs to', async () => {
    const user = userEvent.setup();

    await renderSearch();

    await user.type(screen.getByLabelText('Search term'), 'HY');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    const panel = await screen.findByRole('region', { name: 'Transactions (1 on this page)' });

    expect(within(panel).getByText('₹300.00')).toBeVisible();
    expect(
      within(panel).getByText(
        `${INCOME_VOIDED.member?.name} (${INCOME_VOIDED.member?.referenceId})`,
      ),
    ).toBeVisible();
  });

  it('links a member result to that member and a transaction to its own detail screen', async () => {
    const user = userEvent.setup();

    await renderSearch();

    await user.type(screen.getByLabelText('Search term'), 'HY');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    const members = await screen.findByRole('region', { name: 'Members (1 on this page)' });

    expect(within(members).getByRole('link', { name: MEMBER_ONE.name })).toHaveAttribute(
      'href',
      `/members/${MEMBER_ONE.id}`,
    );

    const transactions = screen.getByRole('region', { name: 'Transactions (1 on this page)' });

    expect(
      within(transactions).getByRole('link', { name: `Open ${INCOME_VOIDED.referenceId}` }),
    ).toHaveAttribute('href', `/income/${INCOME_VOIDED.id}`);
  });

  it('searches only the scope the Admin chose', async () => {
    const user = userEvent.setup();
    const client = await renderSearch();

    await user.selectOptions(screen.getByLabelText('Search in'), 'member');
    await user.type(screen.getByLabelText('Search term'), 'HY');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(searchPaths(client)).toEqual(['/search?q=HY&type=member']);
  });

  it('offers exactly the three documented scopes', async () => {
    await renderSearch();

    const scope = screen.getByLabelText('Search in');

    expect(
      within(scope)
        .getAllByRole('option')
        .map((option) => option.getAttribute('value')),
    ).toEqual([...SEARCH_TYPES]);
  });
});

describe('the URL as the record of the search', () => {
  it('reads a shared link and searches for it directly', async () => {
    const client = await renderSearch('/search?q=Anitha&type=member');

    expect(searchPaths(client)).toEqual(['/search?q=Anitha&type=member']);
    // The field shows what was searched, so a shared link is reproducible rather than a blank form.
    expect(screen.getByLabelText('Search term')).toHaveValue('Anitha');
  });

  it('falls back to searching everything for an unrecognised scope', async () => {
    const client = await renderSearch('/search?q=Anitha&type=everything');

    // A stale link should not silently appear to find nothing.
    expect(searchPaths(client)).toEqual(['/search?q=Anitha&type=all']);
  });

  it('clears the search and returns to the empty state', async () => {
    const user = userEvent.setup();
    const client = await renderSearch('/search?q=HY');

    await screen.findByTestId('result-count');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(screen.getByText('Nothing searched yet')).toBeVisible();
    // The screen is back where it started, so the earlier search must not still be on screen.
    await waitFor(() => {
      expect(searchPaths(client)).toHaveLength(1);
    });
  });

  it('bounds the term at the length the API accepts', async () => {
    await renderSearch();

    expect(screen.getByLabelText('Search term')).toHaveAttribute(
      'maxlength',
      String(SEARCH_QUERY_MAX_LENGTH),
    );
  });
});

describe('search states', () => {
  it('says plainly when nothing matched', async () => {
    const user = userEvent.setup();

    await renderSearch(
      '/search',
      stubApiClient({
        reports: {
          searchResults: {
            ...SEARCH_RESPONSE,
            results: [],
            pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
          },
        },
      }),
    );

    await user.type(screen.getByLabelText('Search term'), 'zzz');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Nothing matched that search')).toBeVisible();
    expect(screen.getByTestId('result-count')).toHaveTextContent('0 results');
  });

  it('reports a failed search and offers a working retry', async () => {
    const user = userEvent.setup();
    const client = await renderSearch(
      '/search',
      stubApiClient({ reports: { searchFails: transportFailure } }),
    );

    // The failure has to be provoked by a real search, because the screen asks for nothing until a
    // term is submitted.
    await user.type(screen.getByLabelText('Search term'), 'HY');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The API could not be reached.');
    expect(searchPaths(client)).toHaveLength(1);

    // The retry is only real if a second request is actually sent.
    await user.click(screen.getByRole('button', { name: 'Search again' }));

    await waitFor(() => {
      expect(searchPaths(client).length).toBeGreaterThan(1);
    });
  });

  it('does not report an error as zero results', async () => {
    const user = userEvent.setup();

    await renderSearch('/search', stubApiClient({ reports: { searchFails: transportFailure } }));

    await user.type(screen.getByLabelText('Search term'), 'HY');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    // "0 results" would be a false financial-free statement about the church's records.
    await screen.findByRole('alert');
    expect(screen.queryByText('Nothing matched that search')).not.toBeInTheDocument();
  });
});
