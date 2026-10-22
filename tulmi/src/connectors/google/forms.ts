/**
 * GOOGLE FORMS, as a native connector, with the drive.file scope only.
 *
 *   create_form      write   a new form (a survey, a quiz, a sign-up) with its questions
 *   list_responses   read    how many answered, the choices added up, the latest answers
 *
 * forms.create, forms.batchUpdate, forms.setPublishSettings, forms.get and
 * forms.responses.list all accept drive.file, so Tailzu reaches only the
 * forms it made, never the person's other forms or their Drive.
 *
 * Making one is three calls. forms.create takes a title and nothing else; it
 * is made unpublished (no one can answer a half-built form; Google makes
 * API forms unpublished by default from 30 June 2026 anyway); batchUpdate
 * puts the questions in; setPublishSettings then opens it for answers. A form
 * is never sent to anyone: the person gets its link to share.
 */
import type { CallOutcome } from "../client.js";
import type { Args, NativeConnector, NativeTool } from "../native.js";
import { ConnectorError } from "../oauth.js";
import { FORM, ownFiles } from "./drive.js";
import type { GoogleSession } from "./oauth.js";
import { count, noSuchTool, ok, oneLine, reject, str, type Describe } from "./plain.js";
import { dayWord, clock } from "./time.js";
import type { ZoneOf } from "./zone.js";

const API = "https://forms.googleapis.com/v1/forms";
const ID = "google-forms";
const APP = "Google Forms";
const TITLE_MAX = 300;
const QUESTIONS_MAX = 30;
const OPTIONS_MAX = 20;
const LATEST = 3;
/** A question with this many different answers or fewer is added up ("Friday 5, Saturday 2"). */
const TALLY_MAX = 8;

interface Question { title: string; type: "text" | "choice"; options: string[]; required: boolean }
interface GItem { title?: string; questionItem?: { question?: { questionId?: string; choiceQuestion?: unknown } } }
interface GResponse { lastSubmittedTime?: string; createTime?: string; answers?: Record<string, { textAnswers?: { answers?: Array<{ value?: string }> } }> }

const TOOLS: NativeTool[] = [
  {
    name: "create_form", risk: "write", verb: "create",
    description: "Create a new Google Form (a survey, a quiz, a poll, a sign-up) with its questions, open for answers, and give its link to share. Nothing is sent to anyone.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        questions: {
          type: "array",
          description: "Each: {\"title\":\"Which day?\",\"type\":\"choice\",\"options\":[\"Friday\",\"Saturday\"]} or {\"title\":\"Your name\",\"type\":\"text\"}. Add \"required\":true when it must be answered.",
          items: { type: "object" },
        },
      },
      required: ["title", "questions"],
    },
    annotations: {},
  },
  {
    name: "list_responses", risk: "read", verb: "read",
    description: "See the answers to a Google Form Tailzu made: how many answered, each choice added up, and the latest answers.",
    inputSchema: {
      type: "object",
      properties: {
        form: { type: "string", description: "The form's name or edit link." },
        timezone: { type: "string", description: "IANA zone, only if the person named a place." },
      },
      required: ["form"],
    },
    annotations: { readOnlyHint: true },
  },
];

const editLink = (id: string) => `https://docs.google.com/forms/d/${encodeURIComponent(id)}/edit`;

