// Whether the app is in dark mode (main.tsx toggles `.dark` on <html>). For
// components that take literal colours rather than CSS variables.

import * as React from "react";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

export function useDark(): boolean {
  return React.useSyncExternalStore(subscribe, () => document.documentElement.classList.contains("dark"));
}
