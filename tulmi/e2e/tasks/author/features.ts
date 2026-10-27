/**
 * FEATURES WITH HIDDEN ACCEPTANCE TESTS: A SPECIFIED CHANGE, MOSTLY ACROSS SEVERAL FILES, ON REAL PROJECTS.
 *
 * Each request states the behaviour precisely (the names, the shapes, the edge cases), because a hidden test that checks an unstated name would be unfair.
 * What it does not state is where in the code the change goes, or how: finding that is the task.
 */
import type { Task } from "../schema.js";
import { baseText, edit, edits, task } from "./lib.js";

// ------------------------------------------------------------ body-parser: rawBody

async function bodyParserRawBody(): Promise<Task> {
  const utils = await baseText("body-parser", "lib/utils.js");
  const read = await baseText("body-parser", "lib/read.js");
  const readme = await baseText("body-parser", "README.md");
  const utilsNew = edits(utils, [
    ["  const defaultCharset = options?.defaultCharset || 'utf-8'\n", "  const defaultCharset = options?.defaultCharset || 'utf-8'\n  const rawBody = options?.rawBody === true\n"],
    ["    defaultCharset,\n    shouldParse\n", "    defaultCharset,\n    rawBody,\n    shouldParse\n"],
  ]);
  const readNew = edits(read, [
    ["  const verify = options.verify\n", "  const verify = options.verify\n  // the verify callback and the rawBody option both need the bytes as they arrived\n  const wantsBuffer = Boolean(verify) || options.rawBody === true\n"],
    ["  if (verify && encoding !== null && !iconv.encodingExists(encoding)) {", "  if (wantsBuffer && encoding !== null && !iconv.encodingExists(encoding)) {"],
    ["    encoding: verify ? null : encoding,", "    encoding: wantsBuffer ? null : encoding,"],
    ["    // parse\n    let str = body\n", "    // keep the undecoded bytes for the caller (a webhook signature is computed over them)\n    if (options.rawBody === true) {\n      req.rawBody = body\n    }\n\n    // parse\n    let str = body\n"],
  ]);
  const docs = "##### rawBody\n\nWhen set to `true`, the raw bytes of the request body (after any `Content-Encoding`\nhas been undone, before the charset is decoded) are kept on `req.rawBody` as a\n`Buffer`. Defaults to `false`.\n\n##### verify\n";
  const readmeNew = edit(readme, "##### verify\n", docs, 4);
  const test = `'use strict'

const { describe, it } = require('mocha')
const assert = require('node:assert')
const http = require('node:http')
const zlib = require('node:zlib')
const request = require('supertest')

const bodyParser = require('..')

function createServer (kind, opts) {
  const parse = bodyParser[kind](opts)
  return http.createServer(function (req, res) {
    parse(req, res, function (err) {
      res.statusCode = err ? (err.status || 500) : 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({
        raw: Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('base64') : null,
        hasRaw: 'rawBody' in req && req.rawBody !== undefined,
        error: err ? err.type || err.message : null
      }))
    })
  })
}

const CASES = [
  ['json', 'application/json', '{"user":"tobi"}'],
  ['urlencoded', 'application/x-www-form-urlencoded', 'user=tobi&pet=ferret'],
  ['text', 'text/plain', 'user is tobi'],
  ['raw', 'application/octet-stream', Buffer.from([1, 2, 3, 250, 251])]
]

describe('the rawBody option', function () {
  for (const [kind, type, payload] of CASES) {
    describe('bodyParser.' + kind + '()', function () {
      it('should keep the raw bytes on req.rawBody when rawBody is true', function (done) {
        request(createServer(kind, { rawBody: true }))
          .post('/')
          .set('Content-Type', type)
          .send(payload)
          .expect(200)
          .expect(function (res) {
            assert.strictEqual(res.body.raw, Buffer.from(payload).toString('base64'))
          })
          .end(done)
      })

      it('should not set req.rawBody by default', function (done) {
        request(createServer(kind))
          .post('/')
          .set('Content-Type', type)
          .send(payload)
          .expect(200)
          .expect(function (res) {
            assert.strictEqual(res.body.hasRaw, false)
          })
          .end(done)
      })

      it('should not set req.rawBody when rawBody is false', function (done) {
        request(createServer(kind, { rawBody: false }))
          .post('/')
          .set('Content-Type', type)
          .send(payload)
          .expect(200)
          .expect(function (res) {
            assert.strictEqual(res.body.hasRaw, false)
          })
          .end(done)
      })
    })
  }

  it('should keep the decompressed bytes of a gzip body', function (done) {
    const text = '{"user":"tobi","n":[1,2,3]}'
    const test = request(createServer('json', { rawBody: true })).post('/')
    test.set('Content-Encoding', 'gzip')
    test.set('Content-Type', 'application/json')
    test.write(zlib.gzipSync(text))
    test.expect(200)
      .expect(function (res) {
        assert.strictEqual(Buffer.from(res.body.raw, 'base64').toString('utf8'), text)
      })
      .end(done)
  })

  it('should keep bytes undecoded for a non-utf8 charset while req.body is decoded', function (done) {
    const server = http.createServer(function (req, res) {
      bodyParser.text({ rawBody: true, type: 'text/plain' })(req, res, function (err) {
        res.statusCode = err ? 500 : 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ body: req.body, raw: Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('hex') : null }))
      })
    })
    const bytes = Buffer.from('h\\u00e9llo', 'latin1')
    request(server)
      .post('/')
      .set('Content-Type', 'text/plain; charset=iso-8859-1')
      .send(bytes)
      .expect(200)
      .expect(function (res) {
        assert.strictEqual(res.body.raw, bytes.toString('hex'))
        assert.strictEqual(res.body.body, 'h\\u00e9llo')
      })
      .end(done)
  })

  it('should work together with verify', function (done) {
    let seen = null
    request(createServer('json', { rawBody: true, verify: function (req, res, buf) { seen = buf.toString() } }))
      .post('/')
      .set('Content-Type', 'application/json')
      .send('{"a":1}')
      .expect(200)
      .expect(function (res) {
        assert.strictEqual(seen, '{"a":1}')
        assert.strictEqual(Buffer.from(res.body.raw, 'base64').toString(), '{"a":1}')
      })
      .end(done)
  })

  it('should still keep the bytes when the body fails to parse', function (done) {
    request(createServer('json', { rawBody: true }))
      .post('/')
      .set('Content-Type', 'application/json')
      .send('{"user"')
      .expect(400)
      .expect(function (res) {
        assert.strictEqual(res.body.error, 'entity.parse.failed')
      })
      .end(done)
  })

  it('should reject a non-boolean-true value as off', function (done) {
    request(createServer('json', { rawBody: 'yes' }))
      .post('/')
      .set('Content-Type', 'application/json')
      .send('{"a":1}')
      .expect(200)
      .expect(function (res) {
        assert.strictEqual(res.body.hasRaw, false)
      })
      .end(done)
  })
})
`;
  return task({
    id: "body-parser-feat-rawbody",
    title: "A rawBody option for every body parser",
    category: "feature",
    repo: "body-parser",
    request:
      "We need the original request bytes to verify webhook signatures. Add a `rawBody` option to all four parsers (json, urlencoded, text, raw). "
      + "When it is `true`, the raw bytes of the request body go on `req.rawBody` as a Buffer: after any Content-Encoding (gzip and so on) has been undone, "
      + "but before the charset is decoded, so a latin1 body keeps its latin1 bytes while `req.body` is the decoded string. "
      + "When it is not `true` (missing, false, anything else) `req.rawBody` must not be set. It must work together with the existing `verify` option, "
      + "and the bytes must still be there when the body then fails to parse. Document the option in the README.",
    difficulty: 4,
    tags: ["feature", "multi-file", "bakeoff", "quick", "node-api", "body-parser"],
    truth: { files: ["lib/read.js", "lib/utils.js", "README.md"], allowed: ["^test/", "^HISTORY\\.md$"] },
    hidden: { files: { "test/rawbody.js": test }, run: ["test/rawbody.js"], kind: "tests", minTests: 17 },
    oracle: { kind: "patch", files: { "lib/utils.js": utilsNew, "lib/read.js": readNew, "README.md": readmeNew }, classify: { type: "feature" }, plan: "Add the rawBody option to the shared option handling, keep the bytes in the shared reader, document it" },
    checks: { suite: true, questions: { max: 1 }, expectPr: true },
  });
}

