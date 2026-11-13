/**
 * THE MEETING BOT'S STAGE (meet/stage.ts): a play with no page open answered at once; a page told the meeting's state as it opens; a clip
 * sent to every page and resolved when one says it ended; stop and close resolving what is pending; a clip that never ends resolved by its
 * timeout; a second clip waiting for the first; clips kept until their time is up or they are done; a page that throws dropped without
 * harming the others; and the page's HTML escaped, pointed at its own token's addresses.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { MemoryStageHub, stageHtml, stageHub } = await import("../src/meet/stage.js");

type Ev = { event: string; data: Record<string, unknown> };
function page() {
  const events: Ev[] = [];
  return { events, send: (event: string, data: Record<string, unknown>) => { events.push({ event, data }); } };
}
const clip = (text = "Hello", bytes = 6000) => ({ text, audio: Buffer.alloc(bytes, 1), contentType: "audio/mpeg" });
const says = (p: { events: Ev[] }) => p.events.filter((e) => e.event === "say");

afterEach(() => { vi.useRealTimers(); });

describe("stage hub", () => {
  it("answers no_stage at once when no page is open", async () => {
    const hub = new MemoryStageHub();
    expect(hub.connected("m")).toBe(false);
    expect(await hub.play("m", clip())).toBe("no_stage");
    expect(hub.speaking("m")).toBe(false);
  });

  it("tells a page that opens the current state, and a later change", () => {
    const hub = new MemoryStageHub();
    hub.state("m", "Listening");
    const p = page();
    const close = hub.open("m", p.send);
    expect(hub.connected("m")).toBe(true);
    expect(p.events).toEqual([{ event: "state", data: { label: "Listening" } }]);
    hub.state("m", "Thinking…");
    expect(p.events[1]).toEqual({ event: "state", data: { label: "Thinking…" } });
    close();
    expect(hub.connected("m")).toBe(false);
  });

  it("sends say to every page and resolves played when the page says it ended", async () => {
    const hub = new MemoryStageHub();
    const a = page(), b = page();
    hub.open("m", a.send); hub.open("m", b.send);
    const r = hub.play("m", clip("Hi there"));
    expect(hub.speaking("m")).toBe(true);
    const id = says(a)[0].data.id as string;
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(says(a)[0].data).toEqual({ id, text: "Hi there" });
    expect(says(b)[0].data.id).toBe(id);
    hub.done("m", id, "ended");
    expect(await r).toBe("played");
    expect(hub.speaking("m")).toBe(false);
  });

  it("resolves stopped when the page reports stopped, ignoring unknown ids", async () => {
    const hub = new MemoryStageHub();
    const p = page();
    hub.open("m", p.send);
    const r = hub.play("m", clip());
    hub.done("m", "nope", "ended");
    expect(hub.speaking("m")).toBe(true);
    hub.done("m", says(p)[0].data.id as string, "stopped");
    expect(await r).toBe("stopped");
  });

  it("stop resolves stopped, tells the pages, and drops what waits", async () => {
    const hub = new MemoryStageHub();
    const p = page();
    hub.open("m", p.send);
    const first = hub.play("m", clip("one"));
    const second = hub.play("m", clip("two"));
    hub.stop("m");
    expect(await first).toBe("stopped");
    expect(await second).toBe("stopped");
    expect(p.events.some((e) => e.event === "stop")).toBe(true);
    expect(says(p)).toHaveLength(1);
    expect(hub.speaking("m")).toBe(false);
  });

  it("resolves by timeout: the clip's length plus slack, at most maxPlayMs", async () => {
    vi.useFakeTimers();
    const hub = new MemoryStageHub({ slackMs: 1000, maxPlayMs: 10_000 });
    hub.open("m", page().send);
    let out: string | null = null;
    // 12000 bytes is two seconds, plus one second of slack.
    void hub.play("m", clip("x", 12_000)).then((r) => { out = r; });
    await vi.advanceTimersByTimeAsync(2900);
    expect(out).toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    expect(out).toBe("played");

    let capped: string | null = null;
    void hub.play("m", clip("long", 6000 * 600)).then((r) => { capped = r; });
    await vi.advanceTimersByTimeAsync(9900);
    expect(capped).toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    expect(capped).toBe("played");
  });

  it("makes a second play wait for the first", async () => {
    const hub = new MemoryStageHub();
    const p = page();
    hub.open("m", p.send);
    const first = hub.play("m", clip("one"));
    let secondDone = false;
    const second = hub.play("m", clip("two")).then((r) => { secondDone = true; return r; });
    expect(says(p)).toHaveLength(1);
    hub.done("m", says(p)[0].data.id as string, "ended");
    expect(await first).toBe("played");
    expect(says(p)).toHaveLength(2);
    expect(says(p)[1].data.text).toBe("two");
    expect(secondDone).toBe(false);
    hub.done("m", says(p)[1].data.id as string, "ended");
    expect(await second).toBe("played");
  });

  it("resolves the pending play stopped when the last page closes", async () => {
    const hub = new MemoryStageHub();
    const p = page();
    const close = hub.open("m", p.send);
    const r = hub.play("m", clip());
    close();
    expect(await r).toBe("stopped");
  });

  it("keeps a clip until its TTL, and a minute after it is done", async () => {
    let t = 1_000_000;
    const hub = new MemoryStageHub({ now: () => t, clipTtlMs: 5 * 60_000 });
    const p = page();
    hub.open("m", p.send);
    const r = hub.play("m", clip("a"));
    const id = says(p)[0].data.id as string;
    expect(hub.clip("m", id)?.contentType).toBe("audio/mpeg");
    expect(hub.clip("m", id)?.audio.length).toBe(6000);
    hub.done("m", id, "ended");
    await r;
    t += 30_000;
    expect(hub.clip("m", id)).not.toBeNull();
    t += 31_000;
    expect(hub.clip("m", id)).toBeNull();

    const r2 = hub.play("m", clip("b"));
    const id2 = says(p)[1].data.id as string;
    t += 5 * 60_000 + 1;
    expect(hub.clip("m", id2)).toBeNull();
    hub.stop("m");
    await r2;
    expect(hub.clip("m", "unknown")).toBeNull();
    expect(hub.clip("other", id2)).toBeNull();
  });

  it("close resolves everything pending and forgets pages, clips and label", async () => {
    const hub = new MemoryStageHub();
    const p = page();
    hub.open("m", p.send);
    hub.state("m", "Listening");
    const first = hub.play("m", clip("one"));
    const second = hub.play("m", clip("two"));
    const id = says(p)[0].data.id as string;
    hub.close("m");
    expect(await first).toBe("stopped");
    expect(await second).toBe("stopped");
    expect(hub.clip("m", id)).toBeNull();
    expect(hub.connected("m")).toBe(false);
    expect(await hub.play("m", clip())).toBe("no_stage");
    const q = page();
    hub.open("m", q.send);
    expect(q.events).toEqual([]);
  });

  it("drops a page whose send throws without breaking the others", async () => {
    const hub = new MemoryStageHub();
    const good = page();
    hub.open("m", () => { throw new Error("gone"); });
    hub.open("m", good.send);
    const r = hub.play("m", clip());
    expect(says(good)).toHaveLength(1);
    hub.state("m", "Listening");
    expect(good.events.at(-1)?.event).toBe("state");
    hub.done("m", says(good)[0].data.id as string, "ended");
    expect(await r).toBe("played");
    // A page that throws as it opens is dropped too.
    hub.state("n", "Hi");
    hub.open("n", () => { throw new Error("gone"); });
    expect(hub.connected("n")).toBe(false);
  });

  it("shares one instance", () => {
    expect(stageHub()).toBe(stageHub());
  });
});

describe("stage page", () => {
  it("escapes names and the token, and points at the token's addresses", () => {
    const html = stageHtml({ token: 'ab"</script><b>', botName: "<script>alert(1)</script>", owner: "A&B <i>" });
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Taking notes for A&amp;B &lt;i&gt;");
    expect(html).not.toContain("</script><b>");
    expect(html).toContain("\\u003c/script\\u003e");
  });

  it("uses the event stream and the clip and done routes", () => {
    const html = stageHtml({ token: "tok-123_abc", botName: "X0 Bot", owner: "" });
    expect(html).toContain('"tok-123_abc"');
    expect(html).toContain('"/v1/meet/stage/" + TOKEN');
    expect(html).toContain('new EventSource(base + "/events")');
    expect(html).toContain('base + "/clips/" + id');
    expect(html).toContain('"/done"');
    expect(html).toContain("Taking notes");
    expect(html).not.toContain("Taking notes for");
    expect(html).toContain("#f6f5f2");
    expect(html).not.toMatch(/<script[^>]+src=/);
  });
});
