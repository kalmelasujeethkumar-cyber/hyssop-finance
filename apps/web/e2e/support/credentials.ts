/**
 * The names the browser acceptance run uses to find its provisioned credential.
 *
 * They are kept in their own module so the setup hook and the test helpers agree without the
 * test workers importing the setup hook itself.
 */
export const E2E_ADMIN_IDENTIFIER = 'admin';

/** Environment variable the setup hook fills with the generated password. */
export const E2E_ADMIN_PASSWORD_VARIABLE = 'HYSSOP_E2E_ADMIN_PASSWORD';
