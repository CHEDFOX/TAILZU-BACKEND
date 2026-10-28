// The phone's own renderer (TAILZU-FRONTEND/app/src/sdui), drawn in a browser through react-native-web, for the
// render check (../render.ts). The screen and the insets come from the page: window.__SCREEN__, window.__INSETS__.
import React, { useMemo } from "react";
import { AppRegistry, View } from "react-native";
import { RenderNode } from "@app/sdui/Renderer";
import { ThemeContext } from "@app/sdui/components";
import { Store } from "@app/sdui/state";

const screen = window.__SCREEN__;
const base = window.__THEME__ || {};
const st = screen.theme || {};
const theme = {
  ...base,
  color: { ...(base.color || {}), ...(st.color || {}) },
  space: { ...(base.space || {}), ...(st.space || {}) },
  radius: { ...(base.radius || {}), ...(st.radius || {}) },
  font: { sizes: {}, weights: {}, ...(base.font || {}), ...(st.font || {}) },
};
const noop = () => {};

function App() {
  const store = useMemo(() => new Store(screen.state || {}), []);
  const ctx = useMemo(() => ({
    store, actions: screen.actions || {}, flags: {}, labels: {}, toast: noop,
    nav: { push: noop, replace: noop, back: noop, switchTab: noop, reloadCurrent: noop, refreshLocale: noop },
  }), [store]);
  return (
    <ThemeContext.Provider value={theme}>
      <View style={{ width: window.innerWidth, height: window.innerHeight, backgroundColor: theme.color.bg || "#fff" }}>
        <RenderNode node={screen.root} ctx={ctx} />
      </View>
    </ThemeContext.Provider>
  );
}

AppRegistry.registerComponent("App", () => App);
AppRegistry.runApplication("App", { rootTag: document.getElementById("root") });
window.__RENDERED__ = true;
