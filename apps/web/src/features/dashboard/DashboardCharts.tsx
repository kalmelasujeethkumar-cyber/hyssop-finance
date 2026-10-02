import type {
  ContributionMonthBucket,
  DashboardBreakdownSlice,
  DashboardTrendPoint,
} from '@hyssop/contracts';
import { formatInr } from '../../lib/money';

/**
 * Dashboard charts, drawn as plain SVG.
 *
 * No charting library is used, for three reasons that all point the same way: the design tokens
 * in `docs/04-DESIGN-TOKENS.md` must be the only source of colour, an accessible summary of the
 * same numbers must be present as text for every chart, and the application has no dependency
 * whose defaults would have to be overridden on every chart anyway.
 *
 * **What the browser is and is not calculating.** The phase prohibits client-side recalculation
 * that disagrees with the server, and the line between that and drawing a picture needs to be
 * explicit. These components never derive a financial figure. The amounts, shares, and month
 * totals on screen are the API's own strings, passed straight through; no component adds two
 * values, computes a percentage, or totals a series. A decimal string is parsed to a `number` in
 * exactly one place — turning a magnitude into a pixel height or a sweep angle — and that value
 * is never displayed. If the arithmetic were wrong here it would move a bar, not change what the
 * Admin reads, because every readable number comes from the response.
 *
 * **No colour-only and no pointer-only information.** Each chart renders a text summary beside it
 * carrying the same figures, and each category is named in text rather than distinguished only by
 * hue, because a hue-only distinction fails both a colour-blind reader and a printed page.
 */

const CHART_HEIGHT = 180;
const BAR_GROUP_WIDTH = 44;
const BAR_WIDTH = 15;
const GAP = 6;

/**
 * The magnitude of an exact decimal string, for geometry only.
 *
 * Absolute, so a negative movement does not draw downwards as an income bar. The server already
 * decided the sign and shows it in the label; this only needs a length.
 */
function magnitudeOf(amount: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());

  if (match === null) {
    return 0;
  }

  const [, , whole = '0', fraction = '00'] = match;

  return Number(whole) + Number(fraction.padEnd(2, '0')) / 100;
}

function formatShortAxis(amount: string): string {
  return formatInr(amount).replace('.00', '');
}

/**
 * Income against expenses, month by month.
 *
 * Two bars per month rather than one net bar, because a net figure hides the month that took in
 * a large offering and spent more. The month with no activity still gets a zero-height pair, so
 * the axis keeps the month visible instead of compressing it out.
 */
export function IncomeExpenseBarChart({
  points,
}: {
  readonly points: readonly DashboardTrendPoint[];
}) {
  const tallest = points.reduce(
    (max, point) => Math.max(max, magnitudeOf(point.income), magnitudeOf(point.expenses)),
    0,
  );

  // A chart of nothing must still have a baseline to draw on, or the axis would divide by zero
  // and the single quiet month would render as a full-height bar.
  const scale = tallest > 0 ? (CHART_HEIGHT - 4) / tallest : 0;
  const width = Math.max(points.length * BAR_GROUP_WIDTH, 120);

  return (
    <div className="space-y-3">
      <svg
        role="img"
        aria-label="Income and expenses for each month in the selected period"
        viewBox={`0 0 ${width} ${CHART_HEIGHT + 24}`}
        className="w-full"
      >
        <line
          x1={0}
          y1={CHART_HEIGHT}
          x2={width}
          y2={CHART_HEIGHT}
          stroke="var(--color-border-strong)"
          strokeWidth={1}
        />

        {points.map((point, index) => {
          const groupLeft = index * BAR_GROUP_WIDTH + (BAR_GROUP_WIDTH - (BAR_WIDTH * 2 + GAP)) / 2;
          const incomeHeight = magnitudeOf(point.income) * scale;
          const expenseHeight = magnitudeOf(point.expenses) * scale;

          return (
            <g key={point.month}>
              <rect
                x={groupLeft}
                y={CHART_HEIGHT - incomeHeight}
                width={BAR_WIDTH}
                height={incomeHeight}
                fill="var(--color-blue-600)"
              />
              <rect
                x={groupLeft + BAR_WIDTH + GAP}
                y={CHART_HEIGHT - expenseHeight}
                width={BAR_WIDTH}
                height={expenseHeight}
                fill="var(--color-orange-600)"
              />
              <text
                x={groupLeft + BAR_WIDTH}
                y={CHART_HEIGHT + 16}
                textAnchor="middle"
                fontSize={11}
                fill="var(--color-text-secondary)"
              >
                {monthAbbr(point.monthNumber)}
              </text>
            </g>
          );
        })}
      </svg>

      <TrendTable points={points} />
    </div>
  );
}

