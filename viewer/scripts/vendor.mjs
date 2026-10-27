#!/usr/bin/env node
/**
 * Vendor the libraries an artifact may import (protocol.ts: ARTIFACT_LIBS) into public/vendor/, as pinned, hashed ESM files.
 *
 *   npm run vendor                  fetch + bundle everything (a no-op when public/vendor is already complete)
 *   npm run vendor -- --force       rebuild even so
 *   npm run vendor -- --verify      rebuild and fail if any output differs from vendor.lock.json (CI)
 *   npm run vendor -- --update-lock rebuild and write vendor.lock.json
 *   npm run vendor -- --react=production|development   which React build to ship (default: see REACT_BUILD)
 *
 * Where the packages come from: vendor-src/package.json lists the exact versions and vendor-src/package-lock.json pins the whole
 * dependency tree with the registry's integrity hashes. `npm ci` fetches it from the npm registry and refuses anything that does not
 * match. Each library is then bundled by esbuild into ONE ES module (React and ReactDOM stay external, so every library shares the
 * one React the page loads) and written as  <name>@<version>.<sha256-10>.js : the hash is in the file name, so the file can be
 * cached forever (see public/_headers). Mermaid already ships as ES modules with content-hashed chunks, so its files are copied as
 * they are, into a directory named by a hash of the whole tree.
 *
 * Outputs: public/vendor/manifest.json (import map entries, file list), public/vendor/integrity.json (SHA-384 of every file).
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "vendor-src");
const OUT = join(root, "public", "vendor");
const LOCK = join(root, "vendor.lock.json");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const REACT_BUILD = (args.find((a) => a.startsWith("--react="))?.slice(8)) ?? process.env.VIEWER_REACT_BUILD ?? "development";

// ------------------------------------------------------------------------------------------------ the libraries

/** The ARTIFACT_LIBS of tulmi/src/artifacts/protocol.ts, plus what the viewer itself needs. */
const REQUIRED_SPECS = ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "recharts", "lucide-react", "d3", "three", "mermaid", "@tz/sucrase", "@tz/tailwind"];

const sha = (algo, data, enc = "hex") => createHash(algo).update(data).digest(enc);
const version = (pkg) => JSON.parse(readFileSync(join(SRC, "node_modules", pkg, "package.json"), "utf8")).version;

function readManifest() {
  try {
    return JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8"));
  } catch {
    return null;
  }
}

function upToDate() {
  const m = readManifest();
  if (!m || m.reactBuild !== REACT_BUILD) return false;
  if (!REQUIRED_SPECS.every((s) => m.imports[s])) return false;
  const lock = sha("sha256", readFileSync(join(SRC, "package-lock.json")));
  if (m.lockHash !== lock) return false;
  return Object.values(m.files).every((f) => existsSync(join(OUT, f.path)));
}

if (!flag("force") && !flag("verify") && !flag("update-lock") && upToDate()) {
  console.log("vendor: public/vendor is complete and matches vendor-src/package-lock.json (use --force to rebuild)");
  process.exit(0);
}

// ------------------------------------------------------------------------------------------------ 1. fetch the pinned packages

function ensureInstalled() {
  const stamp = join(SRC, "node_modules", ".package-lock.json");
  const wanted = sha("sha256", readFileSync(join(SRC, "package-lock.json")));
  const have = existsSync(join(SRC, "node_modules", ".tz-lock-hash")) ? readFileSync(join(SRC, "node_modules", ".tz-lock-hash"), "utf8") : "";
  if (existsSync(stamp) && have === wanted) return;
  console.log("vendor: npm ci (vendor-src) …");
  execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", SRC], { stdio: "inherit" });
  writeFileSync(join(SRC, "node_modules", ".tz-lock-hash"), wanted);
}
ensureInstalled();

// ------------------------------------------------------------------------------------------------ 2. bundle

const requireFromSrc = createRequire(join(SRC, "package.json"));
const names = (spec) => Object.keys(requireFromSrc(spec)).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== "default");

/**
 * Keeps `react`, `react-dom`, … as bare specifiers in the output (the page's import map points them at the one vendored copy).
 * An `import` is simply left external. A CommonJS `require()` of one gets a shim that re-exports its named exports from the external,
 * since esbuild cannot turn `require("react")` into an import by itself.
 */
function externals(keep) {
  const shimSource = (spec) => `export { ${names(spec).join(", ")} } from "tz-ext:${spec}";`;
  return {
    name: "tz-externals",
    setup(b) {
      b.onResolve({ filter: /^tz-ext:/ }, (a) => ({ path: a.path.slice(7), external: true }));
      b.onResolve({ filter: /^(react|react-dom|react\/jsx-runtime|react-dom\/client|three)$/ }, (a) => {
        if (!keep.includes(a.path)) return undefined;
        if (a.kind === "require-call") return { path: a.path, namespace: "tz-require-shim" };
        return { path: a.path, external: true };
      });
      b.onLoad({ filter: /.*/, namespace: "tz-require-shim" }, (a) => ({ contents: shimSource(a.path), resolveDir: SRC }));
    },
  };
}

