import { describe, it, expect } from "vitest";
import { converseSystem, languageName } from "../src/pipeline/cleanup";
import { buildScreen, buildKeyboardConfig, speechLocale } from "../src/experience/catalog";

describe("the spoken training partner speaks the user's language", () => {
  it("names the language rather than quoting its code", () => {
    expect(languageName("hi")).toBe("Hindi");
    expect(languageName("es")).toBe("Spanish");
    expect(languageName("hinglish")).toMatch(/Hinglish/);
    expect(languageName("auto")).toBeNull();
    expect(languageName(undefined)).toBeNull();
    expect(converseSystem("hi")).toContain("Speak in Hindi");
    expect(converseSystem("hi")).not.toContain("Speak in hi");
    expect(converseSystem("auto")).toContain("whatever language they are speaking");
  });

  it("gives the live session the hint to listen with and the locale to speak in", () => {
    const props = (language: string) => {
      const screen = buildScreen("training_live", { personality: {}, language, onboarded: true } as never)!;
      let found: Record<string, unknown> | null = null;
      const go = (n: { type?: string; props?: Record<string, unknown>; children?: unknown[] } | undefined) => {
        if (!n || typeof n !== "object") return;
        if (n.type === "VoiceSession") found = n.props ?? {};
        for (const c of n.children ?? []) go(c as never);
      };
      go(screen.root as never);
      return { props: found!, state: screen.state as Record<string, unknown> };
    };
    const hi = props("hi");
    expect(hi.props.language).toBe("hi");
    expect(hi.props.speakLanguage).toBe("hi-IN");
    // The greeting is in their language, and seeded as the first line.
    expect(String(hi.props.greeting)).toMatch(/[\u0900-\u097F]/);
    expect((hi.state.turns as unknown[]).length).toBe(1);
    const hing = props("hinglish");
    expect(hing.props.speakLanguage).toBe("en-IN");
    expect(String(hing.props.greeting)).toMatch(/baat/);
    // English and auto keep the phone's own voice and the written greeting.
    const en = props("en");
    expect(en.props.language).toBe("en");
    expect(en.props.speakLanguage).toBeUndefined();
    expect(typeof en.props.greeting).toBe("string");
    // A language with no greeting of its own opens by listening: nothing
    // seeded, nothing spoken in the wrong voice.
    const es = props("es");
    expect(es.props.speakLanguage).toBe("es-ES");
    expect(es.props.greeting).toBeUndefined();
    expect((es.state.turns as unknown[]).length).toBe(0);
    expect(speechLocale("auto")).toBeUndefined();
    expect(speechLocale("ta")).toBe("ta-IN");
  });
});

describe("the recording veil's blur is keyed on the keyboard build", () => {
  it("is on for K37 and later, off for builds that never said which they are", () => {
    const flags = (kbBuild?: number) =>
      buildKeyboardConfig(undefined, undefined, { platform: "ios", ...(kbBuild ? { kbBuild } : {}) }).flags as Record<string, unknown>;
    expect(flags()["kb.dictation.dim.blur"]).toBe(false);
    expect(flags()["kb.dictation.dim.alpha"]).toBe(0);
    expect(flags(36)["kb.dictation.dim.blur"]).toBe(false);
    expect(flags(37)["kb.dictation.dim.blur"]).toBe(true);
    expect(flags(37)["kb.dictation.dim.alpha"]).toBe(0.06);
    expect(flags(37)["kb.dictation.dim.blocksTouches"]).toBe(true);
  });
});
