/**
 * COMPLEX REASONING TASKS: THE KINDS THE FIRST PAID REALITY RUN SHOWED THE SET WAS THIN ON (e2e/REALITY.md, 2026-10-28).
 *
 *   commander-refactor-storagekey    a rename across modules with every call site (lib/option.js, lib/command.js, the typings), an alias kept, checked by
 *                                    behaviour (a subclass that overrides the new name changes the key everywhere) AND by no call of the old name left in lib/
 *   commander-feat-deprecated-option a feature through four layers: the Option class, the parser (a warning when used), the help, the typings
 *   express-bug-trust-proxy-hops     a bug whose cause is far from its symptom: a client can spoof req.ip behind one proxy (request.js) because the hop-count
 *                                    trust function is off by one (utils.js compileTrust, reached through application.js's settings). Planted as a refactor
 *   commander-bug-transposition-test a fix that needs a NEW TEST: the hidden check runs the agent's own regression test against the library without the fix
 *                                    (it must fail) and with it (it must pass), so a test that tests nothing does not pass
 *   express-vague-notfound-json      a vague request that needs a question: "make not-found better for API clients" has several designs; the scripted
 *                                    person names one (JSON body with fields) only when asked, and the hidden tests check that one
 *   express-lang-json-sort-hinglish  a feature asked in Hinglish: a `json sort keys` setting for res.json and res.jsonp, nested, arrays kept, replacer kept
 *
 * Every hidden test checks behaviour through the public API (and, for the new test, by running it), with names and shapes the request states, so the only
 * way through is to do what was asked. `npm run e2e:author -- complex` writes e2e/tasks/complex.json; `npm run e2e:validate -- --tasks tag:complex --write`
 * proves each fair: the base fails the hidden tests, the oracle passes them, and the project's own suite keeps passing.
 */
import type { Task } from "../schema.js";
import { baseText, edit, edits, task } from "./lib.js";

const RUBRIC_ASK = [
  "The bot asked about the detail that was actually missing (what the not-found response should look like for API clients), not about things it could see in the code",
  "The question is short and specific, with at most a few options",
  "It did not start changing code before it had the answer, and did not invent requirements the person never gave",
];

// ------------------------------------------------------------ commander: attributeName() -> storageKey()

