/**
 * PLAN EASE, STEPS 2 AND 3: WHAT COMES IN (docs/plan-ease.md "The work calendar", "Getting things in", "Bills due"):
 *
 *   - the work calendar's file read: repeats, days taken out, a moved start, time zones, free and cancelled meetings; big files cut first
 *   - the link: pasted once, read through the guard, kept sealed and never in an error; 304; stopped at once or after three; codes
 *   - its meetings on the days: rows, the clash check (busy, never moved), the offer card once, the stopped card and its note line
 *   - bills: amounts, the safe pay link, the box's words, the row, the one thing, the widget and the note without the amount, the
 *     reminders at 10 am and 6 pm, Paid, a monthly bill's next one with no amount
 *   - captures: the rules pick, the reader's answer checked, Add all with "before" steps and Undo, no yes to AI, the day's budget, the
 *     push when they left, the card in Needs-you and the evening note, files gone after
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const { Calendar, memoryCalendarRows } = await import("../src/calendar/index.js");
const { PlanEase } = await import("../src/botsBots/planEase.js");
const { memoryPlanPrefs } = await import("../src/botsBots/planPrefs.js");
const { MemoryTable } = await import("../src/botsBots/rows.js");
const { readIcs, narrow, providerOf, hintOf, linkOf, refOf, placeOf } = await import("../src/botsBots/planIcs.js");
const { PlanLinks, memoryLinkStore, linkSource, STOPPED_LINE, STOPPED_TELL_MS, STOPPED_DROP_MS, CODE_MS } = await import("../src/botsBots/planLinks.js");
const { addPlanSource, removePlanSource } = await import("../src/botsBots/planSources.js");
const { amountOf, rupees, payLinkOf, readDue, cleanTitle, setAddDue } = await import("../src/botsBots/planDue.js");
const { PlanCapture, memoryCaptureStore, checkItems, looksPlanny, nextMonth, setPlanCapture, DAY_PAISE } = await import("../src/botsBots/planCapture.js");
const { looksPasted } = await import("../src/botsBots/planInBox.js");
const { PLAN_PUSH_KINDS, PLAN_KIND_IDS, PLAN_CATEGORIES } = await import("../src/botsBots/planKinds.js");
const { EVENT_PUSH_KINDS } = await import("../src/push/defaults.js");
const { verdict } = await import("../src/you/push.js");
const { DEFAULT_SETTINGS } = await import("../src/you/settings.js");
const { parseItem } = await import("../src/widgets/items.js");
const { resetConfigForTests } = await import("../src/config.js");
const { setEgressTestHooks } = await import("../src/connectors/egress.js");

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const IST = 330;
/** November 2026, India's wall clock, as UTC ms. Thu 12 Nov. */
const ist = (day: number, h: number, m = 0) => Date.UTC(2026, 10, day, h, m) - IST * MIN;
const U = "aaaaaaaa-0000-4000-8000-000000000001";
const URL1 = "https://calendar.google.com/calendar/ical/me%40work.com/private-a91fsecret/basic.ics";

type Sent = { userId: string; kind: string; key: string; vars: Record<string, string>; data?: Record<string, string>; category?: string };
type Skip = { [k: string]: unknown; user_id: string; key: string; at_ms: number };

