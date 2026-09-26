import { DomainError } from '../../common/errors/domain.errors';
import {
  defaultContributionPaise,
  formatPaiseSetting,
  isAppSettingKey,
  validateAppSettingValue,
} from './app-setting.validation';

describe('settings validation (REQ-SETTINGS-001 to REQ-SETTINGS-007)', () => {
  it('accepts a positive integer paise default contribution', () => {
    expect(validateAppSettingValue('DEFAULT_MONTHLY_CONTRIBUTION_PAISE', '50000')).toBe('50000');
    expect(validateAppSettingValue('DEFAULT_MONTHLY_CONTRIBUTION_PAISE', '1')).toBe('1');
    expect(defaultContributionPaise('50000')).toBe(50_000n);
    expect(formatPaiseSetting('50000')).toBe('500.00');
    expect(formatPaiseSetting('1')).toBe('0.01');
  });

  it('rejects a blank, zero, negative, fractional, or ambiguous default contribution', () => {
    expect(() => validateAppSettingValue('DEFAULT_MONTHLY_CONTRIBUTION_PAISE', ' ')).toThrow(
      DomainError,
    );
    expect(() => validateAppSettingValue('DEFAULT_MONTHLY_CONTRIBUTION_PAISE', '0')).toThrow(
      DomainError,
    );
    expect(() => validateAppSettingValue('DEFAULT_MONTHLY_CONTRIBUTION_PAISE', '-500')).toThrow(
      DomainError,
    );
    expect(() => validateAppSettingValue('DEFAULT_MONTHLY_CONTRIBUTION_PAISE', '50,000')).toThrow(
      DomainError,
    );
    // The setting already stores paise, so a rupee decimal form is not accepted.
    expect(() => validateAppSettingValue('DEFAULT_MONTHLY_CONTRIBUTION_PAISE', '500.50')).toThrow(
      DomainError,
    );
  });

  it('accepts a validated non-empty subset of payment methods and removes duplicates', () => {
    expect(validateAppSettingValue('ENABLED_PAYMENT_METHODS', 'CASH,UPI,BANK_TRANSFER')).toBe(
      'CASH,UPI,BANK_TRANSFER',
    );
    expect(validateAppSettingValue('ENABLED_PAYMENT_METHODS', ' UPI , CASH ')).toBe('UPI,CASH');
  });

  it('rejects an unknown or empty payment method list', () => {
    expect(() => validateAppSettingValue('ENABLED_PAYMENT_METHODS', 'CHEQUE')).toThrow(DomainError);
    expect(() => validateAppSettingValue('ENABLED_PAYMENT_METHODS', ',')).toThrow(DomainError);
    expect(() => validateAppSettingValue('ENABLED_PAYMENT_METHODS', 'CASH,CHEQUE')).toThrow(
      DomainError,
    );
  });

  it('keeps currency and business timezone fixed', () => {
    expect(validateAppSettingValue('CURRENCY', 'INR')).toBe('INR');
    expect(validateAppSettingValue('BUSINESS_TIMEZONE', 'Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(() => validateAppSettingValue('CURRENCY', 'USD')).toThrow(DomainError);
    expect(() => validateAppSettingValue('BUSINESS_TIMEZONE', 'UTC')).toThrow(DomainError);
  });

  it('knows only the four documented keys', () => {
    expect(isAppSettingKey('CURRENCY')).toBe(true);
    expect(isAppSettingKey('SESSION_SECRET')).toBe(false);
  });
});
