import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BUSINESS_DATE_FORMAT_MESSAGE,
  EXPENSE_CATEGORY_NAME_MAX_LENGTH,
  MONEY_FORMAT_MESSAGE,
  PAYMENT_METHODS,
  TRANSACTION_DESCRIPTION_MAX_LENGTH,
  TRANSACTION_NOTES_MAX_LENGTH,
  isPaymentMethod,
  type ExpenseCategoryView,
  type ExpenseSummary,
  type PaymentMethod,
  type TransactionSummary,
} from '@hyssop/contracts';
import { useApiClient } from '../../app/providers/ApiClientProvider';
import { ApiTransportError } from '../../lib/api-client';
import { useSession } from '../auth/SessionProvider';
import { invalidateTransactionDependents } from '../transactions/transaction-api';

/**
 * Expense form and category data access.
 *
 * Authority: `docs/01-REQUIREMENTS.md` `REQ-EXP-001` to `REQ-EXP-004` and
 * `docs/phases/PHASE-06-EXPENSES.md`. An expense is created through `POST /api/v1/expenses`;
 * the list, detail, correction, void, and audit behaviour is the shared transaction contract in
 * `../transactions/transaction-api` and is deliberately not reimplemented per expense.
 *
 * The two rules that are genuinely expense-specific are enforced here as well as by the API:
 *
 * - A category is required. `REQ-EXP-004` states an expense must reference exactly one category,
 *   and the browser cannot offer "no category" at all, so the empty state is not a valid
 *   selection to recover from.
 * - The category picker is built from `GET /api/v1/expenses/categories`, which the API
 *   documents as the *active* categories. That is why a deactivated category disappears from the
 *   dropdown instead of appearing greyed out and then being refused: a control that submits a
 *   value the server rejects is a dead control.
 *
 * An expense is never sent a member or an income type, so those keys are absent from the request
 * body entirely. A value that is never sent cannot be stored or misread, which is stronger than
 * asking the server to strip it.
 */

export const EXPENSE_CATEGORIES_QUERY_KEY = ['expense-categories'] as const;
export const EXPENSE_CATEGORIES_PATH = '/expenses/categories';

export const EXPENSE_LIST_DEFAULTS = {
  page: 1,
  pageSize: 20,
  sort: 'businessDate',
  direction: 'desc',
} as const;

export interface ExpenseFormValues {
  readonly categoryId: string;
  readonly amount: string;
  readonly paymentMethod: PaymentMethod;
  readonly businessDate: string;
  readonly description: string;
  readonly notes: string;
}

export const EMPTY_EXPENSE_FORM: ExpenseFormValues = {
  categoryId: '',
  amount: '',
  paymentMethod: 'CASH',
  businessDate: '',
  description: '',
  notes: '',
};

export interface ExpenseFieldErrors {
  readonly categoryId?: string;
  readonly amount?: string;
  readonly paymentMethod?: string;
  readonly businessDate?: string;
  readonly description?: string;
  readonly notes?: string;
}

export const PAYMENT_METHOD_CHOICES: readonly PaymentMethod[] = PAYMENT_METHODS;

const ZERO_AMOUNTS: readonly string[] = ['0', '0.0', '0.00'];

/**
 * Validates the expense fields in the browser.
 *
 * Mirrors the API's shape rules with the shared contract constants rather than a second copy
 * written here, so the browser cannot disagree with the server about what a valid amount or date
 * looks like. The API validates everything again; this only saves a round trip and puts the
 * message next to the field that caused it.
 */
