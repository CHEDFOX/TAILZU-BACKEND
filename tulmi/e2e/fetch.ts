/**
 * A FETCH THAT GOES THROUGH THE PROXY THE ENVIRONMENT NAMES (HTTPS_PROXY, HTTP_PROXY, NO_PROXY).
 *
 * Node's built-in `fetch` does not read those variables: behind a proxy (a sandbox, a company network) the harness's catalog fetch got nothing, the smoke estimate
 * fell back to assumed prices ($0.30 / $1.20 per million tokens, about ten times qwen3.7-flash's real $0.03 / $0.13) and said so only in a small note. The first real run
 * set NODE_USE_ENV_PROXY=1 by hand, which fixed it. This does the same without anyone having to remember: undici's EnvHttpProxyAgent (undici is already a dependency)
 * reads the same variables and tunnels through the proxy, honouring NO_PROXY.
 *
 * With no proxy variable set, or NODE_USE_ENV_PROXY=1 (Node does it itself), it is the plain `fetch`, untouched.
 */
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

type Env = Record<string, string | undefined>;

/** The proxy address the environment names for HTTPS (or HTTP), or "". */
export function proxyOf(env: Env = process.env): string {
  return (env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || "").trim();
}

const agents = new Map<string, EnvHttpProxyAgent>();

/**
 * `fetch`, proxy-aware. `env` is the environment to read (the process's by default); `base` is what to use when no proxy is wanted (the global fetch by default).
 * The agent is built once per proxy setting (the addresses and NO_PROXY).
 */
export function proxyAwareFetch(env: Env = process.env, base: typeof fetch = globalThis.fetch): typeof fetch {
  const proxy = proxyOf(env);
  if (!proxy || env.NODE_USE_ENV_PROXY === "1") return base;
  const httpProxy = env.HTTP_PROXY || env.http_proxy || proxy;
  const noProxy = env.NO_PROXY || env.no_proxy || "";
  const id = JSON.stringify([proxy, httpProxy, noProxy]);
  let agent = agents.get(id);
  if (!agent) {
    agent = new EnvHttpProxyAgent({ httpProxy, httpsProxy: proxy, noProxy });
    agents.set(id, agent);
  }
  const dispatcher = agent;
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => undiciFetch(input as never, { ...(init as object | undefined), dispatcher } as never) as unknown as Promise<Response>) as typeof fetch;
}
