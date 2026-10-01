import {
  HEALTH_SERVICE_NAME,
  type AdminProfile,
  type ContributionPeriodSummary,
  type ContributionPeriodView,
  type CsrfTokenResult,
  type CurrentSessionResult,
  DOCUMENT_UPLOAD_FIELD,
  type DocumentMimeType,
  type DocumentSummary,
  type ExpenseCategoryView,
  type ExpenseSummary,
  type HealthReport,
  type LoginResult,
  type LogoutResult,
  type MemberDetail,
  type MemberSortDirection,
  type MemberSortField,
  type MemberSummary,
  type MemberTransactionView,
  type SessionContext,
  type TransactionAuditEventView,
  type TransactionReceiptView,
  type TransactionSortField,
  type TransactionSummary,
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

/**
 * A member contribution that is fully named.
 *
 * It carries every relation the income screens read — member, contribution period, and a
 * description — so a test can prove the detail screen shows the stored record rather than a
 * locally reconstructed one.
 */
export const INCOME_ONE: TransactionSummary = {
  id: 'ccccccc1-0000-4000-8000-000000000001',
  referenceId: 'HY-INC-000001',
  type: 'INCOME',
  incomeType: 'MEMBER_CONTRIBUTION',
  amount: '500.00',
  currency: 'INR',
  paymentMethod: 'CASH',
  status: 'ACTIVE',
  businessDate: '2026-03-08',
  description: 'March contribution',
  notes: 'Collected at the morning service',
  member: { id: MEMBER_ONE.id, referenceId: MEMBER_ONE.referenceId, name: MEMBER_ONE.name },
  category: null,
  contributionPeriod: { id: MEMBER_ONE_PERIODS[0]?.id ?? '', year: 2026, month: 3 },
  voidReason: null,
  voidedAt: null,
  documentCount: 0,
  revision: 1,
  createdAt: '2026-03-08T06:15:00.000Z',
  updatedAt: '2026-03-08T06:15:00.000Z',
};

/** A visitor offering with no member, so the "no member recorded" path is real. */
export const INCOME_TWO: TransactionSummary = {
  id: 'ccccccc1-0000-4000-8000-000000000002',
  referenceId: 'HY-INC-000002',
  type: 'INCOME',
  incomeType: 'OFFERING',
  amount: '1250.50',
  currency: 'INR',
  paymentMethod: 'UPI',
  status: 'ACTIVE',
  businessDate: '2026-04-06',
  description: 'Sunday offering',
  notes: null,
  member: null,
  category: null,
  contributionPeriod: null,
  voidReason: null,
  voidedAt: null,
  documentCount: 0,
  revision: 1,
  createdAt: '2026-04-06T10:30:00.000Z',
  updatedAt: '2026-04-06T10:30:00.000Z',
};

/**
 * A voided donation.
 *
 * `REQ-FIN-016` keeps a voided record in the list and out of every active total, so the stub
 * holds one: a screen that hides voided rows, or counts them as income, is wrong and the test
 * can say so.
 */
export const INCOME_VOIDED: TransactionSummary = {
  id: 'ccccccc1-0000-4000-8000-000000000003',
  referenceId: 'HY-INC-000003',
  type: 'INCOME',
  incomeType: 'DONATION',
  amount: '300.00',
  currency: 'INR',
  paymentMethod: 'BANK_TRANSFER',
  status: 'VOIDED',
  businessDate: '2026-05-11',
  description: 'Recorded against the wrong member',
  notes: null,
  member: { id: MEMBER_TWO.id, referenceId: MEMBER_TWO.referenceId, name: MEMBER_TWO.name },
  category: null,
  contributionPeriod: null,
  voidReason: 'Recorded against the wrong member',
  voidedAt: '2026-05-12T05:00:00.000Z',
  documentCount: 0,
  revision: 2,
  createdAt: '2026-05-11T09:00:00.000Z',
  updatedAt: '2026-05-12T05:00:00.000Z',
};

/**
 * An anonymous donation.
 *
 * `REQ-INCOME-005` and `REQ-INCOME-006` mean this record has no member, a server-owned
 * description, and no notes. A test that renders this row and finds a donor name, or a
 * free-text description, is looking at a privacy breach.
 */
export const INCOME_ANONYMOUS: TransactionSummary = {
  id: 'ccccccc1-0000-4000-8000-000000000004',
  referenceId: 'HY-INC-000004',
  type: 'INCOME',
  incomeType: 'ANONYMOUS_DONATION',
  amount: '100.00',
  currency: 'INR',
  paymentMethod: 'CASH',
  status: 'ACTIVE',
  businessDate: '2026-05-18',
  description: 'Anonymous Donation',
  notes: null,
  member: null,
  category: null,
  contributionPeriod: null,
  voidReason: null,
  voidedAt: null,
  documentCount: 0,
  revision: 1,
  createdAt: '2026-05-18T11:45:00.000Z',
  updatedAt: '2026-05-18T11:45:00.000Z',
};

export const DEFAULT_INCOME_TRANSACTIONS: readonly TransactionSummary[] = [
  INCOME_ONE,
  INCOME_TWO,
  INCOME_VOIDED,
  INCOME_ANONYMOUS,
];

/**
 * The active categories, as `GET /api/v1/expenses/categories` answers.
 *
 * A **deactivated category is deliberately absent**, because the API documents this route as the
 * active categories. A browser test that wanted to see an inactive one in the picker would be
 * asserting the opposite of the specification. The retained label on a historical expense is
 * proved instead by `EXPENSE_RETIRED_CATEGORY`, which the stub reports as `INACTIVE` on the
 * transaction itself, exactly as the API does.
 */
export const ACTIVE_EXPENSE_CATEGORIES: readonly ExpenseCategoryView[] = [
  {
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Electricity',
    status: 'ACTIVE',
    isSystem: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: '88888888-8888-4888-8888-888888888888',
    name: 'Repairs',
    status: 'ACTIVE',
    isSystem: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
];

export const RETIRED_CATEGORY_REF = {
  id: '77777777-7777-4777-8777-777777777777',
  name: 'Retired category',
  status: 'INACTIVE' as const,
};

/** A category reference as the API returns it on a transaction. */
function categoryRef(
  id: string,
  name: string,
  status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
): NonNullable<TransactionSummary['category']> {
  return { id, name, status };
}

/**
 * An active expense with a receipt.
 *
 * `hasReceipt: true` with `documentCount: 1` are the same fact read two ways, which is what lets
 * a test prove the browser renders the API's derived flag rather than deciding locally.
 */
export const EXPENSE_ONE: ExpenseSummary = {
  id: 'fffffff1-0000-4000-8000-000000000001',
  referenceId: 'HY-EXP-000001',
  type: 'EXPENSE',
  incomeType: null,
  amount: '2450.75',
  currency: 'INR',
  paymentMethod: 'BANK_TRANSFER',
  status: 'ACTIVE',
  businessDate: '2026-09-12',
  description: 'September electricity bill',
  notes: 'Paid by transfer to the utility',
  member: null,
  category: categoryRef(ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '', 'Electricity'),
  contributionPeriod: null,
  voidReason: null,
  voidedAt: null,
  documentCount: 1,
  hasReceipt: true,
  revision: 1,
  createdAt: '2026-09-12T07:15:00.000Z',
  updatedAt: '2026-09-12T07:15:00.000Z',
};

/**
 * An expense with no receipt.
 *
 * This is the `REQ-DOC-003` case: it exists, it counts toward totals, and the interface must say
 * **Receipt Missing** rather than showing an empty cell or a disabled upload control. `hasReceipt:
 * false` and `documentCount: 0` agree, so a screen that invented a receipt would be caught.
 */
export const EXPENSE_TWO: ExpenseSummary = {
  id: 'fffffff1-0000-4000-8000-000000000002',
  referenceId: 'HY-EXP-000002',
  type: 'EXPENSE',
  incomeType: null,
  amount: '800.00',
  currency: 'INR',
  paymentMethod: 'CASH',
  status: 'ACTIVE',
  businessDate: '2026-09-18',
  description: 'Choir sound system repair',
  notes: null,
  member: null,
  category: categoryRef(ACTIVE_EXPENSE_CATEGORIES[1]?.id ?? '', 'Repairs'),
  contributionPeriod: null,
  voidReason: null,
  voidedAt: null,
  documentCount: 0,
  hasReceipt: false,
  revision: 1,
  createdAt: '2026-09-18T09:40:00.000Z',
  updatedAt: '2026-09-18T09:40:00.000Z',
};

/**
 * An expense filed under a category that has since been deactivated.
 *
 * `docs/05-DATABASE-SPEC.md` preserves inactive categories on historical transactions. This is the
 * fixture that proves the browser keeps showing the label and explains why the category is no
 * longer offered, instead of blanking the column or refusing to render the row.
 */
export const EXPENSE_RETIRED_CATEGORY: ExpenseSummary = {
  id: 'fffffff1-0000-4000-8000-000000000003',
  referenceId: 'HY-EXP-000003',
  type: 'EXPENSE',
  incomeType: null,
  amount: '320.40',
  currency: 'INR',
  paymentMethod: 'UPI',
  status: 'ACTIVE',
  businessDate: '2026-08-30',
  description: 'Old maintenance charge',
  notes: null,
  member: null,
  category: categoryRef(RETIRED_CATEGORY_REF.id, RETIRED_CATEGORY_REF.name, 'INACTIVE'),
  contributionPeriod: null,
  voidReason: null,
  voidedAt: null,
  documentCount: 0,
  hasReceipt: false,
  revision: 1,
  createdAt: '2026-08-30T05:05:00.000Z',
  updatedAt: '2026-08-30T05:05:00.000Z',
};

/** A voided expense, so a test can prove voiding keeps the row and excludes it from active views. */
export const EXPENSE_VOIDED: ExpenseSummary = {
  id: 'fffffff1-0000-4000-8000-000000000004',
  referenceId: 'HY-EXP-000004',
  type: 'EXPENSE',
  incomeType: null,
  amount: '150.00',
  currency: 'INR',
  paymentMethod: 'CASH',
  status: 'VOIDED',
  businessDate: '2026-09-20',
  description: 'Recorded twice',
  notes: null,
  member: null,
  category: categoryRef(ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '', 'Electricity'),
  contributionPeriod: null,
  voidReason: 'Recorded twice',
  voidedAt: '2026-09-21T06:00:00.000Z',
  documentCount: 0,
  hasReceipt: false,
  revision: 2,
  createdAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-09-21T06:00:00.000Z',
};

/**
 * Income and expenses in one store.
 *
 * They share the ledger, so the stub holds both and the screen's own narrowing decides which is
 * listed. A test that asked for `GET /expenses` and received an income row would catch a
 * regression the fixtures-only approach could not.
 */
export const DEFAULT_TRANSACTIONS: readonly TransactionSummary[] = [
  ...DEFAULT_INCOME_TRANSACTIONS,
  EXPENSE_ONE,
  EXPENSE_TWO,
  EXPENSE_RETIRED_CATEGORY,
  EXPENSE_VOIDED,
];

export const INCOME_ONE_AUDIT: readonly TransactionAuditEventView[] = [
  {
    id: 'ddddddd1-0000-4000-8000-000000000001',
    action: 'TRANSACTION_CREATED',
    actorDisplayName: ADMIN_PROFILE.displayName,
    occurredAt: '2026-03-08T06:15:00.000Z',
    reason: null,
    requestId: '2a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c40',
    before: null,
    // The snapshot keys are the API's own camelCase ones, because
    // `toAuditSnapshot` in `apps/api/src/database/transactions/transaction.repository.ts` writes
    // `amountPaise`, `businessDate`, and `categoryId` that way. A snake_case fixture would make
    // the screen's formatters unreachable and would let a raw-paise leak pass as correct.
    after: {
      amountPaise: '50000',
      paymentMethod: 'CASH',
      status: 'ACTIVE',
      businessDate: '2026-03-08',
    },
  },
];

/**
 * The audit trail of one expense, as `GET /transactions/:id/audit` answers it.
 *
 * The snapshot is the stored row, so the amount is the paise integer `245075` and the category is
 * its id. A screen that printed those raw would show a financial value in paise and a database key
 * in front of a pastor, so this fixture exists to make that detectable: the rendered trail must read
 * `amount empty → ₹2,450.75` and `category empty → set`.
 */
export const EXPENSE_ONE_AUDIT: readonly TransactionAuditEventView[] = [
  {
    id: 'ddddddd2-0000-4000-8000-000000000001',
    action: 'TRANSACTION_CREATED',
    actorDisplayName: ADMIN_PROFILE.displayName,
    occurredAt: '2026-09-12T07:15:00.000Z',
    reason: null,
    requestId: '2a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c41',
    before: null,
    after: {
      amountPaise: '245075',
      paymentMethod: 'BANK_TRANSFER',
      status: 'ACTIVE',
      businessDate: '2026-09-12',
      categoryId: ACTIVE_EXPENSE_CATEGORIES[0]?.id ?? '',
    },
  },
];

export const INCOME_ONE_RECEIPT: TransactionReceiptView = {
  applicationName: 'HYSSOP FINANCE',
  referenceId: INCOME_ONE.referenceId,
  amount: INCOME_ONE.amount,
  currency: 'INR',
  incomeType: 'MEMBER_CONTRIBUTION',
  paymentMethod: 'CASH',
  businessDate: '2026-03-08',
  receivedFrom: INCOME_ONE.member,
  status: 'ACTIVE',
  voidedAt: null,
  voidReason: null,
  issuedAt: '2026-03-08T06:20:00.000Z',
};

/** The `409` the API returns when a transaction was corrected or voided by someone else first. */
export const staleTransactionRevision = new ApiClientError(
  409,
  'CONFLICT',
  'This transaction was changed by another action. Reload the record and try again.',
  '7d4e5f6a-8b9c-4d0e-9f0a-1b2c3d4e5f61',
);

export const notFound = new ApiClientError(
  404,
  'NOT_FOUND',
  'The requested record was not found.',
  '8e5f6a7b-9c0d-4e1f-a01b-2c3d4e5f6072',
);

export const incomeValidationFailed = new ApiClientError(
  400,
  'VALIDATION_FAILED',
  'The request could not be accepted.',
  '9f6a7b8c-0d1e-4f2a-b12c-3d4e5f607182',
  [
    { field: 'amount', message: 'The amount must be greater than zero.' },
    { field: 'memberId', message: 'Choose the member this contribution is for.' },
  ],
);

export type StubMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RecordedCall {
  readonly method: StubMethod;
  readonly path: string;
  readonly body: unknown;
  readonly csrfToken: string | undefined;
  /** The `If-Match` revision the screen sent, for optimistic-lock assertions. */
  readonly ifMatch: string | undefined;
  /** The `Idempotency-Key` the screen sent, so a duplicate submission can be detected. */
  readonly idempotencyKey: string | undefined;
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

/**
 * Answers the stub may be scripted to return for the income and shared transaction routes.
 *
 * Income is read through `GET /transactions` narrowed by `type=INCOME`, exactly as the browser
 * requests it, so a test that passes here is asserting the real path rather than a convenient
 * one. `listFails` therefore fails the transaction list, not an income-only endpoint that does
 * not exist.
 */
export interface TransactionStubOptions {
  readonly transactions?: readonly TransactionSummary[];
  /** Overrides the audit trail returned for every transaction. */
  readonly audit?: readonly TransactionAuditEventView[];
  /** Overrides the receipt projection returned for every transaction. */
  readonly receipt?: TransactionReceiptView;
  /** Fails `GET /transactions`, for the list error state. */
  readonly listFails?: Error;
  /** Fails `GET /transactions/:id`, for the detail error state. */
  readonly detailFails?: Error;
  /** Fails `GET /transactions/:id/audit`. */
  readonly auditFails?: Error;
  /** Fails `GET /transactions/:id/receipt`. */
  readonly receiptFails?: Error;
  /** Fails `POST /income`, for the create error state. */
  readonly createFails?: Error;
  /**
   * Fails only the first `POST /income`, for the retry path.
   *
   * The failure models a timeout or a dropped connection, which is the case where the browser's
   * reuse of one key across a retry is the only thing preventing a second contribution.
   */
  readonly firstCreateFails?: Error;
  /** Fails `PATCH /transactions/:id`, for the correction error state. */
  readonly correctFails?: Error;
  /** Fails `POST /transactions/:id/void`, for the void error state. */
  readonly voidFails?: Error;
}

/**
 * Answers the stub may be scripted to return for the expense and category routes.
 *
 * Kept separate from `TransactionStubOptions` because the *shared* transaction routes
 * (`GET /transactions/:id`, `PATCH /transactions/:id`, the void, and the audit trail) are
 * configured once for both types, while these are the expense-specific reads and writes.
 */
export interface ExpenseStubOptions {
  /** The categories `GET /expenses/categories` returns. Defaults to the active set. */
  readonly categories?: readonly ExpenseCategoryView[];
  /** Fails `GET /expenses/categories`. */
  readonly categoriesFail?: Error;
  /** Fails `GET /expenses`, for the list error state. */
  readonly listFails?: Error;
  /** Fails `POST /expenses`, for the create error state. */
  readonly createFails?: Error;
  /** Fails only the first `POST /expenses`, for the retry-under-one-key path. */
  readonly firstCreateFails?: Error;
  /** Fails `POST /expenses/categories`, for the add-category error state. */
  readonly createCategoryFails?: Error;
  /** Fails `PATCH /expenses/categories/:id`. */
  readonly updateCategoryFails?: Error;
}

/**
 * Answers the stub may be scripted to return for the document routes.
 *
 * The document store is stateful for the same reason every other store here is: an upload has to
 * really append a row and a removal has to really flip `status` and `contentAvailable`, otherwise
 * a receipt panel would pass while its upload and remove controls were dead.
 */
export interface DocumentStubOptions {
  /** Seeds the store, keyed by transaction id. */
  readonly documentsByTransactionId?: Readonly<Record<string, readonly DocumentSummary[]>>;
  /** Fails `GET /transactions/:id/documents`, for the list error state. */
  readonly listFails?: Error;
  /** Fails `POST /transactions/:id/documents`, for the upload error state. */
  readonly uploadFails?: Error;
  /**
   * Fails only the first upload, for the retry-under-one-key path.
   *
   * Models the dropped-connection case where reusing one `Idempotency-Key` is the only thing
   * preventing the same receipt being stored twice.
   */
  readonly firstUploadFails?: Error;
  /** Fails `DELETE /documents/:id`, for the removal error state. */
  readonly removeFails?: Error;
}

export interface StubApiClient extends ApiClient {
  readonly calls: RecordedCall[];
  /** The current member store, so a test can assert a create or edit actually applied. */
  readonly members: readonly MemberSummary[];
  /** The current transaction store, so a test can assert an income, correction, or void applied. */
  readonly transactions: readonly TransactionSummary[];
  /** The periods currently stored for one member, for period-configuration assertions. */
  periodsFor(memberId: string): readonly ContributionPeriodView[];
  /** The stored transaction with this id, for asserting a write really changed the record. */
  transactionById(id: string): TransactionSummary | undefined;
  /** The documents currently stored for one transaction, for asserting an upload or removal. */
  documentsFor(transactionId: string): readonly DocumentSummary[];
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
    readonly transactions?: TransactionStubOptions;
    readonly expenses?: ExpenseStubOptions;
    readonly documents?: DocumentStubOptions;
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

  const transactionOptions = options.transactions ?? {};
  const expenseOptions = options.expenses ?? {};
  // The transaction store is stateful for the same reason the member store is: recording income
  // must add a row, a correction must bump `revision` and change the amount, and a void must set
  // the status, because a stub that returned a fixture would let a screen pass with a dead
  // write button. Income and expenses live in the same ledger here, exactly as they do in the
  // database.
  const transactionStore: TransactionSummary[] = [
    ...(transactionOptions.transactions ?? DEFAULT_TRANSACTIONS),
  ];
  let nextIncomeNumber = transactionStore.filter((row) => row.type === 'INCOME').length + 1;
  let nextExpenseNumber = transactionStore.filter((row) => row.type === 'EXPENSE').length + 1;
  let hasFailedFirstCreate = false;
  let hasFailedFirstExpenseCreate = false;
  // The category store is stateful as well: adding a category really appends a row the picker can
  // then select, so a test can prove the add-category path ends in a usable selection.
  const categoryStore: ExpenseCategoryView[] = [
    ...(expenseOptions.categories ?? ACTIVE_EXPENSE_CATEGORIES),
  ];
  // The real API rejects a mutation whose `Idempotency-Key` it has already answered, so the
  // stub does too. That is what makes a double submit observable here instead of silently
  // recording the same contribution twice.
  const answeredIdempotencyKeys = new Map<string, unknown>();
  const auditTrail = transactionOptions.audit ?? INCOME_ONE_AUDIT;
  const documentOptions = options.documents ?? {};
  // The document store mirrors the real lifecycle: an upload appends an `AVAILABLE` row, and a
  // removal keeps the row but flips `status`, `contentAvailable`, and `contentDeleted` semantics,
  // because `docs/05-DATABASE-SPEC.md` retains metadata after removal.
  const documentStore = new Map<string, DocumentSummary[]>(
    Object.entries(documentOptions.documentsByTransactionId ?? {}).map(([transactionId, rows]) => [
      transactionId,
      [...rows],
    ]),
  );

  // A fixture that says `documentCount: 1` and `hasReceipt: true` must really have a document, or
  // the detail screen would show "Attached" beside a receipt panel that says Receipt Missing — a
  // screen contradicting itself, which is exactly what the state-honesty rule forbids. Any
  // transaction the caller seeded is left untouched, so a test can still assert an empty list for a
  // transaction that carries a count, and a test that wants a specific row states it explicitly.
  for (const transaction of transactionStore) {
    if (documentStore.has(transaction.id) || transaction.documentCount < 1) {
      continue;
    }

    documentStore.set(
      transaction.id,
      Array.from({ length: transaction.documentCount }, (_, index) =>
        seededDocument(transaction, index),
      ),
    );
  }
  let hasFailedFirstDocumentUpload = false;

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
      idempotencyKey: request?.idempotencyKey,
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

  /** Normalizes `/transactions/<id>[/audit|/receipt]` to the transaction id. */
  function transactionIdOf(path: string): string | undefined {
    const match = /^\/transactions\/([^/?]+)(?:\/|\?|$)/.exec(path);

    return match?.[1];
  }

  function requireTransaction(id: string): TransactionSummary {
    const transaction = transactionStore.find((row) => row.id === id);

    if (transaction === undefined) {
      throw notFound;
    }

    return transaction;
  }

  function replaceTransaction(updated: TransactionSummary): void {
    const index = transactionStore.findIndex((row) => row.id === updated.id);

    transactionStore[index] = updated;
  }

  /**
   * Answers a repeated idempotency key with the first successful response.
   *
   * The stored value is the settled result, so a replay resolves with the *same*
   * `TransactionSummary` rather than creating a second record. A test can then assert that
   * submitting twice produced one row.
   *
   * A **failed** command is deliberately not remembered. The real API writes its idempotency
   * record inside the same transaction as the financial write, so a failure rolls the record
   * back and the caller may retry the same key as a fresh operation. Caching a rejection here
   * would make every retry of a failed submission fail forever.
   */
  async function idempotent<TData>(
    key: string | undefined,
    run: () => Promise<unknown>,
  ): Promise<TData> {
    if (key === undefined || key === '') {
      return run() as Promise<TData>;
    }

    const answered = answeredIdempotencyKeys.get(key);

    if (answered !== undefined) {
      return Promise.resolve(answered as TData);
    }

    const result = (await run()) as TData;

    answeredIdempotencyKeys.set(key, result);

    return result;
  }

  return {
    calls,
    members: store,
    transactions: transactionStore,

    periodsFor(memberId: string): readonly ContributionPeriodView[] {
      return periods.get(memberId) ?? [];
    },

    transactionById(id: string): TransactionSummary | undefined {
      return transactionStore.find((row) => row.id === id);
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
      if (path === '/expenses/categories') {
        // The API documents this route as the *active* categories. The stub filters rather than
        // returning the store verbatim, so a screen that wrongly expected to see a deactivated
        // category here would fail the way it would in production.
        return settleOrReject<TData>(
          categoryStore.filter((category) => category.status === 'ACTIVE'),
          expenseOptions.categoriesFail,
        );
      }

      const transactionId = transactionIdOf(path);

      if (transactionId !== undefined) {
        if (path.includes('/audit')) {
          return settleOrReject<TData>(auditTrail, transactionOptions.auditFails);
        }
        if (path.endsWith('/documents')) {
          // A transaction's documents are read as a plain array, not a paged list envelope, exactly
          // as `docs/06-API-SPEC.md` documents the route. Removed rows are returned too: the
          // history is retained, so dropping them here would let a panel claim a receipt that the
          // audit trail still explains.
          return settleOrReject<TData>(
            documentStore.get(transactionId) ?? [],
            documentOptions.listFails,
          );
        }
        if (path.includes('/receipt')) {
          if (transactionOptions.receiptFails !== undefined) {
            return Promise.reject(transactionOptions.receiptFails);
          }

          const record = requireTransaction(transactionId);
          const receipt: TransactionReceiptView = transactionOptions.receipt ?? {
            applicationName: 'HYSSOP FINANCE',
            referenceId: record.referenceId,
            amount: record.amount,
            currency: 'INR',
            // A receipt exists only for income, so an expense reference here is a wrong link
            // rather than a receipt with no type to print.
            incomeType: record.incomeType ?? 'OFFERING',
            paymentMethod: record.paymentMethod,
            businessDate: record.businessDate,
            // `receivedFrom` is `null` for an anonymous donation, which is the only honest value
            // the contract can express for a donor-free record.
            receivedFrom: record.member,
            status: record.status,
            voidedAt: record.voidedAt,
            voidReason: record.voidReason,
            issuedAt: '2026-09-28T07:00:00.000Z',
          };

          return Promise.resolve(receipt as TData);
        }
        if (transactionOptions.detailFails !== undefined) {
          return Promise.reject(transactionOptions.detailFails);
        }

        return Promise.resolve(requireTransaction(transactionId) as TData);
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

      if (path.startsWith('/transactions')) {
        if (transactionOptions.listFails !== undefined) {
          return Promise.reject(transactionOptions.listFails);
        }

        return Promise.resolve(paginateTransactions(path, transactionStore) as ApiListPage<TItem>);
      }

      if (path.startsWith('/expenses')) {
        if (expenseOptions.listFails !== undefined) {
          return Promise.reject(expenseOptions.listFails);
        }

        // The API narrows this route to expenses itself, so the stub does the same rather than
        // trusting the caller's path. A screen that reached this list without the narrowing would
        // see income rows, which is exactly the bug the route exists to prevent.
        return Promise.resolve(
          paginateTransactions(
            `/transactions?${new URLSearchParams(
              path.includes('?') ? path.slice(path.indexOf('?') + 1) : '',
            )
              .toString()
              .replace(/^/, 'type=EXPENSE&')}`,
            transactionStore,
          ) as ApiListPage<TItem>,
        );
      }

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

      if (path === '/income') {
        if (transactionOptions.createFails !== undefined) {
          return Promise.reject(transactionOptions.createFails);
        }

        if (transactionOptions.firstCreateFails !== undefined && !hasFailedFirstCreate) {
          hasFailedFirstCreate = true;

          return Promise.reject(transactionOptions.firstCreateFails);
        }

        return idempotent<TData>(request?.idempotencyKey, () => {
          const input = (body ?? {}) as {
            incomeType?: TransactionSummary['incomeType'];
            amount?: string;
            paymentMethod?: TransactionSummary['paymentMethod'];
            businessDate?: string;
            memberId?: string;
            description?: string;
            notes?: string;
          };
          const isAnonymous = input.incomeType === 'ANONYMOUS_DONATION';
          const namedMember =
            input.memberId === undefined
              ? undefined
              : store.find((row) => row.id === input.memberId);
          const referenceId = `HY-INC-${String(nextIncomeNumber).padStart(6, '0')}`;

          nextIncomeNumber += 1;

          const created: TransactionSummary = {
            id: 'eeeeeee1-0000-4000-8000-000000000001',
            referenceId,
            type: 'INCOME',
            incomeType: input.incomeType ?? 'MEMBER_CONTRIBUTION',
            amount: formatPaise(toPaise(input.amount ?? '0')),
            currency: 'INR',
            paymentMethod: input.paymentMethod ?? 'CASH',
            status: 'ACTIVE',
            businessDate: input.businessDate ?? '2026-09-28',
            // The server owns the description and clears the notes of an anonymous donation, so
            // the stub refuses to store Admin free text for that income type. A value that is
            // never sent cannot be stored, searched, or exported, which is the whole point of
            // the rule and the reason the browser omits it too.
            description: isAnonymous ? 'Anonymous Donation' : (input.description ?? null),
            notes: isAnonymous ? null : (input.notes ?? null),
            member:
              isAnonymous || namedMember === undefined
                ? null
                : {
                    id: namedMember.id,
                    referenceId: namedMember.referenceId,
                    name: namedMember.name,
                  },
            category: null,
            contributionPeriod:
              input.incomeType === 'MEMBER_CONTRIBUTION' && namedMember !== undefined
                ? { id: 'aaaaaaa1-0000-4000-8000-000000000004', year: 2026, month: 9 }
                : null,
            voidReason: null,
            voidedAt: null,
            documentCount: 0,
            revision: 1,
            createdAt: '2026-09-28T07:30:00.000Z',
            updatedAt: '2026-09-28T07:30:00.000Z',
          };

          transactionStore.unshift(created);

          return Promise.resolve(created);
        });
      }

      if (path === '/expenses') {
        if (expenseOptions.createFails !== undefined) {
          return Promise.reject(expenseOptions.createFails);
        }

        if (expenseOptions.firstCreateFails !== undefined && !hasFailedFirstExpenseCreate) {
          hasFailedFirstExpenseCreate = true;

          return Promise.reject(expenseOptions.firstCreateFails);
        }

        return idempotent<TData>(request?.idempotencyKey, () => {
          const input = (body ?? {}) as {
            categoryId?: string;
            amount?: string;
            paymentMethod?: TransactionSummary['paymentMethod'];
            businessDate?: string;
            description?: string;
            notes?: string;
          };
          const category = categoryStore.find((row) => row.id === input.categoryId);

          // The API refuses an expense with no category, because `REQ-EXP-004` requires exactly
          // one. The stub does too, so a screen that omitted the category cannot pass here.
          if (category === undefined) {
            return Promise.reject(
              new ApiClientError(
                400,
                'VALIDATION_FAILED',
                'An expense must reference an active category.',
                '1b8c9d0e-2f3a-4b4c-d34d-5f6071829304',
                [
                  {
                    field: 'categoryId',
                    message: 'Only an active category can be used for a new expense.',
                  },
                ],
              ),
            );
          }

          const referenceId = `HY-EXP-${String(nextExpenseNumber).padStart(6, '0')}`;

          nextExpenseNumber += 1;

          const created: ExpenseSummary = {
            id: `fffffff1-0000-4000-8000-${String(nextExpenseNumber).padStart(12, '0')}`,
            referenceId,
            type: 'EXPENSE',
            incomeType: null,
            amount: formatPaise(toPaise(input.amount ?? '0')),
            currency: 'INR',
            paymentMethod: input.paymentMethod ?? 'CASH',
            status: 'ACTIVE',
            businessDate: input.businessDate ?? '2026-09-28',
            description: input.description ?? null,
            notes: input.notes ?? null,
            member: null,
            // An expense belongs to the church, never to a member, so `member` is `null` by
            // construction and the browser never sends one.
            category: categoryRef(category.id, category.name, category.status),
            contributionPeriod: null,
            voidReason: null,
            voidedAt: null,
            documentCount: 0,
            // Derived, not stored: nothing has been attached at creation time, so the honest
            // value is `false` and the screen shows Receipt Missing.
            hasReceipt: false,
            revision: 1,
            createdAt: '2026-09-28T08:15:00.000Z',
            updatedAt: '2026-09-28T08:15:00.000Z',
          };

          transactionStore.unshift(created);

          return Promise.resolve(created);
        });
      }

      if (path === '/expenses/categories') {
        if (expenseOptions.createCategoryFails !== undefined) {
          return Promise.reject(expenseOptions.createCategoryFails);
        }

        return idempotent<TData>(request?.idempotencyKey, () => {
          const input = (body ?? {}) as { name?: string; isSystem?: boolean };
          const name = (input.name ?? '').trim();

          if (name === '') {
            return Promise.reject(
              new ApiClientError(
                400,
                'VALIDATION_FAILED',
                'A category name is required.',
                '2c9d0e1f-3a4b-4c5d-e45e-607182930415',
                [{ field: 'name', message: 'A category name is required.' }],
              ),
            );
          }

          // Uniqueness is case-insensitive, so `Books`, `books`, and `Books ` are one category.
          // The stub refuses the near-duplicate the same way the API does, which is what proves
          // the browser surfaces the message against the name field.
          if (categoryStore.some((row) => row.name.trim().toLowerCase() === name.toLowerCase())) {
            return Promise.reject(
              new ApiClientError(
                409,
                'CONFLICT',
                'An expense category with that name already exists.',
                '3d0e1f2a-4b5c-4d6e-f56f-71829304a526',
                [{ field: 'name', message: 'That category name is already in use.' }],
              ),
            );
          }

          const created: ExpenseCategoryView = {
            id: '99999999-9999-4999-8999-999999999999',
            name,
            status: 'ACTIVE',
            // `REQ-EXP-001` fixes the initial set; anything the Admin adds is custom.
            isSystem: input.isSystem ?? false,
            createdAt: '2026-09-28T08:20:00.000Z',
            updatedAt: '2026-09-28T08:20:00.000Z',
          };

          categoryStore.push(created);

          return Promise.resolve(created);
        });
      }

      const voidMatch = /^\/transactions\/([^/]+)\/void$/.exec(path);

      if (voidMatch !== null) {
        const transactionId = voidMatch[1] ?? '';

        if (transactionOptions.voidFails !== undefined) {
          return Promise.reject(transactionOptions.voidFails);
        }

        return idempotent<TData>(request?.idempotencyKey, () => {
          const existing = requireTransaction(transactionId);
          const input = (body ?? {}) as { reason?: string };
          const reason = (input.reason ?? '').trim();

          if (reason === '') {
            return Promise.reject(
              new ApiClientError(
                400,
                'VALIDATION_FAILED',
                'A reason is required to void a transaction.',
                '0a7b8c9d-1e2f-4a3b-c23d-4e5f60718293',
                [{ field: 'reason', message: 'A reason is required to void a transaction.' }],
              ),
            );
          }

          const voided: TransactionSummary = {
            ...existing,
            status: 'VOIDED',
            voidReason: reason,
            voidedAt: '2026-09-28T08:00:00.000Z',
            revision: existing.revision + 1,
            updatedAt: '2026-09-28T08:00:00.000Z',
          };

          replaceTransaction(voided);

          return Promise.resolve(voided);
        });
      }

      return unknown(path);
    },

    patch<TData>(path: string, body?: unknown, request?: ApiRequestOptionsShape): Promise<TData> {
      record('PATCH', path, body, request);

      const transactionId = transactionIdOf(path);

      if (transactionId !== undefined && path.startsWith('/transactions/')) {
        if (transactionOptions.correctFails !== undefined) {
          return Promise.reject(transactionOptions.correctFails);
        }

        return idempotent<TData>(request?.idempotencyKey, () => {
          const existing = requireTransaction(transactionId);
          const sentRevision = parseEntityTagRevision(request?.ifMatch);

          // The real API refuses a correction against a revision that is no longer current and
          // refuses to correct a voided record at all, so a screen that sends a stale
          // `If-Match`, or edits a void, fails here rather than in production.
          if (sentRevision === undefined || sentRevision !== existing.revision) {
            return Promise.reject(staleTransactionRevision);
          }

          if (existing.status === 'VOIDED') {
            return Promise.reject(staleTransactionRevision);
          }

          const input = (body ?? {}) as {
            amount?: string;
            paymentMethod?: TransactionSummary['paymentMethod'];
            businessDate?: string;
            description?: string;
            notes?: string;
            categoryId?: string | null;
          };

          // `REQ-EXP-004`: an expense references exactly one category, so a correction may move
          // it but may not clear it. The stub refuses `null` for the same reason the API does, so
          // a browser that could strip a category would fail here.
          if (input.categoryId === null || input.categoryId === '') {
            return Promise.reject(
              new ApiClientError(
                400,
                'VALIDATION_FAILED',
                'An expense must keep exactly one category.',
                '4e1f2a3b-5c6d-4e7f-a67a-829304a5b637',
                [{ field: 'categoryId', message: 'Choose a category.' }],
              ),
            );
          }

          // A move to a category that does not exist or cannot be used is refused, so the picker
          // offering one would be a dead control.
          const targetCategory =
            input.categoryId === undefined
              ? undefined
              : categoryStore.find((row) => row.id === input.categoryId);

          if (input.categoryId !== undefined && (targetCategory?.status ?? '') !== 'ACTIVE') {
            return Promise.reject(
              new ApiClientError(
                400,
                'VALIDATION_FAILED',
                'Only an active category can be used for a new expense.',
                '5f2a3b4c-6d7e-4f8a-b78b-9304a5b6c748',
                [
                  {
                    field: 'categoryId',
                    message: 'Only an active category can be used for a new expense.',
                  },
                ],
              ),
            );
          }

          const corrected: TransactionSummary = {
            ...existing,
            amount:
              input.amount === undefined ? existing.amount : formatPaise(toPaise(input.amount)),
            paymentMethod: input.paymentMethod ?? existing.paymentMethod,
            businessDate: input.businessDate ?? existing.businessDate,
            description:
              input.description === undefined ? existing.description : input.description || null,
            notes: input.notes === undefined ? existing.notes : input.notes || null,
            category:
              targetCategory === undefined
                ? existing.category
                : categoryRef(targetCategory.id, targetCategory.name, targetCategory.status),
            revision: existing.revision + 1,
            updatedAt: '2026-09-28T07:45:00.000Z',
          };

          replaceTransaction(corrected);

          return Promise.resolve(corrected);
        });
      }

      const categoryMatch = /^\/expenses\/categories\/([^/?]+)$/.exec(path);

      if (categoryMatch !== null) {
        if (expenseOptions.updateCategoryFails !== undefined) {
          return Promise.reject(expenseOptions.updateCategoryFails);
        }

        return idempotent<TData>(request?.idempotencyKey, () => {
          const categoryId = categoryMatch[1] ?? '';
          const index = categoryStore.findIndex((row) => row.id === categoryId);

          if (index === -1) {
            return Promise.reject(notFound);
          }

          const existing = categoryStore[index];

          if (existing === undefined) {
            return Promise.reject(notFound);
          }

          const input = (body ?? {}) as {
            name?: string;
            status?: ExpenseCategoryView['status'];
            isSystem?: boolean;
          };

          // A category is renamed or deactivated, never deleted, and a request that tries to
          // change the system flag is refused: the initial set is fixed by `REQ-EXP-001`.
          if (input.isSystem !== undefined) {
            return Promise.reject(
              new ApiClientError(
                400,
                'VALIDATION_FAILED',
                'The system flag cannot be changed.',
                '6a3b4c5d-7e8f-4a9b-c89d-a4b5c6d7e859',
                [{ field: 'isSystem', message: 'The system flag cannot be changed.' }],
              ),
            );
          }

          const updated: ExpenseCategoryView = {
            ...existing,
            name: input.name?.trim() ?? existing.name,
            status: input.status ?? existing.status,
            updatedAt: '2026-09-28T08:30:00.000Z',
          };

          categoryStore[index] = updated;

          // A rename has to reach the transactions that already carry the old label, or history
          // would keep showing a name the Admin has since corrected.
          for (const [position, row] of transactionStore.entries()) {
            if (row.category?.id === updated.id) {
              transactionStore[position] = {
                ...row,
                category: categoryRef(updated.id, updated.name, updated.status),
              };
            }
          }

          return Promise.resolve(updated as TData);
        });
      }

      const memberId = memberIdOf(path);

      if (memberId !== undefined && path.startsWith('/members/')) {
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
      }

      return unknown(path);
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

    /**
     * The list is not a paginated envelope here on purpose.
     *
     * `docs/06-API-SPEC.md` documents a transaction's documents as a plain array, not a
     * `/transactions/:id/documents` list envelope, so the stub answers exactly what the browser
     * asked for rather than what a member list would need.
     */
    upload<TData>(path: string, form: FormData, request?: ApiRequestOptionsShape): Promise<TData> {
      record('POST', path, form, request);

      const match = /^\/transactions\/([^/?]+)\/documents$/.exec(path);

      if (match === null) {
        return unknown(path);
      }

      if (documentOptions.uploadFails !== undefined) {
        return Promise.reject(documentOptions.uploadFails);
      }

      if (!hasFailedFirstDocumentUpload && documentOptions.firstUploadFails !== undefined) {
        hasFailedFirstDocumentUpload = true;

        return Promise.reject(documentOptions.firstUploadFails);
      }

      const transactionId = match[1] ?? '';
      const transaction = transactionStore.find((row) => row.id === transactionId);

      if (transaction === undefined) {
        return Promise.reject(
          new ApiClientError(404, 'NOT_FOUND', 'That transaction was not found.', 'stub-request'),
        );
      }

      const file = form.get(DOCUMENT_UPLOAD_FIELD);

      if (!(file instanceof File)) {
        return Promise.reject(
          new ApiClientError(
            400,
            'VALIDATION_FAILED',
            `The upload was missing the "${DOCUMENT_UPLOAD_FIELD}" file field.`,
            'stub-request',
          ),
        );
      }

      return settleOrReject<TData>(
        storeDocument(transactionId, transaction.referenceId, file.name, file.size),
        undefined,
      );
    },

    delete<TData>(path: string, body?: unknown, request?: ApiRequestOptionsShape): Promise<TData> {
      record('DELETE', path, body, request);

      const match = /^\/documents\/([^/?]+)$/.exec(path);

      if (match === null) {
        return unknown(path);
      }

      if (documentOptions.removeFails !== undefined) {
        return Promise.reject(documentOptions.removeFails);
      }

      const documentId = match[1] ?? '';
      const located = findDocument(documentId);

      if (located === undefined) {
        return Promise.reject(
          new ApiClientError(404, 'NOT_FOUND', 'That document was not found.', 'stub-request'),
        );
      }

      const input = (body ?? {}) as { reason?: string };
      const reason = input.reason?.trim() ?? '';
      const removalError = reason === '' ? 'A removal reason is required.' : undefined;

      if (removalError !== undefined) {
        return Promise.reject(
          new ApiClientError(400, 'VALIDATION_FAILED', removalError, 'stub-request'),
        );
      }

      return settleOrReject<TData>(
        removeDocument(located.transactionId, located.document, reason),
        undefined,
      );
    },

    documentsFor(transactionId: string): readonly DocumentSummary[] {
      return documentStore.get(transactionId) ?? [];
    },
  };

  /** Locates a document across every transaction, the way a real id-keyed read would. */
  function findDocument(
    documentId: string,
  ): { transactionId: string; document: DocumentSummary } | undefined {
    for (const [transactionId, rows] of documentStore) {
      const found = rows.find((row) => row.id === documentId);

      if (found !== undefined) {
        return { transactionId, document: found };
      }
    }

    return undefined;
  }

  /**
   * Appends an uploaded document.
   *
   * The reference is generated rather than supplied, so a test cannot pass by asserting a value it
   * handed in itself, and the transaction's `documentCount` moves with the store for the same
   * reason: `docs/06-API-SPEC.md` returns that count on the transaction.
   */
  function storeDocument(
    transactionId: string,
    transactionReferenceId: string,
    originalFilename: string,
    byteSize: number,
  ): DocumentSummary {
    const existing = documentStore.get(transactionId) ?? [];
    const id = `dddddddd${String(existing.length + 1).padStart(4, '0')}-4000-8000-000000000000`;
    const mimeType = guessMimeType(originalFilename) ?? 'application/pdf';
    const isImage = mimeType.startsWith('image/');
    const document: DocumentSummary = {
      id,
      referenceId: `HY-DOC-${String(existing.length + 1).padStart(6, '0')}`,
      transactionId,
      transactionReferenceId,
      originalFilename,
      declaredMimeType: mimeType,
      detectedMimeType: mimeType,
      byteSize,
      checksumSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      status: 'AVAILABLE',
      contentAvailable: true,
      // Only images render inline. A PDF is downloadable but not previewable, matching the server
      // decision `docs/06-API-SPEC.md` describes, so the browser cannot offer a control that the API
      // would refuse.
      previewAvailable: isImage,
      downloadPath: `/documents/${id}/content`,
      previewPath: isImage ? `/documents/${id}/content` : null,
      uploadedAt: '2026-03-01T09:00:00.000Z',
      removedAt: null,
      removalReason: null,
      storageDeleted: false,
      cleanupPending: false,
    };

    documentStore.set(transactionId, [...existing, document]);

    // `documentCount` is readonly on the contract, so the row is replaced through the existing
    // store helper rather than mutated. The count moves because `docs/06-API-SPEC.md` returns it on
    // every transaction projection, and a stale value would contradict the list rendered beside it.
    const transaction = transactionStore.find((row) => row.id === transactionId);

    if (transaction !== undefined) {
      replaceTransaction({ ...transaction, documentCount: transaction.documentCount + 1 });
    }

    return document;
  }

  /** Applies removal: the row is retained, and the bytes stop being available. */
  function removeDocument(
    transactionId: string,
    document: DocumentSummary,
    reason: string,
  ): DocumentSummary {
    const removed: DocumentSummary = {
      ...document,
      status: 'REMOVED',
      contentAvailable: false,
      previewAvailable: false,
      previewPath: null,
      removedAt: '2026-03-02T09:00:00.000Z',
      removalReason: reason,
      storageDeleted: true,
      cleanupPending: false,
    };
    const rows = documentStore.get(transactionId) ?? [];

    documentStore.set(
      transactionId,
      rows.map((row) => (row.id === document.id ? removed : row)),
    );

    // `documentCount` on `TransactionSummary` counts *retained* records, so it deliberately does not
    // move: `docs/05-DATABASE-SPEC.md` keeps the metadata after removal. The availability flag lives
    // on the document row itself, which is what this panel renders, and the panel's own query is
    // invalidated so it re-reads the list rather than trusting a local guess.

    return removed;
  }
}

/**
 * Builds the document a fixture implies by declaring a `documentCount`.
 *
 * Only ever a JPG receipt, so the row is *available* and therefore previewable: that exercises the
 * richer of the two presentations. Every field the contract requires is present because the browser
 * validates the payload, and a half-filled row would fail for the wrong reason.
 */
function seededDocument(transaction: TransactionSummary, index: number): DocumentSummary {
  const suffix = String(index + 1).padStart(12, '0');
  const id = `dddddddd0-0000-4000-8000-${suffix}`;
  const originalFilename = index === 0 ? 'receipt.jpg' : `receipt-${index + 1}.jpg`;

  return {
    id,
    referenceId: `HY-DOC-${String(index + 1).padStart(6, '0')}`,
    transactionId: transaction.id,
    transactionReferenceId: transaction.referenceId,
    originalFilename,
    declaredMimeType: 'image/jpeg',
    detectedMimeType: 'image/jpeg',
    byteSize: 3,
    checksumSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    status: 'AVAILABLE',
    contentAvailable: true,
    previewAvailable: true,
    downloadPath: `/api/v1/documents/${id}/download`,
    previewPath: `/api/v1/documents/${id}/preview`,
    uploadedAt: transaction.createdAt,
    removedAt: null,
    removalReason: null,
    storageDeleted: false,
    cleanupPending: false,
  };
}

/** Maps a filename to a demo-supported type, so the stub does not invent an unsupported one. */
function guessMimeType(filename: string): DocumentMimeType | undefined {
  const extension = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();

  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'pdf':
      return 'application/pdf';
    default:
      return undefined;
  }
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

/**
 * Applies the documented transaction filters, sort, and paging.
 *
 * The income screen narrows the one canonical list with `type=INCOME` and adds its own
 * `incomeType`, and this mirrors the API's filtering rather than returning a fixture. A test can
 * therefore prove the income-type filter, the status filter, the date range, the amount range,
 * the search box, the sort columns, and the pager all reach the API with the right parameters —
 * and that a voided row is still listed but excluded when only active income is asked for.
 */
function paginateTransactions(
  path: string,
  store: readonly TransactionSummary[],
): ApiListPage<TransactionSummary> {
  const query = new URLSearchParams(path.includes('?') ? path.slice(path.indexOf('?') + 1) : '');
  const search = (query.get('search') ?? '').trim().toLowerCase();
  const page = Math.max(1, Number.parseInt(query.get('page') ?? '1', 10) || 1);
  const pageSize = Math.max(1, Number.parseInt(query.get('pageSize') ?? '20', 10) || 20);
  const sort = (query.get('sort') ?? 'businessDate') as TransactionSortField;
  const direction = query.get('direction') === 'asc' ? 'asc' : 'desc';
  const type = query.get('type');
  const incomeType = query.get('incomeType');
  const categoryId = query.get('categoryId');
  const status = query.get('status');
  const paymentMethod = query.get('paymentMethod');
  const from = query.get('from');
  const to = query.get('to');
  const minAmount = query.get('minAmount');
  const maxAmount = query.get('maxAmount');

  const matched = store.filter((row) => {
    if (type !== null && type !== '' && row.type !== type) {
      return false;
    }
    if (incomeType !== null && incomeType !== '' && row.incomeType !== incomeType) {
      return false;
    }
    if (categoryId !== null && categoryId !== '' && row.category?.id !== categoryId) {
      return false;
    }
    if (status !== null && status !== '' && row.status !== status) {
      return false;
    }
    if (paymentMethod !== null && paymentMethod !== '' && row.paymentMethod !== paymentMethod) {
      return false;
    }
    if (from !== null && from !== '' && row.businessDate < from) {
      return false;
    }
    if (to !== null && to !== '' && row.businessDate > to) {
      return false;
    }
    if (minAmount !== null && minAmount !== '' && toPaise(row.amount) < toPaise(minAmount)) {
      return false;
    }
    if (maxAmount !== null && maxAmount !== '' && toPaise(row.amount) > toPaise(maxAmount)) {
      return false;
    }

    return (
      search === '' ||
      row.referenceId.toLowerCase().includes(search) ||
      (row.description ?? '').toLowerCase().includes(search) ||
      (row.member?.name ?? '').toLowerCase().includes(search) ||
      (row.category?.name ?? '').toLowerCase().includes(search)
    );
  });

  const ordered = [...matched].sort((a, b) => {
    const order = compareTransactionBy(sort, a, b);

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

function compareTransactionBy(
  sort: TransactionSortField,
  a: TransactionSummary,
  b: TransactionSummary,
): number {
  if (sort === 'amount') {
    // Compared as exact paise, never as a JavaScript number, so the order matches the ledger
    // rather than floating-point rounding.
    const left = toPaise(a.amount);
    const right = toPaise(b.amount);

    return left === right ? a.referenceId.localeCompare(b.referenceId) : left < right ? -1 : 1;
  }
  if (sort === 'createdAt') {
    return a.createdAt === b.createdAt
      ? a.referenceId.localeCompare(b.referenceId)
      : a.createdAt.localeCompare(b.createdAt);
  }
  if (sort === 'referenceId') {
    return a.referenceId.localeCompare(b.referenceId);
  }

  return a.businessDate === b.businessDate
    ? a.referenceId.localeCompare(b.referenceId)
    : a.businessDate.localeCompare(b.businessDate);
}

interface ApiRequestOptionsShape {
  readonly csrfToken?: string;
  readonly ifMatch?: string;
  readonly idempotencyKey?: string;
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
