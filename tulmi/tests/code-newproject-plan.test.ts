/**
 * PLAN.md AND THE SCAFFOLD (src/code/newproject/planDoc.ts, scaffold.ts).
 *
 * planMarkdown(spec, stack): goals, the stack with its reasons, the data and the screens, milestones M0 (scaffold, CI,
 * preview) to the last, each with scope, acceptance criteria and the checks, the risks, a definition of done, and a hand-off
 * section for deploying on their own host. Pure: the same spec and stack make the same file.
 *
 * scaffoldStep(stack): the official starter command per stack, non-interactive, with the exact flags, as a step for the
 * environment router. Nothing is run here, except, in a scratch folder, the two small `node -e` commands that move a new
 * repo's README and the like out of the starter's way and back, which must really work.
 */
import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { planMarkdown, planMilestones, checksFor, envNames } = await import("../src/code/newproject/planDoc.js");
const { scaffoldStep, STARTERS } = await import("../src/code/newproject/scaffold.js");
const { chooseStack } = await import("../src/code/newproject/spec.js");
const { STACK_KINDS } = await import("../src/code/newproject/types.js");
type Spec = import("../src/code/newproject/types.js").Spec;
type Stack = import("../src/code/newproject/types.js").Stack;
type StackKind = import("../src/code/newproject/types.js").StackKind;

const feature = (name: string, priority: "must" | "should" | "later", description = `${name} works.`) => ({ name, description, priority });

const SPEC: Spec = {
  name: "Yoga Book", summary: "A booking site for yoga studios.", users: ["studio owners", "students"], platforms: ["web"],
  features: [feature("Book a class", "must", "Pick a class and a time."), feature("Pay", "must"), feature("Class schedule", "must"), feature("Reminders", "should"), feature("Video classes", "later")],
  nonGoals: ["Video classes", "Mobile apps"], dataModel: [{ entity: "Class", fields: ["title", "starts_at"] }, { entity: "Booking", fields: ["class_id", "user_id"] }],
  surfaces: { screens: [{ name: "Schedule", purpose: "See the week's classes." }], endpoints: [{ method: "POST", path: "/api/book", purpose: "Book a class." }] },
  risks: ["Payments need care."], assumptions: ["One studio to start."],
  needs: { auth: true, database: true, payments: true, seo: true, realtime: false, files: false, ai: false }, source: "model",
};

const STACK: Stack = chooseStack(SPEC, { request: "on Vercel" });

const headings = (md: string, level: string) => md.split("\n").filter((l) => l.startsWith(`${level} `));

