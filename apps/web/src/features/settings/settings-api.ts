import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MONEY_FORMAT_MESSAGE,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type DemoSettings,
  type PaymentMethod,
} from '@hyssop/contracts';
import { useApiClient } from '../../app/providers/ApiClientProvider';
import { ApiClientError, ApiTransportError } from '../../lib/api-client';
import { useSession } from '../auth/SessionProvider';
import { fieldIssuesByName } from '../transactions/transaction-api';

/**
 * Settings data access for the Settings screen.
 *
 * Authority: `docs/06-API-SPEC.md` ("Settings"), `docs/01-REQUIREMENTS.md` `REQ-SETTINGS-001`
 * to `REQ-SETTINGS-009`, and `docs/02-ARCHITECTURE.md` - the browser never decides authoritative
 * state. Three rules shape the code:
 *
 * - **Which values are editable is server-decided.** `DemoSettings.editable` is the API's answer,
 *   so the screen renders the fixed currency and timezone as fixed *because the API said so*
 *   rather than because the browser hardcoded that they are fixed. A screen that inferred
 *   editability itself would offer a control for a value `REQ-SETTINGS-003` and `REQ-SETTINGS-004`
 *   pin, which is the dead control `AGENTS.md` forbids.
 * - **Amounts cross the boundary as exact decimal strings.** `defaultMonthlyContribution` is
 *   `"500.00"`, never a JSON number, because `REQ-FIN-021` requires exact paise and a double cannot
 *   represent every paise value. The value is validated here as *text* only, and only to avoid
 *   sending a request the server will certainly refuse; the stored paise count is the server's
 *   business and this module never computes one.
 * - **Every write reuses one idempotency key per intent,** supplied by the caller, because the
 *   server deduplicates on it. Generating the key inside the mutation would mint a *new* key on
 *   every retry, which is the opposite of what an idempotency key is for: a retry after a timeout
 *   would then apply the change a second time.
 */

export const SETTINGS_QUERY_KEY = ['settings'] as const;

/** The offered payment methods, labelled for a non-technical reader, in contract order. */
export const SETTINGS_PAYMENT_METHOD_CHOICES: readonly {
  readonly value: PaymentMethod;
  readonly label: string;
}[] = PAYMENT_METHODS.map((method) => ({ value: method, label: PAYMENT_METHOD_LABELS[method] }));

export function useSettings() {
  const api = useApiClient();

  return useQuery<DemoSettings, Error>({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: async () => api.get<DemoSettings>('/settings'),
    staleTime: 60_000,
  });
}

export interface UpdateSettingsVariables {
  /** Only the fields the Admin actually changed; an omitted field is left alone server-side. */
  readonly defaultMonthlyContribution?: string | undefined;
  readonly enabledPaymentMethods?: readonly PaymentMethod[] | undefined;
  /** One key per submission intent, reused across retries of that intent. */
  readonly idempotencyKey: string;
}

/**
 * Saves the changed settings through `PATCH /api/v1/settings`.
 *
 * The mutation writes the API's returned settings into the cache rather than refetching, so the
 * screen shows what the server *stored* - including the payment methods re-ordered into the
 * documented order - instead of the order the browser happened to send.
 */
export function useUpdateSettings() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { withCsrf } = useSession();

  return useMutation<DemoSettings, Error, UpdateSettingsVariables>({
    mutationFn: async ({ idempotencyKey, ...changes }) => {
      const body: Record<string, unknown> = {};

      if (changes.defaultMonthlyContribution !== undefined) {
        body.defaultMonthlyContribution = changes.defaultMonthlyContribution;
      }

      if (changes.enabledPaymentMethods !== undefined) {
        body.enabledPaymentMethods = changes.enabledPaymentMethods;
      }

      // `docs/06-API-SPEC.md` requires the CSRF header on every state-changing request, so the
      // token is fetched for this write rather than read from a stale page load.
      return withCsrf((csrfToken) =>
        api.patch<DemoSettings>('/settings', body, { csrfToken, idempotencyKey }),
      );
    },
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_QUERY_KEY, data);
    },
  });
}

