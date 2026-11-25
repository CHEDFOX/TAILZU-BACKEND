/**
 * SPACES, THE NEW WAY (bots.spaces with no id, for a build that draws it: kit canSpaces2; docs/bots-app.md "Spaces").
 *
 * At the top, the person's own bot roams (the whole top area is his: a tap on it blurs the screen, he walks down near the bottom and
 * his thought opens over him). It holds the invitations waiting for this person's email (Accept / Dismiss), the line about the space's
 * admin, a dotted "Have a code?" box, the requests to join the spaces they made, and once they are in a space, "Make a new space".
 *
 *   FIRST   no space yet: under him a box of tiny bots playing, then a dotted Create on the left and "Your Own Space".
 *   CREATE  Create: the button and the words vaporise, the box grows (its bots stay), he walks out at the side; "Call Your People" in
 *           the box (an email, Invite, Sent; more people), Continue, "Name your space", Done. The first Invite makes a draft space
 *           on the server (its mails go at once); Back deletes it and he walks back in.
 *   MADE    just after Done (param `made`): every bot cheers, he walks back in, "{name} is ready" and Open.
 *   JOINED  the person's spaces, each with its last line and what is new.
 *   PEOPLE  under either: "Add · One Person" (one to one by username: docs/social.md §3), and the people they are connected with
 *           (Message) or asked (waiting for a yes). Someone on the app is called into a space by their username too, in the same
 *           box as an email.
 *
 * In the window everything sits in one column, centred, as wide as the box (as the phone's screen is), so his top area is right
 * over the box and nothing is stranded at the left of a wide window.
 *
 * FIRST, CREATE and MADE are one tree with conditions, so Create plays out on the device without a fetch. Reads only
 * GET .../spaces?full=1 (src/botsBots: spaces, spaceJoin); every refusal's toast says the server's own words (said.ts).
 */

import type { ActionRef, ActionSpec, Condition, Node, ScreenResponse } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, C, SCREENS, botCrowd, botLook, botStage, box, button, call, col, crowdSurprises, dottedButton, emptyState, icon, meta,
  open, page, primaryButton, roamFor, row, sectionLabel, seq, statusMark, text, vanish, when, type PersonLookSpec,
} from "../../kit.js";
import { said } from "../../said.js";
import { idParam } from "./memberPage.js";
import { A, clearState, enc, facesRow, facesWidth, field, ifFilled, iconButton, inputBox, isDesk, mailPreview, messagePerson, personMark, PREVIEW_STATE, refresh, shareLook, toast, type MailPreview, type Space } from "./parts.js";
import { pickContact } from "./pickContact.js";
import { countDot, facesLine, plural, quietLinks } from "./spaceDetail.js";

// ===================================================================== what it reads (GET .../spaces?full=1, as the route answers)

/**
 * An invite waiting for this person, to their email or their username (src/botsBots/spaceJoin.ts Invitation); `byBot`, the admin who
 * sent it as their tiny bot; `pair`, someone asking to add them one to one.
 */
export interface Invitation { code: string; spaceId: string; spaceName: string; by: string; byBot?: PersonLookSpec; people: number; expiresAt: number; pair?: boolean }
/** Someone this person is connected with one to one, or asked and is waiting on (botsBots/spaces.ts pairs). */
export interface PersonView { spaceId: string; userId: string; name: string; bot?: PersonLookSpec; waiting: boolean }
/** Someone asking to join a space this person made; `bot`, the tiny bot they would be there. */
export interface JoinRequestView { id: string; spaceId: string; spaceName: string; name: string; bot?: PersonLookSpec; at: number }
/** This person's own open requests: the code they typed (7KQ-29D), never the space's name (a code alone never says whose space it is). */
export interface MyRequest { id: string; code: string; at: number }
/** The space they are calling their people into, before it has a name of its own (`name` null until it is named). */
export interface DraftView {
  id: string; name: string | null;
  invites: Array<{ code: string; email: string; at: number; mail: "queued" | "sent" | "failed" | null }>;
  /** The invite mail as the person called in will read it (src/botsBots/inviteMail.ts), for the preview before Invite. */
  mailPreview?: MailPreview;
}
export interface SpacesFull {
  spaces: Space[]; you: string; unread: number;
  /** One to one: connected, and asked (a server before "Add a person" sends none). */
  people?: PersonView[];
  invitations: Invitation[]; requests: JoinRequestView[]; asked: MyRequest[]; draft: DraftView | null;
  /**
   * The invite mail as it will read before there is any draft at all (botsBots/spaces.ts blankPreview). The first Invite
   * is what makes the draft, so without this the very first invite a person ever sends would have no preview in front of
   * it, which is the one App Review 5.1.2(v) asks for.
   */
  mailPreview?: MailPreview;
}