// ------------------------------------------------------------ commander: envPrefix

async function commanderEnvPrefix(): Promise<Task> {
  const cmd = await baseText("commander", "lib/command.js");
  const dts = await baseText("commander", "typings/index.d.ts");
  const readme = await baseText("commander", "Readme.md");
  const cmdNew = edits(cmd, [
    ["    this._showSuggestionAfterError = true;\n    this._savedState = null; // used in save/restoreStateBeforeParse\n", "    this._showSuggestionAfterError = true;\n    /** @type {(string | undefined)} */\n    this._envPrefix = undefined;\n    this._savedState = null; // used in save/restoreStateBeforeParse\n"],
    [
      "  /**\n   * Add a prepared subcommand.\n   *\n   * See .command() for creating an attached subcommand which inherits settings from its parent.",
      "  /**\n   * Read option values from environment variables named from a prefix and the option's long name,\n   * for the options that do not name a variable with `.env()`: `envPrefix('MYAPP_')` and `--dry-run` read `MYAPP_DRY_RUN`.\n   * Negated options (`--no-color`) are left alone.\n   *\n   * @param {string} prefix\n   * @return {Command} `this` command for chaining\n   */\n  envPrefix(prefix) {\n    this._envPrefix = prefix;\n    this.options.forEach((option) => this._applyEnvPrefix(option));\n    return this;\n  }\n\n  /**\n   * @param {Option} option\n   * @private\n   */\n  _applyEnvPrefix(option) {\n    if (this._envPrefix === undefined || option.envVar !== undefined || option.negate) return;\n    option.envVar = `${this._envPrefix}${option.name().replace(/-/g, '_').toUpperCase()}`;\n  }\n\n  /**\n   * Add a prepared subcommand.\n   *\n   * See .command() for creating an attached subcommand which inherits settings from its parent.",
    ],
    ["  addOption(option) {\n    this._registerOption(option);\n", "  addOption(option) {\n    this._applyEnvPrefix(option);\n    this._registerOption(option);\n"],
    [
      "    if (option.envVar) {\n      this.on('optionEnv:' + oname, (val) => {\n        const invalidValueMessage = `error: option '${option.flags}' value '${val}' from env '${option.envVar}' is invalid.`;\n        handleOptionValue(val, invalidValueMessage, 'env');\n      });\n    }\n",
      "    // always listening: `.envPrefix()` may give the option a variable after it was added\n    this.on('optionEnv:' + oname, (val) => {\n      const invalidValueMessage = `error: option '${option.flags}' value '${val}' from env '${option.envVar}' is invalid.`;\n      handleOptionValue(val, invalidValueMessage, 'env');\n    });\n",
    ],
  ]);
  const dtsNew = edit(dts, "  /**\n   * Display suggestion of similar commands for unknown commands, or options for unknown options.\n   */\n  showSuggestionAfterError(displaySuggestion?: boolean): this;\n", "  /**\n   * Display suggestion of similar commands for unknown commands, or options for unknown options.\n   */\n  showSuggestionAfterError(displaySuggestion?: boolean): this;\n\n  /**\n   * Read option values from environment variables named `prefix` plus the option's long name in upper snake case,\n   * for the options that have no `.env()` of their own.\n   */\n  envPrefix(prefix: string): this;\n");
  const readmeNew = edit(readme, "### Required option\n", "### Environment variables for all options\n\nUse `.envPrefix()` to read every option from an environment variable named from a prefix and the option's long name,\nfor the options that do not call `.env()` themselves. The usual priority applies: the command line wins over the\nenvironment, which wins over a default.\n\n```js\nprogram.envPrefix('MYAPP_').option('--dry-run').option('--name <name>'); // MYAPP_DRY_RUN, MYAPP_NAME\n```\n\n### Required option\n");
  const test = `import * as commander from '../index.js';
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const VARS = ['MYAPP_NAME', 'MYAPP_DRY_RUN', 'MYAPP_PORT', 'MYAPP_NO_COLOR', 'MYAPP_COLOR', 'OTHER_NAME', 'CUSTOM_NAME'];
afterEach(() => {
  for (const v of VARS) delete process.env[v];
});

describe('.envPrefix()', () => {
  test('a value option reads PREFIX + UPPER_SNAKE long name', () => {
    process.env.MYAPP_NAME = 'from env';
    const program = new commander.Command();
    program.envPrefix('MYAPP_').option('--name <name>');
    program.parse([], { from: 'user' });
    assert.equal(program.opts().name, 'from env');
  });

  test('dashes in the long name become underscores', () => {
    process.env.MYAPP_DRY_RUN = '1';
    const program = new commander.Command();
    program.envPrefix('MYAPP_').option('--dry-run');
    program.parse([], { from: 'user' });
    assert.equal(program.opts().dryRun, true);
  });

  test('the command line beats the environment', () => {
    process.env.MYAPP_NAME = 'from env';
    const program = new commander.Command();
    program.envPrefix('MYAPP_').option('--name <name>');
    program.parse(['--name', 'from cli'], { from: 'user' });
    assert.equal(program.opts().name, 'from cli');
  });

  test('the environment beats a default value', () => {
    process.env.MYAPP_PORT = '8080';
    const program = new commander.Command();
    program.envPrefix('MYAPP_').option('--port <number>', 'port', '3000');
    program.parse([], { from: 'user' });
    assert.equal(program.opts().port, '8080');
  });

  test('a default stays when the variable is not set', () => {
    const program = new commander.Command();
    program.envPrefix('MYAPP_').option('--port <number>', 'port', '3000');
    program.parse([], { from: 'user' });
    assert.equal(program.opts().port, '3000');
  });

  test('an option with its own .env() uses that, not the prefix', () => {
    process.env.MYAPP_NAME = 'prefixed';
    process.env.CUSTOM_NAME = 'custom';
    const program = new commander.Command();
    program.envPrefix('MYAPP_');
    program.addOption(new commander.Option('--name <name>').env('CUSTOM_NAME'));
    program.parse([], { from: 'user' });
    assert.equal(program.opts().name, 'custom');
  });

  test('options added before envPrefix() are covered too', () => {
    process.env.MYAPP_NAME = 'late prefix';
    const program = new commander.Command();
    program.option('--name <name>');
    program.envPrefix('MYAPP_');
    program.parse([], { from: 'user' });
    assert.equal(program.opts().name, 'late prefix');
  });

  test('a negated option is not given a variable', () => {
    process.env.MYAPP_NO_COLOR = '1';
    const program = new commander.Command();
    program.envPrefix('MYAPP_').option('--no-color');
    program.parse([], { from: 'user' });
    assert.equal(program.opts().color, true);
  });

  test('another prefix is another variable', () => {
    process.env.OTHER_NAME = 'other';
    const program = new commander.Command();
    program.envPrefix('OTHER_').option('--name <name>');
    program.parse([], { from: 'user' });
    assert.equal(program.opts().name, 'other');
  });

  test('help shows the variable like .env() does', () => {
    const program = new commander.Command();
    program.envPrefix('MYAPP_').option('--dry-run', 'only pretend');
    assert.match(program.helpInformation(), /\\(env: MYAPP_DRY_RUN\\)/);
  });

  test('the value from the environment goes through the option parser', () => {
    process.env.MYAPP_PORT = '42';
    const program = new commander.Command();
    program.envPrefix('MYAPP_').option('--port <number>', 'port', Number);
    program.parse([], { from: 'user' });
    assert.equal(program.opts().port, 42);
  });

  test('returns the command for chaining', () => {
    const program = new commander.Command();
    assert.equal(program.envPrefix('MYAPP_'), program);
  });
});
`;
  return task({
    id: "commander-feat-envprefix",
    title: "An envPrefix() for reading every option from the environment",
    category: "feature",
    repo: "commander",
    request:
      "Add a `.envPrefix(prefix)` method to Command. After it, every option of that command which does not have its own `.env()` reads its value from an environment variable "
      + "named the prefix plus the option's long name in UPPER_SNAKE_CASE: `program.envPrefix('MYAPP_').option('--dry-run')` reads `MYAPP_DRY_RUN`. "
      + "It must work for options added before the call as well as after. The usual priority is unchanged (command line over environment over a default), an option's own `.env()` wins over the prefix, "
      + "negated options like `--no-color` get no variable, and `--help` shows `env: MYAPP_DRY_RUN` the way it does for `.env()`. `.envPrefix()` returns the command so it chains. "
      + "Add it to the TypeScript typings and mention it in the Readme.",
    difficulty: 4,
    tags: ["feature", "multi-file", "bakeoff", "cli", "commander"],
    truth: { files: ["lib/command.js", "typings/index.d.ts", "Readme.md"], allowed: ["^tests/", "^CHANGELOG\\.md$", "^docs/", "^examples/"] },
    hidden: { files: { "tests/command.envPrefix.test.js": test }, run: ["tests/command.envPrefix.test.js"], kind: "tests", minTests: 10 },
    oracle: { kind: "patch", files: { "lib/command.js": cmdNew, "typings/index.d.ts": dtsNew, "Readme.md": readmeNew }, classify: { type: "feature" }, plan: "Add envPrefix(), apply it when options are added, listen for env values on every option, add typings and docs" },
    checks: { suite: true, questions: { max: 1 }, expectPr: true },
  });
}

