import { looksLikeTailwind } from "../../lib/tailwind.js";
import { locateInStack, registerSource, ViewerError } from "../errors.js";
import { ensureTailwind } from "../tailwind.js";
import { blobUrl, type Page, type RenderInput, type Renderer } from "./types.js";

const libSpecs = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

/**
 * V8 reports a module's syntax error from import() without a position. Loading the same code as a <script type=module> reports it as an
 * `error` event that has one. (A fresh blob URL: the failed one is remembered as failed.) The event is muted in the reporter, so it is not reported twice.
 */
function syntaxErrorAt(code: string, mute: (file: string) => () => void): Promise<{ line: number; col: number } | undefined> {
  return new Promise((resolve) => {
    const url = blobUrl(window, code);
    const unmute = mute(url);
    const script = document.createElement("script");
    const finish = (at?: { line: number; col: number }): void => {
      window.removeEventListener("error", on);
      unmute();
      clearTimeout(timer);
      script.remove();
      URL.revokeObjectURL(url);
      resolve(at);
    };
    const on = (e: ErrorEvent): void => {
      if (e.filename === url) finish({ line: e.lineno, col: e.colno });
    };
    const timer = setTimeout(() => finish(), 2000);
    window.addEventListener("error", on);
    script.type = "module";
    script.src = url;
    document.head.appendChild(script);
  });
}

/**
 * A React artifact: compiled in the browser by Sucrase, imported as a blob module whose bare imports the page's import map sends to
 * the vendored, pinned libraries, and mounted into `#root` under an error boundary.
 *
 * Everything it needs is asked for at once, so the compiler, React, the libraries this source imports and (if wanted) Tailwind
 * download side by side instead of one after the other.
 */
export function createReactRenderer(page: Page): Renderer {
  let lastCompiled = "";
  let lastRuntimeError: unknown;
  let mounted = false;
  let host: typeof import("@tz/react-host") | null = null;

  return {
    async render(i: RenderInput) {
      const compilerP = import("@tz/compile");
      const hostP = import("@tz/react-host");
      // Start the libraries this source names now; their failures are the real import's to report.
      for (const m of i.src.matchAll(libSpecs)) {
        if (page.allowed.has(m[1]!)) void import(/* @vite-ignore */ m[1]!).catch(() => undefined);
      }
      const wantsTailwind = !!i.kit?.tailwind || looksLikeTailwind(i.src);
      const tailwindP = wantsTailwind ? ensureTailwind(document, window, i.kit, import.meta.resolve("@tz/tailwind")) : Promise.resolve();

      const { compileReact, locateImportName } = await compilerP;
      const compiled = compileReact(i.src, page.allowed);
      if (compiled.code === lastCompiled && mounted) {
        // The same program again: nothing to render. But if it failed while it was still streaming (and so said nothing), say it now.
        if (i.final && lastRuntimeError !== undefined) throw lastRuntimeError;
        return;
      }
      await tailwindP;
      if (i.isStale()) return;

      const url = blobUrl(window, compiled.code);
      registerSource(url, compiled.locate);
      let mod: { default?: unknown };
      // A module that does not parse also raises an `error` event on window, a moment after the rejection; the rejection is reported, once.
      let parseEvent: ErrorEvent | undefined;
      const listen = (e: ErrorEvent): void => {
        if (e.filename === url) parseEvent = e;
      };
      window.addEventListener("error", listen);
      const unmute = page.reporter.mute(url);
      try {
        mod = await import(/* @vite-ignore */ url);
      } catch (e) {
        const err = e as { message?: string; stack?: string; name?: string };
        const message = String(err?.message ?? e);
        const missing = /does not provide an export named '([^']+)'/.exec(message);
        if (missing) {
          const spec = /The requested module '([^']+)'/.exec(message)?.[1] ?? "";
          const at = locateImportName(i.src, compiled.imports, spec, missing[1]!);
          throw new ViewerError("import", `"${spec}" has no export named "${missing[1]}". Check the name.`, at?.line, at?.col);
        }
        if (err?.name === "SyntaxError" && !locateInStack(err.stack)) {
          // Not thrown by the artifact's own code (that has a frame in it), so the module did not parse. The browser's `error` event for it,
          // which has the position, is queued a moment after the rejection.
          await new Promise((r) => setTimeout(r, 30));
          const at = parseEvent?.lineno ? { line: parseEvent.lineno, col: parseEvent.colno } : await syntaxErrorAt(compiled.code, (f) => page.reporter.mute(f));
          const mapped = at ? compiled.locate(at.line, at.col) : undefined;
          throw new ViewerError("compile", message, mapped?.line, mapped?.col);
        }
        if (/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message)) {
          throw new ViewerError("import", "A library the artifact imports failed to load. " + message);
        }
        throw e; // an error thrown while the module's top level ran: a runtime error, located by its stack
      } finally {
        setTimeout(() => {
          window.removeEventListener("error", listen);
          unmute();
          URL.revokeObjectURL(url);
        }, 1000);
      }
      if (i.isStale()) return;
      if (mod.default === undefined || mod.default === null) {
        throw new ViewerError("runtime", "The artifact has no default export. Write `export default function App() { … }` (or export default a component).");
      }

      host = await hostP;
      let runtimeError: unknown;
      const result = await host.show(page.root, mod.default, {
        final: i.final,
        onCommit: () => undefined,
        onError: (error) => {
          runtimeError = error;
        },
      });
      lastCompiled = compiled.code;
      lastRuntimeError = result === "error" ? runtimeError : undefined;
      mounted = true;
      page.surfaceChanged(window);
      if (result === "error") {
        if (i.final) throw runtimeError;
        throw new ViewerError("runtime", "(the newest version failed to render; the last good one is kept)");
      }
    },
    dispose() {
      // React first: it must take its own nodes down before they are swept away.
      host?.unmount();
      mounted = false;
      lastCompiled = "";
      lastRuntimeError = undefined;
      page.root.replaceChildren();
    },
  };
}
