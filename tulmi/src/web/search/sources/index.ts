/**
 * THE SOURCES, BY NAME.
 *
 * DIRECT are the keyless sources with an API of their own, which a plan names.
 * DISCOVERY are the general web engines, tried in this order and only as many
 * as it takes (engine.ts): SearXNG when we run one, DuckDuckGo's HTML page for
 * low volume, Brave when there is a key. Each takes its keys and addresses
 * from `opts.env`, never from the environment, so a test passes what it wants.
 */
import type { DiscoveryId, Source, SourceId } from "../types.js";
import { brave } from "./brave.js";
import { crates } from "./crates.js";
import { ddg } from "./ddg.js";
import { github } from "./github.js";
import { hn } from "./hn.js";
import { mdn } from "./mdn.js";
import { npm } from "./npm.js";
import { pypi } from "./pypi.js";
import { searxng } from "./searxng.js";
import { stackoverflow } from "./stackoverflow.js";
import { wikipedia } from "./wikipedia.js";

export const DIRECT: Readonly<Record<SourceId, Source>> = { npm, pypi, crates, github, stackoverflow, mdn, hn, wikipedia };
export const DISCOVERY: Readonly<Record<DiscoveryId, Source>> = { searxng, ddg, brave };

export { brave, crates, ddg, github, hn, mdn, npm, pypi, searxng, stackoverflow, wikipedia };