async function commanderStorageKey(): Promise<Task> {
  const opt = await baseText("commander", "lib/option.js");
  const cmd = await baseText("commander", "lib/command.js");
  const dts = await baseText("commander", "typings/index.d.ts");
  const optNew = edits(opt, [
    [
      "  /**\n   * Return option name, in a camelcase format that can be used\n   * as an object attribute key.\n   *\n   * @return {string}\n   */\n\n  attributeName() {\n    if (this.negate) {\n      return camelcase(this.name().replace(/^no-/, ''));\n    }\n    return camelcase(this.name());\n  }\n",
      "  /**\n   * Return the key the option's value is stored under: the option name in camelcase,\n   * without the `no-` of a negated option.\n   *\n   * @return {string}\n   */\n\n  storageKey() {\n    if (this.negate) {\n      return camelcase(this.name().replace(/^no-/, ''));\n    }\n    return camelcase(this.name());\n  }\n\n  /**\n   * The old name of storageKey(), kept for compatibility.\n   *\n   * @deprecated use storageKey()\n   * @return {string}\n   */\n\n  attributeName() {\n    return this.storageKey();\n  }\n",
    ],
    ["option.attributeName()", "option.storageKey()", 3],
  ]);
  const cmdNew = edit(cmd, ".attributeName()", ".storageKey()", cmd.split(".attributeName()").length - 1);
  const dtsNew = edit(dts, "  /**\n   * Return option name, in a camelcase format that can be used\n   * as an object attribute key.\n   */\n  attributeName(): string;\n",
    "  /**\n   * Return the key the option's value is stored under: the option name in camelcase,\n   * without the `no-` of a negated option.\n   */\n  storageKey(): string;\n\n  /**\n   * The old name of storageKey(), kept for compatibility.\n   *\n   * @deprecated use storageKey()\n   */\n  attributeName(): string;\n");
  const test = `import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Command, Option } from '../index.js';

class Prefixed extends Option {
  storageKey() {
    return 'x_' + super.storageKey();
  }
}

afterEach(() => {
  delete process.env.STORAGE_KEY_TEST_PORT;
});

describe('Option.storageKey()', () => {
  test('is the camelCase key of the long name', () => {
    assert.equal(new Option('--dry-run').storageKey(), 'dryRun');
    assert.equal(new Option('-p, --port-number <n>').storageKey(), 'portNumber');
  });

  test('of a negated option is the key of the positive option', () => {
    assert.equal(new Option('--no-colour').storageKey(), 'colour');
  });

  test('attributeName() still works and gives the same key', () => {
    assert.equal(new Option('--dry-run').attributeName(), 'dryRun');
    assert.equal(new Option('--no-colour').attributeName(), 'colour');
  });

  test('a subclass that overrides storageKey() changes attributeName() too', () => {
    assert.equal(new Prefixed('--port <n>').attributeName(), 'x_port');
  });

  test('a value from the command line is stored under storageKey()', () => {
    const program = new Command();
    program.addOption(new Prefixed('--port <n>'));
    program.parse(['--port', '80'], { from: 'user' });
    assert.deepEqual(program.opts(), { x_port: '80' });
  });

  test('a default value is stored under storageKey()', () => {
    const program = new Command();
    program.addOption(new Prefixed('--level <n>').default('3'));
    program.parse([], { from: 'user' });
    assert.deepEqual(program.opts(), { x_level: '3' });
  });

  test('a value from the environment is stored under storageKey()', () => {
    process.env.STORAGE_KEY_TEST_PORT = '8080';
    const program = new Command();
    program.addOption(new Prefixed('--port <n>').env('STORAGE_KEY_TEST_PORT'));
    program.parse([], { from: 'user' });
    assert.deepEqual(program.opts(), { x_port: '8080' });
  });

  test('a negated pair shares the key from storageKey()', () => {
    const program = new Command();
    program.addOption(new Prefixed('--colour'));
    program.addOption(new Prefixed('--no-colour'));
    program.parse(['--no-colour'], { from: 'user' });
    assert.deepEqual(program.opts(), { x_colour: false });
  });

  test('a lone negated option defaults to true under storageKey()', () => {
    const program = new Command();
    program.addOption(new Prefixed('--no-cache'));
    program.parse([], { from: 'user' });
    assert.deepEqual(program.opts(), { x_cache: true });
  });

  test('the typings declare storageKey()', () => {
    const dts = fs.readFileSync(new URL('../typings/index.d.ts', import.meta.url), 'utf8');
    assert.match(dts, /\\bstorageKey\\(\\)\\s*:\\s*string;/);
  });
});
`;
  return task({
    id: "commander-refactor-storagekey",
    title: "Rename Option#attributeName() to storageKey() across the code base",
    category: "refactor",
    repo: "commander",
    request:
      "Rename `Option#attributeName()` to `Option#storageKey()` throughout commander: the method itself, every place the library calls it, and the TypeScript typings. "
      + "Keep `attributeName()` as a deprecated alias that just returns `this.storageKey()`, so existing code keeps working and a subclass of Option that overrides `storageKey()` "
      + "changes the key under which commander stores that option's value everywhere (values from the command line, defaults, environment variables, negated `--no-` options).",
    difficulty: 4,
    tags: ["refactor", "complex", "multi-file", "rename", "commander"],
    truth: { files: ["lib/option.js", "lib/command.js", "typings/index.d.ts"], allowed: ["^tests/", "^typings/index\\.test-d\\.ts$", "^CHANGELOG\\.md$", "^docs/", "^Readme"] },
    hidden: { files: { "tests/option.storageKey.hidden.test.js": test }, run: ["tests/option.storageKey.hidden.test.js"], kind: "tests", minTests: 10 },
    oracle: { kind: "patch", files: { "lib/option.js": optNew, "lib/command.js": cmdNew, "typings/index.d.ts": dtsNew }, classify: { type: "refactor" }, plan: "Rename the method, keep an alias, change every call in lib/ and the typings" },
    checks: {
      suite: true, questions: { max: 1 }, expectPr: true,
      // Every call in the library goes through the new name (the alias's own definition has no dot in front, so it is not a call).
      noLeftovers: [{ pattern: "[\\w)\\]]\\.attributeName\\(", except: ["^(?!lib/|index\\.js$)"] }],
    },
  });
}

// ------------------------------------------------------------ commander: Option#deprecated()

