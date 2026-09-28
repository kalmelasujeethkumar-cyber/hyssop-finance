import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../../features/auth/SessionProvider';

/**
 * Route protection.
 *
 * Authority: `docs/06-API-SPEC.md` ("All routes except `GET /api/v1/health` and the
 * authentication routes require a valid session") and `docs/07-SECURITY-RULES.md` ("Reject
 * unauthenticated access to non-public routes").
 *
 * The redirect is a convenience, not the control: the API rejects an unauthenticated
 * request regardless of what the browser displays. While the session is still being checked
 * nothing protected is rendered, so a protected screen can never flash for a visitor who is
 * not signed in.
 */
export function RequireSession({ children }: { readonly children: ReactNode }) {
  const { status, bootstrapErrorMessage, retryBootstrap } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  // The latest status, readable from the redirect effect below without making the effect
  // re-run. A redirect decided while the session was anonymous must not fire after a
  // successful sign-in has already established one, or it would bounce the Admin straight
  // back to the sign-in screen and discard the session they just created.
  const latestStatus = useRef(status);

  latestStatus.current = status;

  useEffect(() => {
    if (status === 'anonymous' && latestStatus.current === 'anonymous') {
      void navigate('/login', { replace: true, state: { from: location.pathname } });
    }
  }, [navigate, status, location.pathname]);

  if (status === 'checking') {
    return (
      <p className="text-supporting text-text-secondary" role="status">
        Checking your sign-in status…
      </p>
    );
  }

  if (status === 'unavailable') {
    return (
      <section
        aria-labelledby="session-unavailable-heading"
        className="rounded-xl border border-border-default bg-surface p-6"
      >
        <h1
          id="session-unavailable-heading"
          className="text-page-title font-bold text-text-primary"
        >
          Sign-in status unavailable
        </h1>
        <p className="mt-2 text-supporting text-text-secondary">
          {bootstrapErrorMessage ?? 'The session could not be checked.'} Nothing is signed in until
          this check succeeds, so no financial screen is shown.
        </p>
        <button
          type="button"
          onClick={retryBootstrap}
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-supporting font-semibold text-text-inverse"
        >
          Retry the check
        </button>
      </section>
    );
  }

  if (status === 'anonymous') {
    // Deliberately nothing: the redirect runs in the effect above, and a protected screen
    // must never be rendered, even briefly, to a visitor the API has not authenticated.
    return null;
  }

  return <>{children}</>;
}
