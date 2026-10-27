/**
 * LONG HORIZON: AN EMPTY REPOSITORY TO A SMALL WORKING APP, THROUGH THE MILESTONES.
 *
 * The person describes an app in a few sentences; the repository is empty. The product asks what it must (the scripted person says "just start"), writes the spec,
 * commits PLAN.md and the starter's template files, runs the starter's own proof, and does the FIRST MILESTONE as an ordinary task. The person merges that pull
 * request and asks for the next milestone (a second job); the finished app is judged by hidden acceptance tests (installed and run in a clean tree) and by what
 * the plan and the project must contain. The oracle writes each milestone's code the way a good worker would.
 */
import { scaffoldStep } from "../../../src/code/newproject/scaffold.js";
import type { Task } from "../schema.js";
import { task } from "./lib.js";

const NOTES = `export interface Note {
  id: number;
  title: string;
  body: string;
}

/** The notes, in memory: ids count up and are never used again. */
export class NoteStore {
  private notes: Note[] = [];
  private nextId = 1;

  list(): Note[] {
    return this.notes.slice();
  }

  get(id: number): Note | undefined {
    return this.notes.find((note) => note.id === id);
  }

  create(input: { title: string; body?: string }): Note {
    const note: Note = { id: this.nextId++, title: input.title, body: input.body ?? "" };
    this.notes.push(note);
    return note;
  }

  remove(id: number): boolean {
    const before = this.notes.length;
    this.notes = this.notes.filter((note) => note.id !== id);
    return this.notes.length < before;
  }
}
`;

const NOTES_TEST = `import { expect, test } from "vitest";
import { NoteStore } from "./notes.js";

test("creates notes with counting ids", () => {
  const store = new NoteStore();
  expect(store.create({ title: "a" }).id).toBe(1);
  expect(store.create({ title: "b", body: "text" })).toEqual({ id: 2, title: "b", body: "text" });
});

test("never reuses an id", () => {
  const store = new NoteStore();
  store.create({ title: "a" });
  store.remove(1);
  expect(store.create({ title: "b" }).id).toBe(2);
});

test("remove says whether anything was removed", () => {
  const store = new NoteStore();
  store.create({ title: "a" });
  expect(store.remove(1)).toBe(true);
  expect(store.remove(1)).toBe(false);
});
`;

const APP_M1 = `import express from "express";
import { NoteStore } from "./notes.js";

export function buildApp(store: NoteStore = new NoteStore()) {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/notes", (_req, res) => {
    res.json(store.list());
  });

  app.post("/notes", (req, res) => {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    if (!title) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    const body = typeof req.body?.body === "string" ? req.body.body : "";
    res.status(201).json(store.create({ title, body }));
  });

  return app;
}
`;

const APP_M2 = APP_M1.replace("  return app;\n", `  app.get("/notes/:id", (req, res) => {
    const note = store.get(Number(req.params.id));
    if (!note) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(note);
  });

  app.delete("/notes/:id", (req, res) => {
    if (!store.remove(Number(req.params.id))) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.status(204).end();
  });

  return app;
`);

const APP_TEST_M2 = `import { expect, test } from "vitest";
import { buildApp } from "./app.js";

async function withApp(run: (base: string) => Promise<void>) {
  const server = buildApp().listen(0);
  try {
    const { port } = server.address() as { port: number };
    await run(\`http://127.0.0.1:\${port}\`);
  } finally {
    server.close();
  }
}

const post = (base: string, payload: unknown) =>
  fetch(\`\${base}/notes\`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });

test("health", async () => {
  await withApp(async (base) => {
    const res = await fetch(\`\${base}/health\`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

test("creates, reads, lists and deletes a note", async () => {
  await withApp(async (base) => {
    const made = await post(base, { title: "first", body: "hello" });
    expect(made.status).toBe(201);
    const note = (await made.json()) as { id: number };
    expect((await fetch(\`\${base}/notes/\${note.id}\`)).status).toBe(200);
    expect(((await (await fetch(\`\${base}/notes\`)).json()) as unknown[]).length).toBe(1);
    expect((await fetch(\`\${base}/notes/\${note.id}\`, { method: "DELETE" })).status).toBe(204);
    expect((await fetch(\`\${base}/notes/\${note.id}\`)).status).toBe(404);
  });
});

test("a note needs a title", async () => {
  await withApp(async (base) => {
    expect((await post(base, { body: "no title" })).status).toBe(400);
  });
});
`;