async function commanderDeprecatedOption(): Promise<Task> {
  const opt = await baseText("commander", "lib/option.js");
  const cmd = await baseText("commander", "lib/command.js");
  const help = await baseText("commander", "lib/help.js");
  const dts = await baseText("commander", "typings/index.d.ts");
  const optNew = edits(opt, [
    ["    this.helpGroupHeading = undefined; // soft initialised when option added to command\n  }\n", "    this.helpGroupHeading = undefined; // soft initialised when option added to command\n    this.deprecationMessage = undefined; // a string (maybe empty) once the option is deprecated\n  }\n"],
    [
      "  /**\n   * Set the help group heading.\n",
      "  /**\n   * Mark the option as deprecated: it still works, using it on the command line writes a warning,\n   * and the help says so.\n   *\n   * @param {string} [message] - shown after the warning, like what to use instead\n   * @return {Option}\n   */\n\n  deprecated(message) {\n    this.deprecationMessage = message === undefined ? '' : String(message);\n    return this;\n  }\n\n  /**\n   * Set the help group heading.\n",
    ],
  ]);
  const cmdNew = edits(cmd, [
    [
      "  _prepareForParse() {\n",
      "  _prepareForParse() {\n    // deprecated options warn once per parse\n    this._deprecationsWarned = new Set();\n",
    ],
    [
      "    this.on('option:' + oname, (val) => {\n      const invalidValueMessage = `error: option '${option.flags}' argument '${val}' is invalid.`;\n",
      "    this.on('option:' + oname, (val) => {\n      if (option.deprecationMessage !== undefined) {\n        if (!this._deprecationsWarned) this._deprecationsWarned = new Set();\n        if (!this._deprecationsWarned.has(option)) {\n          this._deprecationsWarned.add(option);\n          const why = option.deprecationMessage ? `: ${option.deprecationMessage}` : '';\n          this._outputConfiguration.writeErr(\n            `warning: option '${option.flags}' is deprecated${why}\\n`,\n          );\n        }\n      }\n      const invalidValueMessage = `error: option '${option.flags}' argument '${val}' is invalid.`;\n",
    ],
  ]);
  const helpNew = edit(help, "    if (option.envVar !== undefined) {\n      extraInfo.push(`env: ${option.envVar}`);\n    }\n", "    if (option.envVar !== undefined) {\n      extraInfo.push(`env: ${option.envVar}`);\n    }\n    if (option.deprecationMessage !== undefined) {\n      extraInfo.push('deprecated');\n    }\n");
  const dtsNew = edit(dts, "  /**\n   * Set the help group heading.\n   */\n  helpGroup(heading: string): this;\n", "  /**\n   * Mark the option as deprecated: it still works, using it on the command line writes a warning, and the help says so.\n   */\n  deprecated(message?: string): this;\n\n  /**\n   * Set the help group heading.\n   */\n  helpGroup(heading: string): this;\n", 1);
  const test = `import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Command, Option } from '../index.js';

function program() {
  const said = [];
  const p = new Command();
  p.exitOverride().configureOutput({ writeErr: (s) => said.push(s), writeOut: () => {} });
  return { p, said };
}

describe('Option.deprecated()', () => {
  test('returns the option, for chaining', () => {
    const o = new Option('--old');
    assert.equal(o.deprecated('use --new'), o);
  });

  test('using it on the command line warns once, with the message, and the value is still set', () => {
    const { p, said } = program();
    p.addOption(new Option('--old-name <value>').deprecated('use --name'));
    p.parse(['--old-name', 'a'], { from: 'user' });
    assert.equal(p.opts().oldName, 'a');
    assert.deepEqual(said, ["warning: option '--old-name <value>' is deprecated: use --name\\n"]);
  });

  test('without a message the warning ends after "deprecated"', () => {
    const { p, said } = program();
    p.addOption(new Option('-q, --quiet').deprecated());
    p.parse(['-q'], { from: 'user' });
    assert.equal(p.opts().quiet, true);
    assert.deepEqual(said, ["warning: option '-q, --quiet' is deprecated\\n"]);
  });

  test('warns once per parse however often the option is given', () => {
    const { p, said } = program();
    p.addOption(new Option('--tag <t...>').deprecated('use --label'));
    p.parse(['--tag', 'a', '--tag', 'b'], { from: 'user' });
    assert.deepEqual(p.opts().tag, ['a', 'b']);
    assert.equal(said.length, 1);
  });

  test('says nothing when the option is not used, or comes from a default or the environment', () => {
    process.env.DEPRECATED_OPTION_TEST = 'x';
    try {
      const { p, said } = program();
      p.addOption(new Option('--mode <m>').deprecated('gone').default('fast'));
      p.addOption(new Option('--zone <z>').deprecated('gone').env('DEPRECATED_OPTION_TEST'));
      p.option('--other');
      p.parse(['--other'], { from: 'user' });
      assert.equal(p.opts().mode, 'fast');
      assert.equal(p.opts().zone, 'x');
      assert.deepEqual(said, []);
    } finally {
      delete process.env.DEPRECATED_OPTION_TEST;
    }
  });

  test('is not an error: the action still runs', () => {
    const { p, said } = program();
    let ran = false;
    p.addOption(new Option('--legacy').deprecated()).action(() => { ran = true; });
    p.parse(['--legacy'], { from: 'user' });
    assert.equal(ran, true);
    assert.equal(said.length, 1);
  });

  test('a subcommand option warns too', () => {
    const { p, said } = program();
    const sub = p.command('build');
    sub.addOption(new Option('--fast').deprecated('it is always fast now')).action(() => {});
    p.parse(['build', '--fast'], { from: 'user' });
    assert.deepEqual(said, ["warning: option '--fast' is deprecated: it is always fast now\\n"]);
  });

  test('the help shows that the option is deprecated', () => {
    const { p } = program();
    p.addOption(new Option('--old-name <value>', 'the old way').deprecated('use --name'));
    p.option('--name <value>', 'the new way');
    const help = p.helpInformation();
    const line = help.split('\\n').find((l) => l.includes('--old-name'));
    assert.ok(line, help);
    assert.match(line, /\\bdeprecated\\b/);
    const other = help.split('\\n').find((l) => l.includes('--name <value>') && !l.includes('--old-name'));
    assert.doesNotMatch(other, /deprecated/);
  });

  test('the typings declare deprecated()', () => {
    const dts = fs.readFileSync(new URL('../typings/index.d.ts', import.meta.url), 'utf8');
    assert.match(dts, /\\bdeprecated\\(\\s*\\w+\\?\\s*:\\s*string\\s*\\)\\s*:\\s*this;/);
  });
});
`;
  return task({
    id: "commander-feat-deprecated-option",
    title: "Deprecated options: a warning when used, a mark in the help, the typings",
    category: "feature",
    repo: "commander",
    request:
      "Add `Option#deprecated(message?)` so a CLI can retire an option gently. It returns the option (for chaining). A deprecated option still works exactly as before, "
      + "but when it is given on the command line commander writes ONE warning per parse to the error output (the command's `writeErr` from `configureOutput`): "
      + "`warning: option '<flags>' is deprecated: <message>` followed by a newline, or `warning: option '<flags>' is deprecated` when there is no message, "
      + "where <flags> is the option's flags as declared (e.g. `--old-name <value>`). It is not an error and does not stop the action. No warning when the value only comes "
      + "from a default or an environment variable. This must work for options of subcommands too. In the help, a deprecated option's line says `deprecated` "
      + "(next to the default/env information). Add it to the TypeScript typings.",
    difficulty: 4,
    tags: ["feature", "complex", "multi-file", "layers", "commander"],
    truth: { files: ["lib/option.js", "lib/command.js", "lib/help.js", "typings/index.d.ts"], allowed: ["^tests/", "^typings/index\\.test-d\\.ts$", "^CHANGELOG\\.md$", "^docs/", "^Readme", "^examples/"] },
    hidden: { files: { "tests/option.deprecated.hidden.test.js": test }, run: ["tests/option.deprecated.hidden.test.js"], kind: "tests", minTests: 9 },
    oracle: { kind: "patch", files: { "lib/option.js": optNew, "lib/command.js": cmdNew, "lib/help.js": helpNew, "typings/index.d.ts": dtsNew }, classify: { type: "feature" }, plan: "Option#deprecated(), a warning in the option listener once per parse, the help's extra info, the typings" },
    checks: { suite: true, questions: { max: 1 }, expectPr: true },
  });
}

