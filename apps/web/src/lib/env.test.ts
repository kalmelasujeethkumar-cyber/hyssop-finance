import { describe, expect, it } from 'vitest';
import { DEFAULT_API_BASE_URL, MissingApiBaseUrlError, resolveApiBaseUrl } from './env';

describe('resolveApiBaseUrl', () => {
  it('uses the configured value and removes trailing slashes', () => {
    expect(resolveApiBaseUrl('https://api.hyssop.test/api/v1/', true)).toBe(
      'https://api.hyssop.test/api/v1',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(resolveApiBaseUrl('  /api/v1  ', true)).toBe('/api/v1');
  });

  it('falls back to the same-origin path outside a deployed build', () => {
    expect(resolveApiBaseUrl(undefined, false)).toBe(DEFAULT_API_BASE_URL);
    expect(resolveApiBaseUrl('   ', false)).toBe(DEFAULT_API_BASE_URL);
  });

  it('fails clearly when a deployed build has no API base URL', () => {
    expect(() => resolveApiBaseUrl(undefined, true)).toThrow(MissingApiBaseUrlError);
    expect(() => resolveApiBaseUrl('', true)).toThrow(/VITE_API_BASE_URL must be configured/);
  });
});
