import { useId, useState } from 'react';
import {
  DASHBOARD_PERIOD_LABELS,
  DASHBOARD_PERIOD_PRESETS,
  type DashboardPeriodKind,
  type DashboardPeriodPreset,
} from '@hyssop/contracts';
import { Banner, controlClassName, PRIMARY_BUTTON_CLASS } from '../../components/ui';
import {
  hasDashboardCustomRangeErrors,
  validateDashboardCustomRange,
  type DashboardPeriodSelection,
} from './dashboard-api';

/**
 * The period control.
 *
 * Authority: `docs/03-UI-UX-RULES.md` requires every filter to be usable on a narrow screen and
 * to have a visible label, and `docs/phases/PHASE-08-DASHBOARD.md` forbids a dead filter. Every
 * option here is a real request: there is no placeholder entry and no control that only changes
 * what is drawn.
 *
 * The custom range is a separate, explicit step rather than two extra always-visible date boxes.
 * Eight visible controls plus two empty dates would be a wall of inputs for a case used rarely,
 * and empty boxes that the Admin is expected to ignore read as required fields. Choosing **Custom
 * range** reveals the two bounds and the Apply button, and the Apply button is what commits them,
 * so a half-typed date never becomes the reported period.
 */

/**
 * The preset options, taken from the shared contract list.
 *
 * The browser does not get to name its own periods: a second hand-written array here could offer a
 * control the API rejects, or omit one it accepts, and the screen would then either error or hide
 * a documented period. `DASHBOARD_PERIOD_PRESETS` is the same list the API validates against and
 * its order is the order the API documents.
 */
const PRESET_ORDER: readonly DashboardPeriodPreset[] = DASHBOARD_PERIOD_PRESETS;

/** `custom` is a returned kind, never a preset, so it is the one entry added here. */
const CUSTOM: DashboardPeriodKind = 'custom';

export function DashboardPeriodFilter({
  period,
  onChange,
}: {
  readonly period: DashboardPeriodSelection;
  readonly onChange: (next: DashboardPeriodSelection) => void;
}) {
  const selectId = useId();
  const rangeId = useId();

  const [customVisible, setCustomVisible] = useState(period.kind === 'custom');
  const [from, setFrom] = useState(period.kind === 'custom' ? period.from : '');
  const [to, setTo] = useState(period.kind === 'custom' ? period.to : '');
  const [errors, setErrors] = useState(validateDashboardCustomRange('', ''));

  const selectedKind = period.kind;

  function choosePreset(kind: DashboardPeriodKind) {
    if (kind === 'custom') {
      setCustomVisible(true);

      return;
    }

    setCustomVisible(false);
    setErrors(validateDashboardCustomRange('', ''));
    onChange({ kind });
  }

  function applyCustomRange() {
    const found = validateDashboardCustomRange(from, to);

    setErrors(found);

    if (hasDashboardCustomRangeErrors(found)) {
      return;
    }

    onChange({ kind: 'custom', from: from.trim(), to: to.trim() });
  }

  return (
    <div className="rounded-xl border border-border-default bg-surface p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label
            htmlFor={selectId}
            className="block text-supporting font-semibold text-text-primary"
          >
            Period
          </label>
          <select
            id={selectId}
            value={selectedKind}
            onChange={(event) => choosePreset(event.target.value as DashboardPeriodKind)}
            className={`mt-1 ${controlClassName()}`}
          >
            {PRESET_ORDER.map((kind) => (
              <option key={kind} value={kind}>
                {DASHBOARD_PERIOD_LABELS[kind]}
              </option>
            ))}
            <option value={CUSTOM}>Custom range</option>
          </select>
        </div>
      </div>

      {customVisible ? (
        <fieldset className="mt-4 rounded-lg border border-border-default bg-surface-subtle p-4">
          <legend className="px-1 text-supporting font-semibold text-text-primary">
            Custom range
          </legend>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label
                htmlFor={`${rangeId}-from`}
                className="block text-supporting font-semibold text-text-primary"
              >
                From
              </label>
              <input
                id={`${rangeId}-from`}
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                aria-invalid={errors.from !== undefined}
                aria-describedby={errors.from === undefined ? undefined : `${rangeId}-from-error`}
                className={`mt-1 ${controlClassName()}`}
              />
              {errors.from === undefined ? null : (
                <p id={`${rangeId}-from-error`} className="mt-1 text-supporting text-danger-700">
                  {errors.from}
                </p>
              )}
            </div>

            <div className="flex-1">
              <label
                htmlFor={`${rangeId}-to`}
                className="block text-supporting font-semibold text-text-primary"
              >
                To
              </label>
              <input
                id={`${rangeId}-to`}
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                aria-invalid={errors.to !== undefined}
                aria-describedby={errors.to === undefined ? undefined : `${rangeId}-to-error`}
                className={`mt-1 ${controlClassName()}`}
              />
              {errors.to === undefined ? null : (
                <p id={`${rangeId}-to-error`} className="mt-1 text-supporting text-danger-700">
                  {errors.to}
                </p>
              )}
            </div>

            <button type="button" onClick={applyCustomRange} className={PRIMARY_BUTTON_CLASS}>
              Apply range
            </button>
          </div>

          {errors.range === undefined ? null : (
            <div className="mt-3">
              <Banner tone="warning">{errors.range}</Banner>
            </div>
          )}
        </fieldset>
      ) : null}
    </div>
  );
}