const icsOf = (events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Google Inc//Google Calendar 70.9054//EN\r\nBEGIN:VTIMEZONE\r\nTZID:Asia/Kolkata\r\nBEGIN:STANDARD\r\nTZOFFSETFROM:+0530\r\nTZOFFSETTO:+0530\r\nTZNAME:IST\r\nDTSTART:19700101T000000\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n${events.join("")}END:VCALENDAR\r\n`;
const ev = (o: { uid: string; start: string; end: string; title: string; more?: string }) =>
  `BEGIN:VEVENT\r\nDTSTART;TZID=Asia/Kolkata:${o.start}\r\nDTEND;TZID=Asia/Kolkata:${o.end}\r\nUID:${o.uid}\r\nSUMMARY:${o.title}\r\n${o.more ?? ""}DESCRIPTION:Zoom passcode 123456 join https://zoom.us/j/1\r\nATTENDEE;CN=A:mailto:a@work.com\r\nATTENDEE;CN=B:mailto:b@work.com\r\nEND:VEVENT\r\n`;

afterEach(() => {
  vi.unstubAllEnvs(); resetConfigForTests(); removePlanSource("links"); removePlanSource("captures"); setPlanCapture(null); setAddDue(null);
  setEgressTestHooks(null);
});

// ===================================================================== the file

describe("a work calendar's file", () => {
  const file = icsOf([
    ev({ uid: "standup@x", start: "20261102T100000", end: "20261102T103000", title: "Standup", more: "RRULE:FREQ=WEEKLY;BYDAY=MO,WE\r\nEXDATE;TZID=Asia/Kolkata:20261104T100000\r\nLOCATION:Zoom\r\n" }),
    ev({ uid: "standup@x", start: "20261111T110000", end: "20261111T113000", title: "Standup (moved)", more: "RECURRENCE-ID;TZID=Asia/Kolkata:20261111T100000\r\n" }),
    "BEGIN:VEVENT\r\nDTSTART;TZID=America/New_York:20261112T090000\r\nDTEND;TZID=America/New_York:20261112T100000\r\nUID:ny@x\r\nSUMMARY:NY call\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT\r\n",
    "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261113\r\nDTEND;VALUE=DATE:20261114\r\nUID:allday@x\r\nSUMMARY:Offsite\r\nEND:VEVENT\r\n",
    "BEGIN:VEVENT\r\nDTSTART;TZID=Asia/Kolkata:20261112T150000\r\nDTEND;TZID=Asia/Kolkata:20261112T160000\r\nUID:gone@x\r\nSUMMARY:Cancelled one\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\n",
    "BEGIN:VEVENT\r\nDTSTART;TZID=Asia/Kolkata:20190105T150000\r\nDTEND;TZID=Asia/Kolkata:20190105T160000\r\nUID:old@x\r\nSUMMARY:Long ago\r\nEND:VEVENT\r\n",
  ]);
  const window = { fromMs: ist(5, 0), toMs: ist(5, 0) + 60 * DAY, tz: IST, linkId: "L1" };

  it("expands repeats, skips days taken out, moves a moved start, and keeps only what it should", () => {
    const got = readIcs(file, window);
    const standups = got.filter((s) => s.uid === "standup@x");
    // Mon 9 and Wed 11 (moved to 11 am); Wed 4 was before the window, and Mon 2 too.
    expect(standups[0]!.start).toBe(ist(9, 10));
    const moved = standups.find((s) => s.title === "Standup (moved)")!;
    expect(moved.start).toBe(ist(11, 11));
    // The moved start keeps the id it would have had: the morning note can say "moved".
    expect(moved.ref).toBe(refOf("L1", "standup@x", "2026-11-11T10:00:00"));
    expect(standups.filter((s) => s !== moved).every((s) => s.place === "Online" && s.people === 2)).toBe(true);
    // A zone the file names but doesn't give is the world's one by that name.
    const ny = got.find((s) => s.uid === "ny@x")!;
    expect(ny.start).toBe(Date.UTC(2026, 10, 12, 14, 0));
    expect(ny.busy).toBe(false);
    const allDay = got.find((s) => s.uid === "allday@x")!;
    expect(allDay.allDay).toBe(true);
    expect(got.some((s) => s.uid === "gone@x" || s.uid === "old@x")).toBe(false);
    // Never the description (call links, passcodes) and never the attendees' addresses.
    expect(JSON.stringify(got)).not.toMatch(/passcode|zoom\.us|work\.com/);
  });

  it("never keeps a join link or its passcode as the place: a call is Online, a real room stays", () => {
    const calls = icsOf([
      ev({ uid: "z@x", start: "20261112T100000", end: "20261112T103000", title: "Review", more: "LOCATION:https://us02web.zoom.us/j/8123344556?pwd=abcDEF123\r\n" }),
      ev({ uid: "t@x", start: "20261112T110000", end: "20261112T113000", title: "Sync", more: "LOCATION:Room 4B\\; https://teams.microsoft.com/l/meetup-join/19%3a?ctx=1 Passcode: 991\r\n" }),
      ev({ uid: "p@x", start: "20261112T120000", end: "20261112T123000", title: "Lunch", more: "LOCATION:Apollo\\, Indiranagar\r\n" }),
    ]);
    const got = readIcs(calls, window);
    expect(got.map((x) => [x.uid, x.place])).toEqual([["z@x", "Online"], ["t@x", "Room 4B"], ["p@x", "Apollo, Indiranagar"]]);
    expect(JSON.stringify(got)).not.toMatch(/pwd|zoom\.us|teams\.microsoft|991/);
    expect(placeOf("Zoom Meeting ID: 812 3344 5566 Passcode: 991")).toBe("Online");
    expect(placeOf("Meeting room 2")).toBe("Meeting room 2");
  });

  it("cuts a huge file down before reading it in full", () => {
    const old = Array.from({ length: 300 }, (_, i) => `BEGIN:VEVENT\nDTSTART:2015${String((i % 12) + 1).padStart(2, "0")}10T100000Z\nDTEND:2015${String((i % 12) + 1).padStart(2, "0")}10T110000Z\nUID:o${i}\nSUMMARY:Old ${i}\nEND:VEVENT\n`).join("");
    const small = narrow(icsOf([old, ev({ uid: "keep@x", start: "20261112T100000", end: "20261112T110000", title: "Keep" })]), window.fromMs, window.toMs);
    expect(small).toContain("UID:keep@x");
    expect(small).not.toContain("UID:o1\n");
    expect(small).toContain("BEGIN:VTIMEZONE");
    expect(() => readIcs("<html>not a calendar</html>", window)).toThrow();
  });

  it("knows its calendar from the host, shows only a hint, and reads webcal as https", () => {
    expect(providerOf(URL1)).toBe("google");
    expect(providerOf("https://outlook.office365.com/owa/calendar/x/reachcalendar.ics")).toBe("outlook");
    expect(providerOf("https://p23-caldav.icloud.com/published/2/abc")).toBe("icloud");
    expect(hintOf(URL1)).toMatch(/^calendar\.google\.com\/…[0-9a-f]{4}$/);
    expect(hintOf(URL1)).not.toContain("secret");
    expect(linkOf("webcal://p23-caldav.icloud.com/published/2/abc")).toBe("https://p23-caldav.icloud.com/published/2/abc");
    expect(linkOf("http://example.com/a.ics")).toBeNull();
    expect(linkOf("not a link")).toBeNull();
  });
});

// ===================================================================== the link

function linkRig(t0: number, answer: (req: { headers: Record<string, string> }) => Response) {
  const clock = { t: t0 };
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const store = memoryLinkStore();
  const changed: string[] = [];
  const links = new PlanLinks({
    store, now: () => clock.t, key: randomBytes(32), check: async () => undefined,
    fetch: async (url, init) => {
      const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
      calls.push({ url: String(url), headers });
      return answer({ headers });
    },
    changed: (u) => changed.push(u),
  });
  return { clock, links, store, calls, changed };
}

const okIcs = (body: string, etag = '"v1"') => new Response(body, { status: 200, headers: { etag, "content-type": "text/calendar" } });
const weekFile = icsOf([
  ev({ uid: "review@x", start: "20261112T180000", end: "20261112T190000", title: "Design review", more: "LOCATION:Koramangala\r\n" }),
  ev({ uid: "board@x", start: "20261113T090000", end: "20261113T100000", title: "Board call" }),
]);

describe("the link", () => {
  it("is read once when pasted, kept sealed, and never said back", async () => {
    const r = linkRig(ist(12, 9), () => okIcs(weekFile));
    const { link, n } = await r.links.add(U, `  ${URL1}  `);
    expect(n).toBe(2);
    expect(link).toMatchObject({ provider: "google", name: "Google Calendar", stopped: false });
    const [row] = await r.store.links.select({ user_id: U });
    expect(JSON.stringify(row)).not.toContain("secret");
    expect(JSON.stringify(await r.links.list(U))).not.toContain("secret");
    // The same link again is the same one; a 4th different one is refused.
    await r.links.add(U, URL1);
    expect((await r.links.list(U)).length).toBe(1);
    await r.links.add(U, `${URL1}?2`); await r.links.add(U, `${URL1}?3`);
    await expect(r.links.add(U, `${URL1}?4`)).rejects.toMatchObject({ code: "links_full" });
  });

  it("refuses a link that doesn't open, in words that never hold it", async () => {
    const r = linkRig(ist(12, 9), () => new Response("no", { status: 404 }));
    const err = await r.links.add(U, URL1).catch((e: Error) => e);
    expect(String((err as Error).message)).toMatch(/didn't open/);
    expect(String((err as Error).message)).not.toContain("secret");
    expect(await r.links.list(U)).toEqual([]);
    await expect(r.links.add(U, "ftp://x")).rejects.toMatchObject({ code: "bad_request" });
  });

  it("asks with the last answer's etag, writes nothing on a 304, and stops at once on a 401/403/404", async () => {
    let status = 200;
    const r = linkRig(ist(12, 9), () => (status === 304 ? new Response(null, { status: 304 }) : status === 200 ? okIcs(weekFile) : new Response("", { status })));
    await r.links.add(U, URL1);
    status = 304;
    r.clock.t += 40 * MIN;
    expect(await r.links.tick()).toBe(1);
    expect(r.calls.at(-1)!.headers["if-none-match"]).toBe('"v1"');
    expect((await r.links.list(U))[0]!.stopped).toBe(false);
    status = 403;
    r.clock.t += 40 * MIN;
    await r.links.tick();
    expect((await r.links.list(U))[0]!.stopped).toBe(true);
  });

  it("stops after three other failures in a row, says so after 6 hours, and is taken off after 7 days", async () => {
    let status = 200;
    const r = linkRig(ist(12, 9), () => (status === 200 ? okIcs(weekFile) : new Response("", { status })));
    await r.links.add(U, URL1);
    status = 503;
    for (let i = 0; i < 3; i += 1) { r.clock.t += 2 * HOUR; await r.links.tick(); }
    expect((await r.links.list(U))[0]!.stopped).toBe(true);
    expect((await r.links.status(U)).stopped).toBeNull();
    r.clock.t += STOPPED_TELL_MS;
    expect((await r.links.status(U)).stopped?.name).toBe("Google Calendar");
    r.clock.t += STOPPED_DROP_MS;
    expect(await r.links.sweep()).toBe(1);
    expect(await r.links.list(U)).toEqual([]);
    expect(await r.store.between(U, 0, Number.MAX_SAFE_INTEGER, 100)).toEqual([]);
  });

  it("from a computer: a 6-number code that works once, for 15 minutes, and nothing is read before", async () => {
    const r = linkRig(ist(12, 9), () => okIcs(weekFile));
    const code = await r.links.codeFor(URL1);
    expect(code).toMatch(/^\d{6}$/);
    expect(r.calls.length).toBe(0);
    const [held] = await r.store.codes.select({});
    expect(JSON.stringify(held)).not.toContain(code);
    expect(JSON.stringify(held)).not.toContain("secret");
    await r.links.claim(U, `${code.slice(0, 3)} ${code.slice(3)}`);
    expect((await r.links.list(U)).length).toBe(1);
    await expect(r.links.claim(U, code)).rejects.toMatchObject({ code: "bad_request" });
    const late = await r.links.codeFor(URL1);
    r.clock.t += CODE_MS + MIN;
    await expect(r.links.claim(U, late)).rejects.toMatchObject({ code: "bad_request" });
  });

  it("counts wrong codes in the database: per person, per address and for everyone; a restart or a second server resets nothing", async () => {
    const r = linkRig(ist(12, 9), () => okIcs(weekFile));
    const code = await r.links.codeFor(URL1);
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i += 1) await expect(r.links.claim(U, wrong, IST, "203.0.113.9")).rejects.toMatchObject({ code: "bad_request" });
    // A second server (a new PlanLinks over the same store) still knows: even the right code is refused for this hour.
    const again = new PlanLinks({ store: r.store, now: () => r.clock.t, key: (r.links as unknown as { keyGiven: Buffer }).keyGiven, check: async () => undefined });
    await expect(again.claim(U, code, IST, "203.0.113.9")).rejects.toMatchObject({ code: "too_many" });
    const rows = await r.store.tries.select({});
    expect(rows.map((x) => x.scope)).toHaveLength(3);
    expect(rows.map((x) => x.scope)).toEqual(expect.arrayContaining(["all", `u:${U}`, expect.stringMatching(/^ip:[0-9a-f]{40}$/)]));
    expect(JSON.stringify(rows)).not.toContain("203.0.113.9");
    // Many accounts from many addresses: the count for everyone stops them all.
    for (let i = 0; i < 95; i += 1) {
      await again.claim(`aaaaaaaa-0000-4000-8000-${String(100 + i).padStart(12, "0")}`, wrong, IST, `198.51.100.${i}`).catch(() => undefined);
    }
    await expect(again.claim("aaaaaaaa-0000-4000-8000-000000000999", code, IST, "192.0.2.1")).rejects.toMatchObject({ code: "too_many" });
    // The hour up: the right code works (it was kept for its 15 minutes only, so a new one is made).
    r.clock.t += 61 * MIN;
    await r.links.sweep();
    const fresh = await r.links.codeFor(URL1);
    expect((await r.links.claim(U, fresh, IST, "203.0.113.9")).link.provider).toBe("google");
  });

  it("reads through the guard: an address inside our network is never fetched", async () => {
    setEgressTestHooks({ resolve: () => ["10.0.0.5"] });
    const links = new PlanLinks({ store: memoryLinkStore(), key: randomBytes(32), check: async () => undefined });
    const err = await links.add(U, "https://calendar.internal.example/a.ics").catch((e: Error) => e);
    expect((err as Error).message).toMatch(/didn't open/);
    expect((err as Error).message).not.toContain("internal.example");
  });

  it("really fetches over https only (a plain http server is refused by the guard)", async () => {
    const srv = createServer((_req, res) => { res.end(weekFile); });
    await new Promise<void>((res) => srv.listen(0, "127.0.0.1", () => res()));
    const port = (srv.address() as { port: number }).port;
    const links = new PlanLinks({ store: memoryLinkStore(), key: randomBytes(32), check: async () => undefined });
    await expect(links.add(U, `https://127.0.0.1:${port}/a.ics`)).rejects.toMatchObject({ code: "bad_request" });
    await new Promise<void>((res) => srv.close(() => res()));
  });
});

// ===================================================================== its meetings on the person's days

function dayRig(t0: number, file = weekFile) {
  const clock = { t: t0 };
  const c = new Calendar({ rows: memoryCalendarRows(), now: () => clock.t, publish: () => undefined });
  const prefs = memoryPlanPrefs(() => clock.t);
  const skips = new MemoryTable<Skip>();
  const sent: Sent[] = [];
  const ease = new PlanEase({ calendar: c, prefs, skips, now: () => clock.t, send: async (userId, m) => { sent.push({ userId, ...m }); } });
  ease.attach();
  const store = memoryLinkStore();
  const links = new PlanLinks({ store, now: () => clock.t, key: randomBytes(32), check: async () => undefined, fetch: async () => okIcs(file) });
  addPlanSource(linkSource(() => links, () => skips));
  return { clock, c, prefs, skips, ease, sent, links, store };
}

describe("the work calendar on the person's days", () => {
  it("shows its meetings as rows, from the work calendar, never moved", async () => {
    const r = dayRig(ist(12, 9));
    await r.links.add(U, URL1);
    const p = await r.ease.read(U, IST);
    expect(p.next.big).toBe("Design review at 6 pm");
    const tomorrow = p.days.find((d) => d.label === "Tomorrow")!;
    expect(tomorrow.rows[0]).toMatchObject({ title: "Board call", time: "9 am" });
    expect(tomorrow.rows[0]!.open.id).toMatch(/^wk-/);
    // Its details read its own way.
    const m = await r.links.meeting(U, tomorrow.rows[0]!.open.id, IST);
    expect(m).toMatchObject({ title: "Board call", people: 2, provider: "google", fixed: true, source: "link" });
  });

  it("a clash with their own movable thing is a Move card for theirs; with a booked thing, a grey line on both", async () => {
    const r = dayRig(ist(12, 9));
    await r.links.add(U, URL1);
    await r.c.addEvent(U, { title: "Gym", day: "2026-11-12", time: "18:30", minutes: 60, tz: IST });
    let p = await r.ease.read(U, IST);
    expect(p.needs?.type).toBe("move");
    expect(p.needs?.question).toMatch(/^Move gym to /);
    const r2 = dayRig(ist(12, 9));
    await r2.links.add(U, URL1);
    await r2.c.addEvent(U, { title: "Dentist", day: "2026-11-12", time: "18:30", minutes: 60, tz: IST });
    p = await r2.ease.read(U, IST);
    expect(p.needs).toBeNull();
    const today = p.days.find((d) => d.label === "Today")!;
    // The review is the one thing (left out of the list); the dentist's row says what it clashes with.
    expect(p.next.big).toBe("Design review at 6 pm");
    expect(today.rows.find((x) => x.title === "Dentist")?.line).toBe("Clashes with design review");
  });

  it("a free meeting is no clash", async () => {
    const file = icsOf([ev({ uid: "focus@x", start: "20261112T180000", end: "20261112T190000", title: "Focus time", more: "TRANSP:TRANSPARENT\r\n" })]);
    const r = dayRig(ist(12, 9), file);
    await r.links.add(U, URL1);
    await r.c.addEvent(U, { title: "Gym", day: "2026-11-12", time: "18:30", minutes: 60, tz: IST });
    expect((await r.ease.read(U, IST)).needs).toBeNull();
  });

  it("offers the link once, on the third day Plan Ease is opened with none; No thanks is for ever", async () => {
    const r = dayRig(ist(10, 9));
    expect((await r.ease.read(U, IST)).needs).toBeNull();
    r.clock.t = ist(11, 9);
    expect((await r.ease.read(U, IST)).needs).toBeNull();
    r.clock.t = ist(12, 9);
    const p = await r.ease.read(U, IST);
    expect(p.needs).toMatchObject({ type: "link", question: "Show your work calendar here too?", reason: "Google, Outlook or iPhone. It takes a minute." });
    expect(p.needs!.buttons.map((b) => b.label)).toEqual(["Link it", "No thanks"]);
    expect(p.needs!.buttons[0]!.open?.screen).toBe("bots.plan.link");
    // Only on the page: never the widget.
    expect((await r.ease.line(U, IST)).needs).toBeNull();
    const item = parseItem(p.needs!.item)!;
    expect((await r.ease.act(U, item, "no")).status).toBe(200);
    expect((await r.ease.read(U, IST)).needs).toBeNull();
    // Left alone: not the next day.
    const r2 = dayRig(ist(10, 9));
    for (const d of [10, 11, 12]) { r2.clock.t = ist(d, 9); await r2.ease.read(U, IST); }
    r2.clock.t = ist(13, 9);
    expect((await r2.ease.read(U, IST)).needs).toBeNull();
  });

  it("stopped for 6 hours: the card, and one line in the next evening note", async () => {
    let status = 200;
    const r = dayRig(ist(12, 9));
    const links = new PlanLinks({ store: r.store, now: () => r.clock.t, key: randomBytes(32), check: async () => undefined, fetch: async () => (status === 200 ? okIcs(weekFile) : new Response("", { status })) });
    addPlanSource(linkSource(() => links, () => r.skips));
    await links.add(U, URL1);
    status = 401;
    r.clock.t += 40 * MIN;
    await links.tick();
    r.clock.t += STOPPED_TELL_MS + MIN;
    const p = await r.ease.read(U, IST);
    expect(p.needs).toMatchObject({ type: "linkStopped", question: "Your work calendar stopped updating" });
    expect(p.needs!.buttons).toHaveLength(1);
    await r.c.addEvent(U, { title: "Standup", day: "2026-11-13", time: "10:00", tz: IST });
    const row = (await r.prefs.get(U))!;
    await r.prefs.patch(U, { next_note_ms: r.clock.t - MIN, note: { ...(row.note ?? {}), next: "evening" } });
    await r.ease.notesTick();
    const note = r.sent.find((s) => s.kind === "plan_evening")!;
    expect(note.vars.body).toContain(STOPPED_LINE);
    await r.prefs.patch(U, { next_note_ms: r.clock.t - MIN, note: { ...((await r.prefs.get(U))!.note ?? {}), next: "evening" } });
    r.sent.length = 0;
    await r.ease.notesTick();
    expect(r.sent.find((s) => s.kind === "plan_evening")?.vars.body ?? "").not.toContain(STOPPED_LINE);
  });
});

describe("when the work calendar changes", () => {
  it("a meeting moved overnight leads the morning note", async () => {
    let file = weekFile;
    const r = dayRig(ist(12, 20, 30));
    const links = new PlanLinks({ store: r.store, now: () => r.clock.t, key: randomBytes(32), check: async () => undefined, fetch: async () => okIcs(file, `"${file.length}"`) });
    addPlanSource(linkSource(() => links, () => r.skips));
    await links.add(U, URL1);
    await r.prefs.patch(U, { tz_min: IST, next_note_ms: r.clock.t - MIN, note: { next: "evening" } });
    await r.ease.notesTick();
    expect(r.sent.find((s) => s.kind === "plan_evening")?.vars.title).toBe("Tomorrow: Board call at 9 am");
    file = weekFile.replace("20261113T090000", "20261113T110000").replace("20261113T100000", "20261113T120000");
    r.clock.t = ist(13, 7);
    await links.tick();
    r.clock.t = ist(13, 7, 30);
    await r.prefs.patch(U, { next_note_ms: r.clock.t - MIN, note: { ...((await r.prefs.get(U))!.note ?? {}), next: "morning" } });
    await r.ease.notesTick();
    const morning = r.sent.find((s) => s.kind === "plan_morning")!;
    expect(morning.vars.title).toBe("Today: Board call at 11 am");
    expect(morning.vars.body).toContain("New: board call moved to 11 am.");
  });

  it("a new clash found by a read: one push, once; a booked one is told, never offered a move", async () => {
    const { clashPush } = await import("../src/botsBots/planInWire.js");
    const r = dayRig(ist(12, 9));
    await r.links.add(U, URL1);
    await r.c.addEvent(U, { title: "Gym", day: "2026-11-12", time: "18:30", minutes: 60, tz: IST });
    const sent: Sent[] = [];
    const send = async (userId: string, m: Omit<Sent, "userId">) => { sent.push({ userId, ...m }); };
    expect(await clashPush(r.ease, U, IST, send, ist(12, 9))).toBe(true);
    expect(sent[0]).toMatchObject({ kind: "plan_decide", category: "x0_move" });
    expect(sent[0]!.vars.title).toMatch(/^Move gym to /);
    expect(await clashPush(r.ease, U, IST, send, ist(12, 9))).toBe(false);
    // Late at night it waits for the note.
    const r2 = dayRig(ist(12, 9));
    await r2.links.add(U, URL1);
    await r2.c.addEvent(U, { title: "Dentist · Dr. Mehta", day: "2026-11-12", time: "18:30", minutes: 60, tz: IST });
    expect(await clashPush(r2.ease, U, IST, send, ist(12, 22))).toBe(false);
    expect(await clashPush(r2.ease, U, IST, send, ist(12, 9))).toBe(true);
    expect(sent.at(-1)).toMatchObject({ kind: "plan_decide", vars: { title: "Appointment clashes with your 6 pm meeting", body: "Rebook it if you need to." } });
    expect(sent.at(-1)!.category).toBeUndefined();
  });
});

// ===================================================================== bills

describe("bills: amounts and the pay link", () => {
  it("reads every way an amount is written", () => {
    expect(amountOf("Electricity ₹2,140 due")).toBe(214000);
    expect(amountOf("Pay Rs. 300 for the trip")).toBe(30000);
    expect(amountOf("INR 1500.50")).toBe(150050);
    expect(amountOf("rent 25000 rupees")).toBe(2500000);
    expect(amountOf("fee 300/-")).toBe(30000);
    expect(amountOf("₹1.2k")).toBe(120000);
    expect(amountOf("Room 204 on the 5th")).toBeNull();
    expect(rupees(214000)).toBe("₹2,140");
    expect(rupees(12345600)).toBe("₹1,23,456");
    expect(rupees(150050)).toBe("₹1,500.50");
  });

  it("keeps a Pay link only when it is safe and was in the source word for word", () => {
    const sms = "BESCOM: Bill of Rs 2140 due 14-11-2026. Pay at upi://pay?pa=bescom@hdfcbank&pn=BESCOM&am=2140 or https://www.bescom.co.in/pay";
    expect(payLinkOf("upi://pay?pa=bescom@hdfcbank&pn=BESCOM&am=2140", sms)).toBe("upi://pay?pa=bescom@hdfcbank&pn=BESCOM&am=2140");
    expect(payLinkOf("https://www.bescom.co.in/pay", sms)).toBe("https://www.bescom.co.in/pay");
    // Not in the source: never one we were handed or made up.
    expect(payLinkOf("upi://pay?pa=other@ybl", sms)).toBeNull();
    // An unknown host, or words that push: no Pay button at all.
    const scam = "Dear customer your power will be disconnected tonight. Pay at https://bescom-pay.xyz/now";
    expect(payLinkOf("https://bescom-pay.xyz/now", scam)).toBeNull();
    expect(payLinkOf("upi://pay?pa=bescom@hdfcbank", `${sms} disconnected tonight`)).toBeNull();
  });

  it("reads a bill said in words", () => {
    const now = ist(6, 10);
    expect(readDue("Electricity 2140 due 14th", now, IST)).toEqual({ title: "Electricity", day: "2026-11-14", amountPaise: 214000, repeat: "" });
    expect(readDue("Pay rent by the 5th every month", now, IST)).toEqual({ title: "Rent", day: "2026-12-05", amountPaise: null, repeat: "monthly" });
    expect(readDue("rent 25000 on the 5th every month", now, IST)?.repeat).toBe("monthly");
    expect(readDue("Dentist Fri 5 pm", now, IST)).toBeNull();
    expect(readDue("What's due on Friday?", now, IST)).toBeNull();
    expect(cleanTitle("Pay school fee ₹300 by the 20th")).toBe("School fee");
    expect(nextMonth("2026-01-31")).toBe("2026-02-28");
    // A money size is read as money ("25k" is ₹25,000, never ₹25), and a bare amount never stays in the title.
    expect(readDue("Rent 25k due 5th every month", now, IST)).toEqual({ title: "Rent", day: "2026-12-05", amountPaise: 2_500_000, repeat: "monthly" });
    expect(readDue("Pay school fee 50 by Friday", now, IST)).toMatchObject({ title: "School fee", amountPaise: 5000 });
    expect(readDue("Electricity 2,140 due 14th", now, IST)).toMatchObject({ title: "Electricity", amountPaise: 214000 });
    expect(readDue("Pay Ramesh 1.5 lakh by Friday", now, IST)).toMatchObject({ amountPaise: 15_000_000 });
  });
});

function capRig(t0: number, o: { consent?: boolean; answer?: unknown; picture?: unknown } = {}) {
  const r = dayRig(t0);
  const files = new Map<string, { id: string; userId: string; kind: string; mime: string; name: string; text: string }>();
  const removed: string[] = [];
  const spent: number[] = [];
  const reads: string[] = [];
  const store = memoryCaptureStore();
  // Their yes to AI, as the gate would read it now (taken back mid-way by `yes(false)`).
  let ok = o.consent !== false;
  const capture = new PlanCapture({
    calendar: r.c, prefs: r.prefs, store, now: () => r.clock.t, tzOf: async () => IST, usdInr: () => 100,
    aiOk: async () => ok,
    readers: {
      text: async (_s, user) => { reads.push(user); return { text: JSON.stringify(o.answer ?? { label: "school circular", items: [] }), usd: 0.001 }; },
      picture: async () => { reads.push("picture"); return { text: JSON.stringify(o.picture ?? o.answer ?? { items: [] }), usd: 0.003 }; },
      glance: async () => ({ text: "yes", usd: 0.0001 }),
    },
    files: {
      get: async (userId, id) => { const f = files.get(id); return f && f.userId === userId ? ({ ...f, sha256: "", format: "", bytes: 10, chars: f.text.length, meta: {}, blobKey: "k", keep: false, expiresAt: 0, createdAt: 0 } as never) : null; },
      bytes: async () => Buffer.from("img"),
      remove: async (_u, id) => { removed.push(id); return files.delete(id); },
    },
    spend: (_u, p) => spent.push(p),
    send: async (userId, m) => { r.sent.push({ userId, ...m }); },
    fits: (u, d) => r.ease.policy.spend(u, d),
  });
  setPlanCapture(capture);
  setAddDue((userId, d) => capture.addDue(userId, d));
  addPlanSource({ name: "captures", more: (u) => capture.briefs(u), evening: (u, w) => capture.eveningLine(u, w.asked), morning: (u) => capture.morningLine(u) });
  return { ...r, capture, files, removed, spent, reads, store, yes: (v: boolean) => { ok = v; } };
}

const CIRCULAR = {
  label: "school circular",
  items: [
    { kind: "event", title: "Dress-up day: fruits", day: "2026-11-13", time: null, before: { title: "Buy fruit costume", day: "2026-11-11" }, sure: 0.95 },
    { kind: "due", title: "Field trip money", day: "2026-11-11", amount: 300, payee: "School office", pay_link: "upi://pay?pa=fake@ybl", sure: 0.9 },
    { kind: "event", title: "Parent-teacher meeting", day: "2026-11-14", time: "09:30", place: "School hall", sure: 0.9 },
    { kind: "event", title: "Sports day", day: null, sure: 0.3 },
    { kind: "event", title: "Diwali party", day: "2026-11-01", time: "10:00", sure: 0.9 },
  ],
};
const CIRCULAR_TEXT = "Dear parents,\nDress-up day (fruits) on Fri 13 Nov. Please buy the costume by Wed.\nField trip money ₹300 by Wed 11 Nov to the school office.\nPTM on Sat 14 Nov at 9:30 am in the school hall.\nSports day next month.";

describe("bills on the person's days", () => {
  it("draws the amount once, in the title; the one thing says pay; nothing outside the app says the amount", async () => {
    const r = capRig(ist(12, 8));
    const reply = await r.ease.box(U, "Electricity 2140 due today", IST);
    expect(reply).toMatchObject({ slot: "due", kind: "added", line: "Added: Electricity, due today" });
    const p = await r.ease.read(U, IST);
    expect(p.next).toMatchObject({ big: "Pay ₹2,140 for electricity today", rung: 2 });
    const line = await r.ease.line(U, IST);
    expect(line.widget?.line).toBe("Electricity due today");
    expect(JSON.stringify(line.widget)).not.toMatch(/₹|2,140|2140/);
    // Tomorrow's bill rides in the evening note, without its amount.
    await r.ease.box(U, "Water bill 640 due tomorrow", IST);
    await r.c.addEvent(U, { title: "Standup", day: "2026-11-13", time: "10:00", tz: IST });
    r.clock.t = ist(12, 20, 30);
    const row = (await r.prefs.get(U))!;
    await r.prefs.patch(U, { next_note_ms: r.clock.t - MIN, note: { ...(row.note ?? {}), next: "evening" } });
    await r.ease.notesTick();
    const note = r.sent.find((s) => s.kind === "plan_evening")!;
    expect(note.vars.body).toMatch(/Water bill due\./);
    expect(JSON.stringify(note.vars)).not.toMatch(/₹|640/);
  });

  it("reminds at 10 am with Paid (and Pay only with a safe link), once more at 6 pm if not paid", async () => {
    const r = capRig(ist(12, 8));
    const t = await r.c.addTask(U, { title: "Electricity", day: "2026-11-12", time: "", tz: IST }, { kind: "me" }, null, { kind: "due", amount_paise: 214000, payee: "BESCOM", pay_link: "upi://pay?pa=bescom@hdfcbank" });
    const got: Sent[] = [];
    r.clock.t = ist(12, 10);
    await r.c.remind(async (userId, m) => { got.push({ userId, ...m }); });
    expect(got[0]).toMatchObject({ kind: "plan_due", category: "x0_due", vars: { title: "Electricity due today", body: "BESCOM" } });
    expect(got[0]!.data).toMatchObject({ item: `pt:${t.id}`, go: "pay" });
    expect(JSON.stringify(got[0])).not.toMatch(/₹|2140|upi:/);
    r.clock.t = ist(12, 18);
    await r.c.remind(async (userId, m) => { got.push({ userId, ...m }); });
    expect(got.filter((g) => g.kind === "plan_due")).toHaveLength(2);
    // Paid before 6 pm: no second one.
    const t2 = await r.c.addTask(U, { title: "Gas", day: "2026-11-13", time: "", tz: IST }, { kind: "me" }, null, { kind: "due" });
    r.clock.t = ist(13, 10);
    const more: Sent[] = [];
    await r.c.remind(async (userId, m) => { more.push({ userId, ...m }); });
    expect(more[0]).toMatchObject({ kind: "plan_due", category: "x0_paid" });
    expect((await r.ease.act(U, parseItem(`pt:${t2.id}`)!, "paid")).status).toBe(200);
    r.clock.t = ist(13, 18);
    await r.c.remind(async (userId, m) => { more.push({ userId, ...m }); });
    expect(more).toHaveLength(1);
  });

  it("a monthly bill paid makes next month's, with no amount until its own bill comes", async () => {
    const r = capRig(ist(6, 10));
    const reply = await r.ease.box(U, "Rent 25000 on the 5th every month", IST);
    expect(reply.line).toBe("Added: Rent, due the 5th each month");
    const t = (await r.c.list(U, { from: "2026-12-05", to: "2026-12-05", tz: IST })).tasks[0]!;
    expect(t).toMatchObject({ kind: "due", amountPaise: 2500000, repeat: "monthly" });
    await r.ease.act(U, parseItem(`pt:${t.id}`)!, "paid");
    const next = (await r.c.list(U, { from: "2027-01-05", to: "2027-01-05", tz: IST })).tasks[0]!;
    expect(next).toMatchObject({ title: "Rent", kind: "due", repeat: "monthly" });
    expect(next.amountPaise).toBeUndefined();
    // Undo (not paid after all) takes the next one back out.
    await r.ease.act(U, parseItem(`pt:${t.id}`)!, "unpaid");
    expect((await r.c.list(U, { from: "2027-01-05", to: "2027-01-05", tz: IST })).tasks).toHaveLength(0);
  });
});

// ===================================================================== captures

describe("getting things in", () => {
  it("picks Plan Ease by the rules for words with a date or money; a plain chat is not", () => {
    expect(looksPlanny(CIRCULAR_TEXT, ist(6, 10), IST)).toBe(true);
    expect(looksPlanny("Electricity bill Rs 2140 is due on 14-11-2026", ist(6, 10), IST)).toBe(true);
    expect(looksPlanny("haha that's so funny, see you", ist(6, 10), IST)).toBe(false);
    expect(looksPasted(CIRCULAR_TEXT)).toBe(true);
    expect(looksPasted("Dentist Fri 5 pm")).toBe(false);
  });

  it("checks what the reader said: past dates dropped, unsure unticked, what's on the plan marked, links only as found", () => {
    const got = checkItems(CIRCULAR, { today: "2026-11-06", source: CIRCULAR_TEXT, onPlan: [{ title: "PTM", day: "2026-11-14" }] });
    expect(got.label).toBe("school circular");
    expect(got.items.map((x) => x.title)).toEqual(["Dress-up day: fruits", "Field trip money", "Parent-teacher meeting", "Sports day"]);
    const [dress, money, ptm, sports] = got.items;
    expect(dress).toMatchObject({ kind: "event", time: null, tick: true, before: { title: "Buy fruit costume", day: "2026-11-11" } });
    expect(money).toMatchObject({ kind: "due", amountPaise: 30000, payLink: null, tick: true });
    expect(ptm).toMatchObject({ kind: "event", time: "09:30" });
    expect(ptm!.dupe).toBeNull();
    expect(sports).toMatchObject({ day: null, tick: false });
    const dup = checkItems({ items: [{ kind: "event", title: "PTM", day: "2026-11-14", time: "09:30", sure: 1 }] }, { today: "2026-11-06", source: "PTM 14 Nov", onPlan: [{ title: "PTM at school", day: "2026-11-14" }] });
    expect(dup.items[0]).toMatchObject({ dupe: "PTM at school", tick: false });
  });

  it("keeps a read amount only when the words hold exactly that number; never another line's, never one inside a bigger one", () => {
    const text = "Trip ₹300 by Wed 11 Nov. Sports kit ₹1,200 by Fri 13 Nov. Annual fee 12500 by 20 Nov.";
    const got = checkItems({ items: [
      { kind: "due", title: "Sports kit", day: "2026-11-13", amount: 1250, sure: 0.9 },
      { kind: "due", title: "Trip", day: "2026-11-11", amount: 300, sure: 0.9 },
      { kind: "due", title: "Annual fee", day: "2026-11-20", amount: 12500, sure: 0.9 },
    ] }, { today: "2026-11-06", source: text, onPlan: [] });
    expect(got.items.map((x) => [x.title, x.amountPaise])).toEqual([["Sports kit", null], ["Trip", 30000], ["Annual fee", 1_250_000]]);
  });

  it("a bill read with its amount in the title keeps the amount in its own field only, as the box's do", () => {
    const got = checkItems({ items: [{ kind: "due", title: "Electricity bill 2,140", day: "2026-11-14", amount: 2140, sure: 0.9 }] },
      { today: "2026-11-06", source: "BESCOM: Electricity bill 2,140 due 14 Nov", onPlan: [] });
    expect(got.items[0]).toMatchObject({ kind: "due", title: "Electricity bill", amountPaise: 214000 });
  });

  it("from the share screen: one card, read in the background; Add all adds events, to-dos, bills and before steps; Undo takes them out", async () => {
    const r = capRig(ist(6, 10), { answer: CIRCULAR });
    const look = await r.capture.look(U, { text: CIRCULAR_TEXT, tz: IST });
    expect("capture" in look && look.capture.title).toBe("Reading the school circular…");
    const id = "capture" in look ? look.capture.id : "";
    await r.capture.settled(id);
    const v = await r.capture.view(U, id);
    expect(v.title).toBe("4 things from the school circular");
    expect(v.button).toBe("Add 3");
    expect(v.rows.map((x) => x.dateAsk)).toEqual([false, false, false, true]);
    expect(v.rows[1]!.title).toBe("Field trip money · ₹300");
    expect(r.reads[0]).toContain("<shared>");
    // The same share again is the same card.
    const again = await r.capture.look(U, { text: CIRCULAR_TEXT, tz: IST });
    expect("capture" in again && again.capture.id).toBe(id);
    const res = await r.ease.act(U, parseItem(`pc:${id}`)!, "addall");
    expect(res.body).toMatchObject({ message: "Added 3 things" });
    const l = await r.c.list(U, { from: "2026-11-06", to: "2026-11-20", tz: IST });
    expect(l.events.map((e) => e.title)).toEqual(["Dress-up day: fruits", "Parent-teacher meeting"]);
    expect(l.events[0]).toMatchObject({ source: "capture", from: "school circular", captureId: id, allDay: true });
    expect(l.tasks.map((t) => t.title).sort()).toEqual(["Buy fruit costume", "Field trip money"]);
    expect(l.tasks.find((t) => t.title === "Field trip money")).toMatchObject({ kind: "due", amountPaise: 30000 });
    // A capture's things are booked: never offered a move.
    await r.ease.act(U, parseItem(`pc:${id}`)!, "undo");
    const after = await r.c.list(U, { from: "2026-11-06", to: "2026-11-20", tz: IST });
    expect(after.tasks.length + after.events.length).toBe(0);
    expect((await r.capture.view(U, id)).state).toBe("ready");
  });

  it("a row given a day is ticked; given to a family member it goes to them as a space task", async () => {
    const r = capRig(ist(6, 10), { answer: CIRCULAR });
    const given: Array<{ spaceId: string; b: Record<string, unknown> }> = [];
    r.capture.wire({ giveTask: async (_u, spaceId, b) => { given.push({ spaceId, b }); return { id: "t1" }; } });
    const look = await r.capture.look(U, { text: CIRCULAR_TEXT, tz: IST });
    const id = "capture" in look ? look.capture.id : "";
    await r.capture.settled(id);
    let v = await r.capture.edit(U, id, "i4", { day: "2026-12-04" });
    expect(v.rows[3]).toMatchObject({ tick: true, dateAsk: false });
    expect(v.button).toBe("Add all");
    v = await r.capture.edit(U, id, "i3", { who: { id: "bbbbbbbb-0000-4000-8000-000000000002", name: "Mom", spaceId: "space1" } });
    expect(v.rows[2]!.person?.name).toBe("Mom");
    await r.capture.addAll(U, id);
    expect(given[0]).toMatchObject({ spaceId: "space1", b: { title: "Parent-teacher meeting", kind: "plan", people: ["bbbbbbbb-0000-4000-8000-000000000002"] } });
  });

  it("with Spaces off nothing is given to a family member: no who on a row, and a row given before is added as the person's own", async () => {
    const r = capRig(ist(6, 10), { answer: CIRCULAR });
    const given: Array<{ spaceId: string; b: Record<string, unknown> }> = [];
    r.capture.wire({ giveTask: async (_u, spaceId, b) => { given.push({ spaceId, b }); return { id: "t1" }; } });
    const look = await r.capture.look(U, { text: CIRCULAR_TEXT, tz: IST });
    const id = "capture" in look ? look.capture.id : "";
    await r.capture.settled(id);
    const mom = { id: "bbbbbbbb-0000-4000-8000-000000000002", name: "Mom", spaceId: "space1" };
    // Given while Spaces was on, then Spaces is switched off before Add all.
    await r.capture.edit(U, id, "i3", { who: mom });
    vi.stubEnv("SPACES_ENABLED", "false"); resetConfigForTests();
    const v = await r.capture.edit(U, id, "i1", { who: mom });
    expect(v.rows.every((x) => !x.person)).toBe(true);
    await r.capture.addAll(U, id);
    expect(given).toEqual([]);
    const l = await r.c.list(U, { from: "2026-11-06", to: "2026-11-20", tz: IST });
    expect(l.events.map((e) => e.title)).toContain("Parent-teacher meeting");
  });

  it("without a yes to AI: nothing is asked and nothing is read; words take the rules road at once, a photo is one to-do with its file", async () => {
    const r = capRig(ist(6, 10), { consent: false, answer: CIRCULAR });
    const look = await r.capture.look(U, { text: "PTM on Sat 14 Nov at 9:30 am\nSports day next month\nDress-up day Fri 13 Nov", from: "plan", tz: IST });
    // The rules' card at once, as any card: its things ticked, one button. Nothing waits on a yes, nothing in it asks for one.
    const v = "capture" in look ? look.capture : null;
    expect(v).toMatchObject({ state: "ready", button: "Add all" });
    expect(v!.rows).toHaveLength(2);
    expect(JSON.stringify(v)).not.toMatch(/consent|AI/);
    expect(r.reads).toEqual([]);
    expect(await r.capture.addAll(U, v!.id)).toMatchObject({ n: 2 });
    expect(r.reads).toEqual([]);
    r.files.set("f1", { id: "f1", userId: U, kind: "image", mime: "image/jpeg", name: "IMG_2041.jpg", text: "" });
    const photo = await r.capture.look(U, { files: ["f1"], from: "plan", tz: IST });
    expect("capture" in photo && photo.capture).toMatchObject({ state: "failed", title: "The photo", fallback: "Added: Look at the photo" });
    const l = await r.c.list(U, { from: "2026-11-06", to: "2026-11-20", tz: IST });
    expect(l.tasks.find((t) => t.title === "Look at the photo")).toBeTruthy();
    expect(r.reads).toEqual([]);
    expect(r.removed).toEqual([]);
    // The routes that asked are gone with the card that called them.
    expect("plain" in r.capture || "consented" in r.capture).toBe(false);
  });

  it("the yes taken back while a photo waits for the day's reading: one to-do with its file, nothing read", async () => {
    const r = capRig(ist(6, 10), { answer: CIRCULAR });
    await r.prefs.patch(U, { capture_day: "2026-11-06", capture_paise: DAY_PAISE });
    r.files.set("f2", { id: "f2", userId: U, kind: "image", mime: "image/png", name: "notice.png", text: "" });
    const photo = await r.capture.look(U, { files: ["f2"], from: "plan", tz: IST });
    const pid = "capture" in photo ? photo.capture.id : "";
    await r.capture.settled(pid);
    expect((await r.capture.view(U, pid)).state).toBe("waiting");
    r.yes(false);
    r.clock.t = ist(7, 0, 5);
    await r.capture.tick();
    await r.capture.settled(pid);
    expect(await r.capture.view(U, pid)).toMatchObject({ state: "failed", fallback: "Added: Look at the photo" });
    expect(r.reads).toEqual([]);
  });

  it("a card left from before, waiting for a yes on the card, is read once opened: by the rules without one, by AI with it", async () => {
    const r = capRig(ist(6, 10), { consent: false, answer: CIRCULAR });
    const old = (id: string) => ({
      id, user_id: U, source: "text" as const, label: "school circular", file_id: null, in_hash: id, items: [], state: "consent" as const,
      words: CIRCULAR_TEXT, added: {}, paise: 0, seen_ms: null, told_ms: null, created_ms: r.clock.t - HOUR, updated_ms: r.clock.t - HOUR, expires_ms: r.clock.t + 6 * DAY,
    });
    const a = "cccccccc-0000-4000-8000-0000000000a1", b = "cccccccc-0000-4000-8000-0000000000b2";
    await r.store.insert(old(a));
    await r.store.insert(old(b));
    await r.capture.view(U, a);
    await r.capture.settled(a);
    const ruled = await r.capture.view(U, a);
    expect(ruled.state).toBe("ready");
    expect(ruled.rows.length).toBeGreaterThan(0);
    expect(r.reads).toEqual([]);
    r.yes(true);
    await r.capture.view(U, b);
    await r.capture.settled(b);
    expect((await r.capture.view(U, b)).title).toBe("4 things from the school circular");
    expect(r.reads).toHaveLength(1);
  });

  it("never keeps a shared file past its week, the one a \"Look at the photo\" to-do points at too (it was never read: it may be health)", async () => {
    const r = capRig(ist(6, 10), { consent: false });
    r.files.set("rx", { id: "rx", userId: U, kind: "image", mime: "image/jpeg", name: "IMG_3001.jpg", text: "" });
    const photo = await r.capture.look(U, { files: ["rx"], from: "plan", tz: IST });
    expect("capture" in photo && photo.capture.fallback).toBe("Added: Look at the photo");
    expect(r.removed).toEqual([]);
    r.clock.t += 7 * 24 * 60 * MIN + MIN;
    expect(await r.capture.sweep()).toBe(1);
    expect(r.removed).toEqual(["rx"]);
  });

  it("charges reading to the person and to Plan Ease's day; past ₹5 a photo waits for after midnight and words take the rules road", async () => {
    const r = capRig(ist(6, 10), { answer: CIRCULAR });
    const look = await r.capture.look(U, { text: CIRCULAR_TEXT, tz: IST });
    await r.capture.settled("capture" in look ? look.capture.id : "");
    expect(r.spent).toEqual([10]);
    expect((await r.prefs.get(U))).toMatchObject({ capture_day: "2026-11-06", capture_paise: 10 });
    await r.prefs.patch(U, { capture_day: "2026-11-06", capture_paise: DAY_PAISE });
    r.files.set("f2", { id: "f2", userId: U, kind: "image", mime: "image/png", name: "notice.png", text: "" });
    const photo = await r.capture.look(U, { files: ["f2"], from: "plan", tz: IST });
    const pid = "capture" in photo ? photo.capture.id : "";
    await r.capture.settled(pid);
    expect((await r.capture.view(U, pid)).state).toBe("waiting");
    const reads = r.reads.length;
    const words = await r.capture.look(U, { text: "PTM on Sat 14 Nov at 9:30 am\nDress-up day Fri 13 Nov\nTrip on 20 Nov", from: "plan", tz: IST });
    const wid = "capture" in words ? words.capture.id : "";
    await r.capture.settled(wid);
    expect(r.reads.length).toBe(reads);
    expect((await r.capture.view(U, wid)).rows.length).toBe(3);
    // After their midnight the photo is read, and the morning note says so.
    r.clock.t = ist(7, 0, 5);
    expect(await r.capture.tick()).toBe(1);
    await r.capture.settled(pid);
    expect((await r.capture.view(U, pid)).state).toBe("ready");
    expect(await r.capture.morningLine(U)).toEqual(["I read the school circular: 4 things. Add them?"]);
    expect(await r.capture.morningLine(U)).toEqual([]);
  });

  it("never reads past what Plan Ease's day meter has left, nor with less left than a read can cost", async () => {
    const r = capRig(ist(6, 10), { answer: CIRCULAR });
    let chatLeft = 10;
    r.capture.wire({ leftToday: () => chatLeft });
    // The chat spent ₹7.90 of the ₹8 today: 10 paise is not enough for a read, so the words take the rules road.
    const look = await r.capture.look(U, { text: CIRCULAR_TEXT, tz: IST });
    await r.capture.settled("capture" in look ? look.capture.id : "");
    expect(r.reads).toEqual([]);
    expect(r.spent).toEqual([]);
    chatLeft = 800;
    const again = await r.capture.look(U, { text: `${CIRCULAR_TEXT}\nBring a water bottle on Fri 13 Nov.`, tz: IST });
    await r.capture.settled("capture" in again ? again.capture.id : "");
    expect(r.reads.length).toBe(1);
  });

  it("holds each read's share before it calls: shares at once never spend past ₹5, and no charge is lost", async () => {
    const r = capRig(ist(6, 10), { answer: CIRCULAR });
    // Each read costs ₹1 (a dollar is ₹100 here): only 5 fit in the ₹5, however many arrive at once.
    const slow = { text: async (_s: string, user: string) => { r.reads.push(user); await new Promise((ok) => setTimeout(ok, 5)); return { text: JSON.stringify(CIRCULAR), usd: 0.01 }; } };
    (r.capture as unknown as { readers: { text: unknown } }).readers.text = slow.text;
    const looks = await Promise.all(Array.from({ length: 9 }, (_, i) => r.capture.look(U, { text: `${CIRCULAR_TEXT}\nNote ${i} on Fri 13 Nov.`, tz: IST })));
    await Promise.all(looks.map((l) => r.capture.settled("capture" in l ? l.capture.id : "")));
    const row = await r.prefs.get(U);
    expect(r.reads.length).toBeLessThanOrEqual(5);
    expect(Number(row?.capture_paise)).toBe(r.reads.length * 100);
    expect(Number(row?.capture_paise)).toBeLessThanOrEqual(DAY_PAISE);
    expect(r.spent.reduce((a, b) => a + b, 0)).toBe(r.reads.length * 100);
  });

  it("read after they left: one push, a Needs-you card, the evening note once; the file goes when it is answered", async () => {
    const r = capRig(ist(6, 10), { answer: CIRCULAR });
    r.files.set("f3", { id: "f3", userId: U, kind: "pdf", mime: "application/pdf", name: "circular.pdf", text: CIRCULAR_TEXT });
    const look = await r.capture.look(U, { files: ["f3"], tz: IST });
    const id = "capture" in look ? look.capture.id : "";
    await r.capture.settled(id);
    r.clock.t += 2 * MIN;
    await r.capture.tick();
    const push = r.sent.find((s) => s.kind === "plan_decide")!;
    expect(push).toMatchObject({ category: "x0_capture", data: { item: `pc:${id}` } });
    expect(push.vars.title).toBe("Read the school circular: 4 things");
    expect(JSON.stringify(push.vars)).not.toMatch(/₹|300/);
    const p = await r.ease.read(U, IST);
    expect(p.needs).toMatchObject({ type: "capture", question: "4 things from the school circular. Add them?" });
    expect(p.needs!.buttons.map((b) => b.label)).toEqual(["Add 3", "Look"]);
    // The widget asks it with Add only (Look opens a page).
    expect((await r.ease.line(U, IST)).needs?.buttons.map((b) => b.label)).toEqual(["Add 3"]);
    await r.ease.act(U, parseItem(`pc:${id}`)!, "addall");
    expect(r.removed).toEqual(["f3"]);
    expect((await r.ease.read(U, IST)).needs?.type).not.toBe("capture");
  });

  it("a meeting's notes ready: its named to-dos with a day as one card, someone else's a wait, never \"Speaker 2\", no AI", async () => {
    const r = capRig(ist(6, 10));
    const waits: Array<{ who: string; title: string; key: string | null | undefined }> = [];
    r.capture.wire({ addWait: async (_u, w, o) => { waits.push({ who: w.who, title: w.title, key: o.key }); return { id: "aaaaaaaa-0000-4000-8000-0000000000w1".replace("w1", "a1") }; } });
    const note = {
      id: "note1", title: "Vendor sync", people: [{ label: "Speaker 2", name: "Rahul" }],
      todos: [
        { id: "t1", text: "Send the numbers", who: "Speaker 2", when: "by Thursday", done: false },
        { id: "t2", text: "Share the slides", who: "You", when: "by Monday", done: false },
        { id: "t3", text: "Call the vendor", who: "Others", when: "by Thursday", done: false },
        { id: "t4", text: "Check the contract", who: "Rahul", done: false },
      ],
    };
    const v = await r.capture.fromNote(U, note, IST);
    expect(r.reads).toEqual([]);
    expect(v?.title).toBe("2 things from the meeting");
    expect(v?.rows.map((x) => [x.title, x.line])).toEqual([["The numbers", "Waiting on Rahul · by Thu"], ["Share the slides", expect.stringMatching(/^Mon 9 Nov/)]]);
    // The same note again is the same card, not a second one.
    expect(await r.capture.fromNote(U, note, IST)).toBeNull();
    await r.capture.addAll(U, v!.id);
    expect(waits).toEqual([{ who: "Rahul", title: "The numbers", key: "note:note1:t1" }]);
    const l = await r.c.list(U, { from: "2026-11-06", to: "2026-11-20", tz: IST });
    expect(l.tasks.map((t) => t.title)).toContain("Share the slides");
  });

  it("a card left alone rides one evening note, as its question only (never said twice), and not the next evening", async () => {
    const r = capRig(ist(6, 10), { answer: CIRCULAR });
    for (const d of ["2026-11-07", "2026-11-08", "2026-11-09"]) await r.c.addEvent(U, { title: "Standup", day: d, time: "10:00", tz: IST });
    await r.ease.read(U, IST);
    const look = await r.capture.look(U, { text: CIRCULAR_TEXT, tz: IST });
    await r.capture.settled("capture" in look ? look.capture.id : "");
    r.clock.t = ist(6, 20, 30);
    await r.ease.notesTick();
    const first = r.sent.filter((x) => x.kind === "plan_evening");
    expect(first).toHaveLength(1);
    expect(first[0]!.vars.body).toContain("4 things from the school circular. Add them?");
    expect(first[0]!.vars.body).not.toContain("Add them in Plan Ease");
    for (const t of [ist(7, 7, 30), ist(7, 20, 30)]) { r.clock.t = t; await r.ease.notesTick(); }
    const second = r.sent.filter((x) => x.kind === "plan_evening");
    expect(second).toHaveLength(2);
    expect(second[1]!.vars.body).not.toMatch(/school circular/);
    // Still there on the page until its week is up.
    expect((await r.ease.read(U, IST)).needs?.type).toBe("capture");
  });

  it("a photo shared from anywhere gets one tiny look first; without the yes to AI it isn't looked at", async () => {
    const r = capRig(ist(6, 10), { answer: CIRCULAR });
    r.files.set("p1", { id: "p1", userId: U, kind: "image", mime: "image/jpeg", name: "IMG_2041.jpg", text: "" });
    const look = await r.capture.look(U, { files: ["p1"], tz: IST });
    expect("capture" in look && look.capture.state).toBe("reading");
    const r2 = capRig(ist(6, 10), { consent: false });
    r2.files.set("p1", { id: "p1", userId: U, kind: "image", mime: "image/jpeg", name: "IMG_2041.jpg", text: "" });
    expect(await r2.capture.look(U, { files: ["p1"], tz: IST })).toEqual({ plan: false });
    // Someone else's file is never theirs to read.
    expect(await r.capture.look("cccccccc-0000-4000-8000-000000000003", { files: ["p1"], tz: IST })).toEqual({ plan: false });
  });

  it("a health file's kind never leaves the app", async () => {
    const r = capRig(ist(6, 10), { answer: { label: "lab report", items: [{ kind: "todo", title: "Blood test", day: "2026-11-09", sure: 0.9 }] } });
    const look = await r.capture.look(U, { text: "Lab report: fasting blood test on 9 Nov 2026 at the lab\nBring the prescription\nReport on 12 Nov", tz: IST });
    const id = "capture" in look ? look.capture.id : "";
    await r.capture.settled(id);
    r.clock.t += 2 * MIN;
    await r.capture.tick();
    const push = r.sent.find((s) => s.kind === "plan_decide")!;
    expect(push.vars.title).toBe("Read the file: 1 thing");
    expect(push.vars.body).toMatch(/^Appointment/);
  });
});

// ===================================================================== pushes and the box

describe("steps 2 and 3's pushes and box words", () => {
  it("are said once, with the quiet-hours check, at most 2 buttons, ids unique", () => {
    for (const k of ["plan_decide", "plan_due"]) {
      expect(PLAN_KIND_IDS).toContain(k);
      expect(EVENT_PUSH_KINDS).toContain(k);
      expect(PLAN_PUSH_KINDS.find((x) => x.kind === k)?.verdict).toBe("plan");
      // Plan Ease off on "What pings you": dropped, like every one of its own.
      const planOff = { ...DEFAULT_SETTINGS, notify: { ...DEFAULT_SETTINGS.notify, botsOff: ["plan"] } };
      const quiet = { ...DEFAULT_SETTINGS, notify: { ...DEFAULT_SETTINGS.notify, quiet: true, quietFrom: 22 * 60, quietTo: 7 * 60 } };
      expect(verdict(planOff as never, k, 12 * 60)).toBe("drop");
      expect(verdict(quiet as never, k, 23 * 60 + 30)).toBe("silent");
    }
    const ids = PLAN_CATEGORIES.flatMap((c) => c.actions.map((a) => a.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of PLAN_CATEGORIES) expect(c.actions.length).toBeLessThanOrEqual(2);
    expect(PLAN_CATEGORIES.find((c) => c.id === "x0_paid")!.actions.map((a) => a.title)).toEqual(["Paid"]);
  });

  it("pasted words become a capture card, and 'link my work calendar' opens the link page", async () => {
    const r = capRig(ist(6, 10), { answer: CIRCULAR });
    const reply = await r.ease.box(U, CIRCULAR_TEXT, IST);
    expect(reply).toMatchObject({ slot: "capture", kind: "capture", open: { screen: "bots.plan.capture" } });
    const link = await r.ease.box(U, "link my work calendar", IST);
    expect(link).toMatchObject({ slot: "link", open: { screen: "bots.plan.link" } });
  });

  it("are off with their switches: no card from a share, a bill is a plain to-do", async () => {
    vi.stubEnv("PLAN_V2_CAPTURE", "false");
    vi.stubEnv("PLAN_V2_LINKS", "false");
    resetConfigForTests();
    const r = capRig(ist(6, 10), { answer: CIRCULAR });
    expect(await r.capture.look(U, { text: CIRCULAR_TEXT, tz: IST })).toEqual({ plan: false });
    const reply = await r.ease.box(U, "Electricity 2140 due 14th", IST);
    expect(reply.slot).toBe("item");
    expect((await r.ease.box(U, "link my work calendar", IST)).slot).toBe("item");
  });
});
