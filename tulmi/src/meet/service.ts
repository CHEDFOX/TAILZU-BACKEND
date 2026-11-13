/**
 * THE MEETING BOT'S ENGINE (docs/meet.md). A person sends their bot into a call through Recall.ai: it keeps the transcript in a note, answers
 * what people ask it (out loud through the stage page, or in the meeting's chat), keeps notes as the call goes, and when the call ends the
 * note is organised (a summary, the to-dos) and the person gets a push.
 *
 *   join(user, { url })      a bot into the call now: the row first ("joining"), then Recall's bot, asked for in the background (Recall may
 *                            be asked again for minutes when no bot is free); a live bot already in that call is answered instead
 *   schedule(user, event)    a calendar meeting's bot, kept by Recall for the meeting's start ("scheduled"); once per calendar event
 *   onStatus(body)           Recall's status webhook: joining, waiting to be let in (a push), in the call (the note is made), the call over
 *                            (the note organised, a push when it is ready), failed (a push saying why, in a few words)
 *   onLive(token, body)      the live transcript, the chat, who comes and goes. Lines go to the note in batches; a line that says the bot's
 *                            name, or a chat message to it, is a question: answered one at a time, out loud when its voice is on and the
 *                            stage is open, in the chat otherwise. "Stop" and "leave" are done at once. Answers run after it returns, so
 *                            the next event is never kept waiting; it never throws
 *   leave / cancel           the bot sent away, or a scheduled one called off
 *
 * IN A SPACE (people.ts; docs/spaces.md, the admin and the line about the admin): a space's admin sees the meetings of each member who
 * agreed to the line as it is now, with no block between them (overview's people, a meeting read only), is pushed when such a member takes
 * the bot to a meeting (space_meet), and may send the bot to a member's meeting for them (join's forUser). That meeting is the member's in
 * every way (their consent, their minutes, their settings, their note, their pushes; they are told: space_meet_sent); it names the admin
 * who sent it (by), who may also send its bot away or call it off. Never a word of what was said in a push. Nothing of it while Spaces is
 * off, since there are no people then.
 *
 * Each meeting has a secret token, in its bot's two addresses (/v1/meet/live/<token>/ and /v1/meet/stage/<token>); only its hash is kept.
 * Every model call runs as the person (privacy/aiGate.ts asPerson) and goes on their meter (usage/cost.ts chargedTo). A person's meetings are
 * capped at MEET_DAILY_MINUTES over the last 24 hours. What a meeting needs while its bot is in the call is room.ts's, in memory; after a
 * restart it is rebuilt from the row and the note. Nothing said in a meeting is logged.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Note } from "../../../shared/types/api.js";
import type { AuthedUser } from "../auth/supabase.js";
import { getConfig } from "../config.js";
import { botTopic } from "../live/topics.js";
import { livePublish } from "../live/writes.js";
import { organiseNote } from "../notes/finish.js";
import { createNote, deleteNote, getNote, updateNote } from "../notes/store.js";
import { synthesize } from "../pipeline/tts.js";
import { AI_CONSENT_TEXT, aiAllowedFor, asPerson } from "../privacy/aiGate.js";
import { getProfile } from "../profile/store.js";
import { pushEngine } from "../push/index.js";
import { addCostUsd, chargedTo, ttsUsd } from "../usage/cost.js";
import { brain, type Brain } from "./brain.js";
import { NO_PEOPLE, type MeetPeople } from "./people.js";
import { chatParts, recall, RecallError, type BotInput, type RecallBot, type RecallClient } from "./recall.js";
import {
  botIdOf, chatOf, cleanText, eventOf, FLUSH_LINES, heardOf, personOf, QUEUE_MAX, Room, WAKE_WAIT_MS, type Ask, type Chat, type Heard,
} from "./room.js";
import { stageHub } from "./stage.js";
import { LIVE_STATUSES, meetStore, type Meeting, type MeetSettings, type MeetStatus, type MeetStore } from "./store.js";
import { DEFAULT_BOT_NAME, MEET_SLUG, type MeetingDetail, type MeetingView, type MeetNotify, type MeetOverview, type StageHub } from "./types.js";
import { addressed, commandOf, meetingOf, type MeetingLink, type Platform } from "./words.js";

/** The meeting's token as it is kept: its SHA-256, in hex. */
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** A refusal the routes answer as it is: its status, its words for the person, its code. */
export class MeetError extends Error {
  constructor(readonly status: number, message: string, readonly code: string) {
    super(message);
    this.name = "MeetError";
  }
}

export interface MeetServiceDeps {
  store: MeetStore;
  /** Null: the meeting bot is not set up (join answers meet_off). */
  recall: RecallClient | null;
  brain: Brain;
  stage: StageHub;
  /** A spoken answer (an mp3); the server's speech by default. */
  tts?: (text: string) => Promise<{ audio: Buffer; contentType: string }>;
  /** The push (push/index.ts's engine by default). */
  notify?: MeetNotify;
  /** The person's first name, for the bot's introduction and the stage ("" when not known). */
  ownerName?: (userId: string) => Promise<string>;
  /** This server's public address, for the bot's two addresses (PUBLIC_ORIGIN by default). */
  origin?: string;
  now?: () => number;
  /** Whether the person said yes to AI services (privacy/aiGate.ts aiAllowedFor by default). */
  aiAllowed?: (userId: string) => Promise<boolean>;
  /** A finished meeting's note organised (notes/finish.ts organiseNote, as the person and on their meter, by default). */
  organise?: (userId: string, noteId: string) => Promise<Note | null>;
  /** How long heard lines wait before they are written to the note together (8 seconds). */
  flushMs?: number;
  /** How often the notes so far are written while the call goes on (3 minutes). */
  notesEveryMs?: number;
  /** Who is whose space admin (people.ts spacePeople); nobody by default. */
  people?: MeetPeople;
}

