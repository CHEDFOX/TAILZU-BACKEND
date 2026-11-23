/**
 * ASK'S FLOW, DECIDED HERE (AgentFlow, the `flow` event; docs in shared/types/api.ts).
 *
 * The desktop used to decide how a run goes on its own: whether the card listens again after an answer, how long it
 * waits, whether a command's ordinary steps need a yes, whether to look at a clip or a picture first, whether an ASK's
 * answer opens the microphone. Those are product decisions, so they are made here, from the question's words, the app
 * and config (AGENT_FLOW_*), and sent to a desktop that asked for them. Safety floors stay on the device.
 *
 * Media is decided by readable word rules, ported from the desktop (resolver.js isVisualQuestion, run/video.js
 * wantsClip): a question about something MOVING in a player, or naming a video, is a clip; one about something DRAWN
 * (an equation, a chart, "what's this?") is a picture; anything else, and every order, is answered from the words.
 * The window's title never comes here, so a player is known by the app's label ("VLC", "Chrome: YouTube").
 */
import type { AgentFlow, AgentStepRequest } from "../../../shared/types/api.js";
import { commandText, modeOf, wantsWords } from "./grammar.js";
import { paysOrDeletes } from "./risk.js";

/** The policies, from config (flowPolicy) or a test. */
export interface FlowPolicy {
  /** Kinds of answer after which a conversation listens again: question, command, words, picture. */
  listenAfter: ReadonlySet<string>;
  idleMs: number;
  /** A command with nothing that pays or deletes is their yes for its ordinary steps. */
  trustCommands: boolean;
  /** Ask the device for a clip or a picture when the words want one. */
  media: boolean;
  clipSeconds: number;
  players: readonly string[];
  /** "" leaves it to the device. */
  askReplyMic: "" | "open" | "key";
}

export const PLAYERS: readonly string[] = [
  "VLC", "QuickTime Player", "IINA", "mpv", "Infuse", "Elmedia", "Movist", "Media Player", "Movies & TV", "Films & TV",
  "Windows Media Player", "PotPlayer", "MPC-HC", "MPC-BE", "KMPlayer", "GOM Player", "SMPlayer", "Kodi", "Plex",
  "YouTube", "Netflix", "Prime Video", "Disney+", "Hulu", "Max", "Twitch", "Vimeo", "TikTok", "Dailymotion",
];

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function flowPolicy(cfg: {
  AGENT_FLOW_LISTEN_AFTER: string; AGENT_FLOW_IDLE_MS: number; AGENT_FLOW_TRUST_COMMANDS: boolean;
  AGENT_FLOW_MEDIA: boolean; AGENT_FLOW_CLIP_SECONDS: number; AGENT_FLOW_VIDEO_APPS: string; AGENT_FLOW_ASK_REPLY_MIC: string;
}): FlowPolicy {
  const mic = cfg.AGENT_FLOW_ASK_REPLY_MIC;
  return {
    listenAfter: new Set(list(cfg.AGENT_FLOW_LISTEN_AFTER).map((k) => k.toLowerCase())),
    idleMs: cfg.AGENT_FLOW_IDLE_MS,
    trustCommands: cfg.AGENT_FLOW_TRUST_COMMANDS,
    media: cfg.AGENT_FLOW_MEDIA,
    clipSeconds: cfg.AGENT_FLOW_CLIP_SECONDS,
    players: cfg.AGENT_FLOW_VIDEO_APPS.trim() ? list(cfg.AGENT_FLOW_VIDEO_APPS) : PLAYERS,
    askReplyMic: mic === "open" || mic === "key" ? mic : "",
  };
}

// ---- a question about a picture (desktop resolver.js isVisualQuestion) ---------------------------------------------

