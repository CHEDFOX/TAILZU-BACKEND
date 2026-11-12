/**
 * THE MEETING BOT'S SHARED SHAPES (docs/meet.md): what its routes answer and its screens read, the stage its voice plays through, and the
 * pushes it sends. Every part of src/meet, routes/bots/meet.ts and the screens agree through these.
 *
 * Routes (routes/bots/meet.ts), the signed-in person's:
 *   GET    /v1/meet/overview                 -> MeetOverview
 *   POST   /v1/meet/join                     { url, title?, voice? } -> 201 { meeting: MeetingView }
 *   GET    /v1/meet/meetings/:id             -> MeetingDetail
 *   POST   /v1/meet/meetings/:id/leave       -> { meeting: MeetingView }
 *   PUT    /v1/meet/meetings/:id             { voice } -> { meeting: MeetingView }     (answers out loud, or in the chat, from now on)
 *   DELETE /v1/meet/meetings/:id             -> { ok: true }                            (a scheduled one: its bot is called off)
 *   PUT    /v1/meet/settings                 { autoJoin?, voice?, botName? } -> { settings: MeetSettings }
 * Recall's (signed with RECALL_WEBHOOK_SECRET, recall.ts verifyRecall):
 *   POST   /v1/meet/recall                   the bot's status (set in Recall's dashboard)
 *   POST   /v1/meet/live/:token/             the live transcript, the chat, who joins and leaves (each bot's own address)
 * The stage (the speaking bot's camera, Recall's Output Media; the meeting's token is its key):
 *   GET    /v1/meet/stage/:token                       the page
 *   GET    /v1/meet/stage/:token/events                server-sent events: say, stop, state
 *   GET    /v1/meet/stage/:token/clips/:clip           a spoken answer (audio/mpeg)
 *   POST   /v1/meet/stage/:token/clips/:clip/done      { how: "ended" | "stopped" }
 *
 * Screens: bots.bot with slug "meet" (screens/bots/meetPage.ts) and bots.meet.meeting, params { m } (screens/bots/meetScreens.ts).
 */
import type { LiveNotes, MeetAsk, MeetSettings, MeetStatus } from "./store.js";
import type { Platform } from "./words.js";

export type { LiveNotes, MeetAsk, MeetSettings, MeetStatus, Platform };

export const MEET_SLUG = "meet";
/** The meeting page's screen id (experience/bots/ids.ts SCREENS.meetMeeting). */
export const MEET_MEETING_SCREEN = "bots.meet.meeting";
/** The name the bot shows in a call when the person has not given it one. */
export const DEFAULT_BOT_NAME = "X0 Bot";

/** One meeting as the person sees it (never the bot's ids or the meeting's token). */
export interface MeetingView {
  id: string;
  title: string;
  platform: Platform;
  url: string;
  status: MeetStatus;
  voice: boolean;
  source: "link" | "calendar";
  joinAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  /** The meeting's note in Notes (bots.note, params { id }): its transcript as it goes, its summary and to-dos after. */
  noteId: string | null;
  participants: string[];
  /** Why it could not join, in a few words for a person. */
  error: string | null;
  liveNotes: LiveNotes | null;
}

export interface MeetOverview {
  settings: MeetSettings;
  /** The name it shows in calls (the settings' or DEFAULT_BOT_NAME). */
  botName: string;
  /** Joining, waiting to be let in, or in the call. */
  live: MeetingView[];
  /** Scheduled, soonest first. */
  upcoming: MeetingView[];
  /** Over (done, ended, failed), newest first, at most 20. */
  recent: MeetingView[];
  minutesToday: number;
  minutesCap: number;
  /** Whether its calendar can be read (Google Calendar connected), for auto-join. */
  calendar: boolean;
}

export interface MeetingDetail { meeting: MeetingView; asks: MeetAsk[] }

/** A spoken answer, played through the stage page. */
export interface ClipInput { text: string; audio: Buffer; contentType: string }

/**
 * The stage: the page Recall's bot shows as its camera, whose sound is the bot's voice. src/meet/stage.ts keeps the pages that are open
 * (one per meeting, a server-sent event stream each) and the clips they fetch.
 */
export interface StageHub {
  /** A stage page is open for this meeting: the bot can speak. */
  connected(meetingId: string): boolean;
  /**
   * Plays a clip in the meeting: the page is told to fetch it and play it. Resolves "played" when the page says it ended, "stopped"
   * when stop() or the page cut it short, "no_stage" at once when no page is open; after the clip's length and some slack at the most.
   */
  play(meetingId: string, clip: ClipInput): Promise<"played" | "stopped" | "no_stage">;
  /** Whether a clip is playing now. */
  speaking(meetingId: string): boolean;
  /** Stops what is playing. */
  stop(meetingId: string): void;
  /** What the page says under the bot's name: "Listening", "Thinking…", "Taking notes for Aanya". */
  state(meetingId: string, label: string): void;
  /** The routes': a page opened its event stream. `send` writes one event; the returned function is called when it closes. */
  open(meetingId: string, send: (event: "say" | "stop" | "state", data: Record<string, unknown>) => void): () => void;
  /** The routes': a clip's audio, while it is wanted (a few minutes). */
  clip(meetingId: string, clipId: string): { audio: Buffer; contentType: string } | null;
  /** The routes': the page says a clip ended or was cut short. */
  done(meetingId: string, clipId: string, how: "ended" | "stopped"): void;
  /** The meeting is over: its pages are told to stop, and its clips are forgotten. */
  close(meetingId: string): void;
}

export type MeetPushKind = "meet_ready" | "meet_waiting" | "meet_failed";
/**
 * A push (push/defaults.ts, you/push.ts). meet_ready: { title } -> bots.note { id: noteId }; meet_waiting: { title, name } and
 * meet_failed: { title, name, why } -> bots.meet.meeting { m }. Never a word of what was said.
 */
export type MeetNotify = (userId: string, msg: { kind: MeetPushKind; key: string; vars: Record<string, string>; data: Record<string, string> }) => Promise<unknown>;
