import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ADMIN_PASSWORD_MAX_LENGTH,
  ADMIN_PASSWORD_MIN_LENGTH,
  LOGIN_IDENTIFIER_MAX_LENGTH,
  LOGIN_IDENTIFIER_MIN_LENGTH,
} from '@hyssop/contracts';
import { useSession } from '../features/auth/SessionProvider';
import { ApiClientError, ApiTransportError } from '../lib/api-client';

/**
 * The Admin sign-in screen.
 *
 * Authority: `docs/03-UI-UX-RULES.md` (clear labels with required indication, server-backed
 * validation, correct input types, keyboard order, disabled/loading state during submission,
 * duplicate-submission protection, distinct success and failure feedback) and
 * `docs/06-API-SPEC.md` (the generic login failure must be shown as it is returned).
 *
 * The password field is never read back into application state, never logged, and the
 * identifier is submitted exactly as typed for the server to normalize. The policy bounds
 * come from the shared contract, so the browser cannot disagree with the API about them.
 */
export function LoginPage() {
  const { status, signIn } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const destination = readReturnPath(location.state);
  // A redirect to this screen can be committed after a successful sign-in has already
  // established a session, because a router navigation is applied asynchronously. Rendering
  // the sign-in form to an Admin who is already signed in would strand them on it, so this
  // screen sends them onward instead. The check reads live state, not a queued navigation, so
  // it cannot lose the same race a second time.
  const isAlreadySignedIn = status === 'authenticated';

  useEffect(() => {
    if (isAlreadySignedIn) {
      void navigate(destination, { replace: true });
    }
  }, [destination, isAlreadySignedIn, navigate]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    // Duplicate-submission protection: the button is already disabled, and this guards the
    // keyboard and programmatic paths that bypass the disabled attribute.
    if (isSubmitting) {
      return;
    }

    const form = event.currentTarget;
    // Read once, from the form, and never store it in component state: the plaintext exists
    // only for the duration of this call. The value is narrowed to a string rather than
    // stringified blindly, so a `File` smuggled into the field cannot become `[object File]`.
    const submitted = new FormData(form).get('password');
    const password = typeof submitted === 'string' ? submitted : '';

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await signIn({ identifier, password });
      // `navigate` may return a pending promise under a data router, and awaiting it here
      // would hold the form in its submitted state and never redirect. Redirecting is
      // fire-and-forget by design, so it is explicitly marked as ignored.
      void navigate(destination, { replace: true });
    } catch (error: unknown) {
      setErrorMessage(describeFailure(error));
      // The failed attempt's password is discarded so it is not left sitting in the DOM.
      form.reset();
      setIsSubmitting(false);
    }
  }

  // Nothing is signed in on this screen, so while it is redirecting there is no session to
  // protect and no reason to flash a form the Admin cannot use.
  if (isAlreadySignedIn) {
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <div className="space-y-2">
        <h1 className="text-page-title font-bold text-text-primary">Sign in</h1>
        <p className="text-supporting text-text-secondary">
          HYSSOP FINANCE is available to the church administrator only. Enter the credentials that
          were provisioned with the Admin bootstrap command.
        </p>
      </div>

      {errorMessage === null ? null : (
        <p
          role="alert"
          className="rounded-md border border-danger-700 bg-danger-100 px-4 py-3 text-supporting font-semibold text-danger-700"
        >
          {errorMessage}
        </p>
      )}

      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        aria-busy={isSubmitting}
        className="space-y-5 rounded-xl border border-border-default bg-surface p-6"
      >
        <div className="space-y-1">
          <label
            htmlFor="identifier"
            className="block text-supporting font-semibold text-text-primary"
          >
            Admin identifier (required)
          </label>
          <input
            id="identifier"
            name="identifier"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            minLength={LOGIN_IDENTIFIER_MIN_LENGTH}
            maxLength={LOGIN_IDENTIFIER_MAX_LENGTH}
            value={identifier}
            onChange={(event) => {
              setIdentifier(event.target.value);
            }}
            className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-supporting text-text-primary"
          />
        </div>

        <PasswordField />

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-supporting font-semibold text-text-inverse disabled:bg-border-strong"
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="text-supporting text-text-secondary">
        The password must be at least {ADMIN_PASSWORD_MIN_LENGTH} characters. If sign-in fails,
        check the identifier and password and try again.
      </p>
    </div>
  );
}

/**
 * The password input is a separate component so the plaintext never becomes part of the
 * page's own state: it is read straight from the form at submit time and then discarded.
 */
function PasswordField() {
  return (
    <div className="space-y-1">
      <label htmlFor="password" className="block text-supporting font-semibold text-text-primary">
        Password (required)
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        minLength={ADMIN_PASSWORD_MIN_LENGTH}
        maxLength={ADMIN_PASSWORD_MAX_LENGTH}
        className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-supporting text-text-primary"
      />
    </div>
  );
}

function describeFailure(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }

  if (error instanceof ApiTransportError) {
    return error.message;
  }

  return 'Signing in failed unexpectedly. Please try again.';
}

/** Only a same-site absolute path is honoured, so the return target cannot be redirected off-origin. */
function readReturnPath(state: unknown): string {
  if (typeof state !== 'object' || state === null || !('from' in state)) {
    return '/';
  }

  const from = state.from;

  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/';
}