const DAY_MS = 24 * 60 * 60_000;
const LIST_MAX = 200;
const RECENT_MAX = 20;
/** A space's admin sees each member's latest few meetings, and at most this many in all. */
const PEOPLE_EACH = 10;
const PEOPLE_MAX = 20;
/** New lines since the last notes pass before another is worth a model call. */
const NOTES_MIN_LINES = 8;
const ENDED_MAX = 5_000;
const OVER: ReadonlySet<MeetStatus> = new Set(["ended", "done", "failed", "cancelled"]);
/** Recall's statuses of a bot on its way into a call, or in it. */
const LIVE_EVENTS: ReadonlySet<string> = new Set(["bot.joining_call", "bot.in_waiting_room", "bot.in_call_not_recording", "bot.in_call_recording"]);
/** How far along a meeting is: a status webhook never moves it back (Recall's webhooks can arrive out of order). */
const RANK: Record<MeetStatus, number> = { scheduled: 0, joining: 1, waiting: 2, in_call: 3, ended: 4, done: 4, failed: 4, cancelled: 4 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const SPEAK_HOW = "Speak naturally and clearly, like a helpful colleague in a meeting.";
const SORRY = "Sorry, I couldn't answer that just now.";
const GOODBYE = "Okay, I'm leaving the call now. Bye!";
/** Who the bot works for, as its instructions say it when the person's name is not known. */
const SOMEONE = "your user";

type EngineMsg = Parameters<NonNullable<ReturnType<typeof pushEngine>>["notify"]>[1];
/** The server's push engine, when it runs (push/index.ts). A missed push is not a lost meeting: it is on the meeting's page. */
const defaultNotify: MeetNotify = async (userId, msg) => { await pushEngine()?.notify(userId, msg as unknown as EngineMsg); };

/** The server's speech, as an mp3, on the meter of whoever's work is running (the answer's chargedTo). */
async function speakMp3(text: string): Promise<{ audio: Buffer; contentType: string }> {
  const out = await synthesize({ text, format: "mp3", instructions: SPEAK_HOW });
  addCostUsd(ttsUsd(text.length + SPEAK_HOW.length));
  return out;
}

const said = (err: unknown): string => (err instanceof Error ? err.message : "error").slice(0, 200);
const countWords = (t: string): number => (t.trim() ? t.trim().split(/\s+/).length : 0);
const firstWord = (name: string | null | undefined): string => cleanText(name, 40).split(" ")[0] ?? "";
/** When a meeting happens or happened: its start, else when it is booked for, else when it was made. */
const whenOf = (m: Meeting): number => m.startedAt ?? m.joinAt ?? m.createdAt;
/** Someone a space's admin may send the bot for (people.ts membersOf). */
type Member = { userId: string; name: string; spaceId: string };

/** One meeting as the person sees it: never the bot's id or the meeting's token. */
function viewOf(m: Meeting): MeetingView {
  return {
    id: m.id, title: m.title, platform: m.platform, url: m.url, status: m.status, voice: m.voice, source: m.source, joinAt: m.joinAt,
    startedAt: m.startedAt, endedAt: m.endedAt, noteId: m.noteId, participants: [...m.participants], error: m.error, liveNotes: m.liveNotes,
  };
}

/** What the bot writes in the chat as it joins: who it is, and how to ask it or send it away. */
function introLine(botName: string, owner: string): string {
  const forWhom = owner ? `, taking notes for ${owner}` : ", taking notes for this call";
  return `Hi, I'm ${botName}${forWhom}. Say "${botName}" or message me here to ask me something. Say "${botName}, leave" to send me away.`.slice(0, 500);
}

/** Why a bot could not join or stay, in a few words for a person, from Recall's sub_code. */
function whyFailed(subCode: string): string {
  const s = subCode.toLowerCase();
  if (s.includes("waiting_room") || s.includes("timeout_exceeded_waiting")) return "Nobody let it in.";
  if (s.includes("not_found") || s.includes("invalid")) return "The meeting link didn't work.";
  if (s.includes("denied") || s.includes("kicked") || s.includes("removed")) return "It was removed from the call.";
  return "It couldn't join the meeting.";
}

/** What Recall said when it would not take a bot, already in words for a person; anything else, plainly. */
const failText = (err: unknown): string => (err instanceof RecallError ? err.message : "It couldn't join the meeting.");

/** Recall's refusals as the routes answer them. */
async function viaRecall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof RecallError) throw new MeetError(err.status, err.message, err.code);
    throw err;
  }
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

export class MeetService {
  private readonly store: MeetStore;
  private readonly recall: RecallClient | null;
  private readonly brain: Brain;
  private readonly stage: StageHub;
  private readonly tts: (text: string) => Promise<{ audio: Buffer; contentType: string }>;
  private readonly notify: MeetNotify;
  private readonly ownerName: (userId: string) => Promise<string>;
  private readonly origin: string;
  private readonly now: () => number;
  private readonly aiAllowed: (userId: string) => Promise<boolean>;
  private readonly organise: (userId: string, noteId: string) => Promise<Note | null>;
  private readonly flushMs: number;
  private readonly notesEveryMs: number;
  private people: MeetPeople;

  /** The meetings with a bot in the call, by id; each token's hash to its meeting; rooms being rebuilt after a restart. */
  private readonly rooms = new Map<string, Room>();
  private readonly byHash = new Map<string, string>();
  private readonly building = new Map<string, Promise<Room>>();
  /** Meetings the person sent their bot away from (its room, when it is made, answers nothing more). */
  private readonly leavingIds = new Set<string>();
  /** Meetings being finished or failed now, so a second webhook waits for the first; and the ones this process has closed. */
  private readonly ending = new Map<string, Promise<void>>();
  private readonly ended = new Set<string>();
  /** Work still going on after its caller had its answer: a bot asked for, an answer, a note written, a write-up. */
  private readonly busy = new Set<Promise<void>>();

  constructor(d: MeetServiceDeps) {
    this.store = d.store;
    this.recall = d.recall;
    this.brain = d.brain;
    this.stage = d.stage;
    this.tts = d.tts ?? speakMp3;
    this.notify = d.notify ?? defaultNotify;
    this.ownerName = d.ownerName ?? (async () => "");
    this.origin = (d.origin ?? (process.env.PUBLIC_ORIGIN || "https://api.x0bot.com")).replace(/\/+$/, "");
    this.now = d.now ?? Date.now;
    this.aiAllowed = d.aiAllowed ?? aiAllowedFor;
    this.organise = d.organise
      ?? ((userId, noteId) => asPerson(userId, () => chargedTo(userId, "meet", () => organiseNote({ id: userId }, noteId))));
    this.flushMs = d.flushMs ?? 8_000;
    this.notesEveryMs = d.notesEveryMs ?? 180_000;
    this.people = d.people ?? NO_PEOPLE;
  }

  /** Who is whose space admin, from now on (the server's, once Spaces is made: setMeetPeople). */
  setPeople(p: MeetPeople): void {
    this.people = p;
  }

  // ------------------------------------------------------------------ the person's

  async overview(userId: string, o: { calendar?: boolean } = {}): Promise<MeetOverview> {
    const [settings, all, members] = await Promise.all([
      this.store.settings(userId), this.store.list(userId, LIST_MAX), this.membersOf(userId),
    ]);
    // Their own meetings a space's admin sent the bot to: "Sent by Aanya", the admin as their space has them.
    const senders = all.some((m) => m.byId && m.byId !== userId) ? await this.adminNames(userId) : new Map<string, string>();
    const own = async (list: Meeting[]): Promise<MeetingView[]> => Promise.all(list.map((m) => this.viewFor(userId, m, { senders })));
    return {
      settings,
      botName: settings.botName || DEFAULT_BOT_NAME,
      live: await own(all.filter((m) => LIVE_STATUSES.has(m.status))),
      upcoming: await own(all.filter((m) => m.status === "scheduled").sort((a, b) => (a.joinAt ?? a.createdAt) - (b.joinAt ?? b.createdAt))),
      // Over: done, ended, failed. A cancelled one was never held (a calendar event moved, or the person called it off).
      recent: await own(all.filter((m) => m.status === "done" || m.status === "ended" || m.status === "failed")
        .sort((a, b) => whenOf(b) - whenOf(a)).slice(0, RECENT_MAX)),
      minutesToday: Math.round(this.minutesIn(all)),
      minutesCap: getConfig().MEET_DAILY_MINUTES,
      calendar: o.calendar ?? false,
      people: await this.peopleMeetings(userId, members),
      sendFor: members.map((p) => ({ id: p.userId, name: p.name })),
    };
  }

