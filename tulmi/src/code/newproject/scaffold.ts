/**
 * SCAFFOLD: THE OFFICIAL STARTER COMMAND FOR A STACK, NON-INTERACTIVE, AS A STEP FOR THE ENVIRONMENT ROUTER. IT RUNS NOTHING.
 *
 *   scaffoldStep(stack) -> { kind: "exec", starter, commands, files, gitignore, timeoutSec, estimateMinutes, notes }
 *
 * The first milestone of a new project starts from the framework's own generator, not
 * from a model's idea of a project layout: it is what the framework's docs say, it
 * installs the right versions, and it is what anyone who joins the project will
 * recognise. The commands are the generators' own, with the flags that stop them
 * asking questions (a step on a computer nobody is sitting at cannot answer):
 *
 *   next        npx create-next-app@latest . --ts --eslint --app --src-dir --use-npm --yes
 *   vite-react  npm create vite@latest . -- --template react-ts           (vue-ts, svelte-ts for the others)
 *   expo        npx create-expo-app@latest . --template blank-typescript
 *   flutter     flutter create . --platforms=android,ios,web
 *   django      django-admin startproject config .                        (in a virtualenv Tailzu makes)
 *   fastapi     no generator: a minimal template Tailzu writes (app/main.py, a test, requirements.txt)
 *   fastify     likewise (src/app.ts, src/server.ts, a test, package.json, tsconfig.json)
 *   express     likewise
 *
 * A generator wants an empty folder and a new repo is not empty: it has a README and
 * maybe a LICENSE and a .gitignore. So the step first moves what is there aside (a
 * portable `node -e`, which needs nothing the generator does not), runs the starter,
 * and puts back what the starter did not write; what it did write over, the original
 * is kept beside it as `<name>.original`, and the first milestone folds it in. After
 * the starter come the commands that prove it works (install, build, the template's
 * own test).
 *
 * `files` are the template files Tailzu writes itself (fastapi, fastify, express): they
 * are committed through the workspace, so the policy applies to them like any commit,
 * and `gitignore` lists lines to add to the .gitignore if they are not there. The step
 * itself only carries commands, at most 20, each under 2,000 characters, which is what
 * the job router accepts (jobs/types.ts).
 */
import type { Stack, StackKind } from "./types.js";

export interface ScaffoldFile { path: string; content: string }

export interface ScaffoldStep {
  kind: "exec";
  stack: StackKind;
  /** The generator's own command, exactly as run; null for a stack Tailzu writes the template of. */
  starter: string | null;
  /** Everything to run, in order: moving files aside, the starter, putting back, and the proof. */
  commands: string[];
  files: ScaffoldFile[];
  gitignore: string[];
  timeoutSec: number;
  estimateMinutes: number;
  notes: string[];
}

export const STARTERS: Readonly<Record<StackKind, string | null>> = {
  next: "npx create-next-app@latest . --ts --eslint --app --src-dir --use-npm --yes",
  "vite-react": "npm create vite@latest . -- --template react-ts",
  "vite-vue": "npm create vite@latest . -- --template vue-ts",
  "vite-svelte": "npm create vite@latest . -- --template svelte-ts",
  expo: "npx create-expo-app@latest . --template blank-typescript",
  flutter: "flutter create . --platforms=android,ios,web",
  django: "django-admin startproject config .",
  fastapi: null,
  fastify: null,
  express: null,
};

// The folder the repo's existing files wait in while a generator runs.
const KEEP = ".keep-before-scaffold";

const ASIDE = `node -e "const fs=require('fs');fs.mkdirSync('${KEEP}',{recursive:true});for(const f of fs.readdirSync('.')){if(f!=='.git'&&f!=='${KEEP}')fs.renameSync(f,'${KEEP}/'+f)}"`;
const BACK = `node -e "const fs=require('fs');for(const f of fs.readdirSync('${KEEP}')){fs.renameSync('${KEEP}/'+f,fs.existsSync(f)?f+'.original':f)}fs.rmdirSync('${KEEP}')"`;

const PROOF: Record<StackKind, string[]> = {
  next: ["npm run build"],
  "vite-react": ["npm install", "npm run build"],
  "vite-vue": ["npm install", "npm run build"],
  "vite-svelte": ["npm install", "npm run build"],
  expo: ["npx tsc --noEmit"],
  flutter: ["flutter analyze"],
  django: [".venv/bin/python manage.py check"],
  fastapi: ["python -m venv .venv", ".venv/bin/python -m pip install -r requirements.txt", ".venv/bin/python -m pytest -q"],
  fastify: ["npm install", "npm run build", "npm test"],
  express: ["npm install", "npm run build", "npm test"],
};

const slug = (s: string): string => ((s.match(/[A-Za-z0-9]+/g) ?? []).join("-").toLowerCase().slice(0, 40).replace(/-+$/, "")) || "app";

// ----------------------------------------------------------------- our templates

function fastapiFiles(name: string): ScaffoldFile[] {
  return [
    { path: "app/__init__.py", content: "" },
    {
      path: "app/main.py",
      content: `from fastapi import FastAPI\n\napp = FastAPI(title=${JSON.stringify(name)})\n\n\n@app.get("/health")\ndef health() -> dict[str, str]:\n    return {"status": "ok"}\n`,
    },
    {
      path: "tests/test_health.py",
      content: `from fastapi.testclient import TestClient\n\nfrom app.main import app\n\nclient = TestClient(app)\n\n\ndef test_health() -> None:\n    response = client.get("/health")\n    assert response.status_code == 200\n    assert response.json() == {"status": "ok"}\n`,
    },
    { path: "requirements.txt", content: "fastapi>=0.110\nuvicorn[standard]>=0.29\nhttpx>=0.27\npytest>=8\n" },
    { path: "pytest.ini", content: "[pytest]\npythonpath = .\n" },
    { path: ".env.example", content: "PORT=8000\n" },
  ];
}

