/**
 * What the open projects showed (e2e/xode-eval.ts on flask, umami): a follow-up cited the lines the turn before had read and lost them, an address
 * and its port was taken for a file and its line, and a catalog of 500 strings kept its one-word labels and dropped its messages.
 */
import { describe, expect, it } from "vitest";
import { Anchors, checkCitations, citationsIn } from "../src/code/chat/cite.js";
import { extractTexts } from "../src/code/project/texts.js";
import { TEXTS_PER_FILE } from "../src/code/project/types.js";

describe("citations in a conversation", () => {
  it("keeps what earlier turns read citable, so a follow-up does not lose its sentence", () => {
    const a = new Anchors();
    a.earlier(["src/flask/app.py:720-737", "src/flask/cli.py:883"]);
    const out = checkCitations("It splits SERVER_NAME on the colon (src/flask/app.py:720-724), then calls run_simple at src/flask/app.py:748.", a);
    expect(out.text).toBe("It splits SERVER_NAME on the colon (src/flask/app.py:720-724), then calls run_simple at src/flask/app.py.");
    expect(out.dropped).toEqual(["src/flask/app.py:748"]);
  });

  it("reads a file's bare name, after its first mention, as the one file read with that name", () => {
    const a = new Anchors();
    a.read("backend/app/api/deps.py", Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n"));
    a.read("backend/app/api/routes/items.py", Array.from({ length: 120 }, () => "x").join("\n"));
    const out = checkCitations("The token is checked in backend/app/api/deps.py:30-49; the superuser check is the only role (`deps.py:52-58`). Owners gate it (`items.py:89-90`, `items.py:400`).", a);
    expect(out.text).toBe("The token is checked in backend/app/api/deps.py:30-49; the superuser check is the only role (`deps.py:52-58`). Owners gate it (`items.py:89-90`, `items.py`).");
    // Two read with the same name: neither is guessed.
    a.read("frontend/src/deps.py", "a\n");
    expect(checkCitations("See deps.py:52.", a).dropped).toEqual(["deps.py:52"]);
  });

  it("leaves an address and its port alone: it is not a file and its line", () => {
    const a = new Anchors();
    const text = 'Set app.config["SERVER_NAME"] = "example.com:8080", or api.myapp.dev:443 behind the proxy.';
    expect(checkCitations(text, a)).toEqual({ text, kept: [], dropped: [] });
    expect(citationsIn(text)).toEqual([]);
    // A file of the project named like one is still a file.
    a.read("notes.app", "a\nb\n");
    expect(checkCitations("See notes.app:2.", a).kept).toEqual(["notes.app:2"]);
  });
});

describe("a catalog with more strings than a file keeps", () => {
  it("keeps the sentences a person reads before the one-word labels", () => {
    const labels = Object.fromEntries(Array.from({ length: 434 }, (_, i) => [`label-${i}`, `Label ${i}`]));
    const catalog = { label: labels, message: { "delete-team-warning": "Deleting a team will also delete all team websites." } };
    const hits = extractTexts("public/intl/messages/en-US.json", "JSON", JSON.stringify(catalog, null, 2));
    expect(hits).toHaveLength(TEXTS_PER_FILE);
    expect(hits.some((h) => h.text === "message.delete-team-warning: Deleting a team will also delete all team websites.")).toBe(true);
    // Still in the file's order.
    expect(hits.map((h) => h.line)).toEqual([...hits.map((h) => h.line)].sort((x, y) => x - y));
  });
});