type Layout = "first" | "create" | "made" | "joined";

/** The code an invite's link carried (https://app.x0bot.com/s/bots.spaces?join=CODE). */
export const joinParam = (ctx: BotsCtx): string => String(ctx.params.join ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);

const setState = (path: string, value: unknown): ActionSpec => ({ kind: "setState", path, value });
const CREATING: Condition = { truthy: "creating" };
const MADE: Condition = { truthy: "made" };

/** The tiny bots in the box: the built-ins in their colours, someone's own (stone) and Make a bot (ink). */
const CROWD = [
  { kind: "plan" as const, color: botLook("plan").color }, { kind: "travel" as const, color: botLook("travel").color },
  { kind: "notes" as const, color: shareLook("notes").color }, { kind: "code" as const, color: botLook("code").color },
  { kind: "keybot" as const, color: botLook("keybot").color }, { kind: "custom" as const, color: botLook("custom").color },
  { kind: "make" as const, color: C.ink },
];

/** A heading in the box and the sheet: the prototype's 26 bold. */
const heading = (words: string): Node => text(words, { size: 26, weight: 700, tracking: -0.5, lineHeight: 32 });

// ===================================================================== his thought

/** An invitation: the space, who invited them, how many are in; Accept (with the line about the admin, which they saw) or Dismiss. */
function invRow(ctx: BotsCtx, i: Invitation): Node {
  const path = `${A}/spaces/invitations/${enc(i.code)}`;
  const acc = call("PUT", path, { decision: "accept" }, {
    ok: seq(toast(i.pair ? `You're connected with ${i.by}` : `You joined ${i.spaceName}`), setState("thOpen", false), refresh), fail: said("Couldn't join it. Try again."),
  });
  const dis = call("PUT", path, { decision: "dismiss" }, { ok: seq(toast(`Dismissed. ${i.by} can ask you again.`), refresh), fail: said("Couldn't do that. Try again.") });
  const title = i.pair ? `${i.by} wants to add you` : i.spaceName;
  const line = i.pair ? "One to one. Say yes and you can message each other." : `${i.by} invited you · ${plural(i.people, "person", "people")}`;
  return col([
    row([personMark(ctx, { seed: `${i.spaceId}:${i.by}`, bot: i.byBot }, 36), col([text(title, { size: 16, weight: 600, lineHeight: 21, lines: 1 }), meta(line, { size: 13, lines: i.pair ? 2 : 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 })], { gap: 12 }),
    row([primaryButton("Accept", acc, { size: "md" }), button("Dismiss", dis, { kind: "secondary", size: "md" })], { gap: 8 }),
  ], { gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper });
}

/** Someone with the code of a space this person made, asking to come in. */
function reqRow(ctx: BotsCtx, r: JoinRequestView): Node {
  const path = `${A}/spaces/${enc(r.spaceId)}/requests/${enc(r.id)}`;
  const acc = call("PUT", path, { decision: "accept" }, { ok: seq(toast(`${r.name} joined ${r.spaceName}`), refresh), fail: said("Couldn't let them in. Try again.") });
  const dis = call("PUT", path, { decision: "dismiss" }, { ok: seq(toast(`${r.name} was not let in.`), refresh), fail: said("Couldn't do that. Try again.") });
  return col([
    row([personMark(ctx, { seed: r.id, bot: r.bot }, 36), text(`${r.name} wants to join ${r.spaceName}`, { size: 15, weight: 500, lineHeight: 20, style: { flexGrow: 1, flexShrink: 1, minWidth: 0 } })], { gap: 12 }),
    row([primaryButton("Accept", acc, { size: "md" }), button("Dismiss", dis, { kind: "secondary", size: "md" })], { gap: 8 }),
  ], { gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper });
}

/** Join with a code: in at once when it was an invite for this email, else a request the space's admin answers. */
function joinAction(): ActionRef {
  return ifFilled("code", call("POST", `${A}/spaces/join`, { code: "$state.code" }, {
    assignTo: "joined",
    ok: {
      kind: "condition", if: { eq: ["joined.status", "requested"] },
      then: seq(toast("Request sent. The space's admin will let you in."), clearState("code"), refresh),
      else: seq(toast("You're in"), clearState("code"), setState("thOpen", false), refresh),
    },
    fail: said("That code doesn't work. Check it and try again."),
  }), "Type the code first");
}

/** What his thought holds: making a new space (once they are in one), invitations, requests, the admin's line, the code box. */
function thought(ctx: BotsCtx, L: Layout, d: SpacesFull, focusCode: boolean): Node[] {
  const makeNew = ifFilled("newName", call("POST", `${A}/spaces/draft`, { name: "$state.newName" }, {
    ok: seq(setState("thOpen", false), refresh), fail: said("Couldn't start it. Try again."),
  }), "Name it first");
  const invs = d.invitations;
  const join = joinAction();
  return [
    ...(L === "joined" ? [col([
      sectionLabel("Make a new space"),
      row([box([inputBox([field("newName", "newName", "Its name", { onSubmit: makeNew, extras: { maxLength: 40 } })])], { flexGrow: 1, flexShrink: 1, minWidth: 0 }), dottedButton("Create", makeNew)], { gap: 8 }),
    ], { gap: 10 })] : []),
    col([
      // The prototype's words: "You have an invitation", or "Invitations" when there is none (or several).
      sectionLabel(invs.length === 1 ? "You have an invitation" : invs.length ? "You have invitations" : "Invitations"),
      ...(invs.length ? invs.map((i) => invRow(ctx, i)) : [meta("No invitations right now.", { size: 13 })]),
    ], { gap: 10 }),
    ...(d.requests.length ? [col([sectionLabel("Requests"), ...d.requests.map((r) => reqRow(ctx, r))], { gap: 10 })] : []),
    ...d.asked.map((a) => row([statusMark("waiting"), meta(`Asked to join with the code ${a.code}. The space's admin will let you in.`, { size: 13, style: { flexShrink: 1 } })], { gap: 8 })),
    col([
      text("Have a code?", { size: 15, weight: 600, lineHeight: 20 }),
      row([
        box([field("code", "code", "Type a space's code", { onSubmit: join, extras: { kind: "code", autoFocus: focusCode, maxLength: 16 } })], { flexGrow: 1, flexShrink: 1, minWidth: 0 }),
        primaryButton("Join", join, { size: "md" }),
      ], { gap: 8 }),
    ], { borderWidth: 2, borderStyle: "dotted", borderColor: C.ink, borderRadius: 16, padding: 14, gap: 10 }),
  ];
}

// ===================================================================== Call Your People, Name your space, ready

/** Inviting: the email up as "Sending" at once, then the draft (made by the first invite) with every invite as a Sent row. */
function inviteAction(): ActionRef {
  return ifFilled("email", seq(
    setState("sending", true), setState("sendingEmail", "$state.email"),
    call("POST", `${A}/spaces/draft/invite`, { email: "$state.email" }, {
      ok: seq(clearState("email"), setState("sending", false), refresh),
      fail: seq(setState("sending", false), said("Couldn't invite them. Check it and try again.")),
    }),
  ), "Type their username or email first");
}

/** Done: the draft becomes the space, and Spaces opens on the moment it is ready. */
const madeNow: ActionSpec = { kind: "navigate", screenId: SCREENS.spaces, params: { made: "$state.madeSpace.id" }, replace: true };

function people(ctx: BotsCtx, d: SpacesFull): Node {
  const draft = d.draft;
  // Named already ("Make a new space"): Continue makes it at once, with no empty name field to stop it.
  const cont: ActionRef = draft?.name
    ? call("POST", `${A}/spaces/draft/done`, {}, { assignTo: "madeSpace", ok: madeNow, fail: said("Couldn't make it. Try again.") })
    : setState("step", "name");
  // Back takes the draft away (its invites and any mail still queued) and he walks back in.
  const backAct: ActionRef = draft
    ? call("DELETE", `${A}/spaces/draft`, undefined, { ok: seq(setState("creating", false), refresh), fail: said("Couldn't do that. Try again.") })
    : setState("creating", false);
  const invite = inviteAction();
  // Someone called in by email has no account here yet: a tiny bot of their own, by the address.
  const sentRow = (email: string, status: Node): Node => row([personMark(ctx, { seed: email.toLowerCase() }, 28), text(email, { size: 15, lineHeight: 20, lines: 1, style: { flexGrow: 1, flexShrink: 1, minWidth: 0 } }), status], {
    gap: 10, paddingVertical: 6, paddingLeft: 6, paddingRight: 14, borderRadius: 22, backgroundColor: C.surface,
  });
  return col([
    iconButton("back", backAct, "Back", 40),
    col([
      ...(draft?.name ? [sectionLabel(draft.name)] : []),
      heading("Call Your People"),
      meta("Someone on X0 Bot by their username, anyone else by email.", { size: 13 }),
    ], { gap: 4 }),
    row([
      box([inputBox([field("email", "email", "Their username or email", { onSubmit: invite, extras: { kind: "email", autoFocus: true, maxLength: 200 } })], { radius: 27 })], { flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      when({ falsy: "sending" }, primaryButton("Invite", invite, { size: "md" })),
      when({ truthy: "sending" }, button("Sending", undefined, { kind: "disabled", size: "md" })),
    ], { gap: 8 }),
    // The phone's own contact picker, and what the invite will look like to them: the same two on the space's Invite page.
    ...pickContact(ctx),
    ...mailPreview(draft?.mailPreview ?? d.mailPreview),
    ...(draft?.invites ?? []).map((i) => sentRow(i.email, i.mail === "failed"
      ? meta("Didn't send", { size: 13 })
      : row([icon("check", { size: 14 }), text("Sent", { size: 13, weight: 600, lineHeight: 16 })], { gap: 4 }))),
    when({ truthy: "sending" }, row([text("", { size: 15, lineHeight: 20, lines: 1, bind: "sendingEmail", color: C.meta, style: { flexGrow: 1, flexShrink: 1, minWidth: 0 } }), meta("Sending", { size: 13 })], {
      gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 22, backgroundColor: C.surface,
    })),
    primaryButton("Continue", cont, { wide: true }),
  ], { gap: 14 });
}

function naming(): Node {
  const done = ifFilled("spaceName", call("POST", `${A}/spaces/draft/done`, { name: "$state.spaceName" }, {
    assignTo: "madeSpace", ok: madeNow, fail: said("Couldn't make it. Try again."),
  }), "Name your space first");
  return col([
    iconButton("back", setState("step", "people"), "Back", 40),
    col([heading("Name your space"), meta("Your people see this name.", { size: 13 })], { gap: 4 }),
    inputBox([field("spaceName", "spaceName", "e.g. Sharma Family", { onSubmit: done, extras: { maxLength: 40, autoFocus: true } })], { radius: 27 }),
    primaryButton("Done", done, { wide: true }),
  ], { gap: 14 });
}

/**
 * Open from the moment after Done: this screen becomes the list of the person's spaces, and the new space opens over it, so Back
 * comes to Your spaces (not to the moment again, which would cheer again).
 */
const openMade = (id: string): ActionRef => seq(
  { kind: "navigate", screenId: SCREENS.spaces, params: {}, replace: true },
  open(SCREENS.spaces, { id }),
);

/** The moment after Done, under the box: "{name} is ready", who is invited, Open. */
function madeLines(ctx: BotsCtx, d: SpacesFull, id: string): Node {
  const s = d.spaces.find((x) => x.id === id);
  const name = s?.name ?? "Your space";
  const invited = s?.invited ?? 0;
  return col([
    text(`${name} is ready`, { size: 26, weight: 700, tracking: -0.5, lineHeight: 32, align: "center" }),
    meta(invited ? `${plural(invited, "person", "people")} invited. You are its admin.` : "You are its admin.", { size: 13, align: "center" }),
    primaryButton(s ? `Open ${name}` : "Open it", openMade(id), { size: isDesk(ctx) ? "md" : "lg" }),
  ], { gap: 8, alignItems: "center", paddingTop: 6 });
}

// ===================================================================== your spaces

/**
 * A space in the list: up to three of its people's tiny bots (and "+N"), its name, its last line (else who is in it), what is new; a
 * dot when a payment waits on you.
 */
function spaceRow2(ctx: BotsCtx, s: Space): Node {
  const line = s.last ? `${s.last.from}: ${s.last.text}` : s.waiting ? `${plural(s.waiting, "payment")} ${s.waiting === 1 ? "needs" : "need"} your yes` : facesLine(s);
  return row([
    // As wide as three bots and "+N", so the names line up down the list.
    box([facesRow(ctx, s.members)], { width: facesWidth(ctx), flexShrink: 0 }),
    col([
      text(s.name, { size: 16, weight: 600, lineHeight: 21, lines: 1 }),
      row([...(s.waiting ? [statusMark("needs")] : []), meta(line, { size: 13, lines: 1, style: { flexShrink: 1 } })], { gap: 6 }),
    ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ...(s.unread ? [countDot(s.unread)] : []),
    icon("chevron", { size: 16, color: C.meta }),
  ], { gap: 10, paddingVertical: 12, paddingHorizontal: 14, minHeight: 64, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }, open(SCREENS.spaces, { id: s.id }));
}

// ===================================================================== one to one

const ADDING: Condition = { truthy: "adding" };
/** Create and Add one width, so "Your Own Space" and "One Person" start in one line. */
const ROW_BUTTON = 100;

/** "Add a person": asked (they see it in Spaces), or connected at once when they had already asked you. */
function addPersonAction(): ActionRef {
  return ifFilled("who", call("POST", `${A}/spaces/people`, { username: "$state.who" }, {
    assignTo: "added",
    ok: seq(
      { kind: "condition", if: { eq: ["added.status", "joined"] }, then: toast("You're connected. Message them any time."), else: toast("Asked. They'll see it in Spaces.") },
      clearState("who"), setState("adding", false), refresh,
    ),
    fail: said("Couldn't add them. Check the username and try again."),
  }), "Type their username first");
}

/** The row under Create: a dotted Add and "One Person", in the same shape. */
const addRow = (desk: boolean): Node => row([
  dottedButton("Add", setState("adding", true), { size: "lg", minWidth: ROW_BUTTON }),
  text("One Person", { size: desk ? 27 : 26, weight: 700, tracking: -0.6, lineHeight: 34, style: { flexShrink: 1 } }),
], { gap: 14, alignItems: "center" });

/** The little form "Add" opens: a username, Add, and Cancel. */
function addPersonCard(): Node {
  const add = addPersonAction();
  return col([
    col([heading("Add a person"), meta("By their username. Once they say yes, you can message each other.", { size: 13 })], { gap: 4 }),
    row([
      box([inputBox([field("who", "who", "Their username", { onSubmit: add, extras: { autoFocus: true, maxLength: 21 } })], { radius: 27 })], { flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      primaryButton("Add", add, { size: "md" }),
    ], { gap: 8 }),
    button("Cancel", seq(setState("adding", false), clearState("who")), { kind: "secondary", size: "md" }),
  ], { gap: 12, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper });
}

/** Someone connected (tap to message), or asked and not yet said yes. */
function personRow(ctx: BotsCtx, p: PersonView): Node {
  return row([
    personMark(ctx, { seed: p.userId, bot: p.bot }, 32),
    col([
      text(p.name, { size: 16, weight: 600, lineHeight: 21, lines: 1 }),
      meta(p.waiting ? "Asked. Waiting for a yes." : "Message them", { size: 13, lines: 1 }),
    ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ...(p.waiting ? [statusMark("waiting")] : [icon("chevron", { size: 16, color: C.meta })]),
  ], { gap: 10, paddingVertical: 12, paddingHorizontal: 14, minHeight: 60, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper },
  p.waiting ? undefined : messagePerson(p.userId));
}

/** Add · One Person (or its form), then the people. */
function peopleBlock(ctx: BotsCtx, d: SpacesFull, withRow: boolean): Node[] {
  const list = d.people ?? [];
  return [
    ...(withRow ? [when({ falsy: "adding" }, addRow(isDesk(ctx)))] : []),
    when(ADDING, addPersonCard()),
    ...(list.length ? [col([sectionLabel("Your people"), ...list.map((p) => personRow(ctx, p))], { gap: 10 })] : []),
  ];
}

// ===================================================================== bots.spaces

/**
 * How tall the box grows for Call Your People: its height at rest in the design (phone 560, window 600), or enough for the heading,
 * the field, every invite so far, the Sending row and Continue, whichever is more. The box clips what is past its edge, and a family
 * can invite more than five people.
 */
const GROWN = { phone: 560, desk: 600, head: 286, row: 54 };
const grownHeight = (desk: boolean, d: SpacesFull): number =>
  Math.max(desk ? GROWN.desk : GROWN.phone, GROWN.head + GROWN.row * ((d.draft?.invites.length ?? 0) + 1));
/** The window's box of tiny bots: square, and small enough that the row under it stays in a window of the usual height. */
const DESK_CROWD = 400;
/** The window's column once there are spaces to list: a list reads best a little wider than the box. */
const DESK_LIST = 560;

export function startScreen(ctx: BotsCtx, d: SpacesFull | undefined): ScreenResponse {
  const desk = isDesk(ctx);
  if (!d) {
    return page(ctx, {
      back: !desk, title: "Spaces", nav: "you", maxWidth: 720,
      body: [emptyState({ pose: "think", title: "Couldn't load your spaces", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })],
    });
  }
  const made = idParam(ctx, "made");
  const code = joinParam(ctx);
  const L: Layout = made ? "made" : d.draft ? "create" : d.spaces.length ? "joined" : "first";
  // The thought opens by itself for an invite's link, a request's push (thought=1), and an invitation waiting on the first screen.
  const thOpen = !!code || ctx.params.thought === "1" || ctx.params.thought === 1 || (L === "first" && d.invitations.length > 0);
  const top = botStage({
    life: "spaces.me", kind: "custom", color: C.ink, size: desk ? 34 : 30, height: desk ? 160 : 132, toys: false, roam: roamFor(ctx),
    // The whole top area is his (the owner's "tap the top bot/area").
    hit: "stage",
    // Out by the nearer edge (no side named) while Call Your People is open; back in on Back.
    outWhen: CREATING,
    // A happy hop for news (an invitation, a request) and when a space is made.
    cheerWhen: { any: [MADE, { gt: ["news", 0] }] },
    thought: { style: "space", openPath: "thOpen", shape: "wide", veil: true, place: "low" },
    label: "Your bot. Tap him for invitations and codes.",
    // While Call Your People is open he is out at the side: a tap on the empty top area must not bring him back in.
  }, [col(thought(ctx, L, d, !!code), { padding: 18, gap: 16 })], { onPress: { kind: "condition", if: { falsy: "creating" }, then: setState("thOpen", true) } });

  const body: Node[] = [top];
  if (L === "joined") {
    body.push(
      text("Your spaces", { size: 26, weight: 700, tracking: -0.5, lineHeight: 32 }),
      col(d.spaces.map((s) => spaceRow2(ctx, s)), { gap: 10 }),
      ...peopleBlock(ctx, d, true),
      quietLinks(),
    );
  } else {
    // No height: as tall as it is wide (the owner's square box). The window's is held to a square that fits it.
    const crowd = botCrowd({
      life: "spaces.crowd", bots: CROWD, size: 22, grownWhen: CREATING, grownHeight: grownHeight(desk, d),
      cheerWhen: MADE, surprises: crowdSurprises(ctx), label: "Tiny bots playing",
    }, [
      when({ all: [CREATING, { eq: ["step", "people"] }] }, people(ctx, d)),
      when({ all: [CREATING, { eq: ["step", "name"] }] }, naming()),
    ]);
    body.push(
      crowd,
      vanish({ key: "spaces.create", goneWhen: { any: [CREATING, MADE] } }, [
        col([
          // The dotted Create on the left, the words on its right (the prototype's size); "Add · One Person" under it, the same.
          when({ falsy: "adding" }, row([dottedButton("Create", setState("creating", true), { size: "lg", minWidth: ROW_BUTTON }), text("Your Own Space", { size: desk ? 27 : 26, weight: 700, tracking: -0.6, lineHeight: 34, style: { flexShrink: 1 } })], { gap: 14, alignItems: "center" })),
          ...peopleBlock(ctx, d, true),
        ], { gap: 14 }),
      ]),
      ...(made ? [when(MADE, madeLines(ctx, d, made))] : []),
    );
  }
  // THE WINDOW: one centred column, as wide as the box (or a list's width once they have spaces), the way the phone's screen is.
  const column = desk ? [col(body, { gap: 18, width: "100%", maxWidth: L === "joined" ? DESK_LIST : DESK_CROWD, alignSelf: "center" })] : body;
  return page(ctx, {
    back: !desk, title: "Spaces", nav: "you", gap: 18, maxWidth: 720,
    state: {
      code, thOpen, news: d.invitations.length + d.requests.length, creating: !!d.draft, step: "people", email: "", sending: false, sendingEmail: "", ...PREVIEW_STATE,
      spaceName: "", newName: "", made: !!made, adding: false, who: "",
    },
    live: ["spaces", ...d.spaces.map((s) => `space:${s.id}`)],
    body: column,
  });
}
