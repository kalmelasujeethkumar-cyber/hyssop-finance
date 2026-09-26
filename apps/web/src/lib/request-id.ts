/**
 * Client-side request ID generation. Uses the platform UUID generator when it is
 * available and falls back to a clearly non-cryptographic value so development
 * and test environments never crash the shell.
 */
export function createRequestId(): string {
  const cryptoApi = globalThis.crypto;

  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  const random = Math.random().toString(16).slice(2, 10);
  return `fallback-${Date.now().toString(16)}-${random}`;
}