// ------------------------------------------------------------ zustand: logger middleware

async function zustandLogger(): Promise<Task> {
  const mw = await baseText("zustand", "src/middleware.ts");
  const mwNew = mw.replace("export { combine } from './middleware/combine.ts'\n", "export { combine } from './middleware/combine.ts'\nexport { logger, type LoggerOptions } from './middleware/logger.ts'\n");
  if (mwNew === mw) throw new Error("zustand middleware.ts anchor missing");
  const loggerTs = `import type {
  StateCreator,
  StoreMutatorIdentifier,
} from '../vanilla.ts'

export interface LoggerOptions<T = any> {
  /** Shown between brackets at the start of every line. Defaults to "store". */
  name?: string
  /** Where lines go. Defaults to console.log. */
  log?: (...args: any[]) => void
  /** Logging is skipped while this is false, or returns false. Defaults to true. */
  enabled?: boolean | (() => boolean)
  /** Picks the part of the state that is logged. Defaults to the whole state. */
  select?: (state: T) => unknown
}

type Logger = <
  T,
  Mps extends [StoreMutatorIdentifier, unknown][] = [],
  Mcs extends [StoreMutatorIdentifier, unknown][] = [],
>(
  initializer: StateCreator<T, Mps, Mcs>,
  options?: LoggerOptions<T>,
) => StateCreator<T, Mps, Mcs>

type LoggerImpl = <T>(
  initializer: StateCreator<T, [], []>,
  options?: LoggerOptions<T>,
) => StateCreator<T, [], []>

const loggerImpl: LoggerImpl = (initializer, options = {}) => (set, get, api) => {
  const { name = 'store', log = console.log, enabled = true, select } = options
  const isOn = () => (typeof enabled === 'function' ? enabled() : enabled)
  const pick = (state: any) => (select ? select(state) : state)

  const loggedSet: typeof set = (...args) => {
    const prev = get()
    ;(set as any)(...args)
    const next = get()
    if (isOn() && !Object.is(prev, next)) {
      log(\`[\${name}]\`, { prev: pick(prev), next: pick(next) })
    }
  }
  api.setState = loggedSet
  return initializer(loggedSet, get, api)
}

export const logger = loggerImpl as unknown as Logger
`;
  const test = `import { describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { create } from 'zustand'
import { combine, logger } from 'zustand/middleware'

describe('logger middleware', () => {
  it('logs the previous and the next state after every change', () => {
    const log = vi.fn()
    const store = createStore(
      logger<{ count: number }>(() => ({ count: 0 }), { name: 'counter', log }),
    )
    store.setState({ count: 1 })
    store.setState((s) => ({ count: s.count + 1 }))
    expect(log).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenNthCalledWith(1, '[counter]', { prev: { count: 0 }, next: { count: 1 } })
    expect(log).toHaveBeenNthCalledWith(2, '[counter]', { prev: { count: 1 }, next: { count: 2 } })
  })

  it('logs changes made from inside the store through set', () => {
    const log = vi.fn()
    const store = createStore<{ n: number; inc: () => void }>()(
      logger((set) => ({ n: 0, inc: () => set((s) => ({ n: s.n + 1 })) }), { log }),
    )
    store.getState().inc()
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]![0]).toBe('[store]')
    expect(log.mock.calls[0]![1].prev.n).toBe(0)
    expect(log.mock.calls[0]![1].next.n).toBe(1)
  })

  it('defaults the name to "store" and the output to console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const store = createStore(logger(() => ({ a: 1 })))
    store.setState({ a: 2 })
    expect(spy).toHaveBeenCalledWith('[store]', { prev: { a: 1 }, next: { a: 2 } })
    spy.mockRestore()
  })

  it('does not log a change that leaves the state as it was', () => {
    const log = vi.fn()
    const store = createStore(logger(() => ({ a: 1 }), { log }))
    store.setState((s) => s)
    expect(log).not.toHaveBeenCalled()
  })

  it('does not log while enabled is false, and follows a function', () => {
    const log = vi.fn()
    let on = false
    const store = createStore(logger(() => ({ a: 1 }), { log, enabled: () => on }))
    store.setState({ a: 2 })
    expect(log).not.toHaveBeenCalled()
    on = true
    store.setState({ a: 3 })
    expect(log).toHaveBeenCalledTimes(1)
    const off = createStore(logger(() => ({ a: 1 }), { log, enabled: false }))
    off.setState({ a: 9 })
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('logs only what select picks', () => {
    const log = vi.fn()
    const store = createStore(
      logger<{ a: number; b: number }>(() => ({ a: 1, b: 10 }), { log, select: (s) => s.a }),
    )
    store.setState({ a: 2 })
    expect(log).toHaveBeenCalledWith('[store]', { prev: 1, next: 2 })
  })

  it('still updates the state and notifies subscribers', () => {
    const store = createStore(logger(() => ({ a: 1 }), { log: () => {} }))
    const seen: number[] = []
    store.subscribe((s) => seen.push(s.a))
    store.setState({ a: 5 })
    expect(store.getState().a).toBe(5)
    expect(seen).toEqual([5])
  })

  it('works with create() and with other middleware', () => {
    const log = vi.fn()
    const useStore = create(
      logger(
        combine({ count: 0 }, (set) => ({ inc: () => set((s) => ({ count: s.count + 1 })) })),
        { name: 'combined', log },
      ),
    )
    useStore.getState().inc()
    expect(useStore.getState().count).toBe(1)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]![0]).toBe('[combined]')
  })

  it('is exported from zustand/middleware', () => {
    expect(typeof logger).toBe('function')
  })
})
`;
  return task({
    id: "zustand-feat-logger",
    title: "A logger middleware",
    category: "feature",
    repo: "zustand",
    request:
      "Add a `logger` middleware to zustand's middleware, exported from `zustand/middleware` together with a `LoggerOptions` type. `logger(initializer, options?)` wraps a store so that every state change is logged "
      + "by calling `log('[<name>]', { prev, next })` once, with the state before and the state after. Options: `name` (default \"store\"), `log` (default `console.log`), "
      + "`enabled` (a boolean or a function returning one, default true; nothing is logged while it is false), and `select` (a function that picks the part of the state that goes in `prev` and `next`). "
      + "A change that leaves the state exactly as it was (the same object) is not logged. It must not change how the store behaves: state is still updated and subscribers still hear it, "
      + "and it must compose with other middleware such as `combine`.",
    difficulty: 3,
    tags: ["feature", "multi-file", "bakeoff", "react-lib", "zustand"],
    truth: { files: ["src/middleware/logger.ts", "src/middleware.ts"], allowed: ["^tests/", "^docs/", "^README"] },
    hidden: { files: { "tests/logger.test.tsx": test }, run: ["tests/logger.test.tsx"], kind: "tests", minTests: 8 },
    oracle: { kind: "patch", files: { "src/middleware/logger.ts": loggerTs, "src/middleware.ts": mwNew }, classify: { type: "feature" }, plan: "Write the logger middleware in its own file and export it from the middleware entry" },
    checks: { suite: true, questions: { max: 1 }, expectPr: true },
  });
}