  async join(userId: string, input: { url: string; title?: string; voice?: boolean; forUser?: string }): Promise<MeetingView> {
    if (!this.recall) throw new MeetError(503, "The meeting bot isn't set up on this server.", "meet_off");
    const link = meetingOf(input?.url);
    if (!link) throw new MeetError(400, "That isn't a meeting link (Google Meet, Zoom, Teams or Webex).", "bad_link");
    if (typeof input.forUser === "string" && input.forUser && input.forUser !== userId) return this.joinFor(userId, input.forUser, link, input);
    if (!(await this.aiAllowed(userId))) throw new MeetError(403, AI_CONSENT_TEXT, "ai_consent_needed");
    const all = await this.store.list(userId, LIST_MAX);
    // One bot a call: pasting the link again answers the bot already there.
    const there = all.find((m) => LIVE_STATUSES.has(m.status) && m.url === link.url);
    if (there) return this.viewFor(userId, there);
    if (this.minutesIn(all) >= getConfig().MEET_DAILY_MINUTES) {
      throw new MeetError(429, "Today's meeting time is used up. It comes back over the next day.", "meet_cap");
    }
    const { meeting, bot } = await this.prepare(userId, { link, title: input.title, voice: input.voice, source: "link" });
    await this.store.add(meeting);
    this.publish(userId);
    // Recall may answer 507 (no bot free) and be asked again for minutes: the person has the meeting at once, "joining".
    this.track(this.send(meeting, bot));
    // A member's admins are told they took the bot to a meeting (never a word of it).
    this.track(this.tellAdmins(meeting));
    return viewOf(meeting);
  }

  /**
   * The bot sent to a member's meeting by their space's admin: the member's meeting in every way (their consent, their minutes, their
   * settings and name), the admin named as who sent it. The member is told.
   */
  private async joinFor(adminId: string, forUser: string, link: MeetingLink, input: { title?: string; voice?: boolean }): Promise<MeetingView> {
    const member = (await this.membersOf(adminId)).find((p) => p.userId === forUser);
    if (!member) throw new MeetError(404, "You can send it only for someone in a space you look after.", "not_your_person");
    if (!(await this.aiAllowed(member.userId))) {
      throw new MeetError(403, `${member.name} hasn't turned on AI services in X0 Bot yet.`, "ai_consent_needed");
    }
    const all = await this.store.list(member.userId, LIST_MAX);
    const there = all.find((m) => LIVE_STATUSES.has(m.status) && m.url === link.url);
    if (there) return this.viewFor(adminId, there, { owner: member });
    if (this.minutesIn(all) >= getConfig().MEET_DAILY_MINUTES) {
      throw new MeetError(429, `${member.name}'s meeting time is used up today. It comes back over the next day.`, "meet_cap");
    }
    const owner = (await this.owner(member.userId)) || firstWord(member.name);
    const { meeting, bot } = await this.prepare(member.userId, {
      link, title: input.title, voice: input.voice, source: "link", byId: adminId, spaceId: member.spaceId, owner,
    });
    await this.store.add(meeting);
    this.publish(member.userId, adminId);
    this.track(this.send(meeting, bot));
    this.track(this.tellMember(meeting, adminId));
    return this.viewFor(adminId, meeting, { owner: member });
  }

  async schedule(userId: string, ev: { key: string; title: string; startMs: number; url: string; platform: Platform }): Promise<MeetingView | null> {
    if (!this.recall) return null;
    const link = meetingOf(ev.url);
    if (!link || !ev.key || !Number.isFinite(ev.startMs)) return null;
    if (await this.store.byEvent(userId, ev.key)) return null;
    if (!(await this.aiAllowed(userId))) return null;
    if (this.minutesIn(await this.store.list(userId, LIST_MAX)) >= getConfig().MEET_DAILY_MINUTES) return null;
    const { meeting, bot } = await this.prepare(userId, { link, title: ev.title, source: "calendar", eventKey: ev.key, joinAt: ev.startMs });
    try {
      await this.store.add(meeting);
    } catch (err) {
      // The same event, scheduled a moment ago by another pass.
      if (/already scheduled/i.test(said(err))) return null;
      throw err;
    }
    let row: Meeting = meeting;
    try {
      // A bot asked for more than ten minutes ahead is kept for the meeting: Recall answers at once.
      const made = await this.recall.createBot(bot);
      row = (await this.store.update(meeting.id, { botId: made.id })) ?? { ...meeting, botId: made.id };
      this.track(this.tellAdmins(row));
    } catch (err) {
      row = (await this.store.update(meeting.id, { status: "failed", error: failText(err), endedAt: this.now() }).catch(() => null)) ?? row;
    }
    this.publish(userId);
    return viewOf(row);
  }

  /** Their own meeting; or, read only, one of a member of a space they are the admin of. Null for anyone else. */
  async meeting(viewer: string, id: string): Promise<MeetingDetail | null> {
    const m = UUID.test(id) ? await this.store.get(id) : null;
    if (!m) return null;
    if (m.userId === viewer) return { meeting: await this.viewFor(viewer, m), asks: await this.store.asks(id) };
    const member = (await this.membersOf(viewer)).find((p) => p.userId === m.userId);
    if (!member) return null;
    return { meeting: await this.viewFor(viewer, m, { owner: member }), asks: await this.store.asks(id), readOnly: true };
  }

  /**
   * The bot leaves the call: the owner's say, or the admin's who sent it (while the owner is still theirs to look after). Its status stays
   * as it is until Recall says the call ended (bot.call_ended).
   */
  async leave(viewer: string, id: string): Promise<MeetingView> {
    const got = await this.stoppable(viewer, id);
    if (!got) throw new MeetError(404, "No such meeting.", "not_found");
    const { m, owner } = got;
    if (!LIVE_STATUSES.has(m.status)) return this.viewFor(viewer, m, { owner });
    if (!m.botId) {
      // Recall has not answered yet (no bot was free, and it is being asked again): the meeting is called off now, its bot when it comes.
      const row = (await this.store.update(m.id, { status: "cancelled", endedAt: this.now() })) ?? m;
      this.close(m.id);
      this.publish(m.userId, m.byId);
      return this.viewFor(viewer, row, { owner });
    }
    this.markLeaving(m.id);
    const botId = m.botId;
    if (this.recall) await viaRecall(() => this.recall!.leaveCall(botId));
    this.publish(m.userId, m.byId);
    return this.viewFor(viewer, m, { owner });
  }

  /** Answers out loud (when the stage is open too), or in the chat, from now on. The owner's alone. */
  async setVoice(userId: string, id: string, on: boolean): Promise<MeetingView> {
    const m = await this.own(userId, id);
    const voice = !!on;
    const row = (await this.store.update(m.id, { voice })) ?? { ...m, voice };
    const room = this.rooms.get(m.id);
    if (room) room.voice = voice;
    this.publish(m.userId, m.byId);
    return this.viewFor(userId, row);
  }

