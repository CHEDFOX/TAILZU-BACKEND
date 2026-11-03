import { describe, expect, it } from "vitest";
import { alertLine, checkOnce, problemsOf, readHealth, type Health, type Problem } from "../src/ops/alerts.js";

// The server's own health (src/ops/alerts.ts): what is over its line, told once in six hours, CPU only once it lasts.
const ok: Health = { diskUsed: 0.3, diskTotalGb: 100, memUsed: 0.4, load: 0.1 };

describe("server health alerts", () => {
  it("reads this machine", async () => {
    const h = await readHealth();
    for (const v of [h.diskUsed, h.memUsed]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(h.diskTotalGb).toBeGreaterThan(0);
  });

  it("finds what is over its line, and says it plainly", () => {
    expect(problemsOf(ok)).toEqual([]);
    expect(problemsOf({ ...ok, diskUsed: 0.84, memUsed: 0.9, load: 0.8 })).toEqual(["disk", "memory", "cpu"]);
    expect(alertLine("disk", { ...ok, diskUsed: 0.84 })).toEqual({ title: "Server disk 84% full", body: "84 GB of 100 GB used. Free some space or grow the disk." });
  });

  it("tells once in six hours, CPU only after 15 minutes, and once more when it clears", async () => {
    let h = { ...ok, diskUsed: 0.85 };
    const sent: string[] = [];
    const state = { sent: new Map<Problem, number>(), cpuStreak: 0 };
    const send = async (m: { title: string }) => { sent.push(m.title); };
    let t = Date.UTC(2026, 10, 3, 6, 0);
    const tick = async () => { t += 5 * 60_000; return checkOnce(async () => h, send, state, t); };
    expect(await tick()).toEqual(["disk"]);
    expect(await tick()).toEqual([]);
    h = { ...h, load: 0.95 };
    expect(await tick()).toEqual([]);
    expect(await tick()).toEqual([]);
    expect(await tick()).toEqual(["cpu"]);
    h = { ...ok };
    expect((await tick()).sort()).toEqual(["cpu:ok", "disk:ok"]);
    expect(sent).toEqual(["Server disk 85% full", "Server CPU busy for 15 minutes", "Server disk back to normal", "Server CPU back to normal"]);
  });
});
