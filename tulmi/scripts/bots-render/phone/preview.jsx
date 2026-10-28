// The phone's own renderer (TAILZU-FRONTEND/app/src/sdui: RenderNode, its components and runAction) with a navigator
// around it, for the live preview (../preview.ts). The navigator is SduiApp's, cut down to what a Bots app screen uses:
// a stack, tabs from the bootstrap, push / replace / back / switchTab / reload, a screen's Store, the toast. Every Bots
// screen draws its own chrome (hideChrome), so there is no header or tab bar here. Screens and answers come from the
// preview's shim (../preview/shim.js): window.__preview.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppRegistry, Text, View } from "react-native";
import { RenderNode } from "@app/sdui/Renderer";
import { ThemeContext, typeRole } from "@app/sdui/components";
import { Store } from "@app/sdui/state";
import { setKnobs, num, color } from "@app/sdui/knobs";

const P = window.__preview;
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

/** SduiApp's ScreenHost: one Store per screen, the device answers a window can give, the tree. */
function ScreenHost({ screen, nav, flags, labels, toast }) {
  const store = useMemo(() => {
    const s = new Store(screen.state || {});
    // What the phone reports from the device (SduiApp ScreenHost): a preview has the keyboard and the mic.
    s.set("keyboardEnabled", true);
    s.set("keyboardReady", true);
    s.set("micGranted", true);
    return s;
  }, [screen]);
  const ctx = useMemo(() => ({ store, actions: screen.actions || {}, flags, labels, nav, toast }), [store, screen.actions, flags, labels, nav, toast]);
  return <RenderNode node={screen.root} ctx={ctx} />;
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
    window.__previewReset = () => { setShown(null); setStack(first()); };
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

  const theme = useMemo(() => mergeTheme(boot.theme || {}, shown && shown.screen.theme), [boot, shown]);
  return (
    <View style={{ width: window.innerWidth, height: window.innerHeight, backgroundColor: theme.color.bg || "#fff" }}>
      {shown ? (
        <ThemeContext.Provider value={theme}>
          <ScreenHost key={shown.key} screen={shown.screen} nav={nav} flags={boot.flags || {}} labels={boot.labels || {}} toast={showToast} />
        </ThemeContext.Provider>
      ) : null}
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