  /**
   * A scheduled meeting's bot called off; a live one sent away. The owner's say, or the admin's who sent it. False when it is neither's,
   * or is already over.
   */
  async cancel(viewer: string, id: string): Promise<boolean> {
    const got = await this.stoppable(viewer, id);
    if (!got) return false;
    const { m } = got;
    if (m.status === "scheduled") {
      const botId = m.botId;
      if (botId) await viaRecall(() => this.callOff(botId));
      await this.store.update(m.id, { status: "cancelled" });
      this.close(m.id);
      this.publish(m.userId, m.byId);
      return true;
    }
    if (LIVE_STATUSES.has(m.status)) {
      await this.leave(viewer, id);
      return true;
    }
    return false;
  }

  async saveSettings(userId: string, patch: Partial<MeetSettings>): Promise<MeetSettings> {
    const cur = await this.store.settings(userId);
    const p = patch ?? {};
    const next: MeetSettings = {
      autoJoin: typeof p.autoJoin === "boolean" ? p.autoJoin : cur.autoJoin,
      voice: typeof p.voice === "boolean" ? p.voice : cur.voice,
      botName: typeof p.botName === "string" ? cleanText(p.botName, 40) : cur.botName,
    };
    const saved = await this.store.saveSettings(userId, next);
    this.publish(userId);
    return saved;
  }

  /** The stage page's meeting, by its token: null when there is none, or it is over. */
  async stageFor(token: string): Promise<{ meetingId: string; botName: string; owner: string } | null> {
    if (typeof token !== "string" || !TOKEN.test(token)) return null;
    const m = await this.store.byTokenHash(hashToken(token));
    if (!m || OVER.has(m.status)) return null;
    const room = this.rooms.get(m.id);
    if (room) return { meetingId: m.id, botName: room.botName, owner: room.owner };
    const settings = await this.store.settings(m.userId);
    return { meetingId: m.id, botName: settings.botName || DEFAULT_BOT_NAME, owner: await this.owner(m.userId) };
  }

  /** Every bot of theirs called off or sent away, before the account goes. Best effort: it never throws. */
  async forAccountDelete(userId: string): Promise<void> {
    let all: Meeting[];
    try { all = await this.store.list(userId, LIST_MAX); } catch { return; }
    for (const m of all) {
      if (m.status !== "scheduled" && !LIVE_STATUSES.has(m.status)) continue;
      try {
        if (m.botId && this.recall) {
          if (m.status === "scheduled") await this.callOff(m.botId);
          else await this.recall.leaveCall(m.botId);
        }
      } catch (err) {
        console.warn(`[meet] account delete: a bot could not be called off: ${said(err)}`);
      }
      this.close(m.id);
    }
  }

  /** Resolves when the work started in the background so far has finished: for tests, and a clean shutdown. */
  async idle(): Promise<void> {
    while (this.busy.size) await Promise.all([...this.busy]);
  }

  // ------------------------------------------------------------------ Recall's status webhook

  /** Recall's status webhook. A failure to read or write the row is thrown, so Recall sends it again. */
  async onStatus(body: unknown): Promise<void> {
    const event = eventOf(body);
    const d = obj(obj(body).data);
    const bot = obj(d.bot);
    const botId = str(bot.id);
    const ref = str(obj(bot.metadata).meeting);
    let found = botId ? await this.store.byBot(botId) : null;
    if (!found && UUID.test(ref)) {
      // Its id not kept yet (Recall's answer to the Create Bot request is still on its way): the meeting it was made for.
      const byRef = await this.store.get(ref);
      if (byRef && (!byRef.botId || !botId || byRef.botId === botId)) found = byRef;
    }
    if (!found) return;
    const m: Meeting = botId && !found.botId ? ((await this.store.update(found.id, { botId })) ?? { ...found, botId }) : found;
    const subCode = str(obj(d.data).sub_code);
    // A bot on its way into a meeting that was called off (it came as the person left): it is called off too.
    if (m.status === "cancelled" && botId && LIVE_EVENTS.has(event)) {
      await this.callOff(botId).catch((err) => console.warn(`[meet] a bot could not be called off: ${said(err)}`));
      return;
    }
    switch (event) {
      case "bot.joining_call":
        await this.move(m, "joining");
        return;
      case "bot.in_waiting_room":
        if (await this.move(m, "waiting")) {
          await this.push(m.userId, {
            kind: "meet_waiting", key: `${m.id}:waiting`, vars: { title: m.title || "Your meeting", name: await this.botNameOf(m) }, data: { m: m.id },
          });
        }
        return;
      case "bot.in_call_not_recording":
      case "bot.in_call_recording":
        await this.inCall(m);
        return;
      case "bot.call_ended":
      case "bot.done":
        await this.once(m.id, () => this.finish(m.id, subCode));
        return;
      case "bot.fatal":
        await this.once(m.id, () => this.fail(m.id, subCode));
        return;
      default:
        return;
    }
  }

  /** Forward only, and never once it is over. True when it moved. */
  private async move(m: Meeting, status: MeetStatus): Promise<boolean> {
    if (OVER.has(m.status) || m.status === status || RANK[status] < RANK[m.status]) return false;
    await this.store.update(m.id, { status });
    this.publish(m.userId, m.byId);
    return true;
  }

  private async inCall(m: Meeting): Promise<void> {
    if (OVER.has(m.status)) return;
    let row = m;
    if (m.status !== "in_call" || m.startedAt === null) {
      row = (await this.store.update(m.id, { status: "in_call", startedAt: m.startedAt ?? this.now() })) ?? { ...m, status: "in_call" };
      this.publish(m.userId, m.byId);
    }
    const room = await this.roomFor(row);
    if (room.closed) return;
    room.startedAt = row.startedAt ?? room.startedAt;
    this.stage.state(room.id, "Listening");
    // The note is there from the start, so its page shows the transcript as it grows.
    await this.ensureNote(room);
  }

  /** One finish (or fail) at a time per meeting: a second webhook waits for the first, then finds the meeting over. */
  private once(id: string, work: () => Promise<void>): Promise<void> {
    const running = this.ending.get(id);
    if (running) return running;
    const job = work().finally(() => { if (this.ending.get(id) === job) this.ending.delete(id); });
    this.ending.set(id, job);
    return job;
  }

  /** The call is over: the last lines written, "ended", and the note organised after the webhook has its answer. Once. */
  private async finish(id: string, subCode: string): Promise<void> {
    const m = await this.store.get(id);
    if (!m || OVER.has(m.status)) return;
    // Over before it was ever in the call, and nobody sent it away: it could not join. A waiting room nobody opened ends this way
    // (Recall's call_ended, timeout_exceeded_waiting_room), and the person is told so, as for a fatal error.
    const heard = (this.rooms.get(m.id)?.heard ?? 0) > 0;
    const sentAway = this.leavingIds.has(m.id) || /leave_call/i.test(subCode);
    if (m.startedAt === null && m.noteId === null && !heard && !sentAway) return this.fail(id, subCode);
    const room = this.close(m.id);
    if (room) await this.settle(room);
    const came = room?.cameNames() ?? [];
    const row = (await this.store.update(m.id, { status: "ended", endedAt: this.now(), ...(came.length ? { participants: came } : {}) }))
      ?? { ...m, status: "ended" as const, endedAt: this.now() };
    this.publish(m.userId, m.byId);
    this.track(this.writeUp({ ...row, noteId: row.noteId ?? room?.noteId ?? null }, "done"));
  }

