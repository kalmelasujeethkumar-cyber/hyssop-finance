import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-page-title font-bold text-text-primary">Page not found</h1>
      <p className="text-supporting text-text-secondary">
        This address does not match any screen in the application.
      </p>
      <Link
        to="/"
        className="inline-block rounded-md border border-blue-600 bg-blue-600 px-4 py-2 text-supporting font-semibold text-text-inverse transition-colors hover:bg-blue-700 active:bg-blue-700"
      >
        Back to foundation
      </Link>
    </div>
  );
}
