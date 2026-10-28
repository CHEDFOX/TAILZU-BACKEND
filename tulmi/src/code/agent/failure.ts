/**
 * WHAT A LOOP ERROR SAYS: ITS NAME, ITS CODE, ITS MESSAGE AND WHAT CAUSED IT, FOR THE LOG AND THE REPORT.
 *
 * A loop that fails on something unexpected used to be logged as `{"error":"Error"}`: only the error's code or class name, so a plain `new Error("...")`, a
 * thrown string, or a failure wrapped by another (`ModelUnavailable` over the model's own 400) all read the same, and nothing in the log said what had happened.
 * `errorFacts` reads them all alike, down the chain of `cause`s.
 *
 * THE MESSAGE IS KEPT, WITH ONE EXCEPTION: an error that carries an HTTP status is a service's answer (a model's, GitHub's), and its message may repeat what was sent
 * to it, which this code never logs (gateway.ts: "an error is logged by its status and kind, never its message"). For those the name, the code and the status
 * are kept and the message is not. Whatever is kept goes through the work log's redaction (a secret on its own is `[redacted]`) and is cut short.
 */
import { redactText } from "../work/index.js";

export interface ErrorFacts {
  /** The class name, or "NonError" for something that was thrown and was not an Error. */
  name: string;
  code?: string;
  status?: number;
  /** What it said; "" for an error with no message, and not kept for an error that carries a status. */
  message: string;
  cause?: ErrorFacts;
}

const MESSAGE_CHARS = 300;
const DEPTH_MAX = 4;

const clean = (s: string): string => redactText(s.replace(/\s+/g, " ").trim(), MESSAGE_CHARS);

export function errorFacts(err: unknown, depth = 0): ErrorFacts {
  if (err === null || err === undefined) return { name: "NonError", message: `${err}` };
  if (typeof err !== "object") return { name: "NonError", message: clean(String(err)) };
  const e = err as { name?: unknown; code?: unknown; status?: unknown; message?: unknown; cause?: unknown; causeError?: unknown };
  const isError = err instanceof Error;
  const status = typeof e.status === "number" ? e.status : undefined;
  const raw = typeof e.message === "string" ? e.message : "";
  const facts: ErrorFacts = {
    name: typeof e.name === "string" && e.name ? e.name : isError ? "Error" : "NonError",
    ...(typeof e.code === "string" && e.code ? { code: e.code } : {}),
    ...(status !== undefined ? { status } : {}),
    // An object that is no Error and has no message is described by its keys, so "something was thrown" still says what.
    message: status !== undefined ? "" : raw ? clean(raw) : isError ? "" : clean(`non-error object with keys ${Object.keys(err).slice(0, 8).join(", ") || "(none)"}`),
  };
  // The standard cause, else the one the model door's own wrappers keep under their own name.
  const cause = e.cause !== undefined ? e.cause : e.causeError;
  if (cause !== undefined && cause !== err && depth < DEPTH_MAX) facts.cause = errorFacts(cause, depth + 1);
  return facts;
}

/** The code, else the name: how the log and the job's reason have always named an error. */
export const kindOf = (f: ErrorFacts): string => f.code ?? f.name;

/** One line for a person: "GitHub is down (github_down), caused by ModelUnavailable (400)". Never empty. */
export function errorLine(f: ErrorFacts): string {
  const here = f.message ? `${f.message} (${kindOf(f)}${f.status !== undefined ? ` ${f.status}` : ""})` : `${kindOf(f)}${f.status !== undefined ? ` ${f.status}` : ""}`;
  return f.cause ? `${here}, caused by ${errorLine(f.cause)}` : here;
}