  /** It could not join, or was put out: "failed" with why, a push saying so, and whatever was heard still organised. Once. */
  private async fail(id: string, subCode: string): Promise<void> {
    const m = await this.store.get(id);
    if (!m || OVER.has(m.status)) return;
    const why = whyFailed(subCode);
    const room = this.close(m.id);
    if (room) await this.settle(room);
    const came = room?.cameNames() ?? [];
    const row = (await this.store.update(m.id, { status: "failed", error: why, endedAt: this.now(), ...(came.length ? { participants: came } : {}) }))
      ?? { ...m, status: "failed" as const, error: why };
    this.publish(m.userId, m.byId);
    await this.push(m.userId, {
      kind: "meet_failed", key: `${m.id}:failed`, vars: { title: m.title || "Your meeting", name: room?.botName ?? await this.botNameOf(m), why }, data: { m: m.id },
    });
    const noteId = row.noteId ?? room?.noteId ?? null;
    if (noteId) this.track(this.writeUp({ ...row, noteId }, null));
  }

  /** A closed room's last lines written, and its list of people saved. */
  private async settle(room: Room): Promise<void> {
    await this.flush(room);
    await room.peopleChain?.catch(() => undefined);
  }

  /**
   * The note of a meeting that is over: organised when it has a transcript (a push when it is ready), deleted when nothing was said.
   * `then` is the meeting's status after ("done"), or null to leave it as it is (a failed meeting stays failed).
   */
  private async writeUp(m: Meeting, then: "done" | null): Promise<void> {
    const user: AuthedUser = { id: m.userId };
    try {
      const note = m.noteId ? await getNote(user, m.noteId) : null;
      if (!note || !note.transcript.some((s) => s.text.trim())) {
        // Nobody said anything: no note to keep, no push.
        if (note) await deleteNote(user, note.id);
        if (then || note) await this.store.update(m.id, { ...(then ? { status: then } : {}), ...(note ? { noteId: null } : {}) });
        return;
      }
      const started = m.startedAt ?? Date.parse(note.startedAt);
      const ended = m.endedAt ?? this.now();
      await updateNote(user, note.id, (n) => ({
        ...n,
        status: "organising",
        endedAt: new Date(ended).toISOString(),
        durationSeconds: Number.isFinite(started) ? Math.max(0, Math.round((ended - started) / 1000)) : n.durationSeconds,
      }));
      let organised: Note | null = null;
      try {
        organised = await this.organise(m.userId, note.id);
      } catch (err) {
        console.warn(`[meet] a meeting's note could not be organised: ${said(err)}`);
        await updateNote(user, note.id, (n) => ({ ...n, status: "failed" })).catch(() => null);
      }
      if (then) await this.store.update(m.id, { status: then });
      if (organised?.status === "ready") {
        await this.push(m.userId, {
          kind: "meet_ready", key: `${m.id}:ready`, vars: { title: organised.title || m.title || "Your meeting" }, data: { id: note.id },
        });
      }
    } catch (err) {
      console.warn(`[meet] a meeting's write-up failed: ${said(err)}`);
      if (then) await this.store.update(m.id, { status: then }).catch(() => null);
    } finally {
      this.publish(m.userId, m.byId);
    }
  }

  // ------------------------------------------------------------------ Recall's live events

  /** The live transcript, the chat, who joins and leaves, for the meeting with this token. Never throws. */
  async onLive(token: string, body: unknown): Promise<void> {
    try {
      if (typeof token !== "string" || !TOKEN.test(token)) return;
      const room = await this.roomByToken(token);
      if (!room || room.closed) return;
      const botId = botIdOf(body);
      if (botId && !room.botId) {
        room.botId = botId;
        this.track(this.store.update(room.id, { botId }));
      }
      switch (eventOf(body)) {
        case "transcript.data":
          this.onHeard(room, heardOf(body));
          return;
        case "participant_events.chat_message":
          this.onChat(room, chatOf(body));
          return;
        case "participant_events.join": {
          const p = personOf(body);
          if (p && p.name !== room.botName && room.arrive(p)) this.savePeople(room);
          return;
        }
        case "participant_events.leave": {
          const p = personOf(body);
          if (p && room.depart(p)) this.savePeople(room);
          return;
        }
        default:
          return;
      }
    } catch (err) {
      console.warn(`[meet] a live event failed: ${said(err)}`);
    }
  }

  private onHeard(room: Room, h: Heard | null): void {
    // Nothing said, or the bot's own voice.
    if (!h || h.who.name === room.botName) return;
    room.hear({ who: h.who.name, text: h.text, at: h.at });
    room.keep({ at: h.at, text: h.text, speaker: h.who.name });
    if (room.arrive(h.who)) this.savePeople(room);
    this.flushSoon(room);

    const to = addressed(h.text, room.wake);
    const who = h.who.id || h.who.name;
    const now = this.now();
    // Their name said alone a moment ago: this line of theirs is the question.
    const follows = !to.to && room.waitingFor !== null && room.waitingFor.who === who && now <= room.waitingFor.until;
    // Someone talking over the bot, not to it: it stops.
    if (!to.to && !follows && h.words >= 4 && this.stage.speaking(room.id)) this.stage.stop(room.id);
    if (to.to) {
      room.waitingFor = null;
      const command = commandOf(to.asked);
      if (command) return this.command(room, command);
      if (!to.asked) {
        room.waitingFor = { who, until: now + WAKE_WAIT_MS };
        return;
      }
      return this.ask(room, { who: h.who.name, asked: to.asked, how: "voice", at: h.at });
    }
    if (follows) {
      room.waitingFor = null;
      const command = commandOf(h.text);
      if (command) return this.command(room, command);
      this.ask(room, { who: h.who.name, asked: h.text, how: "voice", at: h.at });
    }
  }

  /** A chat message is a question when it was written to the bot alone, or names it. It never goes in the note. */
  private onChat(room: Room, c: Chat | null): void {
    if (!c || c.who.name === room.botName) return;
    if (room.arrive(c.who)) this.savePeople(room);
    const to = addressed(c.text, room.wake);
    if (!c.toBot && !to.to) return;
    const asked = to.to ? to.asked : c.text;
    const command = commandOf(asked);
    if (command) return this.command(room, command);
    this.ask(room, { who: c.who.name, asked, how: "chat", at: c.at || room.lastAt() });
  }

  /** "Stop": quiet at once, and what was waiting is dropped. "Leave": a goodbye in the chat, and out of the call. */
  private command(room: Room, command: "stop" | "leave"): void {
    if (command === "stop") {
      room.queue.length = 0;
      this.stage.stop(room.id);
      return;
    }
    this.track(this.leaveAsked(room, GOODBYE));
  }

  private async leaveAsked(room: Room, goodbye: string): Promise<void> {
    if (room.leaving || room.closed) return;
    this.markLeaving(room.id);
    await this.chat(room, goodbye).catch((err) => console.warn(`[meet] a goodbye could not be sent: ${said(err)}`));
    if (room.botId && this.recall) await this.recall.leaveCall(room.botId).catch((err) => console.warn(`[meet] a bot could not leave: ${said(err)}`));
  }

  /** Told to leave: it stops talking and answers nothing more. Its status stays until Recall says the call ended. */
  private markLeaving(id: string): void {
    this.leavingIds.add(id);
    const room = this.rooms.get(id);
    if (!room) return;
    room.leaving = true;
    room.queue.length = 0;
    room.waitingFor = null;
    this.stage.stop(id);
  }

