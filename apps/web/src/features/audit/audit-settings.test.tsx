import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  SETTINGS_BUSINESS_TIMEZONE,
  SETTINGS_CURRENCY,
  type ApiPagination,
  type AuditEventRow,
  type AuditHistoryResponse,
  type DemoSettings,
  type PaymentMethod,
} from '@hyssop/contracts';
import { ApiClientError, type ApiClient, type ApiRequestOptions } from '../../lib/api-client';
import { renderRoute } from '../../test/render';
import { stubApiClient, transportFailure } from '../../test/stub-client';

/**
 * UI tests for the Audit History and Settings screens.
 *
 * Authority: `docs/10-TEST-PLAN.md` (`TEST-AUDIT-001`, `TEST-AUDIT-002`) and
 * `docs/phases/PHASE-10-AUDIT-SETTINGS.md` ("Browser tests for audit filters, detail, void
 * history, and settings changes").
 *
 * These assert what the *browser* is responsible for: that it asks the documented routes, that it
 * shows the server's own labels and values, that it renders a read-only trail with no control that
 * could change it, that it never renders a value the API did not send, and that a settings change
 * really leaves the browser in the state the server reported. Persistence, the audit write, and the
 * exact-money guarantee are proven by the API and database suites, not restated here.
 *
 * The stub is deliberately strict: a request to a path these screens must not call fails loudly, so
 * a test cannot pass while the screen quietly asked for something it should not.
 */

const DEFAULT_PAGINATION: ApiPagination = {
  page: 1,
  pageSize: 20,
  totalItems: 2,
  totalPages: 1,
};

const CREATED_EVENT: AuditEventRow = {
  id: 'audit-created',
  action: 'TRANSACTION_CREATED',
  actionLabel: 'Transaction recorded',
  entityType: 'financial_transaction',
  entityLabel: 'Transaction',
  entityReference: 'HY-INC-0001',
  actorDisplayName: 'Pastor Demo',
  occurredAt: '2026-03-04T09:30:00.000Z',
  reason: null,
  requestId: 'req-created',
  before: [],
  after: [
    { key: 'amount', label: 'Amount', value: '1500.00', redacted: false },
    { key: 'paymentMethod', label: 'Payment Method', value: 'UPI', redacted: false },
  ],
  beforeRecorded: false,
  afterRecorded: true,
};

const VOIDED_EVENT: AuditEventRow = {
  id: 'audit-voided',
  action: 'TRANSACTION_VOIDED',
  actionLabel: 'Transaction voided',
  entityType: 'financial_transaction',
  entityLabel: 'Transaction',
  entityReference: 'HY-EXP-0002',
  actorDisplayName: 'Pastor Demo',
  occurredAt: '2026-03-05T14:05:00.000Z',
  reason: 'Recorded against the wrong expense category.',
  requestId: 'req-voided',
  before: [{ key: 'status', label: 'Status', value: 'ACTIVE', redacted: false }],
  after: [{ key: 'status', label: 'Status', value: 'VOIDED', redacted: false }],
  beforeRecorded: true,
  afterRecorded: true,
};

const REDACTED_EVENT: AuditEventRow = {
  id: 'audit-signin',
  action: 'LOGIN_SUCCEEDED',
  actionLabel: 'Signed in',
  entityType: 'session',
  entityLabel: 'Sign-In',
  entityReference: null,
  actorDisplayName: 'Pastor Demo',
  occurredAt: '2026-03-06T04:00:00.000Z',
  reason: null,
  requestId: null,
  before: [],
  after: [{ key: 'loginToken', label: 'Login Token', value: 'Withheld', redacted: true }],
  beforeRecorded: false,
  afterRecorded: true,
};

