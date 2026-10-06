/**
 * Setup's Live Activity: the step someone left off at, until they are done.
 *
 * Installed, opened, put down — and nothing on the phone said where they were.
 * The server decides the step and every word; the app only shows it.
 */
import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

const { buildBootstrap, setupActivity } = await import("../src/experience/catalog.js");

const ios = { platform: "ios" as const };

describe("the step it shows", () => {
  it("asks a stranger to finish signing up, with none of four done", () => {
    expect(setupActivity(ios)).toMatchObject({ done: 0, total: 4, title: "Finish signing up" });
  });

  it("walks the steps in order, counting the ones behind them", () => {
    expect(setupActivity({ ...ios, signedIn: true })).toMatchObject({ done: 1, title: "Add the Tailzu keyboard", url: "tulmi://screen/onboarding_keyboard" });
    expect(setupActivity({ ...ios, signedIn: true, keyboardReady: true })).toMatchObject({ done: 2, title: "Allow the microphone" });
    expect(setupActivity({ ...ios, signedIn: true, keyboardReady: true, micGranted: true })).toMatchObject({ done: 3, title: "Say your first sentence" });
  });

  it("is gone once a first sentence is said", () => {
    expect(setupActivity({ ...ios, signedIn: true, keyboardReady: true, micGranted: true, wordsEver: 12 })).toBeNull();
  });

  it("never shows on Android, a desktop, or to a reviewer", () => {
    expect(setupActivity({ platform: "android" })).toBeNull();
    expect(setupActivity({ ...ios, formFactor: "desktop" })).toBeNull();
    expect(setupActivity({ ...ios, setupDone: true })).toBeNull();
  });

  it("says what to do, how long it takes, and what it gets them", () => {
    const s = setupActivity({ ...ios, signedIn: true })!;
    expect(s.detail).toMatch(/30 seconds/);
    expect(s.detail).toMatch(/every app takes your voice/);
  });
});

describe("in the bootstrap", () => {
  it("rides as a flag while setup is unfinished, and is absent once it is done", () => {
    const open = buildBootstrap({ platform: "ios", signedIn: true } as never) as { flags: Record<string, unknown> };
    expect(open.flags["liveActivity.setup"]).toMatchObject({ title: "Add the Tailzu keyboard" });
    const done = buildBootstrap({ platform: "ios", signedIn: true, keyboardReady: true, micGranted: true, wordsEver: 5 } as never) as { flags: Record<string, unknown> };
    expect(done.flags["liveActivity.setup"]).toBeUndefined();
  });

  it("gives the Flow activity words that say what to do", () => {
    const b = buildBootstrap({ platform: "ios" } as never) as { labels: Record<string, string> };
    expect(b.labels["widget.flow.readyHint"]).toBe("Tap the mic on your keyboard and talk.");
  });
});
