/**
 * A SMALL MEMORY CACHE WITH A TIME LIMIT PER ENTRY, oldest-used dropped first. It also keeps "looked up, nothing there" (null), so a
 * place nobody can find is not asked for again on every screen load.
 *
 *   const c = new TtlCache<Place>(5_000)
 *   c.set(key, place, 30 * DAY);  c.get(key)  -> Place | null (known)  or undefined (not known, or too old)
 *
 * Memory only: a restart forgets, which costs one lookup per place again. The keys are built by the caller (places/index.ts) from
 * normalised words or rounded points; nothing here is written anywhere.
 */
export class TtlCache<V> {
  private map = new Map<string, { v: V | null; until: number }>();

  constructor(private readonly max: number, private readonly now: () => number = Date.now) {}

  /** The value, null when "nothing there" is known, undefined when not known. */
  get(key: string): V | null | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.until <= this.now()) { this.map.delete(key); return undefined; }
    this.map.delete(key);
    this.map.set(key, e);
    return e.v;
  }

  set(key: string, v: V | null, ttlMs: number): void {
    this.map.delete(key);
    this.map.set(key, { v, until: this.now() + Math.max(0, ttlMs) });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }

  get size(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
}
