import { resolveRequestId } from './request-id';

const UUID = '3f0a1b2c-4d5e-4f60-8a71-9b2c3d4e5f60';

describe('resolveRequestId', () => {
  it('reuses a valid client request ID', () => {
    expect(resolveRequestId(UUID)).toBe(UUID);
    expect(resolveRequestId(`  ${UUID.toUpperCase()}  `)).toBe(UUID.toUpperCase());
  });

  it('replaces a non-UUID value with a generated ID', () => {
    const generate = jest.fn(() => 'generated');

    expect(resolveRequestId('../../etc/passwd', generate)).toBe('generated');
    expect(resolveRequestId('not-a-uuid', generate)).toBe('generated');
    expect(resolveRequestId('', generate)).toBe('generated');
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it('uses the first value when the header is repeated and generates a UUID by default', () => {
    expect(resolveRequestId([UUID, 'other'])).toBe(UUID);

    const generated = resolveRequestId(undefined);
    expect(generated).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('generates a fresh ID for a repeated invalid header', () => {
    const generate = jest.fn(() => 'generated');

    expect(resolveRequestId(['bad', 'worse'], generate)).toBe('generated');
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