// ------------------------------------------------------------ express: trust proxy hop count (planted, far from the symptom)

async function expressTrustProxyHops(): Promise<Task> {
  const utils = await baseText("express", "lib/utils.js");
  const right = "    // Support trusting hop count\n    return function(a, i){ return i < val };\n";
  // The planted change looks like a tidy-up of the comment: the comparison moved by one.
  const wrong = "    // Support trusting hop count (val hops are trusted)\n    return function(a, i){ return i <= val };\n";
  const planted = edit(utils, right, wrong);
  const fixed = edit(planted, wrong, right);
  if (fixed !== utils) throw new Error("the trust proxy fix does not give the pinned text back");
  const test = `'use strict'

var assert = require('node:assert')
var express = require('../')
  , request = require('supertest');

function ipApp(trust) {
  var app = express();
  app.set('trust proxy', trust);
  app.get('/', function (req, res) {
    res.json({ ip: req.ip, ips: req.ips, protocol: req.protocol, socket: req.socket.remoteAddress });
  });
  return app;
}

describe('trust proxy as a number of hops', function () {
  it('with 1 hop, a client cannot spoof req.ip with its own X-Forwarded-For', function (done) {
    request(ipApp(1))
      .get('/')
      .set('X-Forwarded-For', '6.6.6.6, 1.2.3.4')
      .expect(200)
      .expect(function (res) {
        assert.strictEqual(res.body.ip, '1.2.3.4')
        assert.deepStrictEqual(res.body.ips, ['1.2.3.4'])
      })
      .end(done)
  })

  it('with 2 hops, req.ip is the address the outer proxy saw', function (done) {
    request(ipApp(2))
      .get('/')
      .set('X-Forwarded-For', '6.6.6.6, 1.2.3.4, 10.0.0.2')
      .expect(200)
      .expect(function (res) {
        assert.strictEqual(res.body.ip, '1.2.3.4')
        assert.deepStrictEqual(res.body.ips, ['1.2.3.4', '10.0.0.2'])
      })
      .end(done)
  })

  it('with 0 hops, the forwarded header is not believed at all', function (done) {
    request(ipApp(0))
      .get('/')
      .set('X-Forwarded-For', '6.6.6.6')
      .set('X-Forwarded-Proto', 'https')
      .expect(200)
      .expect(function (res) {
        assert.strictEqual(res.body.ip, res.body.socket)
        assert.deepStrictEqual(res.body.ips, [])
        assert.strictEqual(res.body.protocol, 'http')
      })
      .end(done)
  })

  it('with 1 hop, X-Forwarded-Proto from the proxy is believed', function (done) {
    request(ipApp(1))
      .get('/')
      .set('X-Forwarded-For', '1.2.3.4')
      .set('X-Forwarded-Proto', 'https')
      .expect(200)
      .expect(function (res) {
        assert.strictEqual(res.body.ip, '1.2.3.4')
        assert.strictEqual(res.body.protocol, 'https')
      })
      .end(done)
  })

  it('true still trusts every hop', function (done) {
    request(ipApp(true))
      .get('/')
      .set('X-Forwarded-For', '6.6.6.6, 1.2.3.4')
      .expect(200)
      .expect(function (res) {
        assert.strictEqual(res.body.ip, '6.6.6.6')
      })
      .end(done)
  })

  it('a mounted app inherits the hop count', function (done) {
    var app = express();
    var api = express();
    app.set('trust proxy', 1);
    api.get('/', function (req, res) { res.json({ ip: req.ip }) });
    app.use('/api', api);
    request(app)
      .get('/api/')
      .set('X-Forwarded-For', '6.6.6.6, 1.2.3.4')
      .expect(200, { ip: '1.2.3.4' }, done)
  })
})
`;
  return task({
    id: "express-bug-trust-proxy-hops",
    title: "A client can spoof req.ip behind one proxy (the cause is two modules away)",
    category: "bug",
    repo: "express",
    base: { commit: (await import("../../repos.js")).getRepo("express").pin, planted: { "lib/utils.js": planted }, message: "refactor: tidy the trust proxy helpers" },
    request:
      "Security report from a customer: their app runs behind exactly one load balancer and sets `app.set('trust proxy', 1)` as the docs say. "
      + "A client can spoof `req.ip`: when it sends its own `X-Forwarded-For: 6.6.6.6`, the load balancer appends the real address (so the app receives `6.6.6.6, <real address>`), "
      + "and `req.ip` comes out as 6.6.6.6 instead of the real address; `req.ips` lists the spoofed address too. Find out why and fix it.",
    difficulty: 4,
    tags: ["bug", "complex", "far-from-symptom", "security", "express"],
    truth: { files: ["lib/utils.js"], near: ["lib/request.js", "lib/application.js"], allowed: ["^test/", "^History\\.md$"] },
    hidden: { files: { "test/req.trust-hops.hidden.js": test }, run: ["test/req.trust-hops.hidden.js"], kind: "tests", minTests: 6 },
    oracle: { kind: "patch", files: { "lib/utils.js": fixed }, classify: { type: "bug_fix" }, plan: "The hop-count trust function in lib/utils.js compileTrust trusts one hop too many; trust only hops below the count" },
    checks: { suite: true, questions: { max: 1 }, expectPr: true },
  });
}

