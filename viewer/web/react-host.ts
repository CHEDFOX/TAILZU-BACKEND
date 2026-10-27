/**
 * Mounts the artifact's default export into the page. Loaded only for react artifacts, and it imports react and react-dom through the
 * page's import map, so it shares the one React with the artifact and the libraries it uses.
 *
 * What is on screen only ever changes for the better: while the source is streaming in, a version that throws while it renders is
 * replaced by the last version that rendered (inside the same commit, so nothing flashes); only a final version that fails shows the error.
 */
import React from "react";
import { createRoot } from "react-dom/client";

type Root = ReturnType<typeof createRoot>;

export interface ShowOptions {
  /** False while the source is still being written. */
  final: boolean;
  /** The new version is on screen. */
  onCommit(): void;
  /** The new version threw while rendering. */
  onError(error: unknown, componentStack: string | undefined): void;
}

let root: Root | null = null;
let rootEl: Element | null = null;
let lastGood: unknown = null;
let epoch = 0;

/** Renders its children, or tells the page they failed and shows something else. */
class Boundary extends (React.Component as any) {
  state = { error: null as unknown, fallbackFailed: false };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    this.props.onError(error, info?.componentStack);
  }
  render() {
    const { error, fallbackFailed } = this.state;
    if (!error) return this.props.children;
    if (this.props.lastGood && !this.props.final && !fallbackFailed) {
      return React.createElement(Safe, { onFail: () => this.setState({ fallbackFailed: true }) }, React.createElement(this.props.lastGood));
    }
    return errorBox(error);
  }
}

/** A boundary for the fallback itself, so a fallback that also throws cannot take the whole page down. */
class Safe extends (React.Component as any) {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function errorBox(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return React.createElement(
    "div",
    { className: "tz-err", role: "alert" },
    React.createElement("strong", null, "This artifact stopped with an error"),
    React.createElement("pre", null, message),
  );
}

function Mark(props: { cb(): void }) {
  React.useLayoutEffect(() => {
    props.cb();
  }, []);
  return null;
}

export function show(container: Element, Component: unknown, o: ShowOptions): Promise<"ok" | "error"> {
  if (!root || rootEl !== container) {
    root?.unmount();
    root = createRoot(container);
    rootEl = container;
  }
  const mine = ++epoch;
  const fallback = lastGood;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: "ok" | "error"): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    root!.render(
      React.createElement(
        Boundary,
        {
          key: mine,
          lastGood: fallback,
          final: o.final,
          onError: (error: unknown, stack: string | undefined) => {
            if (mine !== epoch) return;
            o.onError(error, stack);
            finish("error");
          },
        },
        React.createElement(Component as any),
        React.createElement(Mark, {
          cb: () => {
            if (mine !== epoch) return;
            lastGood = Component;
            o.onCommit();
            finish("ok");
          },
        }),
      ),
    );
    // A component that suspends for ever must not hold the viewer up.
    setTimeout(() => finish("ok"), 5000);
  });
}

export function unmount(): void {
  root?.unmount();
  root = null;
  rootEl = null;
  lastGood = null;
  epoch++;
}