// ------------------------------------------------------------ flask: routes --format json

async function flaskRoutesJson(): Promise<Task> {
  const cli = await baseText("flask", "src/flask/cli.py");
  const changes = await baseText("flask", "CHANGES.rst");
  const cliNew = edits(cli, [
    ["import inspect\nimport os\n", "import inspect\nimport json\nimport os\n"],
    [
      "@click.option(\"--all-methods\", is_flag=True, help=\"Show HEAD and OPTIONS methods.\")\n@with_appcontext\ndef routes_command(sort: str, all_methods: bool) -> None:\n    \"\"\"Show all registered routes with endpoints and methods.\"\"\"\n    rules = list(current_app.url_map.iter_rules())\n\n    if not rules:\n        click.echo(\"No routes were registered.\")\n        return\n",
      "@click.option(\"--all-methods\", is_flag=True, help=\"Show HEAD and OPTIONS methods.\")\n@click.option(\n    \"--format\",\n    \"output_format\",\n    type=click.Choice((\"table\", \"json\")),\n    default=\"table\",\n    help=\"How to print the routes. 'json' prints a list of objects.\",\n)\n@with_appcontext\ndef routes_command(sort: str, all_methods: bool, output_format: str) -> None:\n    \"\"\"Show all registered routes with endpoints and methods.\"\"\"\n    rules = list(current_app.url_map.iter_rules())\n\n    if not rules:\n        click.echo(\"[]\" if output_format == \"json\" else \"No routes were registered.\")\n        return\n",
    ],
    [
      "    rows = []\n\n    for rule in rules:\n        row = [\n            rule.endpoint,\n            \", \".join(sorted((rule.methods or set()) - ignored_methods)),\n        ]\n\n        if has_domain:\n            row.append((rule.host if host_matching else rule.subdomain) or \"\")\n\n        row.append(rule.rule)\n        rows.append(row)\n",
      "    rows = []\n    entries = []\n\n    for rule in rules:\n        methods = sorted((rule.methods or set()) - ignored_methods)\n        row = [rule.endpoint, \", \".join(methods)]\n        entry: dict[str, t.Any] = {\"endpoint\": rule.endpoint, \"methods\": methods}\n\n        if has_domain:\n            domain = (rule.host if host_matching else rule.subdomain) or \"\"\n            row.append(domain)\n            entry[\"domain\"] = domain\n\n        row.append(rule.rule)\n        entry[\"rule\"] = rule.rule\n        rows.append(row)\n        entries.append(entry)\n",
    ],
    [
      "    try:\n        rows.sort(key=itemgetter(sorts.index(sort)))\n    except ValueError:\n        pass\n\n    rows.insert(0, headers)\n",
      "    try:\n        key = itemgetter(sorts.index(sort))\n        order = sorted(range(len(rows)), key=lambda i: key(rows[i]))\n    except ValueError:\n        order = list(range(len(rows)))\n\n    if output_format == \"json\":\n        click.echo(json.dumps([entries[i] for i in order], indent=2))\n        return\n\n    rows = [rows[i] for i in order]\n    rows.insert(0, headers)\n",
    ],
  ]);
  const changesNew = edit(changes, "-   Drop support for Python 3.9 and 3.10. :pr:`5730` :pr:`6168`\n", "-   Drop support for Python 3.9 and 3.10. :pr:`5730` :pr:`6168`\n-   ``flask routes --format json`` prints the routes as a JSON list. The default\n    stays the table.\n");
  const test = `import json

import pytest
from click.testing import CliRunner

from flask import Flask
from flask.cli import FlaskGroup


def make_app(**kwargs):
    app = Flask("routes_app", **kwargs)

    @app.route("/")
    def index():
        return "home"

    @app.route("/users/<int:user_id>", methods=["GET", "POST"])
    def user(user_id):
        return str(user_id)

    @app.route("/about")
    def about():
        return "about"

    return app


def invoke(app, *args):
    cli = FlaskGroup(create_app=lambda: app)
    return CliRunner().invoke(cli, ["routes", *args])


def test_json_is_a_list_of_route_objects():
    result = invoke(make_app(), "--format", "json")
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert isinstance(data, list)
    by_endpoint = {item["endpoint"]: item for item in data}
    assert by_endpoint["index"] == {"endpoint": "index", "methods": ["GET"], "rule": "/"}
    assert by_endpoint["user"]["methods"] == ["GET", "POST"]
    assert by_endpoint["user"]["rule"] == "/users/<int:user_id>"
    assert "static" in by_endpoint


def test_json_hides_head_and_options_unless_asked():
    data = json.loads(invoke(make_app(), "--format", "json").output)
    assert all("HEAD" not in item["methods"] and "OPTIONS" not in item["methods"] for item in data)
    data = json.loads(invoke(make_app(), "--format", "json", "--all-methods").output)
    index = next(item for item in data if item["endpoint"] == "index")
    assert index["methods"] == ["GET", "HEAD", "OPTIONS"]


def test_json_follows_sort():
    data = json.loads(invoke(make_app(), "--format", "json", "--sort", "rule").output)
    rules = [item["rule"] for item in data]
    assert rules == sorted(rules)
    data = json.loads(invoke(make_app(), "--format", "json", "--sort", "endpoint").output)
    endpoints = [item["endpoint"] for item in data]
    assert endpoints == sorted(endpoints)


def test_json_has_a_domain_only_when_some_rule_has_one():
    app = make_app()
    app.add_url_rule("/panel", endpoint="panel", view_func=lambda: "x", subdomain="admin")
    data = json.loads(invoke(app, "--format", "json").output)
    assert all("domain" in item for item in data)
    panel = next(item for item in data if item["endpoint"] == "panel")
    assert panel["domain"] == "admin"
    plain = json.loads(invoke(make_app(), "--format", "json").output)
    assert all("domain" not in item for item in plain)


def test_json_with_no_routes_is_an_empty_list():
    app = Flask("empty", static_folder=None)
    result = invoke(app, "--format", "json")
    assert result.exit_code == 0
    assert json.loads(result.output) == []


def test_table_is_still_the_default():
    result = invoke(make_app())
    assert result.exit_code == 0
    first = result.output.splitlines()[0]
    assert first.split() == ["Endpoint", "Methods", "Rule"]
    explicit = invoke(make_app(), "--format", "table")
    assert explicit.output == result.output


def test_unknown_format_is_refused():
    result = invoke(make_app(), "--format", "yaml")
    assert result.exit_code != 0
    assert "yaml" in result.output
`;
  return task({
    id: "flask-feat-routes-json",
    title: "flask routes --format json",
    category: "feature",
    repo: "flask",
    request:
      "Add a `--format` option to `flask routes` with two choices, `table` (the default, exactly what it prints today) and `json`. "
      + "`json` prints one JSON list on stdout with an object per route: `endpoint`, `methods` (a sorted list, without HEAD and OPTIONS unless `--all-methods` is given) and `rule`, "
      + "plus a `domain` key on every object only when at least one rule has a host or subdomain (the same condition that adds the Host/Subdomain column to the table). "
      + "`--sort` applies to both formats. With no routes at all, `json` prints `[]`. Note it in the changelog.",
    difficulty: 3,
    tags: ["feature", "multi-file", "bakeoff", "python-web", "flask"],
    truth: { files: ["src/flask/cli.py", "CHANGES.rst"], allowed: ["^tests/", "^docs/"] },
    hidden: { files: { "tests/test_routes_format.py": test }, run: ["tests/test_routes_format.py"], kind: "tests", minTests: 7 },
    oracle: { kind: "patch", files: { "src/flask/cli.py": cliNew, "CHANGES.rst": changesNew }, classify: { type: "feature" }, plan: "Add the --format option to the routes command and print JSON from the same rows" },
    checks: { suite: true, questions: { max: 1 }, expectPr: true },
  });
}