// ------------------------------------------------------------ commander: transposition in suggestions, with a regression test of the agent's own

async function commanderTranspositionTest(): Promise<Task> {
  const sim = await baseText("commander", "lib/suggestSimilar.js");
  const tests = await baseText("commander", "tests/help.suggestion.test.js");
  const block = "      // transposition\n      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {\n        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);\n      }\n";
  const buggy = edit(sim, block, "");
  const plantedTests = edits(tests, [
    ["      ['act', ['cat'], 'cat', '1 transposition'],\n", ""],
    ["      ['--act', ['--cat'], '--cat', '1 transposition'],\n", ""],
  ]);
  const NEW_TEST = "tests/suggestSimilar.transposition.test.js";
  const ownTest = `import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Command } from '../index.js';

function suggestionFor(program, args) {
  let message = '';
  program
    .showSuggestionAfterError()
    .exitOverride()
    .configureOutput({ writeErr: (str) => { message = str; } });
  try {
    program.parse(args, { from: 'user' });
  } catch {
    /* the error is expected */
  }
  const match = message.match(/Did you mean (one of )?(.*)\\?/);
  return match ? match[2] : null;
}

describe('suggestions count two swapped letters as one edit', () => {
  test('a swapped command name is suggested', () => {
    const program = new Command();
    program.command('ls');
    assert.equal(suggestionFor(program, ['sl']), 'ls');
  });

  test('a swapped option name is suggested', () => {
    const program = new Command();
    program.option('--dry');
    assert.equal(suggestionFor(program, ['--dyr']), '--dry');
  });
});
`;
  const hidden = `import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Command } from '../index.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// A test runner started from inside a test is told so by NODE_TEST_CONTEXT, and then reports to its parent instead of exiting with its own status: drop it.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
const OWN = ${JSON.stringify(NEW_TEST)};
// lib/suggestSimilar.js as it was before the fix
const WITHOUT_FIX = ${JSON.stringify(buggy)};

function suggestionFor(program, args) {
  let message = '';
  program
    .showSuggestionAfterError()
    .exitOverride()
    .configureOutput({ writeErr: (str) => { message = str; } });
  try {
    program.parse(args, { from: 'user' });
  } catch {
    /* the error is expected */
  }
  const match = message.match(/Did you mean (one of )?(.*)\\?/);
  return match ? match[2] : null;
}

describe('two swapped letters are one edit', () => {
  test('commands', () => {
    const program = new Command();
    program.command('ls');
    program.command('rm');
    assert.equal(suggestionFor(program, ['sl']), 'ls');
  });

  test('options', () => {
    const program = new Command();
    program.option('--dry').option('--yes');
    assert.equal(suggestionFor(program, ['--dyr']), '--dry');
  });

  test('a swap is as close as a deletion, so both are suggested', () => {
    const program = new Command();
    program.command('test');
    program.command('set');
    assert.equal(suggestionFor(program, ['tset']), 'set, test');
  });

  test('a short word with a swap', () => {
    const program = new Command();
    program.command('cat');
    assert.equal(suggestionFor(program, ['act']), 'cat');
  });

  test('a distance of two is still two', () => {
    const program = new Command();
    program.command('cat');
    assert.equal(suggestionFor(program, ['cxx']), null);
  });
});

describe('the regression test that was asked for', () => {
  test(OWN + ' passes with the fix', () => {
    const own = path.join(ROOT, OWN);
    assert.ok(fs.existsSync(own), OWN + ' is missing');
    const run = spawnSync(process.execPath, ['--test', own], { cwd: ROOT, encoding: 'utf8', env: ENV });
    assert.equal(run.status, 0, 'it fails with the fix:\\n' + run.stdout + run.stderr);
  });

  test(OWN + ' fails without the fix', () => {
    const own = path.join(ROOT, OWN);
    assert.ok(fs.existsSync(own), OWN + ' is missing');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-without-fix-'));
    try {
      fs.cpSync(path.join(ROOT, 'lib'), path.join(tmp, 'lib'), { recursive: true });
      fs.cpSync(path.join(ROOT, 'tests'), path.join(tmp, 'tests'), { recursive: true });
      fs.copyFileSync(path.join(ROOT, 'index.js'), path.join(tmp, 'index.js'));
      fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(tmp, 'package.json'));
      fs.writeFileSync(path.join(tmp, 'lib', 'suggestSimilar.js'), WITHOUT_FIX);
      const run = spawnSync(process.execPath, ['--test', path.join(tmp, OWN)], { cwd: tmp, encoding: 'utf8', env: ENV });
      assert.notEqual(run.status, 0, 'it passes without the fix, so it does not test the fix:\\n' + run.stdout);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
`;
  return task({
    id: "commander-bug-transposition-test",
    title: "Swapped letters get no suggestion: fix it and prove it with a new regression test",
    category: "bug",
    repo: "commander",
    base: { commit: (await import("../../repos.js")).getRepo("commander").pin, planted: { "lib/suggestSimilar.js": buggy, "tests/help.suggestion.test.js": plantedTests }, message: "refactor: simplify the edit distance" },
    request:
      "Users who swap two letters no longer get a \"Did you mean\" suggestion: with a command `ls`, typing `sl` gets none, and with an option `--dry`, typing `--dyr` gets none; "
      + "it used to suggest them. Fix it so that two swapped neighbouring letters count as a single edit again, and add a regression test in "
      + "`tests/suggestSimilar.transposition.test.js` (node:test, importing from '../index.js' like the other tests) that fails without your fix and passes with it.",
    difficulty: 3,
    tags: ["bug", "complex", "needs-test", "commander"],
    truth: { files: ["lib/suggestSimilar.js"], allowed: ["^tests/", "^CHANGELOG\\.md$"] },
    hidden: { files: { "tests/suggestSimilar.transposition.hidden.test.js": hidden }, run: ["tests/suggestSimilar.transposition.hidden.test.js"], kind: "tests", minTests: 7 },
    oracle: { kind: "patch", files: { "lib/suggestSimilar.js": sim, [NEW_TEST]: ownTest }, classify: { type: "bug_fix" }, plan: "Restore the transposition step of the edit distance and add a regression test that fails without it" },
    checks: { suite: true, questions: { max: 1 }, expectPr: true, mustContain: [{ path: NEW_TEST, pattern: "node:test" }] },
  });
}

