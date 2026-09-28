import { isApiListEnvelope, isApiPagination, list } from '@hyssop/contracts';

/**
 * Contract guards for the list envelope.
 *
 * These live in the API test tree because `@hyssop/contracts` is a shared dependency with
 * no test runner of its own, and the browser consumes exactly these guards. A regression
 * here would let a malformed page render as a complete list in both applications.
 */

describe('isApiPagination', () => {
  const VALID = { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 };

  it('accepts a well-formed first page of an empty result', () => {
    expect(isApiPagination(VALID)).toBe(true);
  });

  it('accepts a middle page whose counts agree', () => {
    expect(isApiPagination({ page: 2, pageSize: 20, totalItems: 45, totalPages: 3 })).toBe(true);
  });

  it('accepts the last partial page', () => {
    expect(isApiPagination({ page: 3, pageSize: 20, totalItems: 45, totalPages: 3 })).toBe(true);
  });

  it.each([
    ['a zero page', { ...VALID, page: 0 }],
    ['a negative page', { ...VALID, page: -1 }],
    ['a zero page size', { ...VALID, pageSize: 0 }],
    ['a negative total', { ...VALID, totalItems: -1 }],
    ['a non-integer page', { ...VALID, page: 1.5 }],
    ['a non-integer page size', { ...VALID, pageSize: '20' }],
    ['a negative total pages', { ...VALID, totalPages: -1 }],
  ])('rejects %s', (_label, candidate) => {
    expect(isApiPagination(candidate)).toBe(false);
  });

  it('rejects counts that disagree with each other', () => {
    // 45 items at 20 per page is 3 pages, so 99 pages is a malformed response.
    expect(isApiPagination({ page: 1, pageSize: 20, totalItems: 45, totalPages: 99 })).toBe(false);
    // Zero items cannot fill a page.
    expect(isApiPagination({ page: 1, pageSize: 20, totalItems: 0, totalPages: 1 })).toBe(false);
  });

  it('rejects a page beyond the last one', () => {
    expect(isApiPagination({ page: 4, pageSize: 20, totalItems: 45, totalPages: 3 })).toBe(false);
  });

  it('rejects non-objects and null', () => {
    for (const candidate of [null, undefined, 42, 'page', [], true]) {
      expect(isApiPagination(candidate)).toBe(false);
    }
  });
});

describe('isApiListEnvelope', () => {
  it('accepts the envelope produced by the shared list builder', () => {
    const envelope = list([1, 2, 3], { page: 1, pageSize: 20, totalItems: 3 });

    expect(isApiListEnvelope(envelope)).toBe(true);
  });

  it('accepts an empty page', () => {
    const envelope = list([], { page: 1, pageSize: 20, totalItems: 0 });

    expect(isApiListEnvelope(envelope)).toBe(true);
  });

  it('rejects a payload whose rows exceed the page size it claims', () => {
    // The shape of a truncated or over-full page, which must never render as complete.
    const envelope = {
      data: [1, 2, 3],
      pagination: { page: 1, pageSize: 2, totalItems: 2, totalPages: 1 },
    };

    expect(isApiListEnvelope(envelope)).toBe(false);
  });

  it('rejects a missing or non-array data field', () => {
    const pagination = { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 };

    expect(isApiListEnvelope({ pagination })).toBe(false);
    expect(isApiListEnvelope({ data: { '0': 'a' }, pagination })).toBe(false);
  });

  it('rejects an envelope with invalid pagination', () => {
    const envelope = {
      data: [],
      pagination: { page: 0, pageSize: 0, totalItems: 0, totalPages: 0 },
    };

    expect(isApiListEnvelope(envelope)).toBe(false);
  });

  it('rejects non-objects and null', () => {
    for (const candidate of [null, undefined, 0, 'list', []]) {
      expect(isApiListEnvelope(candidate)).toBe(false);
    }
  });
});
