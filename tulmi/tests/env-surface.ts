import { ENV_KEYS } from "../src/config.js";

/**
 * Remove every variable the server reads from a given environment.
 *
 * Kept apart from setup.ts, which calls it, so that a test can import the
 * function without importing a module that clears process.env as a side
 * effect of being imported. Returns the names it removed, which is what makes
 * it checkable against a plain object instead of the real environment.
 */
export function clearAppEnv(env: Record<string, string | undefined>): string[] {
  const removed: string[] = [];
  for (const key of ENV_KEYS) {
    if (key in env) {
      delete env[key];
      removed.push(key);
    }
  }
  // Pinned rather than removed: the runner sets NODE_ENV, and a shell that
  // exports NODE_ENV=production makes the DEV_SKIP_AUTH guard throw ahead of
  // whatever a test was actually asserting.
  env.NODE_ENV = "test";
  return removed;
}