export interface SetDefaultContributionVariables {
  readonly defaultMonthlyContribution: string;
  readonly idempotencyKey: string;
}

/**
 * Saves only the member expectation through `POST /api/v1/settings/contribution-default`.
 *
 * Provided because `docs/06-API-SPEC.md` documents the route, so the Settings screen offers the
 * change the way the specification addresses it rather than hiding a documented endpoint. The
 * browser prefers it over the general `PATCH` when only the amount changed, because it is the
 * narrower command: a body with one field cannot accidentally overwrite the payment methods.
 */
export function useSetDefaultContribution() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { withCsrf } = useSession();

  return useMutation<DemoSettings, Error, SetDefaultContributionVariables>({
    mutationFn: async ({ idempotencyKey, defaultMonthlyContribution }) =>
      withCsrf((csrfToken) =>
        api.post<DemoSettings>(
          '/settings/contribution-default',
          { defaultMonthlyContribution },
          { csrfToken, idempotencyKey },
        ),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_QUERY_KEY, data);
    },
  });
}

/**
 * The money text this screen accepts, before a request is sent.
 *
 * The same shape the API's money pattern accepts: one or more digits with an optional one or two
 * decimal places, no grouping, no sign, no exponent. This is a *transport* check, not a financial
 * one - it exists so a clear mistake such as `1,200` or `500.000` is reported against the field
 * immediately instead of after a round trip. It never converts the text to a number, because
 * `REQ-FIN-021` requires the exact string to reach the server unchanged.
 */
const MONEY_INPUT_PATTERN = /^\d+(?:\.\d{1,2})?$/;

export interface SettingsFieldErrors {
  readonly defaultMonthlyContribution?: string | undefined;
  readonly enabledPaymentMethods?: string | undefined;
}

/**
 * Checks the amount the Admin typed, without judging its size.
 *
 * The only rules enforced here are the ones the API would enforce about the *text*: it must be a
 * plain positive decimal. Whether it is within an acceptable range is left to the server, so this
 * screen cannot hold a second, drifting opinion about what a reasonable contribution is.
 */
export function validateContributionAmount(amount: string): string | undefined {
  const trimmed = amount.trim();

  if (trimmed === '') {
    return 'Enter the amount every member is expected to give each month.';
  }

  if (!MONEY_INPUT_PATTERN.test(trimmed)) {
    return MONEY_FORMAT_MESSAGE;
  }

  if (/^0+(?:\.0{1,2})?$/.test(trimmed)) {
    return 'The amount must be greater than zero.';
  }

  return undefined;
}

export function hasSettingsFieldErrors(errors: SettingsFieldErrors): boolean {
  return (
    errors.defaultMonthlyContribution !== undefined || errors.enabledPaymentMethods !== undefined
  );
}

/**
 * Reads the field-level issues out of an API validation error.
 *
 * `docs/06-API-SPEC.md` returns `error.fields` for a validation failure, so a server-side rejection
 * is shown against the field it belongs to. A field this screen does not know keeps its own name
 * rather than being attached to the nearest input, because attaching it elsewhere would misreport
 * where the problem is.
 */
export function settingsFieldErrors(error: unknown): SettingsFieldErrors {
  const issues = fieldIssuesByName(error);

  return {
    defaultMonthlyContribution: issues['defaultMonthlyContribution'],
    enabledPaymentMethods: issues['enabledPaymentMethods'],
  };
}

/**
 * A settings failure in the words the screen shows.
 *
 * A `409` means the same idempotency key was reused with a different body - in practice a saved
 * page and a second tab - so the message says what to do rather than only that something failed.
 * A transport failure keeps the client's own wording, which already tells the Admin the API could
 * not be reached and offers a retry.
 */
export function describeSettingsFailure(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 409) {
      return 'These settings were already saved with a different value. Reload the page and try again.';
    }

    return error.message;
  }

  if (error instanceof ApiTransportError) {
    return error.message;
  }

  return 'Something went wrong. Please try again.';
}