  // ------------------------------------------------------------------ answering

  /** One answer at a time per meeting; two more may wait, and the rest are dropped. */
  private ask(room: Room, q: Ask): void {
    if (room.closed || room.leaving) return;
    if (room.answering) {
      if (room.queue.length < QUEUE_MAX) room.queue.push(q);
      return;
    }
    room.answering = true;
    this.track(this.answerAll(room, q));
  }

  private async answerAll(room: Room, first: Ask): Promise<void> {
    try {
      for (let q: Ask | undefined = first; q; q = room.closed || room.leaving ? undefined : room.queue.shift()) await this.answer(room, q);
    } finally {
      room.answering = false;
      if (room.closed || room.leaving) room.queue.length = 0;
    }
  }

  private async answer(room: Room, q: Ask): Promise<void> {
    this.stage.state(room.id, "Thinking…");
    try {
      await asPerson(room.userId, () => chargedTo(room.userId, "meet", async () => {
        const a = await this.brain.answer({
          who: q.who, asked: q.asked, how: q.how, botName: room.botName, owner: room.owner || SOMEONE, title: room.title,
          participants: room.names(), lines: room.lines.slice(),
        });
        if (room.closed) return;
        if (a.intent === "leave") return this.leaveAsked(room, a.reply || GOODBYE);
        if (a.intent === "stop") {
          this.stage.stop(room.id);
          return;
        }
        const reply = a.reply.trim();
        if (!reply) return;
        this.keepAnswer(room, q, reply);
        // Out loud when its voice is on and the stage is open; in the chat otherwise, or when the voice could not be made or played.
        if (q.how === "voice" && room.voice && this.stage.connected(room.id) && (await this.speak(room, reply))) return;
        await this.chat(room, reply);
      }));
    } catch (err) {
      console.warn(`[meet] an answer failed: ${said(err)}`);
      if (!room.closed) await this.chat(room, SORRY).catch(() => undefined);
    } finally {
      if (!room.closed) this.stage.state(room.id, "Listening");
    }
  }

  /** The answer said through the stage. False when it could not be (no voice, or the page went away), so the chat has it instead. */
  private async speak(room: Room, reply: string): Promise<boolean> {
    try {
      const clip = await this.tts(reply);
      if (room.closed) return true;
      return (await this.stage.play(room.id, { text: reply, audio: clip.audio, contentType: clip.contentType })) !== "no_stage";
    } catch (err) {
      console.warn(`[meet] a spoken answer failed: ${said(err)}`);
      return false;
    }
  }

  /** The bot's answer is part of the meeting: in the transcript under its name, and among what was asked of it. */
  private keepAnswer(room: Room, q: Ask, reply: string): void {
    const at = q.at || room.lastAt();
    room.hear({ who: room.botName, text: reply, at });
    room.keep({ at, text: reply, speaker: room.botName });
    this.flushSoon(room);
    this.track(this.store.addAsk(room.id, { askedBy: q.who, question: q.asked, answer: reply, how: q.how, at: this.now() }));
  }

  /** Written in the meeting's chat, in parts when it is long. Nothing when the bot is not known yet. */
  private async chat(room: Room, message: string): Promise<void> {
    if (!this.recall || !room.botId) return;
    for (const part of chatParts(message)) await this.recall.sendChat(room.botId, part);
  }

  // ------------------------------------------------------------------ the note and the notes so far

  /** Written with the timer, or at once when a batch is full. */
  private flushSoon(room: Room): void {
    if (room.closed) return;
    if (room.buffer.length >= FLUSH_LINES) {
      this.track(this.flush(room));
      return;
    }
    if (room.flushTimer) return;
    room.flushTimer = setTimeout(() => {
      room.flushTimer = null;
      this.track(this.flush(room));
    }, this.flushMs);
    room.flushTimer.unref?.();
  }

  /** The lines waiting, appended to the note: one write after another, so they land in the order they were said. */
  private flush(room: Room): Promise<void> {
    if (room.flushTimer) {
      clearTimeout(room.flushTimer);
      room.flushTimer = null;
    }
    const run = room.flushChain.then(() => this.write(room));
    room.flushChain = run.catch(() => undefined);
    return run;
  }

  private async write(room: Room): Promise<void> {
    if (!room.buffer.length) return;
    const segs = room.buffer.splice(0);
    if (room.noteGone) return;
    try {
      const noteId = await this.ensureNote(room);
      if (!noteId) throw new Error("the meeting has no note");
      const words = segs.reduce((n, s) => n + countWords(s.text), 0);
      const last = segs.reduce((n, s) => Math.max(n, s.at), 0);
      const saved = await updateNote({ id: room.userId }, noteId, (n) => ({
        ...n, transcript: [...n.transcript, ...segs], words: n.words + words, durationSeconds: Math.max(n.durationSeconds, Math.round(last)),
      }));
      // The person deleted the note while the call went on: nothing more is written to it.
      if (!saved) room.noteGone = true;
    } catch (err) {
      console.warn(`[meet] a meeting's lines could not be written: ${said(err)}`);
      room.putBack(segs);
    }
  }

  /** The meeting's note, made once (in the call, or at the first line that needs it), titled with the meeting's title. */
  private ensureNote(room: Room): Promise<string | null> {
    if (room.noteId) return Promise.resolve(room.noteId);
    if (room.noteGone) return Promise.resolve(null);
    if (!room.noteMaking) {
      room.noteMaking = this.makeNote(room)
        .catch((err): null => { console.warn(`[meet] a meeting's note could not be made: ${said(err)}`); return null; })
        .finally(() => { room.noteMaking = null; });
    }
    return room.noteMaking;
  }

  private async makeNote(room: Room): Promise<string> {
    const user: AuthedUser = { id: room.userId };
    const note = await createNote(user, new Date(room.startedAt ?? this.now()));
    if (room.title) await updateNote(user, note.id, (n) => ({ ...n, title: room.title }));
    room.noteId = note.id;
    await this.store.update(room.id, { noteId: note.id });
    this.publish(room.userId, room.byId);
    return note.id;
  }

  /** Every notesEveryMs while the call goes on, when enough was said since the last pass. */
  private notesTick(room: Room): void {
    if (room.closed || room.notesRunning || room.heard - room.notesAt < NOTES_MIN_LINES) return;
    room.notesRunning = true;
    this.track(this.notesPass(room).finally(() => { room.notesRunning = false; }));
  }

  private async notesPass(room: Room): Promise<void> {
    const upto = room.heard;
    try {
      const notes = await asPerson(room.userId, () => chargedTo(room.userId, "meet", () => this.brain.liveNotes(room.lines.slice(), room.title)));
      if (!notes || room.closed) return;
      room.notesAt = upto;
      await this.store.update(room.id, { liveNotes: { points: notes.points, actions: notes.actions, at: this.now() } });
      this.publish(room.userId, room.byId);
    } catch (err) {
      console.warn(`[meet] the notes so far could not be written: ${said(err)}`);
    }
  }

