/**
 * The desktop window's own copy and layout, sent in the bootstrap.
 */

/**
 * THE DESKTOP'S CHROME, WRITTEN HERE.
 *
 * The window's screens were already server-drawn — same catalog JSON the phones
 * render — but everything AROUND them was not. The sign-in gate, the rail down
 * the left, the tray menu and every notification were literals in main.js and
 * app.html, so changing a single word of them meant cutting an installer and
 * asking people to run it.
 *
 * That is the one thing the desktop cannot afford. There is no OTA channel here
 * and no store to push through: a build is a download the user has to notice,
 * accept past SmartScreen, and install. Copy that lives in the binary is copy
 * that can never be fixed.
 *
 * So it lives here, and the window renders it. The desktop still ships defaults
 * for every key — the tray is built at launch, before any network call can have
 * returned, and a first run on a plane must still have words in it — but the
 * server's answer wins the moment it lands and is cached for the next launch.
 *
 * The shape is flat and boring on purpose: string in, string out, no nodes to
 * interpret. The chrome is a menu bar and a form, not a screen, and giving it
 * the full SDUI vocabulary would buy nothing a label cannot already say.
 */
export const DESKTOP_UI = {
  // The sign-in gate. The only screen this app draws before it has an account,
  // so it is also the only one the catalog cannot reach.
  gate: {
    // THE FORM ITSELF IS `auth.screen` — the same tree the phones render, pills
    // and all. What is left here is the copy AROUND it, which is the window's
    // own: a phone has no room for a heading above the pills and does not draw
    // one. Every label that WAS here — the method tabs, the send button, the
    // two social rows — described a form this window no longer builds.
    title: "X0 Bot",
    subtitle: "Sign in the same way you do on your phone — your voices, history and words come with you.",
    // NOTHING UNDER THE FORM. The line here said dictation needs an account,
    // under a form whose whole job is asking for one: the same fact twice, and
    // the second time as small print. Empty is how the server says "no line";
    // the window hides the element rather than showing its own word, so a
    // sentence can be put back from here without an installer.
    note: "",
  },
  /**
   * WHERE THE FORM SITS ON THE ART.
   *
   * The sign-in art is a composition, not a texture: the mark and the headline
   * are placed in it, and a form centred in the window lands on top of them.
   * A phone has no room for that problem — the art is a backdrop behind a
   * single column — but a window is wide enough for the two to be beside each
   * other, and wide enough for them to collide if nobody says so.
   *
   * All of it is here rather than in the stylesheet because the art is an
   * upload. A new one with its subject on the right is a change to these
   * numbers and a cache bump; in CSS it would be a change to an installer.
   */
  gateLayout: {
    /** Which side of the window the form takes: "right", "left" or "center". */
    align: "right",
    /** Below this width there is no room for two columns and the form
     *  re-centres over the art, which is what a narrow window gets. */
    wideAt: 900,
    /**
     * The form column's centre, 0..1 across the window.
     *
     * The art rules a line at 0.573 of ITSELF, but the art is 16:9 and a window
     * rarely is — `cover` crops the sides, which walks that line inward. In a
     * 1120x760 window it lands near 0.59 of the window rather than 0.573, so
     * this is set for where the line actually appears rather than where it is
     * in the file.
     */
    column: 0.77,
    /** How wide the form is when it has a column to itself. Narrower than the
     *  centred layout's 352, because the band the art leaves empty is narrower
     *  than the window and a form that does not fit in it is back on the art. */
    columnWidth: 300,
    /** Darkening under the form, so a field stays readable over whatever the
     *  art does there. Across rather than down: the art's own contrast holds
     *  the left side, and a full-width bottom scrim crushed it. */
    scrim: "linear-gradient(90deg, rgba(0,0,0,0) 34%, rgba(0,0,0,0.45) 60%, rgba(0,0,0,0.66) 100%)",
    /** The art already says "Code sent." and "Say it right.", so the window's
     *  own heading and subtitle would be the same words twice. Turn either on
     *  again for art that carries no copy. */
    showTitle: false,
    showSubtitle: false,
  },
  // The rail down the left of the window, and the crumb above the screen.
  rail: {
    brand: "X0 Bot",
    dictate: "Dictate now",
    settings: "Settings",
    signOut: "Sign out",
    back: "← Back",
  },
  // The tray menu. Built before the first bootstrap can have answered, so the
  // desktop's own defaults carry the first paint and this replaces them.
  tray: {
    dictate: "Dictate",
    listening: "◉ Listening — {key} stops",
    signInToDictate: "Sign in to dictate…",
    open: "Open X0 Bot",
    tone: "Tone",
    toneThisDevice: "this device",
    liveCaptions: "Live captions while dictating",
    startAtLogin: "Start at login",
    hotkey: "Hotkey",
    holdToTalk: "Hold-to-talk: hold",
    holdUnavailable: "unavailable",
    holdOff: "Hold-to-talk: off (set \"hold\": true in config)",
    backend: "Backend",
    signedIn: "Signed in — dictation lands on your account",
    editConfig: "Edit config…",
    quit: "Quit X0 Bot",
    tooltipReady: "X0 Bot — ready",
    tooltipListening: "X0 Bot — listening…",
    tooltipSignIn: "X0 Bot — sign in to dictate",
  },
  // Native notifications and the sentences the recorder shows when capture
  // fails. Every one of these names something the user has to go and do, and
  // every one of them was previously unfixable without a release.
  notify: {
    title: "X0 Bot",
    signIn: "Sign in to dictate — your words belong to your account.",
    holdUnavailable: "Hold-to-talk unavailable (uiohook-napi didn't load) — using the toggle hotkey.",
    micBlockedWindows: "microphone blocked — Settings → Privacy & security → Microphone → let desktop apps access",
    micBlockedMac: "microphone blocked — System Settings → Privacy & Security → Microphone → X0 Bot",
    micMissing: "no microphone found — plug one in, then try again",
    micBusy: "microphone is in use by another app",
    noSpeech: "no speech detected — check your microphone",
    // {braces} are filled in by the desktop. Reordering or renaming one here
    // without the matching build leaves the placeholder on screen, so a new
    // variable is a new key rather than an edit to an existing one.
    unknownHoldKey: "Unknown holdKey \"{key}\" — use a key name like F9, F10, F12.",
    dictationFailed: "Dictation failed: {message}",
    hotkeyTaken: "{taken} is taken by another app, so dictation is on {bound}. Change it under Edit config.",
    noHotkey: "No hotkey could be registered. Use Dictate in the tray menu, and set a free one under Edit config.",
  },
} as const;