function auditResponse(
  rows: readonly AuditEventRow[],
  overrides: {
    readonly filters?: AuditHistoryResponse['filters'];
    readonly pagination?: ApiPagination;
  } = {},
): AuditHistoryResponse {
  return {
    filters: overrides.filters ?? { action: null, entityType: null, from: null, to: null },
    rows,
    pagination: overrides.pagination ?? {
      ...DEFAULT_PAGINATION,
      totalItems: rows.length,
      totalPages: rows.length === 0 ? 1 : DEFAULT_PAGINATION.totalPages,
    },
  };
}

const DEFAULT_SETTINGS: DemoSettings = {
  currency: SETTINGS_CURRENCY,
  businessTimezone: SETTINGS_BUSINESS_TIMEZONE,
  defaultMonthlyContribution: '500.00',
  enabledPaymentMethods: ['CASH', 'UPI', 'BANK_TRANSFER'],
  editable: {
    defaultMonthlyContribution: true,
    enabledPaymentMethods: true,
    currency: false,
    businessTimezone: false,
  },
  minimumEnabledPaymentMethods: 1,
  expenseCategoryManagement: {
    label: 'Manage expense categories',
    path: '/expenses',
    note: 'Categories are added, renamed, and retired on the Expense screen.',
  },
};

/**
 * A client that answers the Phase 10 routes and refuses everything else the screens must not call.
 *
 * Refusing an unexpected path is the point: a screen that offered to edit or delete an audit event
 * would have to `post` to `/api/v1/audit-events`, and this client throws on that, so such a control
 * cannot quietly appear without a test failing.
 */
function phaseTenClient(handlers: {
  readonly auditHistory?: () => Promise<AuditHistoryResponse>;
  readonly settings?: () => Promise<DemoSettings>;
  readonly onPatchSettings?: (
    body: unknown,
    options: ApiRequestOptions | undefined,
  ) => Promise<DemoSettings>;
  readonly onPostContributionDefault?: (
    body: unknown,
    options: ApiRequestOptions | undefined,
  ) => Promise<DemoSettings>;
}): ApiClient {
  const base = stubApiClient();

  return {
    ...base,
    get: <TData,>(path: string, options?: ApiRequestOptions): Promise<TData> => {
      if (path === '/settings' && handlers.settings !== undefined) {
        return handlers.settings() as Promise<TData>;
      }

      if (path.startsWith('/audit-events') && handlers.auditHistory !== undefined) {
        return handlers.auditHistory() as Promise<TData>;
      }

      return base.get<TData>(path, options);
    },
    patch: <TData,>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<TData> => {
      if (path === '/settings' && handlers.onPatchSettings !== undefined) {
        return handlers.onPatchSettings(body, options) as Promise<TData>;
      }

      throw new Error(`Unexpected PATCH ${path}`);
    },
    post: <TData,>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<TData> => {
      if (
        path === '/settings/contribution-default' &&
        handlers.onPostContributionDefault !== undefined
      ) {
        return handlers.onPostContributionDefault(body, options) as Promise<TData>;
      }

      // Deliberately fatal: the audit trail has no write route, so a screen that posted here would
      // be offering to change history.
      throw new Error(`Unexpected POST ${path}`);
    },
  };
}

