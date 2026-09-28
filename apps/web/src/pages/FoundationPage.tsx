import { Link } from 'react-router-dom';
import { HealthCard } from '../features/health/HealthCard';

/**
 * The starting screen.
 *
 * It states what this build can and cannot do. `docs/03-UI-UX-RULES.md` requires the
 * interface to be honest about state, and a screen that quietly implied a finished product
 * would be dishonest in a way no amount of correct code elsewhere could fix: the parts that
 * do not exist yet are named, and nothing on this page is a placeholder figure.
 */
export function FoundationPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-page-title font-bold text-text-primary">Foundation</h1>
        <p className="max-w-2xl text-supporting text-text-secondary">
          The workspace, toolchain, and shared HTTP contract are in place, and members can now be
          recorded, searched, edited, and given a monthly contribution expectation.
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
          <li>Unit, integration, and browser checks for everything listed here.</li>
        </ul>
        <p className="mt-4 text-supporting text-text-secondary">
          <Link
            to="/members"
            className="font-semibold text-link-700 underline underline-offset-2 hover:text-link-800"
          >
            Go to members
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
          Income, expenses, receipts and documents, reports, and church-wide totals are not
          implemented. No figure anywhere in this application is a stored total or a placeholder:
          every amount shown is calculated by the API from the transactions that actually exist.
          Recording a contribution is the next phase, so a member-month can currently be given an
          expected amount but not yet a payment.
        </p>
      </section>
    </div>
  );
}