/** The questions they gave, checked. A choice question needs at least two choices. */
function questionsOf(v: unknown): Question[] {
  if (!Array.isArray(v) || !v.length) throw reject("What should the form ask?");
  if (v.length > QUESTIONS_MAX) throw reject(`That's more than ${QUESTIONS_MAX} questions. Ask me for a shorter form.`);
  return v.map((raw): Question => {
    const q = (typeof raw === "string" ? { title: raw } : raw ?? {}) as Record<string, unknown>;
    const title = str(q.title ?? q.question, 300);
    if (!title) throw reject("One of the questions has no words. What should it ask?");
    const options = (Array.isArray(q.options) ? q.options : [])
      .map((x) => str(typeof x === "number" ? String(x) : x, 200)).filter((x): x is string => !!x)
      .filter((x, i, all) => all.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
    const choice = q.type === "choice" || (q.type !== "text" && options.length > 0);
    if (choice && options.length < 2) throw reject(`"${oneLine(title, 40)}" needs at least two choices.`);
    if (options.length > OPTIONS_MAX) throw reject(`"${oneLine(title, 40)}" has more than ${OPTIONS_MAX} choices.`);
    return { title, type: choice ? "choice" : "text", options: choice ? options : [], required: q.required === true };
  });
}

/** A question as a Forms item. */
const itemOf = (q: Question) => ({
  title: q.title,
  questionItem: {
    question: {
      required: q.required,
      ...(q.type === "choice"
        ? { choiceQuestion: { type: "RADIO", options: q.options.map((value) => ({ value })) } }
        : { textQuestion: { paragraph: false } }),
    },
  },
});

export function googleForms(o: { session: GoogleSession; zone: ZoneOf; now?: () => number }): NativeConnector {
  const now = () => (o.now ?? Date.now)();
  const files = ownFiles(o.session, ID, APP);
  const call = <T = Record<string, unknown>>(userId: string, url: string, body?: unknown) =>
    o.session.json<T>(userId, ID, APP, url, { method: body === undefined ? "GET" : "POST", body, notFound: "I couldn't find that form." });

  async function createForm(userId: string, args: Args): Promise<CallOutcome> {
    const title = str(args.title, TITLE_MAX);
    if (!title) throw reject("What should I call the form?");
    const questions = questionsOf(args.questions);
    const description = str(args.description, 2000);
    const made = await call<{ formId?: string; responderUri?: string }>(userId, `${API}?unpublished=true`, { info: { title } });
    if (!made.formId) throw new ConnectorError("failed", `${APP} ran into a problem.`);
    const id = encodeURIComponent(made.formId);
    const edit = editLink(made.formId);
    try {
      await call(userId, `${API}/${id}:batchUpdate`, {
        requests: [
          ...(description ? [{ updateFormInfo: { info: { description }, updateMask: "description" } }] : []),
          ...questions.map((q, index) => ({ createItem: { item: itemOf(q), location: { index } } })),
        ],
      });
    } catch {
      // The form exists: say so, with its link, rather than pretending nothing happened.
      return ok(`Made the Google Form "${oneLine(title)}" but couldn't add the questions. ${edit}`);
    }
    try {
      await call(userId, `${API}/${id}:setPublishSettings`, {
        publishSettings: { publishState: { isPublished: true, isAcceptingResponses: true } }, updateMask: "publishState",
      });
    } catch {
      return ok(`Made the Google Form "${oneLine(title)}" with ${count(questions.length, "question")}, but couldn't open it for answers. Publish it from here: ${edit}`);
    }
    const share = made.responderUri && /^https:\/\/docs\.google\.com\/forms\//.test(made.responderUri) ? made.responderUri : edit;
    return ok(`Made the Google Form "${oneLine(title)}" with ${count(questions.length, "question")}. Share this link: ${share} (edit it at ${edit})`);
  }

  async function listResponses(userId: string, args: Args): Promise<CallOutcome> {
    const form = await files.find(userId, FORM, args.form);
    const id = encodeURIComponent(form.id);
    const [shape, got, tz] = await Promise.all([
      call<{ info?: { title?: string }; items?: GItem[] }>(userId, `${API}/${id}`),
      call<{ responses?: GResponse[] }>(userId, `${API}/${id}/responses?pageSize=500`),
      o.zone(userId, args),
    ]);
    const name = oneLine(shape.info?.title || form.name);
    const responses = (got.responses ?? []).slice().sort((a, b) => stamp(b) - stamp(a));
    if (!responses.length) return ok(`No one has answered "${name}" yet.`);
    const questions = (shape.items ?? []).flatMap((it) => {
      const q = it.questionItem?.question;
      return q?.questionId ? [{ id: q.questionId, title: oneLine(it.title, 60, "(a question)"), choice: !!q.choiceQuestion }] : [];
    });
    const answersTo = (r: GResponse, qid: string) => (r.answers?.[qid]?.textAnswers?.answers ?? []).map((a) => a.value ?? "").filter(Boolean);

    const lines = [`${count(responses.length, "response")} to "${name}".`];
    // The choices, added up: what a poll is for.
    for (const q of questions.filter((x) => x.choice)) {
      const tally = new Map<string, number>();
      for (const r of responses) for (const a of answersTo(r, q.id)) tally.set(a, (tally.get(a) ?? 0) + 1);
      if (!tally.size || tally.size > TALLY_MAX) continue;
      const parts = [...tally].sort((a, b) => b[1] - a[1]).map(([a, n]) => `${oneLine(a, 40)} ${n}`);
      lines.push(`${asked(q.title)} ${parts.join(", ")}`);
    }
    lines.push(`The latest ${responses.length > LATEST ? LATEST : responses.length === 1 ? "one" : responses.length}:`);
    for (const r of responses.slice(0, LATEST)) {
      const when = stamp(r) ? `${dayWord(stamp(r), tz, now())} ${clock(stamp(r), tz)}` : "Earlier";
      const said = questions.map((q) => { const a = answersTo(r, q.id); return a.length ? `${asked(q.title)} ${oneLine(a.join(", "), 80)}` : ""; }).filter(Boolean);
      lines.push(`- ${when}: ${said.join("; ") || "(no answers)"}`);
    }
    return ok(lines.join("\n"));
  }

  /** The confirm card: the form and its questions. */
  const describe: Describe = async (_userId, tool, args) => {
    if (tool !== "create_form") return undefined;
    const title = str(args.title, TITLE_MAX);
    if (!title) throw reject("What should I call the form?");
    const qs = questionsOf(args.questions);
    const shown = qs.slice(0, 4).map((q) => `"${oneLine(q.title, 50)}"${q.type === "choice" ? ` (${q.options.slice(0, 4).map((x) => oneLine(x, 20)).join(" / ")})` : ""}`);
    return `Make a new Google Form "${oneLine(title)}" with ${count(qs.length, "question")}: ${shown.join("; ")}${qs.length > 4 ? `; and ${qs.length - 4} more` : ""}. It opens for answers; I share it with no one`;
  };

  return {
    tools: () => TOOLS,
    preview: describe,

    async call(userId, tool, args): Promise<CallOutcome> {
      switch (tool) {
        case "create_form": return createForm(userId, args);
        case "list_responses": return listResponses(userId, args);
        default: throw noSuchTool(APP, tool);
      }
    },
  };
}

/** "Which day?" as it is; "Your name" as "Your name:". */
const asked = (title: string) => (/[?:]$/.test(title) ? title : `${title}:`);

/** When a response came in, as epoch ms (0 when Google gave none). */
function stamp(r: GResponse): number {
  const t = Date.parse(r.lastSubmittedTime ?? r.createTime ?? "");
  return Number.isFinite(t) ? t : 0;
}