// ------------------------------------------------------------ bulletproof-react (Vite): useLocalStorage

async function viteUseLocalStorage(): Promise<Task> {
  const hook = `import * as React from 'react';

const CHANGE_EVENT = 'use-local-storage:change';

const read = <T,>(key: string, initialValue: T): T => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? initialValue : (JSON.parse(raw) as T);
  } catch {
    return initialValue;
  }
};

export const useLocalStorage = <T,>(key: string, initialValue: T) => {
  const [value, setStored] = React.useState<T>(() => read(key, initialValue));
  const initialRef = React.useRef(initialValue);
  initialRef.current = initialValue;

  React.useEffect(() => {
    setStored(read(key, initialRef.current));
    const onChange = (event: Event) => {
      if ((event as CustomEvent<{ key: string }>).detail?.key === key) {
        setStored(read(key, initialRef.current));
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setStored(read(key, initialRef.current));
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [key]);

  const notify = React.useCallback(() => {
    queueMicrotask(() => window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key } })));
  }, [key]);

  const setValue = React.useCallback(
    (next: T | ((previous: T) => T)) => {
      const previous = read(key, initialRef.current);
      const resolved = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next;
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        // storage full or blocked: the in-memory value still changes
      }
      setStored(resolved);
      notify();
    },
    [key, notify],
  );

  const remove = React.useCallback(() => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // nothing to do
    }
    setStored(initialRef.current);
    notify();
  }, [key, notify]);

  return [value, setValue, remove] as const;
};
`;
  const barrel = "export * from './use-disclosure';\nexport * from './use-local-storage';\n";
  const test = `import { renderHook, act } from '@testing-library/react';

import { useDisclosure, useLocalStorage } from '@/hooks';

import { useLocalStorage as direct } from '../use-local-storage';

beforeEach(() => {
  window.localStorage.clear();
});

test('is exported from the hooks folder next to useDisclosure', () => {
  expect(typeof useDisclosure).toBe('function');
  expect(useLocalStorage).toBe(direct);
});

test('starts with the initial value when nothing is stored', () => {
  const { result } = renderHook(() => useLocalStorage('theme', 'light'));
  expect(result.current[0]).toBe('light');
  expect(window.localStorage.getItem('theme')).toBeNull();
});

test('reads a stored JSON value', () => {
  window.localStorage.setItem('prefs', JSON.stringify({ size: 3 }));
  const { result } = renderHook(() => useLocalStorage('prefs', { size: 1 }));
  expect(result.current[0]).toEqual({ size: 3 });
});

test('falls back to the initial value when the stored text is not JSON', () => {
  window.localStorage.setItem('broken', '{nope');
  const { result } = renderHook(() => useLocalStorage('broken', 'fallback'));
  expect(result.current[0]).toBe('fallback');
});

test('setting a value updates the state and writes JSON', () => {
  const { result } = renderHook(() => useLocalStorage('count', 0));
  act(() => {
    result.current[1](5);
  });
  expect(result.current[0]).toBe(5);
  expect(window.localStorage.getItem('count')).toBe('5');
});

test('setting with a function receives the previous value', () => {
  const { result } = renderHook(() => useLocalStorage('count', 10));
  act(() => {
    result.current[1]((n) => n + 1);
  });
  act(() => {
    result.current[1]((n) => n + 1);
  });
  expect(result.current[0]).toBe(12);
  expect(window.localStorage.getItem('count')).toBe('12');
});

test('remove deletes the key and goes back to the initial value', () => {
  window.localStorage.setItem('token', JSON.stringify('abc'));
  const { result } = renderHook(() => useLocalStorage('token', 'none'));
  expect(result.current[0]).toBe('abc');
  act(() => {
    result.current[2]();
  });
  expect(result.current[0]).toBe('none');
  expect(window.localStorage.getItem('token')).toBeNull();
});

test('two hooks on the same key stay in step', async () => {
  const a = renderHook(() => useLocalStorage('shared', 'one'));
  const b = renderHook(() => useLocalStorage('shared', 'one'));
  await act(async () => {
    a.result.current[1]('two');
  });
  expect(b.result.current[0]).toBe('two');
  await act(async () => {
    b.result.current[2]();
  });
  expect(a.result.current[0]).toBe('one');
});

test('a hook on another key is not disturbed', async () => {
  const a = renderHook(() => useLocalStorage('k1', 'x'));
  const b = renderHook(() => useLocalStorage('k2', 'y'));
  await act(async () => {
    a.result.current[1]('changed');
  });
  expect(b.result.current[0]).toBe('y');
});
`;
  return task({
    id: "bulletproof-vite-feat-uselocalstorage",
    title: "A useLocalStorage hook",
    category: "feature",
    repo: "bulletproof-vite",
    request:
      "Add a `useLocalStorage(key, initialValue)` hook next to `useDisclosure` in src/hooks, and make both importable from `@/hooks`. It returns `[value, setValue, remove]` like useState with a third item. "
      + "The value is read as JSON from window.localStorage when the hook mounts; a missing key, or text that is not valid JSON, gives `initialValue`. "
      + "`setValue` takes a value or an updater function (it receives the previous value), stores it as JSON and updates the state. `remove()` deletes the key and puts the state back to `initialValue`. "
      + "Two hooks using the same key in the same page must stay in step with each other, and a hook on a different key must not be touched.",
    difficulty: 3,
    tags: ["feature", "multi-file", "bakeoff", "vite-react", "bulletproof-vite"],
    truth: { files: ["src/hooks/use-local-storage.ts", "src/hooks/index.ts"], allowed: ["^src/hooks/__tests__/", "^README"] },
    hidden: { files: { "src/hooks/__tests__/use-local-storage.test.ts": test }, run: ["src/hooks/__tests__/use-local-storage.test.ts"], kind: "tests", minTests: 9 },
    oracle: { kind: "patch", files: { "src/hooks/use-local-storage.ts": hook, "src/hooks/index.ts": barrel }, classify: { type: "feature" }, plan: "Write the hook, add a hooks barrel that exports both hooks" },
    checks: { suite: true, questions: { max: 1 }, expectPr: true },
  });
}

