import { describe, it, expect } from "vitest";
import { converseSystem, languageName, spokenLanguage } from "../src/pipeline/cleanup";
import { buildScreen, buildKeyboardConfig, speechLocale } from "../src/experience/catalog";

describe("the spoken training partner speaks the user's language", () => {
  it("names the language rather than quoting its code", () => {
    expect(languageName("hi")).toBe("Hindi");
    expect(languageName("es")).toBe("Spanish");
    expect(languageName("hinglish")).toMatch(/Hinglish/);
    expect(languageName("auto")).toBeNull();
    expect(languageName(undefined)).toBeNull();
    // The saved language only opens the conversation; it is named, not coded.
    expect(converseSystem("hi")).toContain("Until they speak, use Hindi.");
    expect(converseSystem("hi")).not.toContain("use hi.");
    expect(converseSystem("auto")).toContain("Always answer in the language they last spoke");
  });

  it("answers in what they are speaking, not in what the account says", () => {
    // Saved as English; they spoke Bengali. The Bengali wins.
    const s = converseSystem("en", "আমি আজ অফিসে অনেক কাজ করেছি");
    expect(s).toContain("They are speaking Bengali");
    expect(s).not.toContain("Until they speak");
    expect(converseSystem("en", "aaj kaam bahut tha yaar, thak gaya hoon")).toContain("Hinglish");
    expect(converseSystem("hi", "I had a long day at work")).not.toMatch(/They are speaking/);
  });

  it("names the voice for a reply by the reply's own script", () => {
    expect(spokenLanguage("আজ কেমন গেল?")?.locale).toBe("bn-IN");
    expect(spokenLanguage("आज कैसा रहा?")?.locale).toBe("hi-IN");
    expect(spokenLanguage("How was today?")).toBeNull();
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
    // It listens in their language and speaks in its voice; it no longer
    // opens with a line of its own in any language (see catalog.test).
    const hi = props("hi");
    expect(hi.props.language).toBe("hi");
    expect(hi.props.speakLanguage).toBe("hi-IN");
    expect(hi.props.greeting).toBeUndefined();
    expect((hi.state.turns as unknown[]).length).toBe(0);
    expect(props("hinglish").props.speakLanguage).toBe("en-IN");
    const en = props("en");
    expect(en.props.language).toBe("en");
    expect(en.props.speakLanguage).toBeUndefined();
    expect(props("es").props.speakLanguage).toBe("es-ES");
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