const HIDDEN = `import { expect, test } from "vitest";
import { buildApp } from "./app.js";

async function withApp(run: (base: string) => Promise<void>) {
  const server = buildApp().listen(0);
  try {
    const { port } = server.address() as { port: number };
    await run(\`http://127.0.0.1:\${port}\`);
  } finally {
    server.close();
  }
}
const json = { "content-type": "application/json" };
const create = (base: string, payload: unknown) => fetch(\`\${base}/notes\`, { method: "POST", headers: json, body: JSON.stringify(payload) });

test("a created note answers 201 with its id, title and body", async () => {
  await withApp(async (base) => {
    const res = await create(base, { title: "Shopping", body: "milk" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 1, title: "Shopping", body: "milk" });
  });
});

test("a note without a title, or with a blank one, is refused with 400", async () => {
  await withApp(async (base) => {
    expect((await create(base, { body: "x" })).status).toBe(400);
    expect((await create(base, { title: "   " })).status).toBe(400);
    expect((await (await fetch(\`\${base}/notes\`)).json())).toEqual([]);
  });
});

test("notes are listed in the order they were made", async () => {
  await withApp(async (base) => {
    await create(base, { title: "one" });
    await create(base, { title: "two" });
    const list = (await (await fetch(\`\${base}/notes\`)).json()) as Array<{ title: string }>;
    expect(list.map((n) => n.title)).toEqual(["one", "two"]);
  });
});

test("one note can be read, and one that is not there is 404", async () => {
  await withApp(async (base) => {
    await create(base, { title: "one" });
    const ok = await fetch(\`\${base}/notes/1\`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { title: string }).title).toBe("one");
    expect((await fetch(\`\${base}/notes/99\`)).status).toBe(404);
  });
});

test("a note can be deleted once: 204, then it is gone and a second delete is 404", async () => {
  await withApp(async (base) => {
    await create(base, { title: "one" });
    expect((await fetch(\`\${base}/notes/1\`, { method: "DELETE" })).status).toBe(204);
    expect((await fetch(\`\${base}/notes/1\`)).status).toBe(404);
    expect((await fetch(\`\${base}/notes/1\`, { method: "DELETE" })).status).toBe(404);
  });
});

test("ids are not reused after a delete", async () => {
  await withApp(async (base) => {
    await create(base, { title: "one" });
    await fetch(\`\${base}/notes/1\`, { method: "DELETE" });
    const again = (await (await create(base, { title: "two" })).json()) as { id: number };
    expect(again.id).toBe(2);
  });
});
`;

export async function tasks(): Promise<Task[]> {
  const template = Object.fromEntries(scaffoldStep({ kind: "express" }, { name: "notes-api" }).files.map((f) => [f.path, f.content]));
  const m1 = { "src/notes.ts": NOTES, "src/notes.test.ts": NOTES_TEST, "src/app.ts": APP_M1 };
  const m2 = { "src/app.ts": APP_M2, "src/app.test.ts": APP_TEST_M2 };
  return [
    task({
      id: "long-notes-api", title: "A notes API from an empty repository, in two milestones", category: "long", repo: "synthetic",
      request:
        "Build me a small notes API with Express in TypeScript. A note has a title and a body. I want to create a note, list the notes, read one and delete one. "
        + "A note must have a title (400 if it is missing or blank), a missing note is a 404, and ids count up and are never reused. Add tests.",
      difficulty: 4, tags: ["long", "flow", "bakeoff", "ts"],
      base: { empty: true },
      truth: { files: ["src/app.ts", "src/notes.ts"], allowed: ["^PLAN\\.md$", "^package\\.json$", "^tsconfig\\.json$", "^src/", "^\\.env\\.example$", "^\\.gitignore$", "^README\\.md$"] },
      hidden: {
        files: { "src/notes.hidden.test.ts": HIDDEN }, run: ["src/notes.hidden.test.ts"], kind: "tests", minTests: 6,
        command: "npm install --no-audit --no-fund --loglevel=error >/dev/null 2>&1; npx vitest run src/notes.hidden.test.ts --reporter=junit --outputFile=\"$E2E_REPORT\"",
      },
      oracle: {
        kind: "milestones", classify: { type: "plan_project" },
        files: { "PLAN.md": "# Notes API\n\n## Milestones\n\n- M1: notes store, create and list\n- M2: read one, delete one\n", ...template, ...m1, ...m2 },
        milestones: [
          { title: "Notes store, create and list", files: m1, existing: ["src/app.ts"] },
          { title: "Read one, delete one", files: m2, existing: ["src/app.ts", "src/app.test.ts", "src/notes.ts"] },
        ],
        spec: {
          name: "Notes API", summary: "A small REST API for notes: create, list, read and delete, in Express and TypeScript.", users: ["developers who want a notes service"], platforms: ["api"],
          features: [
            { name: "Create and list notes", description: "POST /notes with a required title, GET /notes", priority: "must" },
            { name: "Read and delete a note", description: "GET /notes/:id and DELETE /notes/:id, 404 when missing", priority: "must" },
          ],
          nonGoals: ["Accounts, a database, pagination"], dataModel: [{ entity: "Note", fields: ["id", "title", "body"] }],
          endpoints: [{ method: "POST", path: "/notes", purpose: "create a note" }, { method: "GET", path: "/notes", purpose: "list the notes" }, { method: "GET", path: "/notes/:id", purpose: "read one" }, { method: "DELETE", path: "/notes/:id", purpose: "delete one" }],
          risks: ["Notes live in memory and are lost on a restart"], assumptions: ["No persistence is needed in the first version"],
          needs: { auth: false, database: false, payments: false, seo: false, realtime: false, files: false, ai: false },
        },
      },
      scenario: { milestoneJobs: 2, default: "Just start: use your best judgement and keep it small.", answers: [{ when: ".", say: "Just start, you decide." }], timeoutSec: 480 },
      budgetPaise: 3000,
      checks: {
        suite: false, questions: { max: 5 }, expectPr: true,
        mustContain: [{ path: "PLAN.md", pattern: "Milestone|M1|milestone" }, { path: "package.json", pattern: "express" }, { path: "src/app.ts", pattern: "/notes" }],
      },
    }),
  ];
}
