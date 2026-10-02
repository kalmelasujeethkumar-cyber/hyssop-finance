import { Link } from 'react-router-dom';
import { HealthCard } from '../features/health/HealthCard';

/**
 * The build-status screen.
 *
 * It states what this build can and cannot do. `docs/03-UI-UX-RULES.md` requires the
 * interface to be honest about state, and a screen that quietly implied a finished product
 * would be dishonest in a way no amount of correct code elsewhere could fix: the parts that
 * do not exist yet are named, and nothing on this page is a placeholder figure.
 *
 * It is no longer the landing screen — the dashboard is, since `docs/03-UI-UX-RULES.md` makes
 * that the signed-in entry point — but it keeps its own address because it still answers two
 * questions the product pages cannot: what is built, and is the API reachable.
 */
export function FoundationPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-page-title font-bold text-text-primary">Foundation</h1>
        <p className="max-w-2xl text-supporting text-text-secondary">
          The workspace, toolchain, and shared HTTP contract are in place. Members, income,
          expenses, receipts, and the dashboard can now be used, with every amount calculated by the
          API from the transactions that actually exist.
        </p>
      </div>

      <HealthCard />

      <section
        aria-labelledby="scope-heading"
        className="rounded-xl border border-border-default bg-surface p-6"
      >
        <h2 id="scope-heading" className="text-section-title font-bold text-text-primary">
          What this build includes
        </h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-supporting text-text-secondary">
          <li>Validated environment configuration with no secrets in the browser bundle.</li>
          <li>Versioned REST foundation with one shared response contract.</li>
          <li>Structured server logging with mandatory redaction and request IDs.</li>
          <li>
            Member records with a permanent member ID, an audited edit, and a monthly contribution
            expectation derived from real transactions.
          </li>
          <li>
            Income recording with member contributions, offerings, donations, and anonymous
            donations, plus a generated receipt and the full audit history.
          </li>
          <li>
            Expense recording against a required category, with custom categories, an honest
            <em> Receipt Missing</em> state, and the same correction, void, and audit behaviour.
          </li>
          <li>
            Receipts and other documents attached to a transaction through project-controlled
            storage, with an available-and-removed state that stays auditable.
          </li>
          <li>
            A period-aware dashboard whose totals, method balances, contribution status, monthly
            trend, and recent transactions all come from the API.
          </li>
          <li>
            Eleven church-wide reports calculated by the same server-side layer as the dashboard,
            with period or audit-window filters, print-friendly output, and CSV export served as a
            real download.
          </li>
          <li>
            One global search across members and every income and expense record, including voided
            ones, with the count the API actually matched.
          </li>
          <li>Unit, integration, and browser checks for everything listed here.</li>
        </ul>
        <p className="mt-4 text-supporting text-text-secondary">
          <Link
            to="/"
            className="font-semibold text-link-700 underline underline-offset-2 hover:text-link-800"
          >
            Go to the dashboard
          </Link>
          {' · '}
          <Link
            to="/members"
            className="font-semibold text-link-700 underline underline-offset-2 hover:text-link-800"
          >
            Go to members
          </Link>
          {' · '}
          <Link
            to="/income"
            className="font-semibold text-link-700 underline underline-offset-2 hover:text-link-800"
          >
            Go to income
          </Link>
          {' · '}
          <Link
            to="/expenses"
            className="font-semibold text-link-700 underline underline-offset-2 hover:text-link-800"
          >
            Go to expenses
          </Link>
          {' · '}
          <Link
            to="/reports"
            className="font-semibold text-link-700 underline underline-offset-2 hover:text-link-800"
          >
            Go to reports
          </Link>
          {' · '}
          <Link
            to="/search"
            className="font-semibold text-link-700 underline underline-offset-2 hover:text-link-800"
          >
            Go to search
          </Link>
        </p>
      </section>

      <section
        aria-labelledby="not-included-heading"
        className="rounded-xl border border-warning-700 bg-warning-100 p-6"
      >
        <h2 id="not-included-heading" className="text-section-title font-bold text-warning-700">
          What is not in this build yet
        </h2>
        <p className="mt-2 text-supporting text-text-secondary">
          Settings screens are not implemented, and the application has one Admin role rather than
          per-user accounts. No figure anywhere in this application is a stored total or a
          placeholder: every amount shown is calculated by the API from the transactions that
          actually exist, and an expense with no receipt attached says so rather than implying one
          exists.
        </p>
      </section>
    </div>
  );
}