/**
 * The text summary of the trend.
 *
 * Rendered as a real table rather than a screen-reader-only caption because it is also what a
 * sighted Admin reads when the twelve bars are too small to compare, and because a table can be
 * read, copied, and printed. It is a summary of the API's own strings, not a second calculation.
 */
function TrendTable({ points }: { readonly points: readonly DashboardTrendPoint[] }) {
  return (
    <table className="w-full text-left text-supporting text-text-secondary">
      <caption className="sr-only">Income, expenses, and movement for each month</caption>
      <thead>
        <tr>
          <th scope="col" className="py-1 pr-3 font-semibold">
            Month
          </th>
          <th scope="col" className="py-1 pr-3 font-semibold">
            Income
          </th>
          <th scope="col" className="py-1 pr-3 font-semibold">
            Expenses
          </th>
          <th scope="col" className="py-1 font-semibold">
            Movement
          </th>
        </tr>
      </thead>
      <tbody>
        {points.map((point) => (
          <tr key={point.month}>
            <th scope="row" className="py-1 pr-3 font-normal">
              {formatMonthLabel(point)}
            </th>
            <td className="py-1 pr-3">{formatInr(point.income)}</td>
            <td className="py-1 pr-3">{formatInr(point.expenses)}</td>
            <td className="py-1">{formatInr(point.movement)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatMonthLabel(point: DashboardTrendPoint): string {
  const name = monthName(point.monthNumber);

  return `${name} ${point.year}`;
}

/**
 * A breakdown as proportional arcs.
 *
 * `sharePercent` is the API's own two-decimal string, used for the sweep angle so the arc and the
 * printed percentage cannot disagree. The ring is decorative; the legend beside it carries every
 * label, amount, and share in text.
 */
export function BreakdownDonutChart({
  slices,
  total,
  emptyLabel,
  ariaLabel,
}: {
  readonly slices: readonly DashboardBreakdownSlice[];
  readonly total: string;
  readonly emptyLabel: string;
  readonly ariaLabel: string;
}) {
  if (slices.length === 0) {
    return <p className="py-6 text-center text-supporting text-text-secondary">{emptyLabel}</p>;
  }

  // The legend, not a hover tooltip, is where a category is identified. The arc has a `<title>`
  // so a pointer user can also read it, but nothing is reachable *only* by pointing.
  const circumference = 2 * Math.PI * 54;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <svg role="img" aria-label={ariaLabel} viewBox="0 0 140 140" className="h-32 w-32 shrink-0">
        <circle
          cx={70}
          cy={70}
          r={54}
          fill="none"
          stroke="var(--color-surface-subtle)"
          strokeWidth={18}
        />

        {buildArcSlices(slices).map((slice, index) => (
          <circle
            key={slice.key}
            cx={70}
            cy={70}
            r={54}
            fill="none"
            stroke={SLICE_COLORS[index % SLICE_COLORS.length]}
            strokeWidth={18}
            strokeDasharray={`${slice.dash} ${circumference - slice.dash}`}
            strokeDashoffset={-slice.offset}
            transform="rotate(-90 70 70)"
          >
            <title>{`${slice.label}: ${slice.share}`}</title>
          </circle>
        ))}
      </svg>

      <ul className="w-full space-y-1 text-supporting">
        <li className="flex justify-between font-semibold text-text-primary">
          <span>Total</span>
          <span>{formatInr(total)}</span>
        </li>
        {slices.map((slice, index) => (
          <li key={slice.key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: SLICE_COLORS[index % SLICE_COLORS.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-text-secondary">{slice.label}</span>
            <span className="text-text-secondary">{formatInr(slice.amount)}</span>
            <span className="w-14 text-right text-text-secondary">{`${slice.sharePercent}%`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Arc geometry from the API's own percentages.
 *
 * Accumulated as hundredths of a percent so the offsets are computed from the printed values
 * rather than from a re-derived fraction. If two rounded percentages did not total exactly
 * `100.00`, the gap simply renders as a small gap instead of silently over- or under-drawing.
 */
function buildArcSlices(slices: readonly DashboardBreakdownSlice[]): readonly {
  readonly key: string;
  readonly label: string;
  readonly share: string;
  readonly dash: number;
  readonly offset: number;
}[] {
  const circumference = 2 * Math.PI * 54;
  let consumed = 0;

  return slices.map((slice) => {
    const [whole = '0', fraction = '00'] = slice.sharePercent.split('.');
    const sharePercent = Number(whole) + Number(fraction.padEnd(2, '0')) / 100;
    const dash = (sharePercent / 100) * circumference;
    const offset = (consumed / 100) * circumference;

    consumed += sharePercent;

    return {
      key: slice.key,
      label: slice.label,
      share: `${slice.sharePercent}%`,
      dash,
      offset,
    };
  });
}

/**
 * The distinct, token-based colours used across both breakdowns.
 *
 * Blue and orange lead, which are the two accent families of the light theme, and the remainder
 * step through the neutral and status families so the palette stays inside
 * `docs/04-DESIGN-TOKENS.md`. The list is longer than the usual slice count so a deep breakdown
 * still reads as a sequence rather than repeating the same pair twice in a row.
 */
const SLICE_COLORS: readonly string[] = [
  'var(--color-blue-600)',
  'var(--color-orange-600)',
  'var(--color-success-700)',
  'var(--color-blue-700)',
  'var(--color-warning-700)',
  'var(--color-text-secondary)',
];

/**
 * Contribution status for one month.
 *
 * A stacked bar rather than a donut: these are four counts that together describe the member roll
 * for a month, and a part-to-whole bar lets a reader compare *across* months, which a set of
 * separate donuts cannot do. Each count is written out beside the bar, so the bar is a summary of
 * numbers that are all readable anyway.
 */
export function ContributionStatusBars({
  buckets,
}: {
  readonly buckets: readonly ContributionMonthBucket[];
}) {
  return (
    <ul className="space-y-4">
      {buckets.map((bucket) => (
        <li key={bucket.month}>
          <div className="flex items-baseline justify-between text-supporting">
            <span className="font-semibold text-text-primary">
              {formatMonthBucketLabel(bucket)}
            </span>
            <span className="text-text-secondary">
              {bucket.counts.membersByMonthEnd}{' '}
              {bucket.counts.membersByMonthEnd === 1 ? 'member' : 'members'}
            </span>
          </div>

          <div
            className="mt-1 flex h-4 w-full overflow-hidden rounded bg-surface-subtle"
            role="img"
            aria-label={contributionAriaLabel(bucket)}
          >
            {CONTRIBUTION_SEGMENTS.map((segment) => {
              const count = bucket.counts[segment.key];

              return count > 0 ? (
                <span
                  key={segment.key}
                  style={{ width: `${(count / bucket.counts.membersByMonthEnd) * 100}%` }}
                  className={segment.className}
                >
                  <span className="sr-only">{`${count} ${segment.label}`}</span>
                </span>
              ) : null;
            })}
          </div>

          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-supporting text-text-secondary">
            {CONTRIBUTION_SEGMENTS.map((segment) => (
              <div key={segment.key} className="flex items-center gap-1">
                <dt>
                  <span
                    aria-hidden="true"
                    className={`mr-1 inline-block h-2.5 w-2.5 rounded-sm ${segment.className}`}
                  />
                  {segment.label}
                </dt>
                <dd className="font-semibold text-text-primary">{bucket.counts[segment.key]}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}

/**
 * The four counts that make up a month's contribution status.
 *
 * `notConfigured` is a segment of its own rather than being folded into `notPaid`, because
 * `REQ-CONTRIB-006` requires a member with no expected period to be reported separately: showing
 * them as unpaid would tell the Admin a payment is missing when in fact nobody ever asked for one.
 */
const CONTRIBUTION_SEGMENTS: readonly {
  readonly key: 'paid' | 'partiallyPaid' | 'notPaid' | 'notConfigured';
  readonly label: string;
  readonly className: string;
}[] = [
  { key: 'paid', label: 'Paid', className: 'bg-success-700' },
  { key: 'partiallyPaid', label: 'Part paid', className: 'bg-blue-600' },
  { key: 'notPaid', label: 'Not paid', className: 'bg-orange-600' },
  { key: 'notConfigured', label: 'Not configured', className: 'bg-border-strong' },
];

function contributionAriaLabel(bucket: ContributionMonthBucket): string {
  const counts = CONTRIBUTION_SEGMENTS.map(
    (segment) => `${bucket.counts[segment.key]} ${segment.label.toLowerCase()}`,
  ).join(', ');

  return `${formatMonthBucketLabel(bucket)}: ${counts}, out of ${bucket.counts.membersByMonthEnd} members`;
}

function formatMonthBucketLabel(bucket: ContributionMonthBucket): string {
  return `${monthName(bucket.monthNumber)} ${bucket.year}`;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const MONTH_ABBREVIATIONS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month);
}

function monthAbbr(month: number): string {
  return MONTH_ABBREVIATIONS[month - 1] ?? String(month);
}

export { formatShortAxis };
