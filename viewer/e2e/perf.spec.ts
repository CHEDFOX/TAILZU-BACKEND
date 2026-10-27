import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { load, openHost } from "./helpers";

// A small React artifact, as a bot writes them.
const SMALL = `import { useState } from "react";

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <div style={{ fontFamily: "system-ui", padding: 16 }}>
      <h1>Counter</h1>
      <button onClick={() => setCount(count + 1)}>Clicked {count} times</button>
    </div>
  );
}
`;

const WITH_LIBS = `import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from "recharts";
import { Heart } from "lucide-react";
const data = [{ n: 1, v: 3 }, { n: 2, v: 5 }, { n: 3, v: 4 }];
export default function App() {
  const [liked, setLiked] = useState(false);
  return (
    <div style={{ width: 400, height: 240 }}>
      <button onClick={() => setLiked(!liked)}><Heart size={16} fill={liked ? "red" : "none"} /> like</button>
      <ResponsiveContainer width="100%" height="80%"><LineChart data={data}><XAxis dataKey="n" /><YAxis /><Line dataKey="v" /></LineChart></ResponsiveContainer>
    </div>
  );
}
`;

interface Sample {
  /** The viewer's own measure: from receiving `load` to the component being on screen. */
  viewerMs: number;
  /** From sending `load` (in the host page) to receiving `rendered`. */
  roundTripMs: number;
  /** Navigation of the host page, through the viewer saying `ready`. */
  readyMs: number;
  /** Bytes the browser took off the network for everything from navigation to `rendered`. */
  kbTransferred: number;
  requests: number;
}

async function sample(context: BrowserContext, content: string, type = "react"): Promise<{ page: Page; s: Sample }> {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  let bytes = 0;
  let requests = 0;
  cdp.on("Network.loadingFinished", (e) => {
    bytes += e.encodedDataLength;
    requests++;
  });
  const t0 = Date.now();
  await openHost(page);
  const readyMs = Date.now() - t0;
  const out = await load(page, { type, content });
  expect(out.errors).toEqual([]);
  const { sent, got } = await page.evaluate(() => ({
    sent: window.host.log.find((e) => e.msg.t === "load")!.at,
    got: window.host.log.find((e) => e.msg.t === "rendered")!.at,
  }));
  return { page, s: { viewerMs: out.rendered!.ms, roundTripMs: Math.round(got - sent), readyMs, kbTransferred: Math.round(bytes / 1024), requests } };
}

test("cold, warm and hot render times of a small React artifact (and of one with recharts + lucide)", async ({ browser }) => {
  const result: Record<string, Sample> = {};

  // Cold: a browser with nothing cached.
  const cold = await browser.newContext();
  const first = await sample(cold, SMALL);
  result.cold = first.s;

  // Warm: the same browser, a new page: the libraries come from the HTTP cache (immutable), nothing is loaded yet in the page.
  const warm = await sample(cold, SMALL);
  result.warm = warm.s;

  // Hot: the same page, the viewer already running, a new version.
  const from = await warm.page.evaluate(() => window.host.log.length);
  await warm.page.evaluate((c) => window.host.load({ type: "react", content: c }, { version: 2 }), SMALL.replace("Counter", "Counter v2"));
  await warm.page.evaluate((f) => window.host.waitFor((m) => m.t === "rendered", { from: f }), from);
  const hotMs = await warm.page.evaluate((f) => window.host.messages("rendered", f)[0].ms, from);
  result.hot = { ...warm.s, viewerMs: hotMs, roundTripMs: hotMs, readyMs: 0, kbTransferred: 0, requests: 0 };
  await cold.close();

  // The same for an artifact that brings recharts and lucide-react.
  const cold2 = await browser.newContext();
  result.coldWithLibs = (await sample(cold2, WITH_LIBS)).s;
  result.warmWithLibs = (await sample(cold2, WITH_LIBS)).s;
  await cold2.close();

  // Markdown needs no library at all; Mermaid is the heaviest thing there is.
  const cold3 = await browser.newContext();
  result.coldMarkdown = (await sample(cold3, "# Hello\n\nSome **text**, a list:\n\n- one\n- two\n", "markdown")).s;
  result.coldMermaid = (await sample(cold3, "graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Done]\n  B -->|no| A", "mermaid")).s;
  await cold3.close();

  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/perf.json", JSON.stringify(result, null, 2));
  console.log("PERF " + JSON.stringify(result));

  // Generous: this is a guard against a regression of an order of magnitude, not a benchmark (the numbers are in docs/artifact-viewer.md).
  expect(result.cold!.viewerMs).toBeLessThan(3000);
  expect(result.warm!.viewerMs).toBeLessThan(1500);
  expect(result.hot!.viewerMs).toBeLessThan(300);
  expect(result.warm!.kbTransferred).toBeLessThan(result.cold!.kbTransferred / 3);
});
