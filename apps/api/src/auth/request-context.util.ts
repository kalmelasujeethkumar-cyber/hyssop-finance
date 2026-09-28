import type { Request } from 'express';
import { fingerprint } from './token.util';

/**
 * The CSRF header, from the shared contract rather than a string literal, so the API and
 * the browser cannot disagree about its name.
 */
export function readHeader(request: Request, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];

  return typeof value === 'string' ? value : undefined;
}

export function readCookie(request: Request, name: string): string | undefined {
  // `cookie-parser` populates `cookies`, which the Express types leave as `any`; the
  // assertion narrows it to the one shape this code accepts.
  const cookies = request.cookies as Record<string, string> | undefined;
  const value = cookies?.[name];

  return typeof value === 'string' ? value : undefined;
}

/**
 * A non-reversible fingerprint of the request's address, used for the rate-limit bucket
 * and for `audit_event.ip_hash`. The address itself is never stored or logged.
 */
export function requestFingerprint(request: Request): string {
  return fingerprint(request.ip ?? 'unknown');
}

export function requestIdOf(request: Request): string | null {
  return request.requestId ?? null;
}