// ------------------------------------------------------------ express: a vague request about not-found for API clients

async function expressVagueNotFound(): Promise<Task> {
  const app = await baseText("express", "lib/application.js");
  const appNew = edits(app, [
    [
      "app.handle = function handle(req, res, callback) {\n  // final handler\n  var done = callback || finalhandler(req, res, {\n    env: this.get('env'),\n    onerror: logerror.bind(this)\n  });\n",
      "app.handle = function handle(req, res, callback) {\n  // final handler\n  var final = callback || finalhandler(req, res, {\n    env: this.get('env'),\n    onerror: logerror.bind(this)\n  });\n\n  // a client that prefers JSON is told what was not found in JSON\n  var done = callback || function notFound(err) {\n    if (!err && !res.headersSent && req.accepts(['html', 'json']) === 'json') {\n      var body = JSON.stringify({ error: 'Not Found', method: req.method, path: parseUrl.original(req).pathname })\n      res.statusCode = 404\n      res.setHeader('Content-Type', 'application/json; charset=utf-8')\n      res.setHeader('Content-Length', Buffer.byteLength(body))\n      res.end(req.method === 'HEAD' ? undefined : body)\n      return\n    }\n    final(err)\n  };\n",
    ],
    ["var finalhandler = require('finalhandler');\n", "var finalhandler = require('finalhandler');\nvar parseUrl = require('parseurl');\nconst { Buffer } = require('node:buffer');\n"],
  ]);
  const test = `'use strict'

var assert = require('node:assert')
var express = require('../')
  , request = require('supertest');

function app() {
  var a = express();
  a.get('/users', function (req, res) { res.json(['tobi']) });
  a.get('/boom', function (req, res, next) { next(new Error('boom')) });
  return a;
}

describe('not found, for clients that prefer JSON', function () {
  it('should answer 404 with a JSON body naming the method and the path', function (done) {
    request(app())
      .get('/nope')
      .set('Accept', 'application/json')
      .expect('Content-Type', /^application\\/json/)
      .expect(404, { error: 'Not Found', method: 'GET', path: '/nope' }, done)
  })

  it('should leave the query string out of the path', function (done) {
    request(app())
      .post('/missing/thing?x=1&y=2')
      .set('Accept', 'application/json')
      .expect(404, { error: 'Not Found', method: 'POST', path: '/missing/thing' }, done)
  })

  it('should give the full path inside a mounted app', function (done) {
    var parent = express();
    parent.use('/api', app());
    request(parent)
      .get('/api/nope')
      .set('Accept', 'application/json')
      .expect(404, { error: 'Not Found', method: 'GET', path: '/api/nope' }, done)
  })

  it('should keep the HTML page for clients that prefer HTML', function (done) {
    request(app())
      .get('/nope')
      .set('Accept', 'text/html')
      .expect('Content-Type', /^text\\/html/)
      .expect(404, /Cannot GET \\/nope/, done)
  })

  it('should keep the HTML page when the client accepts anything', function (done) {
    request(app())
      .get('/nope')
      .set('Accept', '*/*')
      .expect(404, /Cannot GET \\/nope/, done)
  })

  it('should not touch routes that exist', function (done) {
    request(app())
      .get('/users')
      .set('Accept', 'application/json')
      .expect(200, ['tobi'], done)
  })

  it('should leave errors to the error handler', function (done) {
    var a = app();
    a.set('env', 'test');
    request(a)
      .get('/boom')
      .set('Accept', 'application/json')
      .expect(500)
      .expect(function (res) {
        assert.notDeepStrictEqual(res.body, { error: 'Not Found', method: 'GET', path: '/boom' })
      })
      .end(done)
  })
})
`;
  const precise = "When no route matches and the client prefers JSON (its Accept header picks json over html, as `req.accepts(['html', 'json'])` says), "
    + "respond 404 with `Content-Type: application/json` and exactly the body `{\"error\":\"Not Found\",\"method\":\"GET\",\"path\":\"/the/path\"}`: the request's method, "
    + "and the full path the client asked for (inside a mounted app too) without the query string. Clients that prefer HTML or accept anything keep today's HTML page, "
    + "routes that exist are untouched, and errors (`next(err)`) still go to the normal error handling. Do it in express itself, for every app.";
  return task({
    id: "express-vague-notfound-json",
    title: "\"Make not-found better for our API clients\"",
    category: "vague",
    repo: "express",
    request: "Our API clients get an HTML page back when they call a URL that doesn't exist, which their code can't read. Can you make not-found handling in express better for them?",
    difficulty: 4,
    tags: ["vague", "complex", "flow", "express"],
    truth: { files: ["lib/application.js"], allowed: ["^test/", "^History\\.md$", "^Readme\\.md$", "^lib/"] },
    hidden: { files: { "test/app.notfound-json.hidden.js": test }, run: ["test/app.notfound-json.hidden.js"], kind: "tests", minTests: 7 },
    oracle: { kind: "ask_then_patch", ask: { question: "What should an API client get for a URL that does not exist: a JSON body (with which fields?), or only a status code? And should HTML clients keep today's page?", options: ["JSON with the method and path, HTML stays", "Only the status code"] }, files: { "lib/application.js": appNew }, classify: { type: "feature" } },
    scenario: { answers: [{ when: ".", say: `Here is exactly what I mean. ${precise}` }] },
    rubric: RUBRIC_ASK,
    checks: { suite: true, questions: { min: 1, max: 2 }, expectPr: true },
  });
}

