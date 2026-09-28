import {
  HEALTH_SERVICE_NAME,
  type AdminProfile,
  type ContributionPeriodSummary,
  type ContributionPeriodView,
  type CsrfTokenResult,
  type CurrentSessionResult,
  type HealthReport,
  type LoginResult,
  type LogoutResult,
  type MemberDetail,
  type MemberSortDirection,
  type MemberSortField,
  type MemberSummary,
  type MemberTransactionView,
  type SessionContext,
} from '@hyssop/contracts';
import {
  ApiClientError,
  ApiTransportError,
  type ApiClient,
  type ApiListPage,
} from '../lib/api-client';

export const HEALTH_REPORT: HealthReport = {
  status: 'ok',
  service: HEALTH_SERVICE_NAME,
  version: '0.1.0',
  uptimeSeconds: 42,
  timestamp: '2026-09-26T09:15:00.000Z',
};

export const ADMIN_PROFILE: AdminProfile = {
  id: '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  identifier: 'admin',
  displayName: 'Demo Admin',
};

export const SESSION_CONTEXT: SessionContext = {
  issuedAt: '2026-09-26T12:00:00.000Z',
  expiresAt: '2026-09-26T20:00:00.000Z',
};

export const SESSION_RESULT: CurrentSessionResult = {
  admin: ADMIN_PROFILE,
  session: SESSION_CONTEXT,
};

export const CSRF_TOKEN_RESULT: CsrfTokenResult = {
  csrfToken: 'b'.repeat(43),
  expiresAt: '2026-09-26T12:15:00.000Z',
};

export const LOGIN_RESULT: LoginResult = {
  admin: ADMIN_PROFILE,
  session: SESSION_CONTEXT,
  csrfToken: 'b'.repeat(43),
};

export const transportFailure = new ApiTransportError('The API could not be reached.');

export const serverFailure = new ApiClientError(
  503,
  'INTERNAL_ERROR',
  'An unexpected error occurred. Please try again.',
  '3f0a1b2c-4d5e-4f60-8a71-9b2c3d4e5f60',
);

export const unauthenticated = new ApiClientError(
  401,
  'UNAUTHENTICATED',
  'Your session is missing or has expired. Please sign in again.',
  '4a1b2c3d-5e6f-4a7b-8c8d-9e0f1a2b3c4d',
);

export const invalidCredentials = new ApiClientError(
  401,
  'INVALID_CREDENTIALS',
  'The identifier or password is incorrect.',
  '5b2c3d4e-6f7a-4b8c-8d9e-0f1a2b3c4d5e',
);

export const csrfFailed = new ApiClientError(
  403,
  'CSRF_FAILED',
  'The security token for this request is missing or invalid. Please reload and try again.',
  '6c3d4e5f-7a8b-4c9d-8e9f-0a1b2c3d4e5f',
);

/** The `409` the API returns when a member was edited by someone else first. */
export const staleMemberRevision = new ApiClientError(
  409,
  'CONFLICT',
  'This member was changed by another action. Reload the member and try again.',
  '7d4e5f6a-8b9c-4d0e-9f0a-1b2c3d4e5f60',
);

/**
 * Reads the revision out of a quoted `If-Match` entity-tag.
 *
 * Returns `undefined` for a missing, unquoted, or non-numeric value, which the caller
 * treats as "not a usable revision" and answers with `409` — the same as a genuinely stale
 * revision, because a header the API cannot interpret is not a matching precondition.
 */
export function parseEntityTagRevision(ifMatch: string | undefined): number | undefined {
  if (ifMatch === undefined) {
    return undefined;
  }

  const match = /^"(\d+)"$/.exec(ifMatch.trim());

  if (match === null) {
    return undefined;
  }

  const digits = match[1];

  // `noUncheckedIndexedAccess` is on, so the capture group is typed as possibly absent even
  // though the pattern guarantees it. The guard keeps the return type honest instead of
  // asserting the group away.
  if (digits === undefined) {
    return undefined;
  }

  return Number.parseInt(digits, 10);
}

export const MEMBER_ONE: MemberSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  referenceId: 'HY-MEM-0001',
  name: 'Anitha Kumar',
  phone: '9000000001',
  notes: 'Fictional demo member',
  revision: 1,
  createdAt: '2026-09-20T04:15:00.000Z',
  updatedAt: '2026-09-20T04:15:00.000Z',
};

