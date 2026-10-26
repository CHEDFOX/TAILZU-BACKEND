import { afterEach, beforeEach, expect } from "vitest";

/**
 * A test file that uses this cannot reach the network by accident: the global
 * fetch (which the egress guard's Agent is handed to) throws, and counts, and the
 * test that made the call fails after it. The tests of search and research
 * answer from fakes passed in, so any real call is a hole in a fake.
 *
 * `allowNetwork()` puts the real one back for the one test that needs to see the
 * guard refuse an address before anything is sent.
 */
let real: typeof fetch | undefined;
let reached = 0;

export function noNetwork(): { allowNetwork(): void } {
  beforeEach(() => {
    reached = 0;
    real = globalThis.fetch;
    globalThis.fetch = (async () => { reached += 1; throw new Error("the network is off in this test"); }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = real!;
    expect(reached, "this test reached the network").toBe(0);
  });
  return { allowNetwork: () => { globalThis.fetch = real!; } };
}
