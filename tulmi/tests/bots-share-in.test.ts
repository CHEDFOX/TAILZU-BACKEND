/**
 * SHARING INTO TAILZU (experience/bots/screens/bots.ts, bots.share-in): what another app shared on the phone (the iOS share extension, the
 * Android share intent) or what was dropped on the window lands here, the files already sent to POST /v1/files.
 *
 *   - several files at once (`files`, comma separated, at most five), each shown, all attached to the ask
 *   - a link or text with no file
 *   - "Ask any bot" is always a choice (POST /v1/ask with bot "any"), and the pick when the front door has none
 *   - a bad id in `files` is never read
 */
import { describe, expect, it } from "vitest";
import type { Node } from "../../shared/types/sdui.js";

const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, FIXED_NOW, IST } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { sampleApi } = await import("./bots-bots-data.js");

const A = "/v1/botsapp/bots";
type Client = "phone" | "desktop";

const PHOTO = {
  file: { id: "f-10", name: "IMG_2041.jpg", mime: "image/jpeg", bytes: 2_100_000, createdAt: FIXED_NOW - 60_000 },
  attachment: { id: "f-10", name: "IMG_2041.jpg", mime: "image/jpeg", bytes: 2_100_000, sha256: "b".repeat(64), kind: "image" },
};

async function build(client: Client, params: Record<string, string>, extra: Record<string, unknown> = {}, drop: string[] = []) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const api: Record<string, unknown> = { ...(await sampleApi()), "GET /v1/files/f-10": PHOTO, ...extra };
  for (const k of drop) delete api[k];
  const s = await buildBotsScreen({ screenId: "bots.share-in", client, params, tzOffsetMinutes: IST, user: { id: "u" }, can: new Set(["BotsKit"]), desk: { pages: client === "desktop", notes: false } },
    fakeDeps({ jobs: [], tasks: [], api, calls }));
  return { s, calls, nodes: walk(s.root!) };
}
const texts = (nodes: Node[]) => nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? ""));
function actions(nodes: Node[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const visit = (a: unknown) => {
    if (!a || typeof a !== "object") return;
    const o = a as Record<string, unknown>;
    out.push(o);
    for (const k of ["actions", "then", "else", "onSuccess", "onError"]) {
      const v = o[k];
      if (Array.isArray(v)) v.forEach(visit); else visit(v);
    }
  };
  for (const n of nodes) for (const v of Object.values(n.on ?? {})) visit(v);
  return out;
}
const askOf = (nodes: Node[]) => actions(nodes).find((a) => a.kind === "callEndpoint" && a.path === "/v1/ask");
const composeOf = (nodes: Node[]) => actions(nodes).find((a) => a.kind === "callEndpoint" && a.path === `${A}/share/compose`);

describe("bots.share-in, from another app or a drop", () => {
  for (const client of ["phone", "desktop"] as const) {
    it(`shows every shared file and attaches them all (${client})`, async () => {
      const { s, nodes, calls } = await build(client, { files: "f-9,f-10" });
      expect(lintTree(s.root!)).toEqual([]);
      const t = texts(nodes).join("\n");
      expect(t).toContain("Ticket_BLR-GOI_14Nov.pdf");
      expect(t).toContain("IMG_2041.jpg");
      const ask = askOf(nodes);
      expect((ask?.body as { attachments: Array<{ id: string }> }).attachments.map((a) => a.id)).toEqual(["f-9", "f-10"]);
      expect((composeOf(nodes)?.body as { name: string }).name).toBe("Ticket_BLR-GOI_14Nov.pdf, IMG_2041.jpg");
      // The front door was asked about both names.
      expect(calls.find((c) => c.path === `${A}/share/suggest`)?.body).toMatchObject({ name: "Ticket_BLR-GOI_14Nov.pdf, IMG_2041.jpg" });
    });

    it(`offers "Ask any bot" beside the bots (${client})`, async () => {
      const { s, nodes } = await build(client, { file: "f-9" });
      expect(lintTree(s.root!)).toEqual([]);
      expect(texts(nodes)).toContain("Ask any bot");
      expect(actions(nodes).some((a) => a.kind === "setState" && a.path === "bot" && a.value === "any")).toBe(true);
      expect((s.state as { asks: Record<string, string> }).asks.any).toBe("What's in this?");
    });

    it(`starts on "Ask any bot" when the front door has no pick (${client})`, async () => {
      const { s } = await build(client, { url: "https://www.irctc.co.in/nget/pnr" }, { [`POST ${A}/share/suggest`]: { pick: null, by: "none", reasons: [], ask: "", line: "" } });
      expect(s.state).toMatchObject({ bot: "any", what: "What should I do with this?" });
    });

    it(`takes a link with words that came with it (${client})`, async () => {
      const { s, nodes } = await build(client, { url: "https://maps.app.goo.gl/x1", text: "Kavya's new place" });
      expect(lintTree(s.root!)).toEqual([]);
      const t = texts(nodes).join("\n");
      expect(t).toContain("maps.app.goo.gl/x1");
      expect(t).toContain("Kavya's new place");
      expect(composeOf(nodes)?.body).toMatchObject({ url: "https://maps.app.goo.gl/x1", text: "Kavya's new place" });
      expect(askOf(nodes)?.body).not.toHaveProperty("attachments");
    });
  }

  it("reads at most five files, and never an id that is not one", async () => {
    const { calls } = await build("phone", { file: "f-9", files: "f-9,../x,f-10,a,b,c,d,e" });
    const reads = calls.filter((c) => c.method === "GET" && c.path.startsWith("/v1/files/")).map((c) => c.path);
    expect(reads).toEqual(["/v1/files/f-9", "/v1/files/f-10", "/v1/files/a", "/v1/files/b", "/v1/files/c"]);
  });

  it("draws the honest empty state when nothing came, or the file is gone", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const { s, nodes } = await build(client, { files: "f-404" });
      expect(lintTree(s.root!)).toEqual([]);
      expect(texts(nodes)).toContain("Nothing to send yet");
    }
  });
});