export const MEMBER_TWO: MemberSummary = {
  id: '22222222-2222-4222-8222-222222222222',
  referenceId: 'HY-MEM-0002',
  name: 'Benedict D Souza',
  phone: '9000000002',
  notes: null,
  revision: 3,
  createdAt: '2026-09-18T04:15:00.000Z',
  updatedAt: '2026-09-24T04:15:00.000Z',
};

export const MEMBER_THREE: MemberSummary = {
  id: '33333333-3333-4333-8333-333333333333',
  referenceId: 'HY-MEM-0003',
  name: 'Chandralekha Nair',
  phone: '9000000003',
  notes: 'Prefers UPI',
  revision: 1,
  createdAt: '2026-09-22T04:15:00.000Z',
  updatedAt: '2026-09-22T04:15:00.000Z',
};

/**
 * Three configured months for one member.
 *
 * The three rows are the only honest way to show all three derived states on one screen,
 * and they are the exact statuses `REQ-CONTRIB-002` defines: received at or above
 * expected, received above zero and below expected, and received zero.
 */
export const MEMBER_ONE_PERIODS: readonly ContributionPeriodView[] = [
  {
    id: 'aaaaaaa1-0000-4000-8000-000000000001',
    year: 2026,
    month: 3,
    expectedPaise: '500.00',
    receivedPaise: '500.00',
    remainingPaise: '0.00',
    status: 'PAID',
  },
  {
    id: 'aaaaaaa1-0000-4000-8000-000000000002',
    year: 2026,
    month: 4,
    expectedPaise: '500.00',
    receivedPaise: '150.00',
    remainingPaise: '350.00',
    status: 'PARTIALLY PAID',
  },
  {
    id: 'aaaaaaa1-0000-4000-8000-000000000003',
    year: 2026,
    month: 5,
    expectedPaise: '500.00',
    receivedPaise: '0.00',
    remainingPaise: '500.00',
    status: 'NOT PAID',
  },
];

export const MEMBER_ONE_TRANSACTIONS: readonly MemberTransactionView[] = [
  {
    id: 'bbbbbbb1-0000-4000-8000-000000000001',
    referenceId: 'HY-INC-0001',
    amountPaise: '500.00',
    paymentMethod: 'CASH',
    businessDate: '2026-03-08',
    description: 'March contribution',
    status: 'ACTIVE',
  },
  {
    id: 'bbbbbbb1-0000-4000-8000-000000000002',
    referenceId: 'HY-INC-0002',
    amountPaise: '150.00',
    paymentMethod: 'UPI',
    businessDate: '2026-04-11',
    description: 'April partial contribution',
    status: 'ACTIVE',
  },
];

export const CONTRIBUTION_SUMMARY: ContributionPeriodSummary = {
  year: 2026,
  month: 3,
  configured: 3,
  paid: 1,
  partiallyPaid: 1,
  notPaid: 1,
  expectedTotalPaise: '1500.00',
  receivedTotalPaise: '650.00',
  remainingTotalPaise: '850.00',
};

export type StubMethod = 'GET' | 'POST' | 'PATCH' | 'PUT';

export interface RecordedCall {
  readonly method: StubMethod;
  readonly path: string;
  readonly body: unknown;
  readonly csrfToken: string | undefined;
  /** The `If-Match` revision the screen sent, for optimistic-lock assertions. */
  readonly ifMatch: string | undefined;
}

/** Answers the stub may be scripted to return instead of the default behaviour. */
export interface MemberStubOptions {
  readonly members?: readonly MemberSummary[];
  readonly periodsByMemberId?: Readonly<Record<string, readonly ContributionPeriodView[]>>;
  readonly transactionsByMemberId?: Readonly<Record<string, readonly MemberTransactionView[]>>;
  readonly summary?: ContributionPeriodSummary;
  /** Fails the paginated member list, for the error state. */
  readonly listFails?: Error;
  /** Fails `GET /members/:id`, for the detail error state. */
  readonly detailFails?: Error;
  /** Fails `POST /members`, for the create error state. */
  readonly createFails?: Error;
  /** Fails `PATCH /members/:id`, for the edit error state. */
  readonly updateFails?: Error;
  /** Fails `GET /members/:id/contributions`. */
  readonly contributionsFail?: Error;
}

export interface StubApiClient extends ApiClient {
  readonly calls: RecordedCall[];
  /** The current member store, so a test can assert a create or edit actually applied. */
  readonly members: readonly MemberSummary[];
  /** The periods currently stored for one member, for period-configuration assertions. */
  periodsFor(memberId: string): readonly ContributionPeriodView[];
}

