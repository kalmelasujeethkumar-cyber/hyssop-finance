import { Outlet } from 'react-router-dom';

/**
 * Semantic application shell. It intentionally contains no product navigation:
 * every navigation target would have to work, and no product screen exists yet.
 */
export function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <a
        href="#main-content"
        className="skip-link rounded-md bg-blue-600 px-4 py-2 text-supporting font-semibold text-text-inverse"
      >
        Skip to main content
      </a>

      <header className="border-b border-border-default bg-surface">
        <div className="mx-auto flex max-w-5xl flex-col gap-1 px-6 py-4">
          <p className="text-section-title font-bold tracking-tight text-text-primary">
            HYSSOP FINANCE
          </p>
          <p className="text-supporting text-text-secondary">
            Church financial management · Asia/Kolkata · INR
          </p>
        </div>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-border-default bg-surface">
        <div className="mx-auto max-w-5xl px-6 py-4 text-supporting text-text-secondary">
          Foundation build. No member, income, or expense data is stored or displayed yet.
        </div>
      </footer>
    </div>
  );
}