  /** Who is in the call, saved on the row: one write at a time, the last one with the list as it is then. */
  private savePeople(room: Room): void {
    room.peopleDirty = true;
    if (room.peopleChain || room.closed) return;
    room.peopleChain = this.writePeople(room);
    this.track(room.peopleChain);
  }

  private async writePeople(room: Room): Promise<void> {
    try {
      while (room.peopleDirty && !room.closed) {
        room.peopleDirty = false;
        await this.store.update(room.id, { participants: room.names() });
        this.publish(room.userId, room.byId);
      }
    } catch (err) {
      console.warn(`[meet] who is in a call could not be saved: ${said(err)}`);
    } finally {
      // In the same step the loop ends in, so a change that comes after is never left to a loop that has already finished.
      room.peopleChain = null;
    }
  }

  // ------------------------------------------------------------------ rooms

  private async roomByToken(token: string): Promise<Room | null> {
    const hash = hashToken(token);
    const id = this.byHash.get(hash);
    const known = id ? this.rooms.get(id) : undefined;
    if (known) return known;
    const m = await this.store.byTokenHash(hash);
    if (!m || OVER.has(m.status)) return null;
    return this.roomFor(m);
  }

  /** The meeting's room, made once (two events at the same moment get the same one). */
  private roomFor(m: Meeting): Promise<Room> {
    const have = this.rooms.get(m.id);
    if (have) return Promise.resolve(have);
    let made = this.building.get(m.id);
    if (!made) {
      made = this.build(m).finally(() => { this.building.delete(m.id); });
      this.building.set(m.id, made);
    }
    return made;
  }

  /** A room from the meeting's row: after a restart, its transcript so far from the note. */
  private async build(m: Meeting): Promise<Room> {
    const settings = await this.store.settings(m.userId).catch(() => null);
    const room = new Room(m, settings?.botName || DEFAULT_BOT_NAME, await this.owner(m.userId));
    if (m.noteId) {
      let note: Note | null | undefined;
      try { note = await getNote({ id: m.userId }, m.noteId); } catch { note = undefined; }
      if (note) room.resume(note.transcript);
      else if (note === null) room.noteGone = true;
    }
    // Over while it was being made: a closed room, which hears nothing.
    if (this.ended.has(m.id)) {
      room.closed = true;
      return room;
    }
    if (this.leavingIds.has(m.id)) room.leaving = true;
    this.rooms.set(m.id, room);
    this.byHash.set(m.tokenHash, m.id);
    room.notesTimer = setInterval(() => this.notesTick(room), this.notesEveryMs);
    room.notesTimer.unref?.();
    return room;
  }

  /** The meeting is over here: its room closed and forgotten (and handed back, for its last lines), its stage told. */
  private close(id: string): Room | undefined {
    this.ended.add(id);
    if (this.ended.size > ENDED_MAX) this.ended.delete(this.ended.values().next().value as string);
    this.leavingIds.delete(id);
    const room = this.rooms.get(id);
    if (room) {
      room.closed = true;
      room.queue.length = 0;
      room.waitingFor = null;
      if (room.flushTimer) clearTimeout(room.flushTimer);
      room.flushTimer = null;
      if (room.notesTimer) clearInterval(room.notesTimer);
      room.notesTimer = null;
      this.rooms.delete(id);
      this.byHash.delete(room.tokenHash);
    }
    try { this.stage.close(id); } catch { /* the stage's own trouble */ }
    return room;
  }

  // ------------------------------------------------------------------ the rest

  /**
   * The row of a meeting to ask about, and Recall's bot for it: the owner's settings (its voice, its name), and the owner's first name in
   * its introduction. One a space's admin sends for a member names the admin and the space.
   */
  private async prepare(userId: string, o: {
    link: MeetingLink; title?: string; voice?: boolean; source: "link" | "calendar"; eventKey?: string; joinAt?: number;
    byId?: string; spaceId?: string; owner?: string;
  }): Promise<{ meeting: Meeting; bot: BotInput }> {
    const cfg = getConfig();
    const settings = await this.store.settings(userId);
    const botName = settings.botName || DEFAULT_BOT_NAME;
    const owner = o.owner ?? (await this.owner(userId));
    const voice = typeof o.voice === "boolean" ? o.voice : settings.voice;
    // The meeting's key: in its bot's addresses, kept here only as a hash.
    const token = randomBytes(24).toString("base64url");
    const now = this.now();
    const meeting: Meeting = {
      id: randomUUID(), userId, botId: null, tokenHash: hashToken(token), url: o.link.url, platform: o.link.platform,
      title: cleanText(o.title, 200), status: o.source === "calendar" ? "scheduled" : "joining", voice, source: o.source,
      eventKey: o.eventKey ?? null, joinAt: o.joinAt ?? null, startedAt: null, endedAt: null, noteId: null, liveNotes: null,
      participants: [], error: null, createdAt: now, updatedAt: now, spaceId: o.spaceId ?? null, byId: o.byId ?? null,
    };
    const bot: BotInput = {
      meetingUrl: o.link.url,
      botName,
      ...(o.joinAt !== undefined ? { joinAt: new Date(o.joinAt).toISOString() } : {}),
      metadata: { meeting: meeting.id },
      // Recall wants the trailing slash: without it the address is redirected, and a redirected webhook is lost.
      liveUrl: `${this.origin}/v1/meet/live/${token}/`,
      ...(voice ? { stageUrl: `${this.origin}/v1/meet/stage/${token}` } : {}),
      variant: cfg.MEET_SPEAKING_VARIANT,
      intro: introLine(botName, owner),
      language: cfg.MEET_LANGUAGE,
    };
    return { meeting, bot };
  }

  /** Recall's bot for a meeting just added, in the background: its id kept; called off if the person left meanwhile; or "failed", with why. */
  private async send(m: Meeting, input: BotInput): Promise<void> {
    let made: RecallBot;
    try {
      made = await this.recall!.createBot(input);
    } catch (err) {
      const cur = await this.store.get(m.id).catch(() => null);
      if (cur && cur.status === "joining" && !cur.botId) {
        await this.store.update(m.id, { status: "failed", error: failText(err), endedAt: this.now() }).catch(() => null);
      }
      this.publish(m.userId, m.byId);
      return;
    }
    const row = await this.store.update(m.id, { botId: made.id });
    if (row?.status === "cancelled") await this.callOff(made.id).catch((err) => console.warn(`[meet] a bot could not be called off: ${said(err)}`));
    this.publish(m.userId, m.byId);
  }

  /** A bot not yet sent is deleted; one Recall has already sent (405) is asked to leave instead. */
  private async callOff(botId: string): Promise<void> {
    if (!this.recall) return;
    if (!(await this.recall.deleteBot(botId))) await this.recall.leaveCall(botId);
  }

  private async own(userId: string, id: string): Promise<Meeting> {
    const m = UUID.test(id) ? await this.store.get(id) : null;
    if (!m || m.userId !== userId) throw new MeetError(404, "No such meeting.", "not_found");
    return m;
  }

  /** A meeting the viewer may send its bot away from or call off: theirs, or one they sent for a member who is still theirs to look after. */
  private async stoppable(viewer: string, id: string): Promise<{ m: Meeting; owner?: Member } | null> {
    const m = UUID.test(id) ? await this.store.get(id) : null;
    if (!m) return null;
    if (m.userId === viewer) return { m };
    if (!m.byId || m.byId !== viewer) return null;
    const owner = (await this.membersOf(viewer)).find((p) => p.userId === m.userId);
    return owner ? { m, owner } : null;
  }

