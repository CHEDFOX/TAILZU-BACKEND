// The libraries the viewer imports by bare name are resolved at run time by the page's import map (see scripts/build.mjs): they are not
// in this package's node_modules, so they are typed here, as little as the viewer needs.

declare module "react" {
  const React: any;
  export default React;
}

declare module "react-dom/client" {
  export function createRoot(el: Element): { render(node: unknown): void; unmount(): void };
}

declare module "@tz/sucrase" {
  export function transform(
    code: string,
    options: Record<string, unknown>,
  ): { code: string; sourceMap?: { mappings: string; sources?: string[] } };
}

declare module "@tz/compile" {
  export const compileReact: typeof import("./compile.js").compileReact;
  export const locateImportName: typeof import("./compile.js").locateImportName;
}

declare module "@tz/react-host" {
  export const show: typeof import("./react-host.js").show;
  export const unmount: typeof import("./react-host.js").unmount;
}

declare module "mermaid" {
  const mermaid: {
    initialize(config: Record<string, unknown>): void;
    render(id: string, text: string): Promise<{ svg: string }>;
    parse(text: string, opts?: { suppressErrors?: boolean }): Promise<unknown>;
  };
  export default mermaid;
}