// ------------------------------------------------------------ express: json sort keys, asked in Hinglish

async function expressJsonSortHinglish(): Promise<Task> {
  const res = await baseText("express", "lib/response.js");
  const resNew = edits(res, [
    ["  var replacer = app.get('json replacer');\n  var spaces = app.get('json spaces');\n  var body = stringify(obj, replacer, spaces, escape)\n\n  // content-type\n  if (!this.get('Content-Type')) {\n    this.set('Content-Type', 'application/json');\n  }\n\n  return this.send(body);",
      "  var replacer = sortedReplacer(app.get('json replacer'), app.get('json sort keys'));\n  var spaces = app.get('json spaces');\n  var body = stringify(obj, replacer, spaces, escape)\n\n  // content-type\n  if (!this.get('Content-Type')) {\n    this.set('Content-Type', 'application/json');\n  }\n\n  return this.send(body);"],
    ["  var replacer = app.get('json replacer');\n  var spaces = app.get('json spaces');\n  var body = stringify(obj, replacer, spaces, escape)\n  var callback = this.req.query[app.get('jsonp callback name')];",
      "  var replacer = sortedReplacer(app.get('json replacer'), app.get('json sort keys'));\n  var spaces = app.get('json spaces');\n  var body = stringify(obj, replacer, spaces, escape)\n  var callback = this.req.query[app.get('jsonp callback name')];"],
    ["/**\n * Stringify JSON, like JSON.stringify, but v8 optimized, with the\n",
      "/**\n * The \"json replacer\" to stringify with: the app's own, and, when the\n * \"json sort keys\" setting is on, one that sends object keys in\n * alphabetical order (arrays keep their order).\n *\n * @param {function|Array} replacer\n * @param {boolean} sort\n * @returns {function|Array}\n * @private\n */\n\nfunction sortedReplacer (replacer, sort) {\n  if (!sort) {\n    return replacer\n  }\n\n  return function (key, value) {\n    var val = typeof replacer === 'function'\n      ? replacer.call(this, key, value)\n      : value\n\n    if (val === null || typeof val !== 'object' || Array.isArray(val)) {\n      return val\n    }\n\n    var sorted = {}\n    Object.keys(val).sort().forEach(function (k) {\n      sorted[k] = val[k]\n    })\n    return sorted\n  }\n}\n\n/**\n * Stringify JSON, like JSON.stringify, but v8 optimized, with the\n"],
  ]);
  const test = `'use strict'

var express = require('../')
  , request = require('supertest');

function app(settings) {
  var a = express();
  Object.keys(settings).forEach(function (k) { a.set(k, settings[k]) });
  a.get('/json', function (req, res) {
    res.json({ zeta: 1, alpha: { yak: true, bee: [3, 1, 2], aardvark: { z: 0, a: 0 } }, mid: [{ y: 1, b: 2 }] });
  });
  a.get('/jsonp', function (req, res) {
    res.jsonp({ b: 1, a: 2 });
  });
  return a;
}

describe('the "json sort keys" setting', function () {
  it('should send object keys in alphabetical order, at every depth, with arrays in their own order', function (done) {
    request(app({ 'json sort keys': true }))
      .get('/json')
      .expect(200, '{"alpha":{"aardvark":{"a":0,"z":0},"bee":[3,1,2],"yak":true},"mid":[{"b":2,"y":1}],"zeta":1}', done)
  })

  it('should be off by default: keys stay in the order they were set', function (done) {
    request(app({}))
      .get('/json')
      .expect(200, '{"zeta":1,"alpha":{"yak":true,"bee":[3,1,2],"aardvark":{"z":0,"a":0}},"mid":[{"y":1,"b":2}]}', done)
  })

  it('should stay off when set to false', function (done) {
    request(app({ 'json sort keys': false }))
      .get('/jsonp')
      .expect(200, '{"b":1,"a":2}', done)
  })

  it('should sort res.jsonp() too, with and without a callback', function (done) {
    var a = app({ 'json sort keys': true });
    request(a)
      .get('/jsonp')
      .expect(200, '{"a":2,"b":1}', function (err) {
        if (err) return done(err)
        request(a)
          .get('/jsonp?callback=cb')
          .expect(200, /cb\\(\\{"a":2,"b":1\\}\\);/, done)
      })
  })

  it('should work with "json spaces"', function (done) {
    request(app({ 'json sort keys': true, 'json spaces': 2 }))
      .get('/jsonp')
      .expect(200, '{\\n  "a": 2,\\n  "b": 1\\n}', done)
  })

  it('should keep a "json replacer" function working', function (done) {
    request(app({ 'json sort keys': true, 'json replacer': function (key, val) { return key === 'yak' ? undefined : val } }))
      .get('/json')
      .expect(200, '{"alpha":{"aardvark":{"a":0,"z":0},"bee":[3,1,2]},"mid":[{"b":2,"y":1}],"zeta":1}', done)
  })

  it('should leave values that are not objects alone', function (done) {
    var a = express();
    a.set('json sort keys', true);
    a.get('/', function (req, res) { res.json([3, 'b', null, true]) });
    request(a)
      .get('/')
      .expect(200, '[3,"b",null,true]', done)
  })
})
`;
  return task({
    id: "express-lang-json-sort-hinglish",
    title: "A json sort keys setting, asked in Hinglish",
    category: "language",
    language: "hinglish",
    repo: "express",
    request:
      "Humare API ke JSON responses mein keys har baar alag order mein aati hain, isliye snapshot tests aur caching (ETag) mein dikkat hoti hai. Express mein ek naya app setting "
      + "`json sort keys` add karo: jab `app.set('json sort keys', true)` ho, to `res.json()` aur `res.jsonp()` objects ki keys alphabetical order mein bhejein, nested objects "
      + "mein bhi; arrays ka order bilkul waisa hi rahe. Default `false` rahe (abhi jaisa behaviour, keys usi order mein jaise set hui thi). `json spaces` aur function wala "
      + "`json replacer` dono iske saath kaam karte rahne chahiye.",
    difficulty: 3,
    tags: ["language", "hinglish", "complex", "express"],
    front: { intent: "code_task" },
    truth: { files: ["lib/response.js"], allowed: ["^test/", "^History\\.md$", "^Readme\\.md$", "^lib/application\\.js$"] },
    hidden: { files: { "test/res.json.sort-keys.hidden.js": test }, run: ["test/res.json.sort-keys.hidden.js"], kind: "tests", minTests: 7 },
    oracle: { kind: "patch", files: { "lib/response.js": resNew }, classify: { type: "feature" }, plan: "A replacer that sorts object keys when the setting is on, wrapped around the app's own replacer, for res.json and res.jsonp" },
    checks: { suite: true, questions: { max: 1 }, expectPr: true },
  });
}

export async function tasks(): Promise<Task[]> {
  return [
    await commanderStorageKey(),
    await commanderDeprecatedOption(),
    await expressTrustProxyHops(),
    await commanderTranspositionTest(),
    await expressVagueNotFound(),
    await expressJsonSortHinglish(),
  ];
}
