/**
 * The You area's computer screen, on the phone and in the window (computerPhone, computerDesk).
 */

import type { Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, botAvatar, title, card, text, meta, button, page, emptyState, listCard, col, row, icon, box, C, listRow, quietButton, call,
  seq, sectionLabel, infoChip,
} from "../../kit.js";
import { botOf, plural, DAY_MS, openUrl, couldNot, toast, refresh, oops, heading, columns } from "./parts.js";

export interface ComputersData {
  online: Array<{ deviceId: string; name: string; os: string; allowRun: boolean; busy: boolean; projects: "all" | "most" | number; liveOnly: boolean; container: boolean }>;
  offline: Array<{ deviceId: string; name: string; os: string; lastSeen: number }>;
  /** The desktop app signed in as them while its runner is off ("Your Mac"). */
  signedIn?: Array<{ deviceId: string; name: string; os: string; lastSeen: number }>;
  helped: { jobs: number; minutes: number };
}

const hours = (min: number) => (min < 60 ? `${min} min` : min % 60 >= 10 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${Math.floor(min / 60)} h`);

const avatar = (ctx: BotsCtx, slug: string, size = 24): Node => botAvatar(botOf(ctx, slug).look, size);

// ===================================================================== bots.computer
const DOWNLOAD_URL = `${(process.env.PUBLIC_ORIGIN || "https://api.x0bot.com").replace(/\/+$/, "")}/download`;

function onlineLine(c: ComputersData["online"][number], working: string | undefined): string {
  if (!c.allowRun) return "Online · not running jobs";
  if (c.busy) return working ? `Online · working on ${working}` : "Online · working for Xode";
  return "Online · ready for Xode";
}
const projectsLine = (p: ComputersData["online"][number]["projects"]) => (p === "all" ? "Every project" : p === "most" ? "All but a few" : plural(p, "project"));
const daysAgo = (ctx: BotsCtx, t: number) => {
  const days = Math.floor((ctx.live.now - t) / DAY_MS);
  return days < 1 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};
const codeWorking = (ctx: BotsCtx) => ctx.live.working.find((w) => w.bot === "code" && w.id.startsWith("job:"));

export function computerPhone(ctx: BotsCtx, d: ComputersData | undefined) {
  const head = [title("This computer helps")];
  const signedIn = d?.signedIn ?? [];
  const add = card([
    text("Add a computer", { size: 15, weight: 600 }),
    meta("On that computer, get X0 Bot and sign in as you.", { size: 13, lineHeight: 18 }),
    button("Get X0 Bot for computer", openUrl(DOWNLOAD_URL), { kind: "secondary", size: "md" }),
  ], { gap: 10 });
  if (!d) return page(ctx, { back: true, nav: "computer", title: "This computer helps", body: [...head, couldNot("your computers")] });
  if (!d.online.length && !d.offline.length && !signedIn.length) {
    return page(ctx, { back: true, nav: "computer", title: "This computer helps", body: [...head, emptyState({ pose: "think", title: "No computer yet", action: { label: "Get X0 Bot for computer", onPress: openUrl(DOWNLOAD_URL) } })] });
  }
  const w = codeWorking(ctx);
  const first = d.online[0];
  return page(ctx, {
    back: true, nav: "computer", title: "This computer helps", gap: 18,
    body: [
      ...head,
      listCard([
        ...d.online.map((c, i) => col([
          row([icon("computer", { size: 22 }), col([text(c.name, { size: 15, weight: 600 }), meta(onlineLine(c, c.busy ? w?.title.split(/[.\n]/)[0] : undefined), { size: 12 })], { gap: 2, flexShrink: 1, minWidth: 0 })], { gap: 12 }),
          ...(i === 0 ? [row([
            box([text(plural(d.helped.jobs, "job"), { size: 18, weight: 700 }), meta("helped this month", { size: 12 })], { flexGrow: 1, flexBasis: 0, backgroundColor: C.surface, borderRadius: 12, padding: 12, gap: 2 }),
            box([text(hours(d.helped.minutes), { size: 18, weight: 700 }), meta("of work, free", { size: 12 })], { flexGrow: 1, flexBasis: 0, backgroundColor: C.surface, borderRadius: 12, padding: 12, gap: 2 }),
          ], { gap: 10 })] : []),
        ], { gap: 12, paddingVertical: 14, paddingHorizontal: 16 })),
        ...d.offline.map((c) => listRow({
          left: icon("computer", { size: 22, color: C.idle }), label: c.name, sub: `Offline · last seen ${daysAgo(ctx, c.lastSeen)}`, chevron: false,
          right: quietButton("Remove", call("DELETE", `/v1/you/computers/${encodeURIComponent(c.deviceId)}`, undefined, { ok: seq(toast(`${c.name} removed`), refresh), fail: oops("remove it") }), { size: "md" }),
        })),
        ...signedIn.map((c) => listRow({ left: icon("computer", { size: 22 }), label: c.name, sub: "Signed in · Xode is off", chevron: false })),
      ]),
      ...(first ? [col([
        sectionLabel("What it may do"),
        listCard([
          listRow({ label: "Run jobs for Xode", value: first.allowRun ? "On" : "Off" }),
          listRow({ label: "Projects", value: projectsLine(first.projects) }),
          listRow({ label: "Can push code", value: "Never", sub: "It gets a read-only copy" }),
        ]),
        meta("Change these in X0 Bot on that computer. Never other folders, passwords, photos or your browser.", { size: 12, lineHeight: 17 }),
      ], { gap: 8 })] : []),
      add,
    ],
  });
}

/**
 * TAILZU CODE ON THIS COMPUTER, the runner's own window drawn here (a window that declares DeskRunner: the
 * desktop's runnerCard.js): its switch and what it is doing, the safety words, Stop, the container, the projects
 * and what it ran, as that computer's main process reports them. Every word it shows is one of these props, so
 * they are the server's and translated (i18n NODE_TYPE_TEXT_PROPS). Turning it on and allowing a project are
 * asked by the window itself, in its own words, before they happen; the card is never the consent.
 */
export const RUNNER_CARD_WORDS = {
  title: "Xode on this computer",
  lede: "Let Xode do its work here first: free, and fast, because nothing has to wait for a cloud computer to start.",
  use: "Use this computer for Xode",
  safetyLead: "Off until you turn it on.",
  safety: "When it is on, and only while X0 Bot is open, Xode can run its commands (tests, builds, installs) on this computer, for the projects you allow below. Each project is asked about the first time. It works in a folder of its own, from a read-only copy of your code, and cannot see your passwords, keys or other files: commands get a clean environment and a private home folder, and things like sudo, git push, publishing or deleting your home folder are refused. It pauses by itself when the battery is under 20% or Low Power Mode is on. Everything it runs is listed below and kept in a log on this computer for 7 days.",
  stateOff: "Off",
  stateSignedOut: "Sign in to X0 Bot to use this",
  stateConnecting: "Connecting…",
  stateOnline: "Online for Xode",
  stateWorking: "Working on {project}",
  statePaused: "Paused",
  pausedBattery: "Paused: the battery is under 20%",
  pausedLowPower: "Paused: Low Power Mode is on",
  stateLiveOff: "Xode is not on for your account yet",
  stateReplaced: "Another copy of X0 Bot has this computer",
  workingLine: "X0 Bot is working on {project}",
  stop: "Stop",
  stopNote: "Stop ends what is running and turns this off until you turn it on again.",
  container: "Run in a container (Docker)",
  checkDocker: "Check Docker",
  dockerRunning: "Docker {version} is running.",
  dockerChecking: "Checking Docker…",
  dockerDown: "{reason} Nothing will run until it is available or this is turned off.",
  containerNote: "Each command runs in a throwaway container (image {image}) with only this project's workspace mounted, so it cannot touch the rest of this computer. Needs Docker installed and running; if it is not, nothing runs here. Off by default.",
  projects: "Projects",
  noProjects: "No projects yet. Xode asks the first time it wants to run one here.",
  allow: "Allow",
  deny: "Don't allow",
  askAgain: "Ask me again",
  badgeAsk: "Will ask",
  badgeAllowed: "Allowed",
  badgeDenied: "Not allowed",
  ran: "What it ran",
  nothingYet: "Nothing yet.",
  colTime: "Time",
  colProject: "Project",
  colCommand: "Command",
  colExit: "Exit",
  colTook: "Took",
  devServer: "[dev server]",
  notRun: "- not run: {why}",
  running: "running",
  refused: "refused",
  timedOut: "(time)",
  stopped: "(stopped)",
  audit: "Open the audit log folder",
  workspaces: "Workspaces: {dir}",
} as const;

/** The card, for a window that draws it; nothing for any other. */
const runnerCard = (ctx: BotsCtx): Node[] =>
  ctx.can.has("DeskRunner") ? [col([sectionLabel("On this computer"), { type: "DeskRunner", props: { ...RUNNER_CARD_WORDS } }], { gap: 8 })] : [];

export function computerDesk(ctx: BotsCtx, d: ComputersData | undefined) {
  const head = heading(ctx, "This computer helps", "Your bots can run heavy work on your own computers instead of the cloud. It's free, and your files stay with you.");
  if (!d) return page(ctx, { back: true, nav: "computer", title: "This computer helps", maxWidth: 1040, body: [head, ...runnerCard(ctx), couldNot("your computers")] });
  const w = codeWorking(ctx);
  const busy = d.online.find((c) => c.busy);
  const first = d.online[0];
  const status = first ? onlineLine(first, busy ? w?.title.split(/[.\n]/)[0] : undefined) : d.offline.length ? "Offline" : d.signedIn?.length ? "Signed in · Xode is off" : "No computer yet";
  return page(ctx, {
    back: true, nav: "computer", title: "This computer helps", maxWidth: 1040, gap: 20,
    body: [
      row([col([head], { flexGrow: 1, flexShrink: 1 }), ...(first ? [infoChip(first.allowRun ? "Helping" : "Not helping")] : [])], { gap: 16, alignItems: "flex-start" }),
      ...runnerCard(ctx),
      columns([
        col([
          sectionLabel("Runner"),
          listCard([
            listRow({ label: "Status", value: status }),
            ...(first ? [
              listRow({ label: "This computer", value: [first.name, first.os === "darwin" ? "Mac" : first.os === "win32" ? "Windows" : first.os === "linux" ? "Linux" : ""].filter(Boolean).join(" · ") }),
              listRow({ label: "Projects it may run", value: projectsLine(first.projects) }),
              listRow({ label: "Where jobs run", value: first.container ? "In a sealed box" : "On this computer, in its own folder" }),
            ] : []),
          ]),
        ], { gap: 8 }),
        ...(busy && w ? [card([
          row([avatar(ctx, "code", 30), col([text(`Working on ${w.title.split(/[.\n]/)[0]}`, { size: 14, weight: 600, lines: 1 }), meta(`Xode · on ${busy.name}`, { size: 12 })], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 }),
            button("Stop job", call("POST", `/v1/code/jobs/${w.id.slice(4)}/stop`, {}, { ok: seq(toast("Stopped"), refresh), fail: oops("stop it") }), { kind: "secondary", size: "md" })], { gap: 12 }),
        ], { padding: 16 })] : []),
        ...(d.offline.length ? [col([sectionLabel("Other computers"), listCard(d.offline.map((c) => listRow({
          left: icon("computer", { size: 20, color: C.idle }), label: c.name, sub: `Offline · last seen ${daysAgo(ctx, c.lastSeen)}`, chevron: false,
          right: button("Remove", call("DELETE", `/v1/you/computers/${encodeURIComponent(c.deviceId)}`, undefined, { ok: seq(toast(`${c.name} removed`), refresh), fail: oops("remove it") }), { kind: "secondary", size: "md" }),
        })))], { gap: 8 })] : []),
        ...(!d.online.length ? [card([
          text("Add a computer", { size: 15, weight: 600 }),
          meta("On that computer, get X0 Bot and sign in as you.", { size: 13 }),
          button("Get X0 Bot for computer", openUrl(DOWNLOAD_URL), { kind: "secondary", size: "md" }),
        ], { gap: 10, padding: 20 })] : []),
      ], [
        card([
          sectionLabel("Guard rails"),
          ...[
            [icon("folder", { size: 18 }), "Runs only projects you allowed", "Nothing else on the computer is shown to bots."],
            [icon("lock", { size: 18 }), "Never pushes code", "It gets a copy to read. X0 Bot commits, through your rules."],
            [icon("shield", { size: 18 }), "Asks before anything risky", "Bots say when they use a computer."],
          ].map(([g, l, s]) => row([g as Node, col([text(l as string, { size: 14, weight: 500 }), meta(s as string, { size: 12 })], { gap: 2, flexShrink: 1 })], { gap: 12, alignItems: "flex-start" })),
        ], { padding: 20, gap: 14 }),
        card([
          sectionLabel("Helped this month"),
          row([text(plural(d.helped.jobs, "job"), { size: 30, weight: 700, tracking: -0.6 }), meta(`${hours(d.helped.minutes)} of work, free`, { size: 12, style: { paddingBottom: 6 } })], { gap: 10, alignItems: "flex-end" }),
        ], { padding: 20, gap: 10 }),
      ]),
    ],
  });
}