const stubTsInterfaceChecker = {
  name: "stub-ts-interface-checker",
  setup(b) {
    b.onResolve({ filter: /^ts-interface-checker$/ }, () => ({ path: "tic", namespace: "tz-stub" }));
    // Sucrase checks its options against a type description (Options-gen-types.js); the viewer passes fixed options, so the checker is a no-op.
    b.onLoad({ filter: /.*/, namespace: "tz-stub" }, () => ({
      contents:
        "const noop = () => ({});\nexport const array = noop, iface = noop, lit = noop, opt = noop, union = noop;\n" +
        "export const createCheckers = () => ({ Options: { strictCheck() {} } });",
    }));
  },
};

/**
 * d3-dsv (d3.csvParse and friends) builds a row-reading function with `new Function` for speed. The viewer's CSP has no 'unsafe-eval',
 * so the same function is written as a plain closure. Same result, a little slower on huge files.
 */
const noEvalDsv = {
  name: "d3-dsv-no-eval",
  setup(b) {
    b.onLoad({ filter: /d3-dsv[\\/]src[\\/]dsv\.js$/ }, (a) => {
      const text = readFileSync(a.path, "utf8");
      const re = /function objectConverter\(columns\) \{[\s\S]*?\n\}/;
      if (!re.test(text)) throw new Error("d3-dsv changed: objectConverter was not found, so it cannot be made eval-free");
      const closure = 'function objectConverter(columns) {\n  return function(d) {\n    var o = {};\n    for (var i = 0; i < columns.length; i++) o[columns[i]] = d[i] || "";\n    return o;\n  };\n}';
      return { contents: text.replace(re, () => closure), loader: "js" };
    });
  },
};

const REACT_ALL = ["react", "react-dom", "react/jsx-runtime", "react-dom/client"];

async function bundle(contents, keep, extraPlugins = []) {
  const r = await build({
    stdin: { contents, resolveDir: SRC, loader: "js", sourcefile: "entry.js" },
    absWorkingDir: SRC,
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "none",
    logLevel: "error",
    define: { "process.env.NODE_ENV": JSON.stringify(REACT_BUILD === "production" ? "production" : "development"), global: "globalThis" },
    plugins: [externals(keep), ...extraPlugins],
  });
  return Buffer.from(r.outputFiles[0].contents);
}

const reexportAll = (pkg) => `import * as ns from "${pkg}"; export * from "${pkg}"; export default ns;`;

const files = {}; // file name (relative to public/vendor) → { bytes, sha256, sha384 }
const imports = {}; // import specifier → /vendor/<file>