  // ------------------------------------------------------------------ in a space

  /** The members of the spaces they are the admin of (people.ts); nobody when that can't be read. */
  private async membersOf(adminId: string): Promise<Member[]> {
    try { return await this.people.membersOf(adminId); } catch (err) {
      console.warn(`[meet] a space's members could not be read: ${said(err)}`);
      return [];
    }
  }

  /** The admins of the spaces they are a member of, by id, with their names as those spaces have them. */
  private async adminNames(memberId: string): Promise<Map<string, string>> {
    try {
      return new Map((await this.people.adminsOf(memberId)).map((a) => [a.userId, a.name]));
    } catch (err) {
      console.warn(`[meet] a member's admins could not be read: ${said(err)}`);
      return new Map();
    }
  }

  /**
   * A meeting as the viewer sees it: whose it is, when it is not theirs (a member's, seen by their admin), and who sent the bot, when that
   * was a space's admin and not the viewer ("Sent by Aanya"). The sender's name is as the owner's space has it, else their own first name.
   */
  private async viewFor(viewer: string, m: Meeting, o: { owner?: Member; senders?: Map<string, string> } = {}): Promise<MeetingView> {
    const v = viewOf(m);
    if (m.userId !== viewer) {
      const owner = o.owner ?? (await this.membersOf(viewer)).find((p) => p.userId === m.userId);
      if (owner) v.owner = { id: owner.userId, name: owner.name };
    }
    if (m.byId && m.byId !== viewer) {
      // The names the caller already has (a list of meetings), or the owner's admins read now (one meeting).
      const known = o.senders ? o.senders.get(m.byId) : (await this.adminNames(m.userId)).get(m.byId);
      v.by = known || (await this.owner(m.byId)) || "your space's admin";
    }
    return v;
  }

  /** The meetings of the members they see: each member's latest few (none called off), newest first, at most PEOPLE_MAX. */
  private async peopleMeetings(viewer: string, members: Member[]): Promise<MeetingView[]> {
    const all: Array<{ m: Meeting; owner: Member }> = [];
    for (const owner of members) {
      const list = await this.store.list(owner.userId, PEOPLE_EACH).catch(() => [] as Meeting[]);
      for (const m of list) if (m.status !== "cancelled") all.push({ m, owner });
    }
    all.sort((a, b) => whenOf(b.m) - whenOf(a.m));
    // Who sent which: the senders other than the viewer are named once each (a member of two spaces may have two admins).
    const senders = new Map<string, string>();
    const views: MeetingView[] = [];
    for (const { m, owner } of all.slice(0, PEOPLE_MAX)) {
      if (m.byId && m.byId !== viewer && !senders.has(m.byId)) {
        senders.set(m.byId, (await this.adminNames(m.userId)).get(m.byId) || (await this.owner(m.byId)) || "Someone");
      }
      views.push(await this.viewFor(viewer, m, { owner, senders }));
    }
    return views;
  }

  /**
   * A member took the bot to a meeting (their own link, or their calendar): each admin who sees their meetings is pushed, with the
   * member's name and the meeting's title, never a word of the call. Not for one an admin sent.
   */
  private async tellAdmins(m: Meeting): Promise<void> {
    if (m.byId) return;
    let admins: Array<{ userId: string; memberName: string }>;
    try { admins = await this.people.adminsOf(m.userId); } catch (err) {
      console.warn(`[meet] a member's admins could not be read: ${said(err)}`);
      return;
    }
    for (const a of admins) {
      if (a.userId === m.userId) continue;
      await this.push(a.userId, {
        kind: "space_meet", key: `${m.id}:admin:${a.userId}`, vars: { name: a.memberName || "Someone", title: m.title || "a meeting" }, data: { m: m.id },
      });
      this.publish(a.userId);
    }
  }

  /** A space's admin sent the bot to a member's meeting: the member is told who, and to what. */
  private async tellMember(m: Meeting, adminId: string): Promise<void> {
    const name = (await this.owner(adminId)) || firstWord((await this.adminNames(m.userId)).get(adminId)) || "Your space's admin";
    await this.push(m.userId, {
      kind: "space_meet_sent", key: `${m.id}:sent`, vars: { name, title: m.title || "your meeting" }, data: { m: m.id },
    });
  }

  /** The person's first name, or "" (never an error). */
  private async owner(userId: string): Promise<string> {
    try { return cleanText(await this.ownerName(userId), 40); } catch { return ""; }
  }

  private async botNameOf(m: Meeting): Promise<string> {
    const room = this.rooms.get(m.id);
    if (room) return room.botName;
    const settings = await this.store.settings(m.userId).catch(() => null);
    return settings?.botName || DEFAULT_BOT_NAME;
  }

  /** Minutes of the person's meetings that started in the last 24 hours (one still going counts up to now). */
  private minutesIn(all: readonly Meeting[]): number {
    const now = this.now();
    let ms = 0;
    for (const m of all) {
      if (m.startedAt === null || m.startedAt < now - DAY_MS || m.startedAt > now) continue;
      ms += Math.max(0, (m.endedAt ?? now) - m.startedAt);
    }
    return ms / 60_000;
  }

  private async push(userId: string, msg: Parameters<MeetNotify>[1]): Promise<void> {
    try { await this.notify(userId, msg); } catch { /* a missed push is not a lost meeting: it is on the meeting's page */ }
  }

  /** The meeting bot's pages hear of a change: the owner's, and the space admin's who sent the bot, when one did. */
  private publish(userId: string, also?: string | null): void {
    livePublish(userId, [botTopic(MEET_SLUG)]);
    if (also && also !== userId) livePublish(also, [botTopic(MEET_SLUG)]);
  }

  /** Work that goes on after its caller has its answer: never an unhandled rejection, and idle() waits for it. */
  private track(work: Promise<unknown>): void {
    const job: Promise<void> = work
      .then(() => undefined, (err: unknown) => { console.warn(`[meet] background work failed: ${said(err)}`); })
      .finally(() => { this.busy.delete(job); });
    this.busy.add(job);
  }
}

/** The person's first name, from their profile ("" when there is none). */
async function firstNameOf(userId: string): Promise<string> {
  const p = await getProfile({ id: userId });
  return (p.fullName ?? "").trim().split(/\s+/)[0] ?? "";
}

let shared: MeetService | null = null;
let sharedPeople: MeetPeople | null = null;

/** The server's shared instance when recall() is set (store meetStore(), brain(), stageHub() from ./stage.js), else null. */
export function meetService(): MeetService | null {
  if (shared) return shared;
  const client = recall();
  if (!client) return null;
  shared = new MeetService({
    store: meetStore(), recall: client, brain: brain(), stage: stageHub(), ownerName: firstNameOf, ...(sharedPeople ? { people: sharedPeople } : {}),
  });
  return shared;
}

/** Who is whose space admin, for the server's instance: set on it now, or kept for it if it is not made yet (server.ts, once Spaces is). */
export function setMeetPeople(p: MeetPeople): void {
  sharedPeople = p;
  shared?.setPeople(p);
}