describe('audit history screen', () => {
  it('shows the trail in the order the API returned, with the API labels', async () => {
    renderRoute({
      path: '/audit-history',
      client: phaseTenClient({
        auditHistory: async () => auditResponse([VOIDED_EVENT, CREATED_EVENT]),
      }),
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Audit History' }),
    ).toBeInTheDocument();

    // Scope to the main content: the app shell's own navigation is also a list, and a bare
    // `getAllByRole('listitem')` would return its links before the audit entries.
    const entries = await within(screen.getByRole('main')).findAllByRole('listitem');

    // Order is the API's: this screen must not re-sort what it was given.
    expect(within(entries[0] as HTMLElement).getByText('Transaction voided')).toBeInTheDocument();
    expect(within(entries[1] as HTMLElement).getByText('Transaction recorded')).toBeInTheDocument();
    expect(screen.getByText(/HY-INC-0001/)).toBeInTheDocument();
    expect(screen.getByText(/HY-EXP-0002/)).toBeInTheDocument();
    expect(screen.getAllByText(/Pastor Demo/).length).toBeGreaterThan(0);
  });

  it('shows the void reason, because the reason is the point of a void', async () => {
    renderRoute({
      path: '/audit-history',
      client: phaseTenClient({ auditHistory: async () => auditResponse([VOIDED_EVENT]) }),
    });

    expect(
      await screen.findByText(/Recorded against the wrong expense category/),
    ).toBeInTheDocument();
  });

  it('keeps the before and after values behind a control, and shows them when asked', async () => {
    const user = userEvent.setup();

    renderRoute({
      path: '/audit-history',
      client: phaseTenClient({ auditHistory: async () => auditResponse([CREATED_EVENT]) }),
    });

    await screen.findByRole('heading', { level: 1, name: 'Audit History' });

    // Wait for the row before asserting on its collapsed state, otherwise the assertion could pass
    // only because the page is still loading.
    const toggle = await screen.findByRole('button', { name: 'Show the details' });

    // Collapsed by default: a page of entries would otherwise be unreadable, and the headline
    // sentence is what a viewer scans.
    expect(screen.queryByText('1500.00')).not.toBeInTheDocument();

    await user.click(toggle);

    expect(screen.getByText('1500.00')).toBeInTheDocument();
    expect(screen.getByText('UPI')).toBeInTheDocument();
  });

  it('says a creation had nothing to compare against instead of showing an empty panel', async () => {
    const user = userEvent.setup();

    renderRoute({
      path: '/audit-history',
      client: phaseTenClient({ auditHistory: async () => auditResponse([CREATED_EVENT]) }),
    });

    await screen.findByRole('heading', { level: 1, name: 'Audit History' });
    await user.click(await screen.findByRole('button', { name: 'Show the details' }));

    // `beforeRecorded === false` is a different fact from "recorded and empty", and conflating them
    // would imply the change had no prior state worth keeping.
    expect(
      screen.getByText('Not recorded, because there was nothing to compare against.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('A record was kept for this change and contained no values.'),
    ).not.toBeInTheDocument();
  });

  it('shows a withheld value as withheld rather than dropping the field', async () => {
    const user = userEvent.setup();

    renderRoute({
      path: '/audit-history',
      client: phaseTenClient({ auditHistory: async () => auditResponse([REDACTED_EVENT]) }),
    });

    await screen.findByRole('heading', { level: 1, name: 'Audit History' });
    await user.click(await screen.findByRole('button', { name: 'Show the details' }));

    // The API already replaced the value. This proves the screen renders the marker's own text
    // rather than deciding on its own what to hide.
    expect(screen.getByText('Withheld')).toBeInTheDocument();
    expect(screen.getByText('Login Token')).toBeInTheDocument();
  });

  it('sends only the criteria the Admin chose, and keeps them in the URL', async () => {
    const user = userEvent.setup();
    const requested: string[] = [];
    const client = phaseTenClient({ auditHistory: async () => auditResponse([CREATED_EVENT]) });

    const spy: ApiClient = {
      ...client,
      get: <TData,>(path: string, options?: ApiRequestOptions): Promise<TData> => {
        if (path.startsWith('/audit-events')) {
          requested.push(path);
        }

        return client.get<TData>(path, options);
      },
    };

    renderRoute({ path: '/audit-history', client: spy });

    await screen.findByRole('heading', { level: 1, name: 'Audit History' });

    await waitFor(() => {
      expect(requested.length).toBeGreaterThan(0);
    });

    // Nothing chosen yet, so no filter is sent - only the paging bounds the screen always states.
    const initial = requested[requested.length - 1] as string;
    expect(initial).not.toContain('action=');
    expect(initial).not.toContain('entityType=');
    expect(initial).not.toContain('from=');

    await user.selectOptions(screen.getByLabelText('What happened'), 'TRANSACTION_VOIDED');

    await waitFor(() => {
      expect(requested.some((path) => path.includes('action=TRANSACTION_VOIDED'))).toBe(true);
    });
    // The unset criteria are absent rather than sent blank, because the API treats a blank value as
    // one outside its documented vocabulary.
    expect(requested.some((path) => path.includes('entityType='))).toBe(false);
    expect(requested.some((path) => path.includes('from='))).toBe(false);
  });

  it('distinguishes an empty result from an empty trail and offers the documented way out', async () => {
    const user = userEvent.setup();

    renderRoute({
      path: '/audit-history?action=LOGOUT',
      client: phaseTenClient({ auditHistory: async () => auditResponse([]) }),
    });

    expect(await screen.findByText('No entries match these filters')).toBeInTheDocument();

    await user.click(
      screen.getAllByRole('button', { name: 'Clear all filters' })[0] as HTMLElement,
    );

    await waitFor(() => {
      expect(screen.queryByText('No entries match these filters')).not.toBeInTheDocument();
    });
    expect(screen.getByText('No changes recorded yet')).toBeInTheDocument();
  });

  it('offers no control that could change a recorded entry', async () => {
    renderRoute({
      path: '/audit-history',
      client: phaseTenClient({ auditHistory: async () => auditResponse([CREATED_EVENT]) }),
    });

    await screen.findByRole('heading', { level: 1, name: 'Audit History' });

    // `REQ-AUDIT-001` makes the trail append-only. Any edit, delete, or void control here would be
    // a promise the API cannot keep.
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /void/i })).not.toBeInTheDocument();
  });

  it('reports a failure with a working retry rather than an empty table', async () => {
    const user = userEvent.setup();
    let attempt = 0;

    renderRoute({
      path: '/audit-history',
      client: phaseTenClient({
        auditHistory: async () => {
          attempt += 1;

          if (attempt === 1) {
            throw transportFailure;
          }

          return auditResponse([CREATED_EVENT]);
        },
      }),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('The API could not be reached.');
    expect(screen.queryByText('No changes recorded yet')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    // The reference is unique on the page; the action label also appears as a filter option, so
    // asserting on it would be ambiguous.
    expect(await screen.findByText(/HY-INC-0001/)).toBeInTheDocument();
    expect(attempt).toBe(2);
  });
});

describe('settings screen', () => {
  it('shows the fixed values as fixed and offers no control for them', async () => {
    renderRoute({
      path: '/settings',
      client: phaseTenClient({ settings: async () => DEFAULT_SETTINGS }),
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    // Wait for the loaded state before asserting on the fixed values, because both the loading and
    // the loaded view render the same page heading.
    await screen.findByLabelText(/Default monthly contribution/);

    // `REQ-SETTINGS-003` and `REQ-SETTINGS-004` are honoured visibly. Rendering them as read-only
    // text satisfies the requirement; rendering an input would be a control the API refuses.
    // Scope to main content because the app shell's header also names the timezone and currency.
    const main = within(screen.getByRole('main'));
    expect(main.getByText(/INR \(rupees\)/)).toBeInTheDocument();
    expect(main.getByText(/Asia\/Kolkata/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/currency/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/timezone/i)).not.toBeInTheDocument();
  });

  it('shows the stored amount as the exact string the API returned', async () => {
    renderRoute({
      path: '/settings',
      client: phaseTenClient({ settings: async () => DEFAULT_SETTINGS }),
    });

    expect(await screen.findByLabelText(/Default monthly contribution/)).toHaveValue('500.00');
  });

  it('links category management to the destination the API named', async () => {
    renderRoute({
      path: '/settings',
      client: phaseTenClient({ settings: async () => DEFAULT_SETTINGS }),
    });

    const link = await screen.findByRole('link', { name: 'Manage expense categories' });

    expect(link).toHaveAttribute('href', '/expenses');
  });

  it('will not let the Admin disable the last payment method', async () => {
    renderRoute({
      path: '/settings',
      client: phaseTenClient({
        settings: async () => ({
          ...DEFAULT_SETTINGS,
          enabledPaymentMethods: ['CASH'] as readonly PaymentMethod[],
        }),
      }),
    });

    // One method is enabled, so unticking it would break `REQ-SETTINGS-002`. The checkbox is
    // disabled for that documented reason rather than letting the Admin clear it and be refused.
    const cash = await screen.findByRole('checkbox', { name: 'Cash' });

    expect(cash).toBeChecked();
    expect(cash).toBeDisabled();
    expect(screen.getByText(/At least 1 payment method must stay enabled/)).toBeInTheDocument();
  });

  it('sends the amount through the dedicated contribution-default route', async () => {
    const user = userEvent.setup();
    const sent: { body: unknown; idempotencyKey: string | undefined }[] = [];

    renderRoute({
      path: '/settings',
      client: phaseTenClient({
        settings: async () => DEFAULT_SETTINGS,
        onPostContributionDefault: (body, options) => {
          sent.push({ body, idempotencyKey: options?.idempotencyKey });

          return Promise.resolve({
            ...DEFAULT_SETTINGS,
            defaultMonthlyContribution: '750.00',
          });
        },
      }),
    });

    const amount = await screen.findByLabelText(/Default monthly contribution/);

    await user.clear(amount);
    await user.type(amount, '750.00');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    // Only the amount changed, so the narrower documented route is used: a body with one field
    // cannot accidentally overwrite the payment methods.
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toEqual({ defaultMonthlyContribution: '750.00' });
    // `docs/06-API-SPEC.md` requires the header, and it is created once per submission intent.
    expect(sent[0]?.idempotencyKey).toBeTruthy();
  });

  it('sends a methods change through the settings route and shows what was stored', async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];

    renderRoute({
      path: '/settings',
      client: phaseTenClient({
        settings: async () => DEFAULT_SETTINGS,
        onPatchSettings: (body) => {
          sent.push(body);

          return Promise.resolve({
            ...DEFAULT_SETTINGS,
            // The API decides the stored set, so the screen must display the server's value rather
            // than the order the checkboxes happened to be ticked in.
            enabledPaymentMethods: ['CASH', 'BANK_TRANSFER'] as readonly PaymentMethod[],
          });
        },
      }),
    });

    await screen.findByLabelText(/Default monthly contribution/);
    await user.click(screen.getByRole('checkbox', { name: 'UPI' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(sent).toEqual([{ enabledPaymentMethods: ['CASH', 'BANK_TRANSFER'] }]);
    expect(
      await screen.findByText(/The available payment methods were saved\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'UPI' })).not.toBeChecked();
  });

  it('refuses a malformed amount without contacting the API', async () => {
    const user = userEvent.setup();
    let sent = 0;

    renderRoute({
      path: '/settings',
      client: phaseTenClient({
        settings: async () => DEFAULT_SETTINGS,
        onPostContributionDefault: () => {
          sent += 1;

          return Promise.resolve(DEFAULT_SETTINGS);
        },
      }),
    });

    const amount = await screen.findByLabelText(/Default monthly contribution/);

    await user.clear(amount);
    await user.type(amount, '1,200');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(sent).toBe(0);
  });

  it('refuses to save when nothing changed instead of reporting a false success', async () => {
    let sent = 0;

    renderRoute({
      path: '/settings',
      client: phaseTenClient({
        settings: async () => DEFAULT_SETTINGS,
        onPostContributionDefault: () => {
          sent += 1;

          return Promise.resolve(DEFAULT_SETTINGS);
        },
        onPatchSettings: () => {
          sent += 1;

          return Promise.resolve(DEFAULT_SETTINGS);
        },
      }),
    });

    await screen.findByLabelText(/Default monthly contribution/);

    // With no change the control is disabled, so there is nothing to click and nothing to send.
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeDisabled();
    expect(sent).toBe(0);
  });

  it('discards an unsaved edit', async () => {
    const user = userEvent.setup();

    renderRoute({
      path: '/settings',
      client: phaseTenClient({ settings: async () => DEFAULT_SETTINGS }),
    });

    const amount = await screen.findByLabelText(/Default monthly contribution/);

    await user.clear(amount);
    await user.type(amount, '999.00');
    expect(amount).toHaveValue('999.00');

    await user.click(screen.getByRole('button', { name: 'Discard changes' }));

    // The screen returns to the stored value; the server was never asked to change anything.
    expect(amount).toHaveValue('500.00');
  });

  it('shows a failure honestly and keeps the edit so it can be retried', async () => {
    const user = userEvent.setup();

    renderRoute({
      path: '/settings',
      client: phaseTenClient({
        settings: async () => DEFAULT_SETTINGS,
        onPostContributionDefault: () => Promise.reject(transportFailure),
      }),
    });

    const amount = await screen.findByLabelText(/Default monthly contribution/);

    await user.clear(amount);
    await user.type(amount, '750.00');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The API could not be reached.');
    // The typed amount survives, so the retry is the same intent and reuses the same key.
    expect(amount).toHaveValue('750.00');
  });

  it('reports a server-side field rejection against the field it belongs to', async () => {
    const user = userEvent.setup();

    renderRoute({
      path: '/settings',
      client: phaseTenClient({
        settings: async () => DEFAULT_SETTINGS,
        onPostContributionDefault: () =>
          Promise.reject(
            new ApiClientError(
              400,
              'VALIDATION_FAILED',
              'The submitted values were not accepted.',
              'req-1',
              [{ field: 'defaultMonthlyContribution', message: 'That amount is not allowed.' }],
            ),
          ),
      }),
    });

    const amount = await screen.findByLabelText(/Default monthly contribution/);

    await user.clear(amount);
    await user.type(amount, '750.00');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    // `docs/06-API-SPEC.md` returns the offending field; showing it here proves the screen maps that
    // block to the input rather than showing one generic message.
    expect(await screen.findByText('That amount is not allowed.')).toBeInTheDocument();
    expect(amount).toHaveAttribute('aria-invalid', 'true');
  });

  it('reports a load failure with a working retry', async () => {
    const user = userEvent.setup();
    let attempt = 0;

    renderRoute({
      path: '/settings',
      client: phaseTenClient({
        settings: async () => {
          attempt += 1;

          if (attempt === 1) {
            throw transportFailure;
          }

          return DEFAULT_SETTINGS;
        },
      }),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('The API could not be reached.');

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByLabelText(/Default monthly contribution/)).toHaveValue('500.00');
    expect(attempt).toBe(2);
  });

  it('keeps the payment methods in the documented order however they were ticked', async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];

    renderRoute({
      path: '/settings',
      client: phaseTenClient({
        settings: async () => ({
          ...DEFAULT_SETTINGS,
          enabledPaymentMethods: ['CASH'] as readonly PaymentMethod[],
        }),
        onPatchSettings: (body) => {
          sent.push(body);

          return Promise.resolve({
            ...DEFAULT_SETTINGS,
            enabledPaymentMethods: ['CASH', 'UPI', 'BANK_TRANSFER'] as readonly PaymentMethod[],
          });
        },
      }),
    });

    await screen.findByLabelText(/Default monthly contribution/);

    // Ticked out of order on purpose: the request must still read Cash, UPI, Bank Transfer.
    await user.click(screen.getByRole('checkbox', { name: 'Bank Transfer' }));
    await user.click(screen.getByRole('checkbox', { name: 'UPI' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(sent).toEqual([{ enabledPaymentMethods: ['CASH', 'UPI', 'BANK_TRANSFER'] }]);
  });
});
