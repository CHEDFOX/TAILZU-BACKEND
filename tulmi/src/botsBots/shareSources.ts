/**
 * WHERE A PERSON'S OWN ITEMS COME FROM, FOR SHARING INTO A GROUP (spaceShares.ts): one ShareSource a bot.
 *
 *   plan     their calendar: events in the next 30 days (from yesterday) and their open to-dos (src/calendar)
 *   notes    their meeting notes, newest first (src/notes)
 *   travel   their trips, newest first (trips.ts)
 *   code     their Xode projects, each with what Xode is doing on it now or did last (src/code)
 *
 * Each item is a title, one short line and a time; nothing else of the item leaves its bot. A source that fails lists nothing.
 */
import type { AuthedUser } from "../auth/supabase.js";
import { calendar } from "../calendar/index.js";
import { codeStore } from "../code/store.js";
import { jobStore } from "../code/jobs/store.js";
import type { CodeJob } from "../code/jobs/types.js";
import { listNotes } from "../notes/store.js";
import type { OwnItem, ShareSources } from "./spaceShares.js";
import type { Trips } from "./trips.js";

const DAY = 86_400_000;
const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const LIST_MAX = 50;

/** What Xode is doing on a project, from its newest job: "Working · fixing cart", "Done · add dark mode", or nothing yet. */
export function projectLine(jobs: CodeJob[]): string {
  const j = jobs[0];
  if (!j) return "No work yet";
  const task = j.task.replace(/\s+/g, " ").trim().slice(0, 60);
  switch (j.state) {
    case "running": case "queued": case "waiting_for_compute": return `Working · ${task}`;
    case "waiting_for_you": case "paused": return `Waiting · ${task}`;
    case "done": return `Done · ${task}`;
    case "failed": return `Stopped · ${task}`;
    default: return `Last · ${task}`;
  }
}

export function shareSources(o: { trips?: Trips | null; now?: () => number }): ShareSources {
  const now = o.now ?? Date.now;
  return {
    plan: {
      async list(userId) {
        const t = now();
        const got = await calendar().list(userId, { from: dayKey(t - DAY), to: dayKey(t + 30 * DAY) });
        const events: OwnItem[] = got.events.map((e) => ({ id: `e:${e.id}`, title: e.title, line: e.allDay ? "All day" : "Event", at: e.start }));
        const todos: OwnItem[] = [...got.tasks, ...got.open].filter((x) => !x.done)
          .map((x) => ({ id: `t:${x.id}`, title: x.title, line: "To-do", at: x.at ?? (x.due ? Date.parse(`${x.due}T00:00:00Z`) : null) }));
        const seen = new Set<string>();
        return [...events, ...todos].filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
          .sort((a, b) => (a.at ?? Number.MAX_SAFE_INTEGER) - (b.at ?? Number.MAX_SAFE_INTEGER)).slice(0, LIST_MAX);
      },
    },
    notes: {
      async list(userId) {
        const notes = await listNotes({ id: userId } as AuthedUser, LIST_MAX);
        return notes.map((n) => {
          const min = Math.round((n.durationSeconds ?? 0) / 60);
          return { id: n.id, title: n.title || "A note", line: min ? `${min} min` : "Note", at: Date.parse(n.startedAt) || null };
        });
      },
    },
    ...(o.trips ? {
      travel: {
        async list(userId: string) {
          return (await o.trips!.list(userId, LIST_MAX)).map((t) => ({ id: t.id, title: t.place, line: [t.when, t.who].filter(Boolean).join(" · ") || "Trip", at: t.createdAt }));
        },
      },
    } : {}),
    code: {
      async list(userId) {
        const [projects, jobs] = await Promise.all([codeStore().listProjects(userId), jobStore().listJobs(userId, 100).catch(() => [] as CodeJob[])]);
        return projects.map((p) => {
          const mine = jobs.filter((j) => j.projectId === p.id).sort((a, b) => b.updatedAt - a.updatedAt);
          return { id: p.id, title: p.fullName.split("/").pop() || p.fullName, line: projectLine(mine), at: mine[0]?.updatedAt ?? p.createdAt };
        });
      },
    },
  };
}
