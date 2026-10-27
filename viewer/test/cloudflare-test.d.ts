// What @cloudflare/vitest-plugin gives a test inside workerd, typed by hand (its own types need the Workers lib, which clashes with the
// DOM lib the browser code is checked with).
declare module "cloudflare:test" {
  export const env: import("../src/index.js").Env;
  export const SELF: { fetch(input: Request | string | URL, init?: RequestInit): Promise<Response> };
}