export function validateExpenseFields(values: ExpenseFormValues): ExpenseFieldErrors {
  const errors: {
    categoryId?: string;
    amount?: string;
    paymentMethod?: string;
    businessDate?: string;
    description?: string;
    notes?: string;
  } = {};

  if (values.categoryId.trim() === '') {
    errors.categoryId = 'Choose a category.';
  }

  const amount = values.amount.trim();

  if (amount === '') {
    errors.amount = 'Enter an amount.';
  } else if (ZERO_AMOUNTS.includes(amount)) {
    errors.amount = 'The amount must be greater than zero.';
  } else if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) {
    errors.amount = MONEY_FORMAT_MESSAGE;
  }

  if (!isPaymentMethod(values.paymentMethod)) {
    errors.paymentMethod = 'Choose a payment method.';
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.businessDate.trim())) {
    errors.businessDate = BUSINESS_DATE_FORMAT_MESSAGE;
  }

  if (values.description.trim().length > TRANSACTION_DESCRIPTION_MAX_LENGTH) {
    errors.description = `Description must be ${TRANSACTION_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }

  if (values.notes.trim().length > TRANSACTION_NOTES_MAX_LENGTH) {
    errors.notes = `Notes must be ${TRANSACTION_NOTES_MAX_LENGTH} characters or fewer.`;
  }

  return errors;
}

export function hasExpenseFieldErrors(errors: ExpenseFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Builds the create body.
 *
 * Only the keys `docs/06-API-SPEC.md` defines for `POST /api/v1/expenses` are sent, and blank
 * optional text is omitted rather than sent empty. The amount is passed as the exact decimal
 * string the Admin typed: no `Number` conversion happens here, because `Number('1.10')` is the
 * float 1.1 and the difference between 110 and 110.00000000000001 paise is exactly what
 * `docs/01-REQUIREMENTS.md` forbids. The API parses the string into integer paise.
 */
export function expenseRequestBody(values: ExpenseFormValues): {
  categoryId: string;
  amount: string;
  paymentMethod: PaymentMethod;
  businessDate: string;
  description?: string;
  notes?: string;
} {
  const description = values.description.trim();
  const notes = values.notes.trim();

  return {
    categoryId: values.categoryId.trim(),
    amount: values.amount.trim(),
    paymentMethod: values.paymentMethod,
    businessDate: values.businessDate.trim(),
    ...(description === '' ? {} : { description }),
    ...(notes === '' ? {} : { notes }),
  };
}

/**
 * Narrows a shared transaction to an expense.
 *
 * `TransactionSummary.category` is nullable because income has no category, so the *shape* of an
 * expense is not proven by `type` alone. Checking the category and the derived `hasReceipt`
 * together is what makes the narrowing honest: a record claiming `EXPENSE` with no category, or
 * with no receipt state at all, is not something this screen should render as a normal expense
 * because `REQ-EXP-004` and `REQ-DOC-003` would both be silently unanswerable.
 */
export function isExpenseSummary(record: TransactionSummary): record is ExpenseSummary {
  return (
    record.type === 'EXPENSE' &&
    record.category !== null &&
    typeof (record as { readonly hasReceipt?: unknown }).hasReceipt === 'boolean'
  );
}

/**
 * Finds a category by id, for seeding the picker and the edit form.
 *
 * Returns `undefined` rather than a placeholder when the category is not in the active list.
 * That happens legitimately: the expense was filed under a category that has since been
 * deactivated, and its id is real but is not offered for a new entry. The caller shows the
 * retained label from the transaction and does not silently substitute a different category.
 */
export function findExpenseCategory(
  categories: readonly ExpenseCategoryView[],
  categoryId: string | undefined,
): ExpenseCategoryView | undefined {
  if (categoryId === undefined) {
    return undefined;
  }

  return categories.find((category) => category.id === categoryId);
}

/**
 * The label to show for an expense's category, including the deactivated case.
 *
 * A historical expense under a deactivated category must still read correctly, so the name is
 * shown with an explicit "inactive" note rather than being blanked or replaced. The note is
 * state, not a design flourish: without it the Admin cannot tell a typo apart from a category
 * that was retired.
 */
export function expenseCategoryLabel(
  categories: readonly ExpenseCategoryView[],
  category: ExpenseSummary['category'],
): string {
  const known = findExpenseCategory(categories, category.id);

  if (category.status === 'INACTIVE' || known?.status === 'INACTIVE') {
    return `${category.name} (inactive)`;
  }

  return category.name;
}

/** Validates a custom category name. Shared with the Phase 10 Settings screen. */
export function validateCategoryName(name: string): string | undefined {
  if (name.trim() === '') {
    return 'Enter a category name.';
  }

  if (name.trim().length > EXPENSE_CATEGORY_NAME_MAX_LENGTH) {
    return `Name must be ${EXPENSE_CATEGORY_NAME_MAX_LENGTH} characters or fewer.`;
  }

  return undefined;
}

/**
 * The active categories, as the documented plain data array.
 *
 * `retry: false` and a one-minute `staleTime` because this is a bounded configuration list that
 * changes rarely: a create or a deactivation invalidates it explicitly, and a screen should not
 * refetch it on every focus and re-render the picker under the Admin's cursor.
 */
export function useExpenseCategories() {
  const client = useApiClient();

  return useQuery({
    queryKey: EXPENSE_CATEGORIES_QUERY_KEY,
    queryFn: ({ signal }) =>
      client.get<readonly ExpenseCategoryView[]>(EXPENSE_CATEGORIES_PATH, { signal }),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateExpense() {
  const client = useApiClient();
  const { withCsrf } = useSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      readonly values: ExpenseFormValues;
      readonly idempotencyKey: string;
    }) => {
      if (input.idempotencyKey === '') {
        return Promise.reject(new ApiTransportError('No idempotency key was prepared.'));
      }

      return withCsrf((csrfToken) =>
        client.post<ExpenseSummary>('/expenses', expenseRequestBody(input.values), {
          csrfToken,
          // Sent on every create, as `docs/06-API-SPEC.md` requires. The key belongs to this one
          // submission, so a double submit or a retry records one expense, not two.
          idempotencyKey: input.idempotencyKey,
        }),
      );
    },
    onSuccess: () => {
      // A new expense changes the list, the counts, the category totals, and the audit view, so
      // every cached view that depends on the ledger is invalidated rather than patched.
      invalidateTransactionDependents(queryClient);
    },
  });
}

/**
 * A custom category created from the expense screen.
 *
 * `REQ-EXP-002` lets the Admin add a category the initial set does not contain. Creating it here
 * means the next expense can be filed under it without a detour to a Settings screen that Phase
 * 10 owns; the full Settings management UI is deliberately not built in this phase.
 */
export function useCreateExpenseCategory() {
  const client = useApiClient();
  const { withCsrf } = useSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { readonly name: string; readonly idempotencyKey: string }) => {
      if (input.idempotencyKey === '') {
        return Promise.reject(new ApiTransportError('No idempotency key was prepared.'));
      }

      return withCsrf((csrfToken) =>
        client.post<ExpenseCategoryView>(
          EXPENSE_CATEGORIES_PATH,
          { name: input.name.trim() },
          { csrfToken, idempotencyKey: input.idempotencyKey },
        ),
      );
    },
    onSuccess: () => {
      // Only the category list changes here. A new category has no transactions yet, so the
      // expense list, the detail, and the audit trail are all still correct.
      void queryClient.invalidateQueries({ queryKey: EXPENSE_CATEGORIES_QUERY_KEY });
    },
  });
}
