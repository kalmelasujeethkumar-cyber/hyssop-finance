/**
 * The disposable project cluster is a developer resource, not a test artifact.
 *
 * It is deliberately left running after the suite so `npm run db:seed` and the
 * development database stay usable. Stop it explicitly with `npm run db:stop`.
 */

export default async function globalTeardown(): Promise<void> {}