function nodeApiFiles(name: string, framework: "fastify" | "express"): ScaffoldFile[] {
  const pkg = {
    name: slug(name), version: "0.1.0", private: true, type: "module",
    scripts: { dev: "tsx watch src/server.ts", build: "tsc", start: "node dist/server.js", typecheck: "tsc --noEmit", test: "vitest run" },
    dependencies: framework === "fastify" ? { fastify: "^5.0.0" } : { express: "^4.21.0" },
    devDependencies: {
      "@types/node": "^20.14.0", ...(framework === "express" ? { "@types/express": "^4.17.21" } : {}), tsx: "^4.19.0", typescript: "^5.5.0", vitest: "^2.1.0",
    },
  };
  const tsconfig = { compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", outDir: "dist", rootDir: "src", strict: true, esModuleInterop: true, skipLibCheck: true }, include: ["src"] };
  const app = framework === "fastify"
    ? `import Fastify from "fastify";\n\nexport function buildApp() {\n  const app = Fastify({ logger: false });\n  app.get("/health", async () => ({ status: "ok" }));\n  return app;\n}\n`
    : `import express from "express";\n\nexport function buildApp() {\n  const app = express();\n  app.get("/health", (_req, res) => {\n    res.json({ status: "ok" });\n  });\n  return app;\n}\n`;
  const server = framework === "fastify"
    ? `import { buildApp } from "./app.js";\n\nconst port = Number(process.env.PORT ?? 3000);\nawait buildApp().listen({ port, host: "0.0.0.0" });\n`
    : `import { buildApp } from "./app.js";\n\nconst port = Number(process.env.PORT ?? 3000);\nbuildApp().listen(port, "0.0.0.0");\n`;
  const test = framework === "fastify"
    ? `import { expect, test } from "vitest";\nimport { buildApp } from "./app.js";\n\ntest("health", async () => {\n  const res = await buildApp().inject({ method: "GET", url: "/health" });\n  expect(res.statusCode).toBe(200);\n  expect(res.json()).toEqual({ status: "ok" });\n});\n`
    : `import { expect, test } from "vitest";\nimport { buildApp } from "./app.js";\n\ntest("health", async () => {\n  const server = buildApp().listen(0);\n  try {\n    const { port } = server.address() as { port: number };\n    const res = await fetch(\`http://127.0.0.1:\${port}/health\`);\n    expect(res.status).toBe(200);\n    expect(await res.json()).toEqual({ status: "ok" });\n  } finally {\n    server.close();\n  }\n});\n`;
  return [
    { path: "package.json", content: `${JSON.stringify(pkg, null, 2)}\n` },
    { path: "tsconfig.json", content: `${JSON.stringify(tsconfig, null, 2)}\n` },
    { path: "src/app.ts", content: app },
    { path: "src/server.ts", content: server },
    { path: "src/app.test.ts", content: test },
    { path: ".env.example", content: "PORT=3000\n" },
  ];
}

const GITIGNORE: Partial<Record<StackKind, string[]>> = {
  fastapi: [".venv/", "__pycache__/", ".pytest_cache/", ".env"],
  fastify: ["node_modules/", "dist/", ".env"],
  express: ["node_modules/", "dist/", ".env"],
  django: [".venv/", "__pycache__/", "db.sqlite3", ".env"],
};

// --------------------------------------------------------------------- the step

/** A generator that wants an empty folder. */
const NEEDS_EMPTY: ReadonlySet<StackKind> = new Set(["next", "vite-react", "vite-vue", "vite-svelte", "expo"]);

export function scaffoldStep(stack: Pick<Stack, "kind">, o: { name?: string } = {}): ScaffoldStep {
  const kind = stack.kind;
  const name = (o.name ?? "").trim() || "app";
  const starter = STARTERS[kind];
  const commands: string[] = [];
  const notes: string[] = [];

  if (NEEDS_EMPTY.has(kind)) {
    commands.push(ASIDE, starter!, BACK);
    notes.push("The starter needs an empty folder, so the README and the like are moved aside while it runs and put back after; a file the starter also wrote keeps your original as <name>.original, to be folded in by the first milestone.");
  } else if (kind === "django") {
    commands.push("python -m venv .venv", ".venv/bin/python -m pip install django", ".venv/bin/django-admin startproject config .");
    notes.push("Django is installed in a virtualenv in the repo's folder (.venv), which is not committed.");
  } else if (kind === "flutter") {
    commands.push(starter!);
    notes.push("Needs the Flutter SDK on the computer that runs it.");
  } else if (starter === null) {
    notes.push("There is no official generator for this: X0 Bot writes a small template (the files listed), and the commands only install it and prove it works.");
  }
  commands.push(...PROOF[kind]);

  const files = kind === "fastapi" ? fastapiFiles(name) : kind === "fastify" || kind === "express" ? nodeApiFiles(name, kind) : [];
  const slow = kind === "next" || kind === "expo" || kind === "flutter";
  return {
    kind: "exec", stack: kind, starter, commands: commands.slice(0, 20), files, gitignore: GITIGNORE[kind] ?? [],
    timeoutSec: slow ? 1500 : 900, estimateMinutes: slow ? 8 : 4, notes,
  };
}
