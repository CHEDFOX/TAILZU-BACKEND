import type { ArtifactPayload, DesignKitCss } from "../../../tulmi/src/artifacts/protocol.js";
import type { Reporter } from "../errors.js";
import type { InstrumentCtx } from "../instrument.js";

/** What a renderer may use of the page it renders into. */
export interface Page {
  /** `#root`: where svg, markdown, mermaid and react artifacts go. */
  root: HTMLElement;
  /** Where html artifacts' frames go. */
  frames: HTMLElement;
  reporter: Reporter;
  instrument: InstrumentCtx;
  /** The bare names the page's import map can resolve (the libraries an artifact may import). */
  allowed: ReadonlySet<string>;
  /** The exact text of the page's import map, to give an html artifact's own document the same one. */
  importMapText: string;
  /** The window whose content height is now the artifact's. */
  surfaceChanged(win: Window): void;
}

export interface RenderInput {
  src: string;
  /** False while the source is still being written. */
  final: boolean;
  artifact: ArtifactPayload;
  theme: "light" | "dark";
  kit: DesignKitCss | undefined;
  /** performance.now() when the message that asked for this render arrived. */
  t0: number;
  isStale(): boolean;
}

export interface Renderer {
  /** Show `src`. Resolves when it is on screen. Throws a ViewerError for a problem in the source. */
  render(input: RenderInput): Promise<void>;
  /** Take everything this renderer put on the page away. */
  dispose(): void;
}

export const nextFrame = (win: Window): Promise<void> => new Promise((r) => win.requestAnimationFrame(() => r()));

export function blobUrl(win: Window, code: string, type = "text/javascript"): string {
  const w = win as Window & typeof globalThis;
  return w.URL.createObjectURL(new w.Blob([code], { type }));
}