/**
 * A recording client the UI tests drive.
 *
 * Each documented path gets its own answer so a test can state exactly what the API
 * returned, and any unexpected call fails loudly instead of silently resolving, which is
 * how a test proves the browser only asks for routes that exist.
 *
 * The member store is **stateful on purpose**: creating a member really adds a row and
 * editing one really bumps `revision`, exactly as the API does. A stub that returned a
 * fixed fixture would let a screen pass while its create or edit button was dead.
 */
export function stubApiClient(
  options: {
    readonly session?: CurrentSessionResult | Error;
    readonly health?: HealthReport | Error;
    readonly csrf?: CsrfTokenResult | Error;
    readonly login?: LoginResult | Error;
    readonly logout?: 'success' | Error;
    /** Reported as `LogoutResult.revoked`; defaults to the normal signed-in sign-out. */
    readonly revokedOnLogout?: boolean;
    readonly members?: MemberStubOptions;
  } = {},
): StubApiClient {
  const calls: RecordedCall[] = [];
  const session = options.session ?? SESSION_RESULT;
  const health = options.health ?? HEALTH_REPORT;
  const csrf = options.csrf ?? CSRF_TOKEN_RESULT;
  const login = options.login ?? LOGIN_RESULT;
  // Tracks whether a session exists, the way a real API does. `/auth/me` reports the
  // live session state, so a successful `login` makes it succeed from then on. Without this,
  // a stubbed `/auth/me` that always answers "unauthenticated" would contradict the login it
  // just accepted and race the browser back to the sign-in screen.
  let isSignedIn = session === SESSION_RESULT;

  const memberOptions = options.members ?? {};
  const store: MemberSummary[] = [
    ...(memberOptions.members ?? [MEMBER_ONE, MEMBER_TWO, MEMBER_THREE]),
  ];
  const periods = new Map<string, ContributionPeriodView[]>(
    Object.entries(
      memberOptions.periodsByMemberId ?? { [MEMBER_ONE.id]: [...MEMBER_ONE_PERIODS] },
    ).map(([memberId, rows]) => [memberId, [...rows]]),
  );
  const transactions: Readonly<Record<string, readonly MemberTransactionView[]>> =
    memberOptions.transactionsByMemberId ?? { [MEMBER_ONE.id]: MEMBER_ONE_TRANSACTIONS };

  function record(
    method: StubMethod,
    path: string,
    body: unknown,
    request?: ApiRequestOptionsShape,
  ) {
    calls.push({
      method,
      path,
      body,
      csrfToken: request?.csrfToken,
      ifMatch: request?.ifMatch,
    });
  }

  function unknown(path: string): never {
    throw new Error(`The stub client was called with an unexpected path: ${path}`);
  }

  /** Normalizes `/members/<id>` to the member id, or `undefined` for the collection. */
  function memberIdOf(path: string): string | undefined {
    const match = /^\/members\/([^/?]+)(?:\/|\?|$)/.exec(path);

    return match?.[1];
  }

  function requireMember(id: string): MemberSummary {
    const member = store.find((row) => row.id === id);

    if (member === undefined) {
      throw new ApiClientError(
        404,
        'NOT_FOUND',
        'The requested record was not found.',
        '8e5f6a7b-9c0d-4e1f-a01b-2c3d4e5f6071',
      );
    }

    return member;
  }

  return {
    calls,
    members: store,

    periodsFor(memberId: string): readonly ContributionPeriodView[] {
      return periods.get(memberId) ?? [];
    },

    get<TData>(path: string, request?: ApiRequestOptionsShape): Promise<TData> {
      record('GET', path, undefined, request);

      if (path === '/auth/me') {
        if (isSignedIn) {
          return settle<TData>(SESSION_RESULT);
        }

        return settle<TData>(session);
      }
      if (path === '/auth/csrf') {
        return settle<TData>(csrf);
      }
      if (path === '/health') {
        return settle<TData>(health);
      }

      const memberId = memberIdOf(path);

      if (memberId === undefined && path.startsWith('/members')) {
        return Promise.reject(
          memberOptions.listFails ??
            new Error('Use getList for the paginated member collection, as the real client does.'),
        );
      }

      if (memberId !== undefined && path.startsWith('/members/')) {
        if (path.includes('/contributions')) {
          return settleOrReject<TData>(
            periods.get(memberId) ?? [],
            memberOptions.contributionsFail,
          );
        }
        if (path.includes('/transactions')) {
          return settleOrReject<TData>(transactions[memberId] ?? [], undefined);
        }
        if (memberOptions.detailFails !== undefined) {
          return Promise.reject(memberOptions.detailFails);
        }

        const member = requireMember(memberId);
        const detail: MemberDetail = {
          ...member,
          contributionPeriods: periods.get(memberId) ?? [],
          transactions: transactions[memberId] ?? [],
        };

        return Promise.resolve(detail as TData);
      }

      return unknown(path);
    },

    getList<TItem>(path: string, request?: ApiRequestOptionsShape): Promise<ApiListPage<TItem>> {
      record('GET', path, undefined, request);

      if (!path.startsWith('/members')) {
        return unknown(path);
      }

      if (memberOptions.listFails !== undefined) {
        return Promise.reject(memberOptions.listFails);
      }

      return Promise.resolve(paginateMembers(path, store) as ApiListPage<TItem>);
    },

    post<TData>(path: string, body?: unknown, request?: ApiRequestOptionsShape): Promise<TData> {
      record('POST', path, body, request);

      if (path === '/auth/login') {
        const result = settle<TData>(login);

        if (login !== undefined && !(login instanceof Error)) {
          isSignedIn = true;
        }

        return result;
      }
      if (path === '/auth/logout') {
        if (options.logout !== undefined && options.logout !== 'success') {
          return Promise.reject(options.logout);
        }

        isSignedIn = false;

        // The real endpoint answers `200` with the canonical envelope, which the real client
        // unwraps into `LogoutResult`. Returning that shape here is deliberate: an empty
        // object would let a test pass against a contract the API does not actually honour.
        const result: LogoutResult = { revoked: options.revokedOnLogout ?? true };

        return Promise.resolve(result as TData);
      }

      if (path === '/members') {
        if (memberOptions.createFails !== undefined) {
          return Promise.reject(memberOptions.createFails);
        }

        const input = (body ?? {}) as { name?: string; phone?: string; notes?: string };
        const created: MemberSummary = {
          id: '44444444-4444-4444-8444-444444444444',
          // The stub mirrors the API's real allocator: sequential, never reused, and
          // independent of how many members already exist.
          referenceId: `HY-MEM-${String(store.length + 1).padStart(4, '0')}`,
          name: input.name ?? '',
          phone: input.phone ?? null,
          notes: input.notes ?? null,
          revision: 1,
          createdAt: '2026-09-28T06:00:00.000Z',
          updatedAt: '2026-09-28T06:00:00.000Z',
        };
        store.push(created);

        return Promise.resolve(created as TData);
      }

      return unknown(path);
    },

    patch<TData>(path: string, body?: unknown, request?: ApiRequestOptionsShape): Promise<TData> {
      record('PATCH', path, body, request);

      const memberId = memberIdOf(path);

      if (memberId === undefined || !path.startsWith('/members/')) {
        return unknown(path);
      }

      if (memberOptions.updateFails !== undefined) {
        return Promise.reject(memberOptions.updateFails);
      }

      const member = requireMember(memberId);
      const input = (body ?? {}) as { name?: string; phone?: string; notes?: string };
      // The real API rejects a stale `If-Match`; the stub does too, so a screen that
      // ignores the revision fails in the test instead of in production.
      //
      // `If-Match` carries an entity-tag, which the API spec requires to be a *quoted*
      // revision such as `"3"`. The quotes are part of the header value, so the stub has to
      // remove them before reading the number. Parsing the raw header with `parseInt` would
      // yield `NaN` for every well-formed request and reject all of them as stale, which
      // would quietly turn the success path into a permanent false conflict.
      const sentRevision = parseEntityTagRevision(request?.ifMatch);

      if (sentRevision === undefined || sentRevision !== member.revision) {
        return Promise.reject(staleMemberRevision);
      }

      const updated: MemberSummary = {
        ...member,
        name: input.name ?? member.name,
        phone: input.phone === undefined ? member.phone : input.phone || null,
        notes: input.notes === undefined ? member.notes : input.notes || null,
        revision: member.revision + 1,
        updatedAt: '2026-09-28T06:05:00.000Z',
      };
      const index = store.findIndex((row) => row.id === memberId);
      store[index] = updated;

      return Promise.resolve(updated as TData);
    },

    put<TData>(path: string, body?: unknown, request?: ApiRequestOptionsShape): Promise<TData> {
      record('PUT', path, body, request);

      if (path === '/contribution-periods/summary') {
        return settleOrReject<TData>(memberOptions.summary ?? CONTRIBUTION_SUMMARY, undefined);
      }

      const match = /^\/contribution-periods\/([^/?]+)\/(\d{4})\/(\d{1,2})$/.exec(path);

      if (match === null) {
        return unknown(path);
      }

      const [, memberId = '', year = '', month = ''] = match;
      const input = (body ?? {}) as { expectedPaise?: string };
      const expected = input.expectedPaise ?? '0.00';
      const existing = periods.get(memberId) ?? [];
      const current = existing.find(
        (row) => row.year === Number(year) && row.month === Number(month),
      );
      // Received is derived, so the stub derives it too: it never changes here.
      const received = current?.receivedPaise ?? '0.00';
      const status: ContributionPeriodView['status'] =
        toPaise(received) >= toPaise(expected)
          ? 'PAID'
          : toPaise(received) > 0n
            ? 'PARTIALLY PAID'
            : 'NOT PAID';
      const view: ContributionPeriodView = {
        id: current?.id ?? 'aaaaaaa1-0000-4000-8000-0000000000ff',
        year: Number(year),
        month: Number(month),
        expectedPaise: expected,
        receivedPaise: received,
        remainingPaise: formatPaise(toPaise(expected) - toPaise(received)),
        status,
      };
      periods.set(
        memberId,
        [...existing.filter((row) => row.id !== view.id), view].sort(
          (a, b) => b.year - a.year || b.month - a.month,
        ),
      );

      return Promise.resolve(view as TData);
    },
  };
}

