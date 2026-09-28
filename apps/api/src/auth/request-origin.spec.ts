import { ApiError } from '../common/errors/api-error';
import { resolveTrustedOrigin } from './request-origin';

const ALLOWED = ['http://localhost:5173', 'https://hyssop.example'];

function resolve(headers: { origin?: string; referer?: string }): string {
  return resolveTrustedOrigin(headers, ALLOWED);
}

describe('trusted origin resolution', () => {
  it('accepts an allowed origin and returns it in normalized form', () => {
    expect(resolve({ origin: 'http://localhost:5173' })).toBe('http://localhost:5173');
    expect(resolve({ origin: 'https://hyssop.example' })).toBe('https://hyssop.example');
  });

  it('reduces a full URL to its origin, so a path cannot change the decision', () => {
    expect(resolve({ origin: 'https://hyssop.example/app/dashboard' })).toBe(
      'https://hyssop.example',
    );
  });

  it('rejects an origin that is not on the allowlist', () => {
    expect(() => resolve({ origin: 'https://evil.example' })).toThrow(ApiError);
  });

  it('rejects a request with no origin and no referer', () => {
    expect(() => resolve({})).toThrow(ApiError);
  });

  it('rejects an opaque or list-valued Origin header', () => {
    expect(() => resolve({ origin: 'null' })).toThrow(ApiError);
    expect(() => resolve({ origin: 'http://localhost:5173, https://evil.example' })).toThrow(
      ApiError,
    );
  });

  it('accepts an allowed Referer when Origin is absent', () => {
    expect(resolve({ referer: 'https://hyssop.example/login?next=/' })).toBe(
      'https://hyssop.example',
    );
  });

  it('rejects a disallowed Referer', () => {
    expect(() => resolve({ referer: 'https://evil.example/login' })).toThrow(ApiError);
  });

  it('prefers Origin over Referer when both are present', () => {
    expect(resolve({ origin: 'https://hyssop.example', referer: 'https://evil.example' })).toBe(
      'https://hyssop.example',
    );
  });

  it('treats a look-alike host as untrusted', () => {
    expect(() => resolve({ origin: 'https://hyssop.example.evil.test' })).toThrow(ApiError);
    expect(() => resolve({ origin: 'http://localhost:5173.evil.test' })).toThrow(ApiError);
    expect(() => resolve({ origin: 'https://evil.test/#http://localhost:5173' })).toThrow(ApiError);
  });

  it('reports a refusal as FORBIDDEN with a message that reveals nothing', () => {
    try {
      resolve({ origin: 'https://evil.example' });
      throw new Error('expected resolveTrustedOrigin to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.code).toBe('FORBIDDEN');
      expect(apiError.message).toBe('The request origin is not allowed.');
      expect(JSON.stringify(apiError.getResponse())).not.toContain('evil.example');
    }
  });
});
