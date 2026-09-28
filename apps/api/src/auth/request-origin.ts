import { trustedOriginRequired } from '../common/errors/api-error';

/**
 * Trusted origin resolution for state-changing requests.
 *
 * Authority: `docs/07-SECURITY-RULES.md` ("Deny cross-origin state-changing requests;
 * validate the Origin or Referer header against the configured allowlist") and
 * `docs/02-ARCHITECTURE.md` (explicit CORS allowlist; the demo has one origin, the web
 * application).
 *
 * CORS is not a substitute for this check. A browser withholds the *response* to a
 * disallowed cross-origin request, but the state-changing request has already been sent,
 * so the server must refuse it itself. `Origin` is required for these methods: browsers
 * always send it on a cross-origin request, and an absent one means the request did not
 * come from a page. `Referer` is the documented fallback because some privacy settings
 * strip `Origin` from same-origin navigations.
 */
export function resolveTrustedOrigin(
  headers: { readonly origin?: string | undefined; readonly referer?: string | undefined },
  allowedOrigins: readonly string[],
): string {
  const candidate = parseOrigin(headers.origin) ?? parseRefererOrigin(headers.referer);

  if (candidate === null || !allowedOrigins.includes(candidate)) {
    throw trustedOriginRequired();
  }

  return candidate;
}

function parseOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();

  if (trimmed === undefined || trimmed === '') {
    return null;
  }

  // A header may carry a list, and `Origin: null` is what a sandboxed or opaque-origin
  // page sends. Neither identifies a trusted origin.
  if (trimmed.includes(',') || trimmed.toLowerCase() === 'null') {
    return null;
  }

  return toOrigin(trimmed);
}

function parseRefererOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();

  if (trimmed === undefined || trimmed === '') {
    return null;
  }

  return toOrigin(trimmed);
}

function toOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
