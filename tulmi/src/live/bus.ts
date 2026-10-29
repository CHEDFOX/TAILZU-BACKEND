/**
 * LIVE UPDATES: THE BUS. Anything that changes something a person can see
 * says so here, by topic, for the people who see it; the live channel
 * (routes/live.ts) carries it to every device they have open, and a screen
 * listening to that topic (its `liveTopics`, from `page(ctx, { live })`)
 * reloads itself.
 *
 *   live.publish(["user-a", "user-b"], "thread:42", { kind: "message" })
 *   const stop = live.subscribe("user-a", (e) => send(e))
 *
 * Topics are short strings, a kind and an id: "activity", "home", "bots",
 * "space:<id>", "thread:<id>", "threads", "job:<id>", "notes", "note:<id>",
 * "keybot". An event names its topic and when; `data` is a hint, never the
 * content itself (a screen reloads to get the content, so what a person may
 * see is decided where it always is: the screen's own load). The one
 * exception is `ask:<id>` (askStream.ts): an answer's words as they are
 * written, to the person who asked, under an id only their screen knows.
 *
 * In-process: one server process holds every live connection. If the
 * backend ever runs as several processes, fan publish() out through
 * Postgres LISTEN/NOTIFY (or Redis) in `setRelay` and keep this interface.
 */
export type LiveEvent = { topic: string; at: number; data?: Record<string, unknown> };
export type LiveListener = (e: LiveEvent) => void;

export class LiveBus {
  private listeners = new Map<string, Set<LiveListener>>();
  private relay: ((userIds: string[], e: LiveEvent) => void) | null = null;

  /** Tell these people that `topic` changed. Never throws. */
  publish(userIds: Iterable<string>, topic: string, data?: Record<string, unknown>): void {
    const ids = [...new Set([...userIds].filter(Boolean))];
    if (!ids.length || !topic) return;
    const e: LiveEvent = { topic, at: Date.now(), ...(data ? { data } : {}) };
    if (this.relay) { try { this.relay(ids, e); } catch { /* the relay's own problem */ } return; }
    this.deliver(ids, e);
  }

  /** Hand an event to this process's listeners (a relay calls this on receipt). */
  deliver(userIds: string[], e: LiveEvent): void {
    for (const id of userIds) {
      for (const fn of this.listeners.get(id) ?? []) { try { fn(e); } catch { /* one bad listener never stops the rest */ } }
    }
  }

  /** Listen for one person's events; returns the way to stop. */
  subscribe(userId: string, fn: LiveListener): () => void {
    let set = this.listeners.get(userId);
    if (!set) this.listeners.set(userId, (set = new Set()));
    set.add(fn);
    return () => { set!.delete(fn); if (!set!.size) this.listeners.delete(userId); };
  }

  /** How many listeners one person has open (tests, metrics). */
  count(userId: string): number { return this.listeners.get(userId)?.size ?? 0; }

  /** Several processes: route publish() through a shared channel that calls deliver() everywhere. */
  setRelay(relay: ((userIds: string[], e: LiveEvent) => void) | null): void { this.relay = relay; }
}

/** The one bus the server uses. */
export const live = new LiveBus();
