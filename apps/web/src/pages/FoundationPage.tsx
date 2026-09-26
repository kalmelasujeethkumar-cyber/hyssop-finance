import { HealthCard } from '../features/health/HealthCard';

export function FoundationPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-page-title font-bold text-text-primary">Foundation</h1>
        <p className="max-w-2xl text-supporting text-text-secondary">
          The workspace, toolchain, and shared HTTP contract are in place. Financial features are
          not implemented in this phase and are not simulated on this screen.
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
          <li>Unit, integration, and browser checks for everything listed here.</li>
        </ul>
      </section>
    </div>
  );
}
