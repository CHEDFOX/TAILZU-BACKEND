/**
 * SMALL TOOLS THE JOB ROUTER USES: A LOCK PER KEY, AND WHAT TO KEEP OF A STEP'S OUTPUT.
 */
import { scanForSecrets } from "../policy.js";
import { OUTPUT_TAIL_BYTES } from "./types.js";

/**
 * One thing at a time per key, in the order they were asked. The router takes
 * one lock per person, so a heartbeat, a result and the ticker never change the
 * same person's jobs at once inside a server. (Across servers the store's
 * casJob is what keeps them honest.) A function that fails releases the lock
 * like one that returns.
 */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const result = prev.then(fn);
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(key, tail);
    void tail.then(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });
    return result;
  }

  /** Keys with something running or waiting (for tests). */
  get size(): number { return this.tails.size; }
}

/** The last `max` bytes of a text, never starting in the middle of a character. */
export function tailBytes(text: string, max = OUTPUT_TAIL_BYTES): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= max) return text;
  let start = buf.length - max;
  while (start < buf.length && (buf[start]! & 0xc0) === 0x80) start += 1;
  return buf.subarray(start).toString("utf8");
}

/**
 * What is kept of a step's output: the last 8 KB. A build log can print an
 * environment variable or a token, so the output is read by the same secret
 * scan a commit goes through (policy.ts scanForSecrets); if it looks like it
 * holds one, none of it is kept, only a line saying so and what kind of thing
 * it looked like. The value is never stored, logged or put in an error.
 */
export function keepOutput(text: unknown): string {
  if (typeof text !== "string" || !text) return "";
  const recent = tailBytes(text, 64 * 1024);
  const hits = scanForSecrets([{ path: "output.log", content: recent }]);
  if (hits.length) {
    const kinds = [...new Set(hits.flatMap((h) => h.kinds))];
    return `[Output not kept: it looked like it held ${kinds.join(" and ")}.]`;
  }
  return tailBytes(recent, OUTPUT_TAIL_BYTES);
}