// ------------------------------------------------------------ express: res.noContent()

async function expressNoContent(): Promise<Task> {
  const res = await baseText("express", "lib/response.js");
  const resNew = edit(res, "/**\n * Transfer the file at the given `path`.\n", "/**\n * Send a `204 No Content` response: no body, and none of the headers that describe one.\n *\n * Examples:\n *\n *     res.noContent();\n *\n * @return {ServerResponse} for chaining\n * @public\n */\n\nres.noContent = function noContent() {\n  this.status(204);\n  this.removeHeader('Content-Type');\n  this.removeHeader('Content-Length');\n  this.removeHeader('Transfer-Encoding');\n  this.end();\n  return this;\n};\n\n/**\n * Transfer the file at the given `path`.\n");
  const test = `'use strict'

var express = require('../')
  , request = require('supertest');

describe('res', function(){
  describe('.noContent()', function(){
    it('should send 204 with an empty body', function(done){
      var app = express();

      app.use(function(req, res){
        res.noContent();
      });

      request(app)
      .get('/')
      .expect(204, '', done);
    })

    it('should drop the entity headers even when they were set', function(done){
      var app = express();

      app.use(function(req, res){
        res.set('Content-Type', 'text/plain');
        res.set('Content-Length', '12');
        res.noContent();
      });

      request(app)
      .get('/')
      .expect(204)
      .expect(function(res){
        if ('content-type' in res.headers) throw new Error('content-type was sent');
        if ('content-length' in res.headers) throw new Error('content-length was sent');
        if ('transfer-encoding' in res.headers) throw new Error('transfer-encoding was sent');
      })
      .end(done)
    })

    it('should keep other headers', function(done){
      var app = express();

      app.use(function(req, res){
        res.set('X-Thing', 'kept');
        res.cookie('a', 'b');
        res.noContent();
      });

      request(app)
      .get('/')
      .expect('X-Thing', 'kept')
      .expect('Set-Cookie', /a=b/)
      .expect(204, done)
    })

    it('should be 204 whatever status was set before', function(done){
      var app = express();

      app.use(function(req, res){
        res.status(500).noContent();
      });

      request(app)
      .get('/')
      .expect(204, done)
    })

    it('should return the response so it chains', function(done){
      var app = express();
      var same = null;

      app.use(function(req, res){
        same = res.noContent() === res;
      });

      request(app)
      .get('/')
      .expect(204, function(err){
        if (err) return done(err);
        if (same !== true) return done(new Error('noContent() did not return res'));
        done();
      })
    })

    it('should work for other methods', function(done){
      var app = express();

      app.delete('/thing', function(req, res){
        res.noContent();
      });

      request(app)
      .delete('/thing')
      .expect(204, '', done)
    })
  })
})
`;
  return task({
    id: "express-feat-nocontent",
    title: "res.noContent()",
    category: "feature",
    repo: "express",
    request:
      "Add `res.noContent()` to the response object. It sends `204 No Content` with an empty body and none of the headers that describe a body: Content-Type, Content-Length and Transfer-Encoding "
      + "are removed even if they were set earlier, while every other header (custom ones, cookies) is kept. It always answers 204, whatever status was set before, and it returns the response so it can be chained.",
    difficulty: 2,
    tags: ["feature", "node-api", "express", "quick"],
    truth: { files: ["lib/response.js"], allowed: ["^test/", "^History\\.md$", "^Readme\\.md$"] },
    hidden: { files: { "test/res.noContent.js": test }, run: ["test/res.noContent.js"], kind: "tests", minTests: 6 },
    oracle: { kind: "patch", files: { "lib/response.js": resNew }, classify: { type: "feature" }, plan: "Add noContent() to the response prototype" },
    checks: { suite: true, questions: { max: 1 }, expectPr: true },
  });
}

export async function tasks(): Promise<Task[]> {
  return [
    await bodyParserRawBody(),
    await commanderEnvPrefix(),
    await zustandLogger(),
    await flaskRoutesJson(),
    await viteUseLocalStorage(),
    await expressNoContent(),
  ];
}
