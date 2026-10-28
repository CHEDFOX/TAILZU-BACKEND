// The phone's own renderer (TAILZU-FRONTEND/app/src/sdui: RenderNode, its components and runAction) with a navigator
// around it, for the live preview (../preview.ts). The navigator is SduiApp's, cut down to what a Bots app screen uses:
// a stack, tabs from the bootstrap, push / replace / back / switchTab / reload, a screen's Store, the toast. Every Bots
// screen draws its own chrome (hideChrome), so there is no header or tab bar here. Screens and answers come from the
// preview's shim (../preview/shim.js): window.__preview.
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppRegistry, Linking, Text, View } from "react-native";
import { RenderNode } from "@app/sdui/Renderer";
import { ThemeContext, typeRole } from "@app/sdui/components";
import { Store } from "@app/sdui/state";
import { setKnobs, num, color } from "@app/sdui/knobs";
import * as bus from "@app/onboard/stageBus";

const P = window.__preview;

/**
 * THE PHONE'S OWN READINGS, as a phone fresh from onboarding has them: Keybot not added yet, the microphone not
 * allowed, so Bots shows both cards. Opening Settings stands in for coming back with the keyboard on, and the
 * microphone's prompt (phone/expo-audio.js) answers yes; the screen picks either up on its next reading, as the app
 * does (SduiApp's ScreenHost, every 1.5 s).
 */
const FRESH = { keyboardEnabled: false, keyboardReady: false, micGranted: false };
const DEVICE = (window.__previewDevice = window.__previewDevice || { ...FRESH });
const settingsOpened = async () => { DEVICE.keyboardEnabled = true; DEVICE.keyboardReady = true; };
try { Linking.openSettings = settingsOpened; Linking.sendIntent = settingsOpened; } catch { /* a frozen Linking: the button does nothing here */ }
let seq = 0;
const entry = (screenId, params) => ({ screenId, params: params || {}, n: ++seq });

function mergeTheme(base, st) {
  if (!st) return base;
  return {
    ...base,
    color: { ...(base.color || {}), ...(st.color || {}) },
    space: { ...(base.space || {}), ...(st.space || {}) },
    radius: { ...(base.radius || {}), ...(st.radius || {}) },
    font: { ...(base.font || {}), ...(st.font || {}) },
  };
}

/** SduiApp's ScreenHost: one Store per screen, the device's readings written into it (and again on a timer), the tree. */
function ScreenHost({ screen, nav, flags, labels, toast }) {
  const store = useMemo(() => new Store(screen.state || {}), [screen]);
  useEffect(() => {
    const sync = () => { for (const k of Object.keys(FRESH)) if (store.get(k) !== DEVICE[k]) store.set(k, DEVICE[k]); };
    sync();
    const iv = setInterval(sync, 1500);
    return () => clearInterval(iv);
  }, [store]);
  const ctx = useMemo(() => ({ store, actions: screen.actions || {}, flags, labels, nav, toast }), [store, screen.actions, flags, labels, nav, toast]);
  return <RenderNode node={screen.root} ctx={ctx} />;
}

/**
 * BLIP, FOR THE PREVIEW. In the app he is BlipHost: one figure drawn with Skia above everything, walked from spot to
 * spot by what the stages and their BlipSpots tell stageBus. A browser has no Skia, so here the same bus is read and
 * he is the pose's own animated loop (the ones /blip/ serves), moved from spot to spot: one Blip across Welcome, Sign
 * in, Code, About you and Name, held still between two stages, and let go on any other screen. Reduce Motion: he
 * moves without travelling.
 */
const LOOP = {
  wave: "wave-l", tada: "tada-s", listen: "listen-s", wait: "listen-s", think: "think-s", present: "present-s",
  tap: "tap-s", pointd: "pointd-s", thumbs: "thumbs-s", nod: "thumbs-s", carry: "carry-s", key: "carry-s",
};
const reducedMotion = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

function PreviewBlip() {
  const s = useSyncExternalStore(bus.subscribe, bus.snapshot, bus.snapshot);
  const last = useRef(null);
  useEffect(() => { bus.setReduced(reducedMotion()); }, []);
  let at = null;
  if (s.spot && s.spot.rect && s.stage && s.stage.origin) {
    const r = s.spot.rect;
    at = { x: s.stage.origin.x + r.x + r.w / 2, y: s.stage.origin.y + r.y + r.h - s.scroll, h: s.spot.h, pose: s.spot.pose };
    last.current = at;
  } else if (s.mode !== "off") {
    at = last.current;
  } else {
    last.current = null;
  }
  if (!at) return null;
  // The loop pictures are a little taller than he is (room for his arms and his shadow).
  const h = Math.round(at.h * 1.16);
  const still = s.reduced || reducedMotion();
  const ease = "cubic-bezier(.32,.72,0,1)";
  return (
    <img
      alt=""
      aria-hidden="true"
      data-preview-blip=""
      src={`blip/${LOOP[at.pose] || "present-s"}.webp`}
      style={{
        position: "fixed", left: 0, top: 0, height: h, width: "auto", pointerEvents: "none", zIndex: 40,
        transform: `translate(${Math.round(at.x)}px, ${Math.round(at.y - h)}px) translateX(-50%)`,
        transition: still ? "opacity 200ms" : `transform 720ms ${ease}, height 400ms ${ease}`,
        opacity: s.mode === "off" ? 0 : 1,
      }}
    />
  );
}

