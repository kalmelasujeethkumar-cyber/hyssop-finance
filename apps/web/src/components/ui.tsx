import { Children, cloneElement, isValidElement, type ReactNode } from 'react';
import type { ContributionStatus, TransactionStatus } from '@hyssop/contracts';

/**
 * Small shared presentational pieces.
 *
 * Authority: `docs/03-UI-UX-RULES.md` — labelled controls, accessible inline errors,
 * intentional loading/empty/error states, status badges that include text rather than
 * colour alone, and touch targets suitable for mobile. These exist so every screen states
 * those things the same way instead of each page inventing a slightly different banner.
 */

const CONTROL_CLASS =
  'w-full rounded-md border border-border-default bg-surface px-3 py-2 text-supporting text-text-primary placeholder:text-text-secondary disabled:bg-surface-subtle disabled:text-text-secondary';

export interface FormFieldProps {
  readonly id: string;
  readonly label: string;
  /**
   * Shows the required or optional marker described in the UI rules.
   *
   * The marker is opt-in per field rather than automatic, because the UI rules require
   * required/optional indication on *form inputs* — a name the Admin must supply, an amount
   * they may leave blank. A search box, a sort control, or a month selector is not an
   * optional input; labelling one "optional" is misleading, and labelling it "required" is
   * worse when the control always holds a value. Those pass neither flag and get a plain
   * label.
   *
   * The `| undefined` members are deliberate: this project compiles with
   * `exactOptionalPropertyTypes`, so a caller passing `error={maybeUndefined}` must be
   * allowed to.
   */
  readonly required?: boolean | undefined;
  readonly optional?: boolean | undefined;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly children: ReactNode;
}

/**
 * One labelled control with its hint and inline error.
 *
 * The error is associated with the input through `aria-describedby` and marked
 * `role="alert"`, so a screen reader announces the problem when it appears instead of the
 * Admin discovering a red border with no explanation. `aria-invalid` is set from the same
 * value, so assistive technology reports the field as invalid rather than merely styled
 * that way.
 */
export function FormField({
  id,
  label,
  required,
  optional,
  hint,
  error,
  children,
}: FormFieldProps) {
  const describedBy =
    [error === undefined ? undefined : `${id}-error`, hint === undefined ? undefined : `${id}-hint`]
      .filter((value): value is string => value !== undefined)
      .join(' ') || undefined;
  const marker = required === true ? ' (required)' : optional === true ? ' (optional)' : '';

  // `aria-describedby` and `aria-invalid` have to reach the control itself. A plain
  // `div` carries no form semantics, so an `aria-describedby` placed on a wrapper is never
  // announced when focus moves into the field — the hint and the error would be invisible to
  // a screen reader while looking correct in the DOM. The single child is therefore cloned
  // with the attributes merged onto it, so every screen ends up with a real association
  // without each caller having to remember to wire it up.
  const child = Children.only(children);

  if (!isValidElement<Record<string, unknown>>(child)) {
    throw new Error(`FormField "${id}" must wrap exactly one form control.`);
  }

  const existingDescribedBy = child.props['aria-describedby'];
  const existingInvalid = child.props['aria-invalid'];
  const mergedDescribedBy =
    [typeof existingDescribedBy === 'string' ? existingDescribedBy : undefined, describedBy]
      .filter((value): value is string => value !== undefined && value !== '')
      .join(' ') || undefined;
  const control = cloneElement(child, {
    'aria-describedby': mergedDescribedBy,
    'aria-invalid': error === undefined ? existingInvalid : true,
  });

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-supporting font-semibold text-text-primary">
        {`${label}${marker}`}
      </label>
      <div className="contents">{control}</div>
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="text-supporting text-text-secondary">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-supporting font-semibold text-danger-700"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export function controlClassName(extra?: string): string {
  return extra === undefined ? CONTROL_CLASS : `${CONTROL_CLASS} ${extra}`;
}

export interface BannerProps {
  readonly tone: 'info' | 'success' | 'warning' | 'danger';
  readonly children: ReactNode;
  /**
   * An optional control shown beside the message.
   *
   * It exists because `docs/03-UI-UX-RULES.md` requires a failure state to offer a way forward:
   * an error the Admin can only stare at would be a dead end, and "Try again" is the honest
   * recovery when the cause is a transport failure rather than bad input.
   */
  readonly action?: ReactNode | undefined;
}

const TONE_CLASS: Record<BannerProps['tone'], string> = {
  info: 'border-border-strong bg-surface-subtle text-text-primary',
  success: 'border-success-700 bg-success-100 text-success-700',
  warning: 'border-warning-700 bg-warning-100 text-warning-700',
  danger: 'border-danger-700 bg-danger-100 text-danger-700',
};