/** Reads a decimal INR string into exact paise, the same way the API does. */
function toPaise(amount: string): bigint {
  const [rupees = '0', fraction = ''] = amount.trim().split('.');

  if (!/^\d+$/.test(rupees) || !/^\d{0,2}$/.test(fraction)) {
    throw new Error(`The stub received a malformed money string: ${amount}`);
  }

  return BigInt(rupees) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2) || '0');
}

function formatPaise(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const formatted = `${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;

  return negative ? `-${formatted}` : formatted;
}

/**
 * Applies search, sort, and paging the way the API does.
 *
 * Doing it here rather than returning a fixture is what lets a UI test prove the search
 * box, the column sort, and the pager actually reach the API with the right parameters.
 */
function paginateMembers(
  path: string,
  store: readonly MemberSummary[],
): ApiListPage<MemberSummary> {
  const query = new URLSearchParams(path.includes('?') ? path.slice(path.indexOf('?') + 1) : '');
  const search = (query.get('search') ?? '').trim().toLowerCase();
  const page = Math.max(1, Number.parseInt(query.get('page') ?? '1', 10) || 1);
  const pageSize = Math.max(1, Number.parseInt(query.get('pageSize') ?? '20', 10) || 20);
  const sort = (query.get('sort') ?? 'name') as MemberSortField;
  const direction = (query.get('direction') ?? 'asc') as MemberSortDirection;

  const matched = store.filter(
    (member) =>
      search === '' ||
      member.name.toLowerCase().includes(search) ||
      member.referenceId.toLowerCase().includes(search) ||
      (member.phone ?? '').includes(search),
  );

  const ordered = [...matched].sort((a, b) => {
    const order = compareBy(sort, a, b);

    return direction === 'desc' ? -order : order;
  });
  const totalItems = ordered.length;
  const start = (page - 1) * pageSize;

  return {
    items: ordered.slice(start, start + pageSize),
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pageSize),
    },
  };
}

function compareBy(sort: MemberSortField, a: MemberSummary, b: MemberSummary): number {
  if (sort === 'createdAt') {
    return a.createdAt.localeCompare(b.createdAt);
  }
  if (sort === 'referenceId') {
    return a.referenceId.localeCompare(b.referenceId);
  }

  return a.name.localeCompare(b.name);
}

interface ApiRequestOptionsShape {
  readonly csrfToken?: string;
  readonly ifMatch?: string;
}

function settleOrReject<TData>(value: unknown, failure: Error | undefined): Promise<TData> {
  return failure === undefined ? Promise.resolve(value as TData) : Promise.reject(failure);
}

function settle<TData>(
  value: CurrentSessionResult | HealthReport | CsrfTokenResult | LoginResult | Error,
): Promise<TData> {
  return value instanceof Error ? Promise.reject(value) : Promise.resolve(value as TData);
}

/**
 * Stands in for the real client on a signed-in screen, so the foundation tests still reach
 * the product screen now that it is behind authentication.
 */
export function clientResolvingWith(report: HealthReport = HEALTH_REPORT): ApiClient {
  return stubApiClient({ health: report });
}

export function clientFailingWith(error: Error): ApiClient {
  return stubApiClient({ health: error });
}
