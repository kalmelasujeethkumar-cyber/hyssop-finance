import { Test } from '@nestjs/testing';
import { AuditEventRepository } from '../database/audit/audit-event.repository';
import { ContributionPeriodRepository } from '../database/contributions/contribution-period.repository';
import { MemberRepository } from '../database/members/member.repository';
import { ReconciliationService } from '../database/reconciliation/reconciliation.service';
import { TransactionRepository } from '../database/transactions/transaction.repository';
import { DomainError } from '../common/errors/domain.errors';
import type { SearchResult } from '@hyssop/contracts';
import { ReportsService } from './reports.service';

/**
 * `REQ-SEARCH-001` / `REQ-SEARCH-002` global search paging.
 *
 * Global search merges two independently paginated sources into what the Admin sees as one ordered
 * list. That merge is the part worth testing, because getting it wrong does not throw — it silently
 * returns twice the requested page size, skips rows, or reports a `totalItems` that disagrees with
 * what is on screen.
 *
 * The order is defined as: every matching member in member order, then every matching transaction
 * in transaction order. These tests pin that window arithmetic for both a member-heavy and a
 * transaction-heavy result set.
 */
describe('ReportsService.search', () => {
  const memberRow = (index: number): Record<string, unknown> => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    referenceId: `MEM-${index}`,
    name: `Member ${index}`,
    phone: `+9198${String(100000000 + index)}`,
  });

  const transactionRow = (index: number): Record<string, unknown> => ({
    id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    referenceId: `TXN-${index}`,
    type: 'INCOME',
    incomeType: 'OFFERING',
    amountPaise: 1000n,
    paymentMethod: 'CASH',
    status: 'ACTIVE',
    businessDate: new Date('2026-09-01T00:00:00.000Z'),
    description: null,
    notes: null,
    voidReason: null,
    voidedAt: null,
    contributionPeriod: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    member: null,
    category: null,
    documents: [],
    _count: { documents: 0 },
  });

  interface Harness {
    readonly service: ReportsService;
    readonly memberSearch: jest.Mock;
    readonly memberCount: jest.Mock;
    readonly transactionSearch: jest.Mock;
    readonly transactionCount: jest.Mock;
  }

  async function build(memberTotal: number, transactionTotal: number): Promise<Harness> {
    // The mocks honour the requested `limit`/`offset`, so a merged page really does contain the
    // number of rows the arithmetic claimed. Returning a fixed array instead would make a page-size
    // assertion vacuous.
    const memberSearch = jest.fn(({ limit, offset }: { limit: number; offset: number }) =>
      Promise.resolve(
        Array.from({ length: Math.max(0, Math.min(limit, memberTotal - offset)) }, (_, index) =>
          memberRow(offset + index + 1),
        ),
      ),
    );
    const memberCount = jest.fn().mockResolvedValue(memberTotal);
    const transactionSearch = jest.fn(
      (_term: string, { limit, offset }: { limit: number; offset: number }) =>
        Promise.resolve(
          Array.from(
            { length: Math.max(0, Math.min(limit, transactionTotal - offset)) },
            (_, index) => transactionRow(offset + index + 1),
          ),
        ),
    );
    const transactionCount = jest.fn().mockResolvedValue(transactionTotal);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: ReconciliationService, useValue: {} },
        {
          provide: TransactionRepository,
          useValue: { searchGlobally: transactionSearch, countSearchGlobally: transactionCount },
        },
        {
          provide: MemberRepository,
          useValue: { search: memberSearch, countMatching: memberCount },
        },
        { provide: ContributionPeriodRepository, useValue: {} },
        { provide: AuditEventRepository, useValue: {} },
      ],
    }).compile();

    return {
      service: moduleRef.get(ReportsService),
      memberSearch,
      memberCount,
      transactionSearch,
      transactionCount,
    };
  }

  /** `build` plus the first page's result rows, for asserting the merged length. */
  async function collect(
    memberTotal: number,
    transactionTotal: number,
    pageSize: number,
  ): Promise<
    Omit<Harness, 'memberCount' | 'transactionCount'> & { results: readonly SearchResult[] }
  > {
    const harness = await build(memberTotal, transactionTotal);
    const page = await harness.service.search({
      term: 'anita',
      type: 'all',
      page: { page: 1, pageSize },
    });

    return { ...harness, results: page.results };
  }

  /**
   * Walks every page of one merged result set and reports each page's length.
   *
   * This is the invariant a concatenated two-source search gets wrong: each page must be exactly
   * `pageSize` rows, with no gap and no overlap at the member/transaction boundary.
   */
  async function collectAcrossPages(
    memberTotal: number,
    transactionTotal: number,
    pageSize: number,
  ): Promise<{ collectResults: number[] }> {
    const harness = await build(memberTotal, transactionTotal);
    const lengths: number[] = [];

    for (let pageNumber = 1; ; pageNumber += 1) {
      const page = await harness.service.search({
        term: 'anita',
        type: 'all',
        page: { page: pageNumber, pageSize },
      });

      if (page.results.length === 0) {
        break;
      }

      lengths.push(page.results.length);
    }

    return { collectResults: lengths };
  }

  it('reports the combined total across both sources', async () => {
    const { service } = await build(7, 12);

    const result = await service.search({
      term: 'anita',
      type: 'all',
      page: { page: 1, pageSize: 10 },
    });

    expect(result.pagination.totalItems).toBe(19);
  });

  it('never asks one source for more rows than match, when the page fits inside one source', async () => {
    const { service, memberSearch, transactionSearch } = await build(30, 40);

    const result = await service.search({
      term: 'anita',
      type: 'all',
      page: { page: 1, pageSize: 5 },
    });

    // Page 1 covers merged positions 0..4, which are all members because there are 30 of them.
    expect(memberSearch).toHaveBeenCalledWith({ search: 'anita', limit: 5, offset: 0 });
    expect(transactionSearch).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(5);
  });

  it('reads exactly the remainder of the member block when a page ends inside it', async () => {
    const { memberSearch, transactionSearch, results } = await collect(3, 40, 5);

    // Only 3 members exist, so positions 3 and 4 are transactions: the page is filled from both.
    expect(memberSearch).toHaveBeenCalledWith({ search: 'anita', limit: 3, offset: 0 });
    expect(transactionSearch).toHaveBeenCalledWith('anita', { limit: 2, offset: 0 });
    expect(results).toHaveLength(5);
  });

  it('splits a page that straddles the member/transaction boundary', async () => {
    const { memberSearch, transactionSearch, results } = await collect(4, 10, 6);

    expect(memberSearch).toHaveBeenCalledWith({ search: 'anita', limit: 4, offset: 0 });
    expect(transactionSearch).toHaveBeenCalledWith('anita', { limit: 2, offset: 0 });
    // Merged positions 0..5 are 4 members then the first 2 transactions — a full page, no overlap.
    expect(results).toHaveLength(6);
  });

  it('skips past every member on a later page instead of re-reading the member block', async () => {
    const { service, memberSearch, transactionSearch } = await build(4, 10);

    await service.search({ term: 'anita', type: 'all', page: { page: 2, pageSize: 6 } });

    // Page 2 covers merged positions 6..11: all transactions, starting at transaction index 2.
    expect(memberSearch).not.toHaveBeenCalled();
    expect(transactionSearch).toHaveBeenCalledWith('anita', { limit: 6, offset: 2 });
  });

  it('returns an empty page past the end of both sources rather than an error', async () => {
    const { service, memberSearch, transactionSearch } = await build(4, 10);

    const result = await service.search({
      term: 'anita',
      type: 'all',
      page: { page: 9, pageSize: 6 },
    });

    expect(memberSearch).not.toHaveBeenCalled();
    // Clamped to the end of the result set: asking for a full page beyond the last match would
    // issue a query that can only ever return nothing.
    expect(transactionSearch).not.toHaveBeenCalled();
    expect(result.results).toEqual([]);
    expect(result.pagination.totalItems).toBe(14);
  });

  it('returns a short final page rather than padding past the end of the results', async () => {
    const harness = await build(4, 10);

    // 14 total in pages of 6 gives 6, 6, 2.
    const first = await harness.service.search({
      term: 'anita',
      type: 'all',
      page: { page: 1, pageSize: 6 },
    });
    const last = await harness.service.search({
      term: 'anita',
      type: 'all',
      page: { page: 3, pageSize: 6 },
    });

    expect(first.results).toHaveLength(6);
    expect(last.results).toHaveLength(2);
  });

  it('keeps every page exactly one page long while results remain', async () => {
    const { collectResults } = await collectAcrossPages(20, 20, 5);

    // 40 merged results in pages of 5: eight full pages, then an empty one that ends the walk.
    expect(collectResults).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
  });

  it('queries only the requested source when the Admin filters by type', async () => {
    const { service, memberSearch, transactionSearch, memberCount } = await build(4, 10);

    await service.search({ term: 'anita', type: 'transaction', page: { page: 1, pageSize: 6 } });

    expect(memberSearch).not.toHaveBeenCalled();
    expect(memberCount).not.toHaveBeenCalled();
    expect(transactionSearch).toHaveBeenCalledWith('anita', { limit: 6, offset: 0 });
  });

  it('trims the term before searching', async () => {
    const { service, memberSearch } = await build(1, 0);

    await service.search({ term: '  anita  ', type: 'member', page: { page: 1, pageSize: 10 } });

    expect(memberSearch).toHaveBeenCalledWith({ search: 'anita', limit: 1, offset: 0 });
  });

  it('rejects a whitespace-only query instead of listing the whole table', async () => {
    const { service, memberSearch, transactionSearch } = await build(4, 10);

    await expect(
      service.search({ term: '   ', type: 'all', page: { page: 1, pageSize: 10 } }),
    ).rejects.toBeInstanceOf(DomainError);

    expect(memberSearch).not.toHaveBeenCalled();
    expect(transactionSearch).not.toHaveBeenCalled();
  });

  it('returns each source already projected, keeping member rows before transaction rows', async () => {
    const { service } = await build(2, 1);

    const result = await service.search({
      term: 'anita',
      type: 'all',
      page: { page: 1, pageSize: 10 },
    });

    expect(result.results.map((entry) => entry.kind)).toEqual(['member', 'member', 'transaction']);
  });

  it('strips identity from an anonymous donation found by search', async () => {
    const anonymous = {
      ...transactionRow(1),
      incomeType: 'ANONYMOUS_DONATION',
      member: memberRow(99),
      description: 'Secret donor',
    };
    const transactionSearch = jest.fn().mockResolvedValue([anonymous]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: ReconciliationService, useValue: {} },
        {
          provide: TransactionRepository,
          useValue: {
            searchGlobally: transactionSearch,
            countSearchGlobally: jest.fn().mockResolvedValue(1),
          },
        },
        {
          provide: MemberRepository,
          useValue: {
            search: jest.fn().mockResolvedValue([]),
            countMatching: jest.fn().mockResolvedValue(0),
          },
        },
        { provide: ContributionPeriodRepository, useValue: {} },
        { provide: AuditEventRepository, useValue: {} },
      ],
    }).compile();

    const result = await moduleRef
      .get(ReportsService)
      .search({ term: 'anita', type: 'transaction', page: { page: 1, pageSize: 10 } });

    const [entry] = result.results;

    // Narrowed first, because `SearchResult` is a union and the transaction variant is the only one
    // carrying a `transaction`.
    expect(entry?.kind).toBe('transaction');

    if (entry?.kind !== 'transaction') {
      throw new Error('expected a transaction search result');
    }

    expect(entry.transaction.member).toBeNull();
  });
});