/**
 * A status or error message.
 *
 * `role="alert"` is used for the danger and warning tones so a failure is announced, and
 * `role="status"` for the neutral and success tones so a confirmation is announced without
 * interrupting. Every tone states its meaning in words, so colour is never the only signal.
 */
export function Banner({ tone, children, action }: BannerProps) {
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={`rounded-md border px-4 py-3 text-supporting font-semibold ${TONE_CLASS[tone]}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>{children}</span>
        {action === undefined ? null : <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}

const STATUS_CLASS: Record<ContributionStatus, string> = {
  PAID: 'border-success-700 bg-success-100 text-success-700',
  'PARTIALLY PAID': 'border-warning-700 bg-warning-100 text-warning-700',
  'NOT PAID': 'border-danger-700 bg-danger-100 text-danger-700',
};

/**
 * The derived contribution status.
 *
 * `REQ-CONTRIB-004` and `docs/03-UI-UX-RULES.md` require the status to read as text, not as
 * a colour, so the badge always spells out `Paid`, `Partially paid`, or `Not paid` next to
 * its colour. The value itself is derived by the API from active transactions; the browser
 * never computes it.
 */
export function ContributionStatusBadge({ status }: { readonly status: ContributionStatus }) {
  return (
    <span
      data-status={status}
      className={`inline-block rounded-full border px-2 py-0.5 text-supporting font-semibold ${STATUS_CLASS[status]}`}
    >
      {labelForStatus(status)}
    </span>
  );
}

function labelForStatus(status: ContributionStatus): string {
  if (status === 'PAID') {
    return 'Paid';
  }

  return status === 'PARTIALLY PAID' ? 'Partially paid' : 'Not paid';
}

const TRANSACTION_STATUS_CLASS: Record<TransactionStatus, string> = {
  ACTIVE: 'border-success-700 bg-success-100 text-success-700',
  VOIDED: 'border-border-strong bg-surface-subtle text-text-secondary',
};

/**
 * The transaction status.
 *
 * `REQ-FIN-016` to `REQ-FIN-020` make void a state rather than a deletion, so a voided record is
 * still shown in every list and on its detail screen. The word is always spelled out next to
 * the colour, because a struck-through or greyed row is not something a screen reader can
 * announce and colour alone would leave a voided amount looking countable.
 */
export function TransactionStatusBadge({ status }: { readonly status: TransactionStatus }) {
  return (
    <span
      data-status={status}
      className={`inline-block rounded-full border px-2 py-0.5 text-supporting font-semibold ${TRANSACTION_STATUS_CLASS[status]}`}
    >
      {status === 'ACTIVE' ? 'Active' : 'Voided'}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode | undefined;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-page-title font-bold text-text-primary">{title}</h1>
        <p className="max-w-2xl text-supporting text-text-secondary">{description}</p>
      </div>
      {action === undefined ? null : <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Panel({
  title,
  children,
  action,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly action?: ReactNode | undefined;
}) {
  return (
    <section aria-label={title} className="rounded-xl border border-border-default bg-surface p-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-section-title font-bold text-text-primary">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * A neutral message for an empty result.
 *
 * `empty` distinguishes "there is genuinely nothing" from "your search matched nothing",
 * which `docs/03-UI-UX-RULES.md` requires to be distinguishable rather than both shown as
 * a blank table.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode | undefined;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border-strong bg-surface-subtle p-6 text-center">
      <p className="text-supporting font-semibold text-text-primary">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-supporting text-text-secondary">{description}</p>
      {action === undefined ? null : <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * A busy indicator with a live-region announcement.
 *
 * `aria-busy` on the region and `role="status"` on the text mean the wait is announced
 * rather than being conveyed only by a spinner, which is invisible to a screen reader.
 */
export function LoadingBlock({ label }: { readonly label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="rounded-lg border border-border-default bg-surface-subtle p-6 text-center"
    >
      <p className="text-supporting font-semibold text-text-primary">{label}</p>
    </div>
  );
}

export const PRIMARY_BUTTON_CLASS =
  'rounded-md bg-blue-600 px-4 py-2 text-supporting font-semibold text-text-inverse hover:bg-blue-700 disabled:bg-border-strong';

export const SECONDARY_BUTTON_CLASS =
  'rounded-md border border-border-strong bg-surface px-4 py-2 text-supporting font-semibold text-text-primary hover:bg-surface-subtle disabled:bg-surface-subtle disabled:text-text-secondary';
