import { validationFailed } from '../../common/errors/domain.errors';
import { formatPaise, MAX_PAISES } from '../../common/money/paise';

export const APP_SETTING_KEYS = [
  'DEFAULT_MONTHLY_CONTRIBUTION_PAISE',
  'ENABLED_PAYMENT_METHODS',
  'CURRENCY',
  'BUSINESS_TIMEZONE',
] as const;

export type AppSettingKey = (typeof APP_SETTING_KEYS)[number];

export const PAYMENT_METHOD_NAMES = ['CASH', 'UPI', 'BANK_TRANSFER'] as const;

export type PaymentMethodName = (typeof PAYMENT_METHOD_NAMES)[number];

export const FIXED_CURRENCY = 'INR';
export const FIXED_BUSINESS_TIMEZONE = 'Asia/Kolkata';

export function isAppSettingKey(value: string): value is AppSettingKey {
  return (APP_SETTING_KEYS as readonly string[]).includes(value);
}

export function isPaymentMethodName(value: string): value is PaymentMethodName {
  return (PAYMENT_METHOD_NAMES as readonly string[]).includes(value);
}

/**
 * Validates one setting value before it is written.
 *
 * Authority: `docs/05-DATABASE-SPEC.md`: the default contribution is positive integer
 * paise, enabled methods are a validated non-empty subset of `CASH`, `UPI`,
 * `BANK_TRANSFER`, `CURRENCY` is fixed to `INR`, and `BUSINESS_TIMEZONE` is fixed to
 * `Asia/Kolkata`. The database repeats the same rules as CHECK constraints, so an
 * invalid value can never be stored even if this function is bypassed.
 */
export function validateAppSettingValue(key: AppSettingKey, value: string): string {
  const trimmed = value.trim();

  if (trimmed === '') {
    throw validationFailed('A setting value must not be blank.', { key });
  }

  switch (key) {
    case 'DEFAULT_MONTHLY_CONTRIBUTION_PAISE': {
      parsePaiseSetting(trimmed);
      return trimmed;
    }
    case 'ENABLED_PAYMENT_METHODS': {
      const methods = trimmed.split(',').map((method) => method.trim());
      const unique = [...new Set(methods)];

      if (unique.length === 0 || unique.some((method) => !isPaymentMethodName(method))) {
        throw validationFailed(
          'Enabled payment methods must be a comma-separated subset of CASH, UPI, BANK_TRANSFER.',
          { key },
        );
      }

      return unique.join(',');
    }
    case 'CURRENCY': {
      if (trimmed !== FIXED_CURRENCY) {
        throw validationFailed('Currency is fixed to INR for this application.', { key });
      }
      return FIXED_CURRENCY;
    }
    case 'BUSINESS_TIMEZONE': {
      if (trimmed !== FIXED_BUSINESS_TIMEZONE) {
        throw validationFailed('Business timezone is fixed to Asia/Kolkata for this application.', {
          key,
        });
      }
      return FIXED_BUSINESS_TIMEZONE;
    }
    default: {
      const exhaustive: never = key;
      throw validationFailed(`Unsupported setting key: ${String(exhaustive)}`);
    }
  }
}

/**
 * Reads a setting that stores an integer paise count.
 *
 * The stored value is already paise, so it is never re-interpreted as rupees; the
 * decimal string is produced only at the API boundary.
 */
export function parsePaiseSetting(value: string): bigint {
  const trimmed = value.trim();

  if (!/^\d{1,19}$/.test(trimmed)) {
    throw validationFailed('The default contribution must be a whole number of paise.', {
      key: 'DEFAULT_MONTHLY_CONTRIBUTION_PAISE',
    });
  }

  const paise = BigInt(trimmed);

  if (paise <= 0n) {
    throw validationFailed('The default contribution must be greater than zero.', {
      key: 'DEFAULT_MONTHLY_CONTRIBUTION_PAISE',
    });
  }

  if (paise > MAX_PAISES) {
    throw validationFailed('The default contribution exceeds the maximum supported value.', {
      key: 'DEFAULT_MONTHLY_CONTRIBUTION_PAISE',
    });
  }

  return paise;
}

/** Reads the default monthly contribution in paise. */
export function defaultContributionPaise(value: string): bigint {
  return parsePaiseSetting(value);
}

/** Formats a stored paise amount for a settings read, using the API decimal string form. */
export function formatPaiseSetting(value: string): string {
  return formatPaise(parsePaiseSetting(value));
}