function App({ boot }) {
  const tabs = boot.navigation && boot.navigation.kind === "tabs" ? boot.navigation.tabs : [];
  const first = () => [entry(boot.initialScreenId || (tabs[0] && tabs[0].screenId) || "bots.home")];
  const [stack, setStack] = useState(first);
  const [reload, setReload] = useState(0);
  const [shown, setShown] = useState(null);
  const [toast, setToastState] = useState(null);
  const timer = useRef();
  const top = stack[stack.length - 1];

  const showToast = useCallback((message, tone) => {
    setToastState({ message, tone });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastState(null), num("app.toastMs", 2800));
  }, []);

  const nav = useMemo(() => ({
    push: (screenId, params) => setStack((s) => [...s, entry(screenId, params)]),
    replace: (screenId, params) => setStack((s) => [...s.slice(0, -1), entry(screenId, params)]),
    back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    switchTab: (id) => {
      const tab = tabs.find((t) => t.id === id);
      if (tab) setStack([entry(tab.screenId)]);
    },
    reloadCurrent: () => setReload((n) => n + 1),
    refreshLocale: () => setReload((n) => n + 1),
  }), [tabs]);

  // The preview page's own controls (index.html): jump to a screen, start over, what is showing.
  useEffect(() => {
    window.__previewGo = (screenId, params) => nav.push(screenId, params);
    window.__previewReset = () => { Object.assign(DEVICE, FRESH); setShown(null); setStack(first()); };
    window.__previewBack = () => nav.back();
  }, [nav]);
  useEffect(() => { window.__previewTop = () => ({ screenId: top.screenId, params: top.params, depth: stack.length }); }, [top, stack.length]);

  // The screen at the top of the stack. The one showing stays until the next is ready, as in SduiApp.
  useEffect(() => {
    let live = true;
    P.screen(top.screenId, top.params).then((screen) => { if (live) setShown({ screen, key: `${top.n}:${reload}` }); })
      .catch((e) => { if (live) showToast(String((e && e.message) || e), "error"); });
    return () => { live = false; };
  }, [top, reload, showToast]);

  // What BlipHost is told in the app (SduiApp's phase): a stage on screen, or not, so Blip holds between two stages
  // and is let go on any other screen.
  useEffect(() => {
    bus.setAppPhase(!shown ? "pending" : shown.screen.root && shown.screen.root.type === "OnboardStage" ? "stage" : "other");
  }, [shown]);

  const theme = useMemo(() => mergeTheme(boot.theme || {}, shown && shown.screen.theme), [boot, shown]);
  return (
    <View style={{ width: window.innerWidth, height: window.innerHeight, backgroundColor: theme.color.bg || "#fff" }}>
      {shown ? (
        <ThemeContext.Provider value={theme}>
          <ScreenHost key={shown.key} screen={shown.screen} nav={nav} flags={boot.flags || {}} labels={boot.labels || {}} toast={showToast} />
        </ThemeContext.Provider>
      ) : null}
      <PreviewBlip />
      {toast ? (
        <View style={{
          position: "absolute", left: 16, right: 16, padding: 14,
          bottom: num("app.toast.bottom", 76), borderRadius: num("app.toast.radius", 10),
          backgroundColor: toast.tone === "error" ? (theme.color.toastError ?? color("app.color.toastError", "#3a1417"))
            : toast.tone === "success" ? (theme.color.toastSuccess ?? color("app.color.toastSuccess", "#13301a"))
            : (theme.color.toastInfo ?? color("app.color.toastInfo", "#1c1c25")),
        }} accessibilityLiveRegion="polite">
          <Text style={[typeRole(theme, "toast"), { color: theme.color.toastText ?? color("app.color.toastText", "#FFFFFF") }]}>{toast.message}</Text>
        </View>
      ) : null}
    </View>
  );
}

P.boot().then((boot) => {
  setKnobs(boot);
  AppRegistry.registerComponent("App", () => () => <App boot={boot} />);
  AppRegistry.runApplication("App", { rootTag: document.getElementById("root") });
  window.__RENDERED__ = true;
});