function emit(name, ext, data, specs) {
  const hash = sha("sha256", data).slice(0, 10);
  const file = `${name}.${hash}.${ext}`;
  writeFileSync(join(OUT, file), data);
  files[file] = { path: file, bytes: data.length, sha256: sha("sha256", data), sha384: "sha384-" + sha("sha384", data, "base64") };
  for (const s of specs) imports[s] = `/vendor/${file}`;
  console.log(`  ${file.padEnd(58)} ${(data.length / 1024).toFixed(0).padStart(6)} KB`);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

console.log(`vendor: bundling (React ${REACT_BUILD} build) …`);

const reactV = version("react");
const reactDomV = version("react-dom");

// React: the CommonJS package becomes an ES module with real named exports.
emit(
  `react@${reactV}`,
  "js",
  await bundle(`import R from "react"; export default R; export const { ${names("react").join(", ")} } = R;`, []),
  ["react"],
);
emit(
  `react-jsx-runtime@${reactV}`,
  "js",
  await bundle(`import R from "react/jsx-runtime"; export default R; export const { ${names("react/jsx-runtime").join(", ")} } = R;`, ["react"]),
  ["react/jsx-runtime", "react/jsx-dev-runtime"],
);
{
  const dom = names("react-dom");
  const client = names("react-dom/client");
  emit(
    `react-dom@${reactDomV}`,
    "js",
    await bundle(
      `import D from "react-dom"; import C from "react-dom/client"; export default D;\n` +
        // createRoot and hydrateRoot come from react-dom/client: the ones react-dom itself exports only warn that they should be imported from there.
        `export const { ${dom.filter((n) => !client.includes(n)).join(", ")} } = D;\nexport const { ${client.join(", ")} } = C;`,
      ["react"],
    ),
    ["react-dom", "react-dom/client"],
  );
}

const recharts = version("recharts");
emit(`recharts@${recharts}`, "js", await bundle(`export * from "recharts";`, REACT_ALL), ["recharts"]);
const lucide = version("lucide-react");
emit(`lucide-react@${lucide}`, "js", await bundle(`export * from "lucide-react";`, REACT_ALL), ["lucide-react"]);
const d3 = version("d3");
emit(`d3@${d3}`, "js", await bundle(reexportAll("d3"), [], [noEvalDsv]), ["d3"]);
const three = version("three");
emit(`three@${three}`, "js", await bundle(reexportAll("three"), []), ["three"]);
// The addon most three.js code reaches for. It shares the one vendored `three`.
emit(
  `three-orbit-controls@${three}`,
  "js",
  await bundle(`export * from "three/examples/jsm/controls/OrbitControls.js";`, ["three"]),
  ["three/addons/controls/OrbitControls.js", "three/examples/jsm/controls/OrbitControls.js"],
);

// The viewer's own tools: the compiler and Tailwind's browser runtime (a classic script, not a module).
const sucrase = version("sucrase");
emit(`sucrase@${sucrase}`, "js", await bundle(`export { transform } from "sucrase";`, [], [stubTsInterfaceChecker]), ["@tz/sucrase"]);
const tailwind = version("@tailwindcss/browser");
emit(`tailwind-browser@${tailwind}`, "js", readFileSync(join(SRC, "node_modules/@tailwindcss/browser/dist/index.global.js")), ["@tz/tailwind"]);

// Mermaid ships ES modules whose lazily loaded chunks have content-hashed names already: copied as they are.
{
  const mermaidV = version("mermaid");
  const from = join(SRC, "node_modules/mermaid/dist");
  const list = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".mjs") && (p === join(from, "mermaid.esm.min.mjs") || p.includes(join("chunks", "mermaid.esm.min")))) list.push(p);
    }
  };
  walk(from);
  list.sort();
  const tree = createHash("sha256");
  for (const p of list) tree.update(relative(from, p)).update(readFileSync(p));
  const dirName = `mermaid@${mermaidV}.${tree.digest("hex").slice(0, 10)}`;
  for (const p of list) {
    const target = join(OUT, dirName, relative(from, p));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(p, target);
    const data = readFileSync(target);
    const rel = join(dirName, relative(from, p));
    files[rel] = { path: rel, bytes: data.length, sha256: sha("sha256", data), sha384: "sha384-" + sha("sha384", data, "base64") };
  }
  imports["mermaid"] = `/vendor/${dirName}/mermaid.esm.min.mjs`;
  const total = list.reduce((n, p) => n + statSync(p).size, 0);
  console.log(`  ${(dirName + "/ (" + list.length + " files)").padEnd(58)} ${(total / 1024).toFixed(0).padStart(6)} KB`);
}

// ------------------------------------------------------------------------------------------------ 3. record

const libs = Object.fromEntries(
  ["react", "react-dom", "recharts", "lucide-react", "d3", "three", "mermaid", "sucrase", "@tailwindcss/browser"].map((p) => [p, version(p)]),
);
const totalBytes = Object.values(files).reduce((n, f) => n + f.bytes, 0);
const manifest = {
  reactBuild: REACT_BUILD,
  lockHash: sha("sha256", readFileSync(join(SRC, "package-lock.json"))),
  libs,
  imports,
  files,
  totalBytes,
};
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(
  join(OUT, "integrity.json"),
  JSON.stringify({ algorithm: "sha384", libs, files: Object.fromEntries(Object.values(files).map((f) => [f.path, f.sha384])) }, null, 2) + "\n",
);
console.log(`vendor: ${Object.keys(files).length} files, ${(totalBytes / 1048576).toFixed(2)} MB in public/vendor`);

// ------------------------------------------------------------------------------------------------ 4. lock

const outputs = Object.fromEntries(Object.values(files).map((f) => [f.path, f.sha256]));
const lock = { esbuild: JSON.parse(readFileSync(join(root, "node_modules/esbuild/package.json"), "utf8")).version, reactBuild: REACT_BUILD, libs, outputs };
if (flag("update-lock")) {
  writeFileSync(LOCK, JSON.stringify(lock, null, 2) + "\n");
  console.log("vendor: wrote vendor.lock.json");
} else if (flag("verify")) {
  const want = JSON.parse(readFileSync(LOCK, "utf8"));
  const bad = [];
  for (const [f, h] of Object.entries(outputs)) if (want.outputs[f] !== h) bad.push(`changed or new: ${f}`);
  for (const f of Object.keys(want.outputs)) if (!outputs[f]) bad.push(`missing: ${f}`);
  if (bad.length) {
    console.error("vendor: the output does not match vendor.lock.json:\n  " + bad.join("\n  "));
    process.exit(1);
  }
  console.log("vendor: output matches vendor.lock.json");
}