describe("planMarkdown", () => {
  const md = planMarkdown(SPEC, STACK, { date: "2026-10-26" });

  it("has its sections in order", () => {
    expect(headings(md, "##")).toEqual(["## Goals", "## Stack", "## Data", "## Screens", "## Endpoints", "## Milestones", "## Risks and assumptions", "## Definition of done", "## Hand-off: deploying on your own host"]);
    expect(md.startsWith("# Yoga Book: plan\n")).toBe(true);
    expect(md.endsWith("\n")).toBe(true);
    expect(md).not.toMatch(/\n{3,}/);
  });

  it("says its goals: the summary, who it is for, where it runs, what is in and what is not", () => {
    expect(md).toContain("A booking site for yoga studios.");
    expect(md).toContain("**Who it is for:** studio owners; students.");
    expect(md).toContain("**Where it runs:** the website.");
    expect(headings(md, "###").slice(0, 3)).toEqual(["### In the first version", "### If time allows", "### Not in the first version"]);
    expect(md).toContain("- **Book a class**: Pick a class and a time.");
    expect(md).toContain("- Video classes (later)");
    expect(md).toContain("- Mobile apps");
  });

  it("says the stack with the reasons and each part", () => {
    expect(md).toContain("**Next.js (App Router, TypeScript)**");
    for (const r of STACK.reasons) expect(md).toContain(`- ${r}`);
    expect(md).toContain("- **Supabase (Postgres)** (database):");
    expect(md).toContain("- **Stripe** (payments):");
    expect(md).toContain("**Hosting:** Vercel.");
  });

  it("has a milestone for the scaffold first, and each has its scope, acceptance criteria as checkboxes, and checks", () => {
    const ms = headings(md, "###").filter((h) => /^### M\d/.test(h));
    expect(ms[0]).toBe("### M0: Scaffold, CI and preview");
    expect(ms.length).toBe(planMilestones(SPEC, STACK).length);
    const m0 = md.slice(md.indexOf("### M0:"), md.indexOf("### M1:"));
    expect(m0).toContain("**Scope**");
    expect(m0).toContain("Set up Next.js (App Router, TypeScript) with its official starter, in this repo.");
    expect(m0).toContain("(A workflow file is a change X0 Bot asks you to approve.)");
    expect(m0).toContain("Connect Vercel so every pull request gets a preview link");
    expect(m0).toContain("**Acceptance criteria**");
    expect(m0).toMatch(/- \[ \] The app starts locally and shows its first page\./);
    expect(m0).toContain("**Checks**");
    for (const c of checksFor("next")) expect(m0).toContain(`- \`${c}\``);
  });

  it("has a definition of done and a hand-off with the host, the build settings, the variables by name, the database, a domain, and how to take X0 Bot away", () => {
    const done = md.slice(md.indexOf("## Definition of done"), md.indexOf("## Hand-off"));
    expect(done).toMatch(/- \[ \] Every must-have feature has been accepted\./);
    expect(done).toContain("`npx tsc --noEmit`");
    const hand = md.slice(md.indexOf("## Hand-off"));
    expect(hand).toContain("1. **The code is yours.**");
    expect(hand).toContain("2. **Make an account on Vercel**");
    expect(hand).toContain("The framework preset is Next.js");
    expect(hand).toContain("- `NEXT_PUBLIC_SUPABASE_URL`");
    expect(hand).toContain("- `SUPABASE_SERVICE_ROLE_KEY (server only)`");
    expect(hand).toContain("- `STRIPE_SECRET_KEY (server only)`");
    expect(hand).toContain("`supabase/migrations`");
    expect(hand).toContain("**A domain:**");
    expect(hand).toContain("**Taking X0 Bot's access away:**");
    // never a value, only names
    expect(hand).not.toMatch(/sk_(live|test)|eyJ/);
  });

  it("is the same file for the same spec and stack", () => {
    expect(planMarkdown(SPEC, STACK, { date: "2026-10-26" })).toBe(md);
  });

  it("says when it was made from the answers alone, and leaves out what it has none of", () => {
    const plain = planMarkdown({ ...SPEC, source: "rules", dataModel: [], surfaces: { screens: [], endpoints: [] }, risks: [], assumptions: [], features: [], needs: { ...SPEC.needs, auth: false, database: false, payments: false } }, chooseStack({ ...SPEC, needs: { ...SPEC.needs, auth: false, database: false, payments: false } }));
    expect(plain).toContain("from your answers alone");
    expect(headings(plain, "##")).not.toContain("## Data");
    expect(headings(plain, "##")).not.toContain("## Risks and assumptions");
    expect(plain).toContain("_Nothing was listed. Say what it must do and this section fills in._");
    expect(plain).toContain("**Environment variables:**".replace("**Environment variables:**", "3. **Environment variables:** none are needed yet"));
    expect(plain).toContain("4. **The database:** this project does not keep data yet");
  });
});

describe("the milestones", () => {
  it("M0 is the scaffold; accounts and data follow when the spec needs them; the must-haves go three at a time, then the should-haves; launch readiness is last", () => {
    const ms = planMilestones({ ...SPEC, features: [...Array.from({ length: 7 }, (_, i) => feature(`Must ${i}`, "must")), feature("Nice", "should")] }, STACK);
    expect(ms.map((m) => m.k)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(ms.map((m) => m.title)).toEqual([
      "Scaffold, CI and preview", "Accounts and data", "Core: Must 0, Must 1, Must 2", "Core: Must 3, Must 4, Must 5", "Core: Must 6", "More: Nice", "Launch readiness",
    ]);
  });

  it("no accounts or data milestone when the spec needs neither; a data-only one is named Data", () => {
    const none = planMilestones({ ...SPEC, needs: { ...SPEC.needs, auth: false, database: false } }, STACK);
    expect(none.some((m) => /Accounts|Data/.test(m.title))).toBe(false);
    expect(planMilestones({ ...SPEC, needs: { ...SPEC.needs, auth: false, database: true } }, STACK)[1]!.title).toBe("Data");
  });

  it("acceptance criteria are things a person can check, and name the feature", () => {
    const core = planMilestones(SPEC, STACK).find((m) => m.title.startsWith("Core"))!;
    expect(core.acceptance[0]).toBe("Book a class: Pick a class and a time works from start to finish on the website.");
    expect(core.acceptance).toEqual(expect.arrayContaining(["Each of these has a test for its main path.", "No secret, key or password is in the code or in git."]));
    expect(core.acceptance.join(" ")).toMatch(/Payments work in test mode only/);
    expect(core.scope[0]).toBe("Book a class: Pick a class and a time.");
    expect(core.checks).toEqual(checksFor("next"));
  });

  it("launch readiness covers search engines when the site should be found, and payments when it takes them", () => {
    const launch = planMilestones(SPEC, STACK).at(-1)!;
    expect(launch.title).toBe("Launch readiness");
    expect(launch.scope.join(" ")).toMatch(/sitemap/);
    expect(launch.scope.join(" ")).toMatch(/payment launch checklist/);
    const plain = planMilestones({ ...SPEC, needs: { ...SPEC.needs, seo: false, payments: false } }, STACK).at(-1)!;
    expect(plain.scope.join(" ")).not.toMatch(/sitemap|payment launch/);
  });

  it("the checks are the stack's", () => {
    expect(checksFor("fastapi")).toEqual(["python -m pytest -q"]);
    expect(checksFor("flutter")).toEqual(["flutter analyze", "flutter test"]);
    expect(checksFor("expo")).toEqual(["npx tsc --noEmit", "npm test"]);
    for (const k of STACK_KINDS) expect(checksFor(k).length, k).toBeGreaterThan(0);
  });

  it("the environment variables are named for the stack and never given a value", () => {
    expect(envNames(SPEC, STACK)).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY (server only)", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_SECRET_KEY (server only)", "STRIPE_WEBHOOK_SECRET (server only)"]);
    const vite = chooseStack({ ...SPEC, needs: { ...SPEC.needs, seo: false, payments: false } });
    expect(envNames(SPEC, vite)).toEqual(["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]);
    const api = chooseStack({ ...SPEC, platforms: ["api"], needs: { ...SPEC.needs, payments: false, ai: true } });
    expect(envNames({ ...SPEC, needs: { ...SPEC.needs, ai: true, payments: false } }, api)).toEqual(["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY (server only)", "MODEL_API_KEY (server only)", "PORT"]);
  });

  it("the hand-off tells each stack's build settings", () => {
    const text = (kind: StackKind, host = "Vercel") => planMarkdown({ ...SPEC, needs: { ...SPEC.needs, auth: false, database: false, payments: false } }, { ...chooseStack(SPEC), kind, hosting: { name: host, tier: "free", note: "n" } }).split("## Hand-off")[1]!;
    expect(text("vite-react", "Cloudflare Pages")).toMatch(/Build output directory: `dist`/);
    expect(text("vite-vue", "Netlify")).toMatch(/Publish directory: `dist`/);
    expect(text("expo")).toMatch(/eas build --platform all/);
    expect(text("fastapi", "Render")).toMatch(/uvicorn app\.main:app --host 0\.0\.0\.0 --port \$PORT/);
    expect(text("fastify", "Render")).toMatch(/Start command: `npm start`/);
    expect(text("django", "Render")).toMatch(/gunicorn config\.wsgi/);
    expect(text("flutter")).toMatch(/flutter build apk/);
  });
});

// --------------------------------------------------------------------- scaffold

/** The JavaScript of a `node -e "..."` command. */
const jsOf = (cmd: string): string => /^node -e "(.*)"$/s.exec(cmd)![1]!;

describe("scaffoldStep: the official starter, non-interactive, with the exact flags", () => {
  it("Next.js", () => {
    const s = scaffoldStep({ kind: "next" });
    expect(s.starter).toBe("npx create-next-app@latest . --ts --eslint --app --src-dir --use-npm --yes");
    expect(s.kind).toBe("exec");
    expect(s.commands).toContain(s.starter);
    expect(s.commands.at(-1)).toBe("npm run build");
  });

  it("Vite with React, Vue and Svelte", () => {
    expect(scaffoldStep({ kind: "vite-react" }).starter).toBe("npm create vite@latest . -- --template react-ts");
    expect(scaffoldStep({ kind: "vite-vue" }).starter).toBe("npm create vite@latest . -- --template vue-ts");
    expect(scaffoldStep({ kind: "vite-svelte" }).starter).toBe("npm create vite@latest . -- --template svelte-ts");
    expect(scaffoldStep({ kind: "vite-react" }).commands.slice(-2)).toEqual(["npm install", "npm run build"]);
  });

  it("Expo, Flutter and Django", () => {
    expect(scaffoldStep({ kind: "expo" }).starter).toBe("npx create-expo-app@latest . --template blank-typescript");
    expect(scaffoldStep({ kind: "flutter" }).starter).toBe("flutter create . --platforms=android,ios,web");
    const dj = scaffoldStep({ kind: "django" });
    expect(dj.starter).toBe("django-admin startproject config .");
    expect(dj.commands).toEqual(["python -m venv .venv", ".venv/bin/python -m pip install django", ".venv/bin/django-admin startproject config .", ".venv/bin/python manage.py check"]);
    expect(dj.gitignore).toEqual([".venv/", "__pycache__/", "db.sqlite3", ".env"]);
  });

  it("FastAPI, Fastify and Express have no official generator: X0 Bot writes a minimal template", () => {
    const api = scaffoldStep({ kind: "fastapi" }, { name: "Yoga Book" });
    expect(api.starter).toBeNull();
    expect(api.files.map((f) => f.path)).toEqual(["app/__init__.py", "app/main.py", "tests/test_health.py", "requirements.txt", "pytest.ini", ".env.example"]);
    expect(api.files.find((f) => f.path === "app/main.py")!.content).toContain('app = FastAPI(title="Yoga Book")');
    expect(api.files.find((f) => f.path === "app/main.py")!.content).toContain('@app.get("/health")');
    expect(api.files.find((f) => f.path === "requirements.txt")!.content).toMatch(/fastapi>=0\.\d+\nuvicorn\[standard\]>=/);
    expect(api.commands).toEqual(["python -m venv .venv", ".venv/bin/python -m pip install -r requirements.txt", ".venv/bin/python -m pytest -q"]);
    expect(api.gitignore).toContain(".venv/");
    expect(api.notes[0]).toMatch(/no official generator/);

    for (const kind of ["fastify", "express"] as const) {
      const s = scaffoldStep({ kind }, { name: "Yoga Book!" });
      const pkg = JSON.parse(s.files.find((f) => f.path === "package.json")!.content);
      expect(pkg).toMatchObject({ name: "yoga-book", type: "module", private: true, scripts: { build: "tsc", start: "node dist/server.js", test: "vitest run", typecheck: "tsc --noEmit" } });
      expect(Object.keys(pkg.dependencies)).toEqual([kind]);
      expect(JSON.parse(s.files.find((f) => f.path === "tsconfig.json")!.content).compilerOptions).toMatchObject({ strict: true, outDir: "dist" });
      expect(s.files.map((f) => f.path)).toEqual(["package.json", "tsconfig.json", "src/app.ts", "src/server.ts", "src/app.test.ts", ".env.example"]);
      expect(s.files.find((f) => f.path === "src/app.ts")!.content).toContain('"/health"');
      expect(s.commands).toEqual(["npm install", "npm run build", "npm test"]);
      expect(s.gitignore).toEqual(["node_modules/", "dist/", ".env"]);
    }
  });

  it("every stack has a step the job router accepts: at most 20 commands of 2,000 characters, a timeout and an estimate in range", () => {
    for (const kind of STACK_KINDS) {
      const s = scaffoldStep({ kind });
      expect(s.stack).toBe(kind);
      expect(s.commands.length, kind).toBeGreaterThan(0);
      expect(s.commands.length, kind).toBeLessThanOrEqual(20);
      for (const c of s.commands) { expect(c.length, kind).toBeLessThanOrEqual(2000); expect(c.trim(), kind).not.toBe(""); }
      expect(s.timeoutSec).toBeGreaterThan(0);
      expect(s.timeoutSec).toBeLessThanOrEqual(3600);
      expect(s.estimateMinutes).toBeGreaterThan(0);
      expect(s.estimateMinutes).toBeLessThanOrEqual(360);
      expect(s.starter, kind).toBe(STARTERS[kind]);
      // a starter is run exactly as it is written, never with a prompt to answer
      if (s.starter) expect(s.starter).not.toMatch(/--interactive|\binit\b$/);
    }
  });

  it("nothing is run and no file is written: it only returns the step", () => {
    const before = readdirSync(tmpdir()).length;
    scaffoldStep({ kind: "fastapi" });
    expect(readdirSync(tmpdir()).length).toBe(before);
  });

  it("the commands that move a new repo's files out of the starter's way, and back, really do", () => {
    const s = scaffoldStep({ kind: "vite-react" });
    const [aside, starter, back] = s.commands as [string, string, string];
    expect(starter).toBe(s.starter);
    const dir = mkdtempSync(join(tmpdir(), "scaffold-"));
    try {
      const run = (cmd: string) => execFileSync(process.execPath, ["-e", jsOf(cmd)], { cwd: dir });
      mkdirSync(join(dir, ".git"));
      writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
      writeFileSync(join(dir, "README.md"), "# my app\n");
      writeFileSync(join(dir, "LICENSE"), "MIT\n");
      writeFileSync(join(dir, ".gitignore"), "node_modules\n");

      run(aside);
      expect(readdirSync(dir).sort()).toEqual([".git", ".keep-before-scaffold"]);
      expect(readdirSync(join(dir, ".keep-before-scaffold")).sort()).toEqual([".gitignore", "LICENSE", "README.md"]);

      // the starter writes its own README and package.json (and its own .gitignore)
      writeFileSync(join(dir, "README.md"), "# Vite + React\n");
      writeFileSync(join(dir, "package.json"), "{}\n");
      writeFileSync(join(dir, ".gitignore"), "dist\n");

      run(back);
      expect(existsSync(join(dir, ".keep-before-scaffold"))).toBe(false);
      expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("# Vite + React\n");
      expect(readFileSync(join(dir, "README.md.original"), "utf8")).toBe("# my app\n");
      expect(readFileSync(join(dir, ".gitignore.original"), "utf8")).toBe("node_modules\n");
      expect(readFileSync(join(dir, "LICENSE"), "utf8")).toBe("MIT\n");
      expect(readFileSync(join(dir, ".git", "HEAD"), "utf8")).toBe("ref: refs/heads/main\n");
      expect(existsSync(join(dir, "package.json"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("only the stacks whose starter wants an empty folder get the move-aside", () => {
    for (const kind of ["next", "vite-react", "vite-vue", "vite-svelte", "expo"] as const) expect(scaffoldStep({ kind }).commands[0], kind).toMatch(/^node -e /);
    for (const kind of ["flutter", "django", "fastapi", "fastify", "express"] as const) expect(scaffoldStep({ kind }).commands.some((c) => c.startsWith("node -e")), kind).toBe(false);
  });
});
