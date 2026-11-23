import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

// eslint-disable-next-line import/first
import { buildBootstrap } from "../src/experience/bootstrap/bootstrap.js";
// eslint-disable-next-line import/first
import { publishedUiBundle, resetPublishedUiBundle, uiBundleFlags } from "../src/experience/desktopUiBundle.js";

/** The desktop's overlay pages as published (desktop scripts/ui-bundle.js → deploy/receive-download.sh). */
describe("desktop.ui: the published UI bundle", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-bundle-"));
  const ui = path.join(dir, "ui");
  const v = "20261123101500-3f9a2c1d0e4b";
  const sha = "ab".repeat(32);
  const publish = (latest: Record<string, unknown>, body = "{\"format\":1}") => {
    fs.mkdirSync(ui, { recursive: true });
    fs.writeFileSync(path.join(ui, `${v}.json`), body);
    fs.writeFileSync(path.join(ui, "latest.json"), JSON.stringify(latest));
  };
  beforeEach(() => {
    process.env.DOWNLOADS_DIR = dir;
    fs.rmSync(ui, { recursive: true, force: true });
    resetPublishedUiBundle();
  });
  afterAll(() => { delete process.env.DOWNLOADS_DIR; resetPublishedUiBundle(); fs.rmSync(dir, { recursive: true, force: true }); });
  const desktop = () => buildBootstrap({ formFactor: "desktop", desk: true, os: "win32" } as never) as { flags: Record<string, unknown> };

  it("names what latest.json says, at the bundle's own address on the API", () => {
    publish({ format: 1, v, sha256: sha, size: 12, minApp: "0.4.7" });
    expect(uiBundleFlags()).toEqual({ "desktop.ui": { v, url: `/downloads/ui/${v}.json`, sha256: sha, minApp: "0.4.7" } });
    expect(desktop().flags["desktop.ui"]).toEqual({ v, url: `/downloads/ui/${v}.json`, sha256: sha, minApp: "0.4.7" });
  });

  it("is not sent to a phone", () => {
    publish({ format: 1, v, sha256: sha, size: 12, minApp: "0.4.7" });
    const phone = buildBootstrap({ formFactor: "phone" } as never) as { flags: Record<string, unknown> };
    expect(phone.flags["desktop.ui"]).toBeUndefined();
  });

  it("nothing published: no flag", () => {
    expect(publishedUiBundle()).toBeNull();
    expect(desktop().flags["desktop.ui"]).toBeUndefined();
  });

  it("a latest.json that is off, or a bundle not in place: no flag", () => {
    const bad: Array<Record<string, unknown>> = [
      { format: 1, v: "../../etc/passwd", sha256: sha, minApp: "0.4.7" },
      { format: 1, v, sha256: "nothex", minApp: "0.4.7" },
      { format: 1, v, sha256: sha, minApp: "soon" },
      { format: 2, v, sha256: sha, minApp: "0.4.7" },
      { format: 1, v, sha256: sha, size: 999, minApp: "0.4.7" },
    ];
    for (const m of bad) {
      publish(m);
      resetPublishedUiBundle();
      expect(publishedUiBundle(), JSON.stringify(m)).toBeNull();
    }
    publish({ format: 1, v, sha256: sha, minApp: "0.4.7" });
    fs.rmSync(path.join(ui, `${v}.json`));
    resetPublishedUiBundle();
    expect(publishedUiBundle()).toBeNull();
    fs.writeFileSync(path.join(ui, "latest.json"), "not json");
    resetPublishedUiBundle();
    expect(publishedUiBundle()).toBeNull();
  });

  it("is read once a minute, not on every bootstrap", () => {
    publish({ format: 1, v, sha256: sha, size: 12, minApp: "0.4.7" });
    expect(publishedUiBundle(1_000)?.v).toBe(v);
    fs.rmSync(ui, { recursive: true, force: true });
    expect(publishedUiBundle(30_000)?.v).toBe(v);
    expect(publishedUiBundle(62_000)).toBeNull();
  });
});
