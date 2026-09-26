import type { AppEnvironment } from './environment';
import { parseEnvironment } from './environment';

/**
 * Configuration factory executed by `ConfigModule` during module initialization.
 * A malformed environment therefore fails the process before it starts listening.
 */
export function loadAppEnvironment(): { environment: AppEnvironment } {
  return { environment: parseEnvironment(process.env) };
}
