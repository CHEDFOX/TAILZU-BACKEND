/**
 * The setup checklist's progress, as the bootstrap reports it.
 */

/**
 * SETUP, AS A LIVE ACTIVITY — the step someone left off at.
 *
 * Installed, opened, put down: nothing on the phone said where they were.
 * This is the unfinished task on the Lock Screen until it is done — which step,
 * what it takes, and a tap back to it. Four steps, the ones behind them
 * counted, so what is left reads as short: it is.
 *
 * The words are written for the moment they are read, on a locked phone,
 * hours later: one action, how long it takes, and what it gets them. Nothing
 * when setup is done, and never on a desktop or Android (no Live Activities).
 * Not amber: nothing here is live.
 */
// Each step opens the Bots app where it is done: the keyboard on Keylessbord's "Turn on" page (bots.keybot.on, the step by step
// the keyboard card's "Show me how" opens), the microphone on Keylessbord's page, whose card asks for it first (firstRun.ts
// keybotCard). Signing up and the first sentence open the app as it is.
const SETUP_STEPS = [
  { key: "account", title: "Finish signing up", detail: "About a minute from here to talking in any app.", url: "tulmi://" },
  { key: "keyboard", title: "Add the X0 keyboard", detail: "30 seconds in Settings. Then every app takes your voice.", url: "tulmi://screen/bots.keybot.on" },
  { key: "mic", title: "Allow the microphone", detail: "So it can hear you. It listens only when you tap.", url: "tulmi://screen/bots.keybot" },
  { key: "first", title: "Say your first sentence", detail: "Tap the mic on the X0 keyboard, in any app.", url: "tulmi://" },
] as const;

export function setupActivity(opts: {
  platform?: string; formFactor?: string; signedIn?: boolean; keyboardReady?: boolean;
  micGranted?: boolean; wordsEver?: number; setupDone?: boolean;
}): { done: number; total: number; title: string; detail: string; url: string } | null {
  if (opts.setupDone || opts.platform !== "ios" || opts.formFactor === "desktop") return null;
  const done: Record<string, boolean> = {
    account: !!opts.signedIn,
    keyboard: !!opts.keyboardReady,
    mic: !!opts.micGranted,
    first: (opts.wordsEver ?? 0) > 0,
  };
  const next = SETUP_STEPS.find((st) => !done[st.key]);
  if (!next) return null;
  return {
    done: SETUP_STEPS.filter((st) => done[st.key]).length,
    total: SETUP_STEPS.length,
    title: next.title,
    detail: next.detail,
    url: next.url,
  };
}
