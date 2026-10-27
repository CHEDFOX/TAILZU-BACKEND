/**
 * THE CONTRACT BETWEEN THE APP AND THE ARTIFACT VIEWER.
 *
 * An artifact is a small self-contained thing a bot makes (a page, a component, a chart, a
 * diagram) that the person sees live and can click. It runs in the viewer: a page on its own
 * site (never the app's), inside an iframe with `sandbox="allow-scripts"` and no network. The
 * app (phone, desktop, web) is the iframe's parent; the two talk only through postMessage, in
 * the messages below. The viewer never holds a Tailzu token: anything that needs the server
 * (saved data, asking the bot) goes up to the parent, which calls the API as the person.
 *
 * Both sides import this file: the server (tulmi/src/artifacts) and the viewer Worker (viewer/).
 */

export const PROTOCOL_VERSION = 1;

/** What an artifact is written in. */
export type ArtifactType = "html" | "react" | "svg" | "mermaid" | "markdown";

/**
 * The libraries a react artifact may import, by bare name. The viewer hosts pinned builds of
 * each on its own origin and loads a heavy one only when the artifact imports it. Anything else
 * is a compile error the bot is asked to fix.
 */
export const ARTIFACT_LIBS = [
  "react",
  "react-dom",
  "recharts",
  "lucide-react",
  "d3",
  "three",
  "mermaid",
] as const;
export type ArtifactLib = (typeof ARTIFACT_LIBS)[number];

/**
 * Every element the person can point at carries this attribute, set by the viewer as it compiles:
 * `"<line>:<col>"`, 1-based, of the `<` that opens the element in the artifact's ORIGINAL source
 * (before any transform). The server finds the element's source span from it, so an edit can be
 * scoped to just that element.
 */
export const ELEMENT_ID_ATTR = "data-tz-id";

/** A project's look, for artifacts made "in the style of" a project: CSS the viewer adds first. */
export interface DesignKitCss {
  /** `:root { --tz-…: … }` variables, font-face/@import lines, base element styles. */
  css: string;
  /** Font stylesheet URLs to load (only from the viewer's allowed font hosts). */
  fonts?: string[];
  /** "tailwind" when the project uses Tailwind: the viewer loads its Tailwind runtime with `config`. */
  tailwind?: { config: Record<string, unknown> };
}

export interface ArtifactPayload {
  id: string;
  version: number;
  type: ArtifactType;
  title: string;
  content: string;
}

// ------------------------------------------------------------------ parent → viewer

export type HostMsg =
  /** Show this artifact (first load, or a new version). */
  | { t: "load"; artifact: ArtifactPayload; theme?: "light" | "dark"; kit?: DesignKitCss }
  /** The source so far while the bot is still writing it; the viewer re-renders, debounced. */
  | { t: "stream"; content: string; done: boolean }
  /** Point-and-change mode: hovering outlines elements, a click sends `select` and does nothing else. */
  | { t: "select-mode"; on: boolean }
  | { t: "storage-result"; reqId: string; ok: boolean; value?: unknown; keys?: string[]; error?: string }
  | { t: "ask-result"; reqId: string; ok: boolean; text?: string; error?: string };

// ------------------------------------------------------------------ viewer → parent

export type FrameMsg =
  | { t: "ready"; protocol: number }
  | { t: "rendered"; version: number; ms: number }
  | {
      t: "error";
      kind: "compile" | "runtime" | "import" | "limit";
      message: string;
      line?: number;
      col?: number;
      stack?: string;
    }
  | {
      t: "select";
      elementId: string;
      tag: string;
      /** Visible text of the element, cut to 200 characters. */
      text: string;
      rect: { x: number; y: number; w: number; h: number };
    }
  /** Saved data for this artifact. `shared` data is seen by everyone who opens the artifact; the rest is the viewer's own. */
  | { t: "storage"; reqId: string; op: "get" | "set" | "delete" | "list"; key?: string; value?: unknown; shared?: boolean }
  /** The artifact asks the bot a question (metered against the person who opened it). */
  | { t: "ask"; reqId: string; prompt: string }
  | { t: "download"; name: string; mime: string; dataBase64: string }
  | { t: "resize"; height: number };

/** Hard limits both sides enforce. */
export const LIMITS = {
  /** Largest artifact source. */
  contentBytes: 512 * 1024,
  /** Largest value one storage key may hold. */
  storageValueBytes: 64 * 1024,
  /** Most keys one artifact may store per scope. */
  storageKeys: 500,
  /** Longest `ask` prompt. */
  askChars: 8000,
  /** Largest `download` payload. */
  downloadBytes: 5 * 1024 * 1024,
} as const;