const VISUAL_NOUNS = [
  "equations?", "formula[es]?", "integrals?", "derivatives?", "matri(?:x|ces)", "graphs?",
  "(?:bar |pie |line )?charts?", "plots?", "diagrams?", "figures?(?! out\\b)", "pictures?", "pics?", "images?",
  "photos?", "photographs?", "screenshots?", "drawings?", "sketch(?:es)?", "illustrations?",
  "infographics?", "flow ?charts?", "schematics?", "maps?", "memes?", "logos?", "icons?", "handwriting",
  "paintings?", "artworks?", "visuali[sz]ations?", "curves?", "histograms?", "geometry", "triangles?",
  "symbols?", "(?:maths?|geometry|physics|chemistry) (?:problem|question|sum)s?",
];
/** …unless the noun only names a control: "the image button", "chart settings". */
const UI_AFTER = "(?:button|tab|menu|link|options?|settings?|field|box|toggle|switch|panel|tools?|toolbar|view|mode|type|format|editor|icon|bar|picker|size|file|folder|layer|style|filter)";
const VISUAL_NOUN = new RegExp(`\\b(?:${VISUAL_NOUNS.join("|")})\\b(?!\\s+${UI_AFTER}\\b)`);
const ABOUT_A_PICTURE = /^(?:describe|read|interpret|analy[sz]e|summari[sz]e|break down|walk me through|go through|transcribe|identify|translate|caption)\b|\b(?:samjhao|samjhaiye|samjha do|batao|bataiye)\b/;
const SOLVE = /\b(?:solve|integrate|differentiate|factori[sz]e|evaluate|calculate|compute|work (?:this|that|it) out|what(?:'s| is) the (?:answer|solution|value of|derivative|integral)|find (?:x|y|z|the (?:value|derivative|integral|area|slope|roots?|answer|solution)))\b/;
const JUST_THIS = /^(?:(?:what(?:'s| is| are)|whats) (?:this|that|these|those|it|here|on (?:my|the) screen|in (?:this|the) (?:picture|image|photo))|what am i (?:looking at|seeing)|(?:what(?:'s| is)|whats) (?:going on|happening) (?:here|on (?:my|the) screen)|who(?:'s| is| are) (?:this|that|these|those)|what do you see|describe (?:this|that|it|what you see|the screen)|look at (?:this|that)|can you see (?:this|that)|yeh? (?:kya|kaun) (?:hai|he|h))$/;
/** Finding, pressing or changing something: the tree answers it, however pictorial its name. */
export const FIND_OR_ACT = /^(?:where|wheres|find|locate|look for|point|click|press|tap|hit|select|choose|open|close|go to|scroll|show me (?!what|how|why)|help me find|i can'?t find|i cannot find|i don'?t see|turn|switch|enable|disable|delete|remove|send|share|save|download|upload|copy|paste|insert|add|crop|resize|rotate|move|drag)\b/;
const FIND_THE_ANSWER = /^find (?:x|y|z|the (?:value|derivative|integral|area|slope|roots?|answer|solution))\b/;
const PUT_IT = /(?:^|\b(?:and|then) )(?:then )?(?:type|write(?! out\b)|put|paste|fill(?: in)?|enter|send|reply|insert|post|submit)\b/;
/** How to do something TO a picture in this app: about controls, not what it shows. */
export const HOW_TO_DO = /^(?:how (?:do|can|could|would|should|did) (?:i|you|we|one)|how to|can i|could i|should i|is (?:there|it possible) (?:a way )?to|what happens (?:if|when) i)\s+(?:\w+\s+)?(?:insert|add|make(?! sense)|create|draw|change|edit|crop|resize|rotate|flip|delete|remove|save|export|import|upload|download|attach|replace|copy|paste|move|hide|print|share|send|format|align|embed|rename|duplicate|update|put|turn|set)\b/;

export function isVisualQuestion(said: string, names: string[] = []): boolean {
  const clean = commandText(said, names);
  if (!clean) return false;
  if (FIND_OR_ACT.test(clean) && !FIND_THE_ANSWER.test(clean)) return false;
  if (PUT_IT.test(clean) && modeOf(said, names) === "do") return false;
  if (JUST_THIS.test(clean) || SOLVE.test(clean)) return true;
  if (HOW_TO_DO.test(clean)) return false;
  if (!VISUAL_NOUN.test(clean)) return false;
  return modeOf(said, names) === "show" || ABOUT_A_PICTURE.test(clean);
}

// ---- a question about something moving (desktop run/video.js wantsClip) --------------------------------------------

const VIDEO_NOUN = /\b(?:videos?|clips?|movies?|films?|footage|trailers?|reels?|livestreams?|live ?streams?|gifs?|animations?|cartoons?|episodes?|vlogs?)\b/;
/** What goes on over time; only in a player (in a chat, "what's happening?" is about words). */
const MOTION = /\b(?:what(?:'s| is| was|s) (?:happening|going on|playing)|what (?:just )?happened|what(?:'s| is) (?:he|she|it|they) doing|what are (?:they|these|those|people) doing|watch (?:this|that|it)|who(?:'s| is| are) (?:speaking|talking|singing|playing)|what (?:are|is|did) (?:they|he|she) (?:saying|say|singing)|what (?:song|music|language) is (?:this|that|playing))\b/;
const ABOUT = /^(?:describe|explain|summari[sz]e|analy[sz]e|interpret|break down|walk me through|go through|transcribe|translate|identify|tell me about)\b/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The app's label names a player: a whole word or phrase of it, so "Max" is the player and "Maxwell's notes" is not. */
export function isPlayer(app: string, players: readonly string[] = PLAYERS): boolean {
  const names = players.map((p) => p.trim()).filter(Boolean);
  if (!names.length) return false;
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${names.map(escapeRe).join("|")})(?=$|[^\\p{L}\\p{N}])`, "iu").test(app);
}

/** Never for an order, nor for finding a control or how to do something. */
export function wantsClip(said: string, app: string, names: string[] = [], players: readonly string[] = PLAYERS): boolean {
  const clean = commandText(said, names);
  if (!clean) return false;
  if (modeOf(said, names) !== "show" && !ABOUT.test(clean)) return false;
  if (FIND_OR_ACT.test(clean) || HOW_TO_DO.test(clean)) return false;
  if (VIDEO_NOUN.test(clean)) return true;
  if (!isPlayer(app, players)) return false;
  return MOTION.test(clean) || isVisualQuestion(said, names);
}

// ---- the decisions ---------------------------------------------------------------------------------------------------

export interface FlowInput {
  req: AgentStepRequest;
  said: string;
  /** The run's first words, which its mode is read from. */
  first: string;
  mode: "show" | "do";
  /** Everything said in the run. */
  all: string;
  names: string[];
  /** The step carried a picture or a clip. */
  media: boolean;
}

/** The step's flow event, for a request that asked for version 1 or later. */
export function decideFlow(p: FlowPolicy, s: FlowInput): AgentFlow {
  const { req } = s;
  const kind = s.media ? "picture" : s.mode === "do" ? "command" : wantsWords(s.first, s.names) ? "words" : "question";
  const listen = p.listenAfter.has(kind);
  const flow: AgentFlow = { v: 1, afterAnswer: listen ? "listen" : "close" };
  if (listen) flow.idleMs = p.idleMs;
  flow.trusted = p.trustCommands && s.mode === "do" && !paysOrDeletes(s.all);
  // Only at a fresh question: once the run has acted, the screen is not the one the device pictured.
  const can = req.flow?.can ?? [];
  if (p.media && !s.media && !(req.history ?? []).some((t) => t.did)) {
    if (can.includes("clip") && !req.privateWindow && wantsClip(s.said, req.app, s.names, p.players)) {
      flow.media = "clip";
      flow.clipSeconds = p.clipSeconds;
    } else if (can.includes("picture") && isVisualQuestion(s.said, s.names)) flow.media = "picture";
    else flow.media = "none";
  }
  if (p.askReplyMic) flow.askReplyMic = p.askReplyMic;
  return flow;
}
