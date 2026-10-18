import "./index.css";

import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openUrl } from "@tauri-apps/plugin-opener";
import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { api, errorMessage } from "./lib/tauri";
import { SettingsProvider } from "./lib/settings";
import { Overlay } from "./overlay";

// The webview ignores target="_blank"; hand external links to the default browser.
document.addEventListener("click", (e) => {
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (a && /^https?:/i.test(a.href)) {
    e.preventDefault();
    void openUrl(a.href);
  }
});

// Follow the OS light/dark setting.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches);
applyTheme();
dark.addEventListener("change", applyTheme);

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// Both windows load this page; the overlay window only draws the pill.
if (getCurrentWebviewWindow().label === "overlay") {
  document.documentElement.classList.add("overlay");
  root.render(<Overlay />);
} else {
  api.settingsGet().then(
    (settings) =>
      root.render(
        <React.StrictMode>
          <SettingsProvider initial={settings}>
            <App />
          </SettingsProvider>
        </React.StrictMode>,
      ),
    (e) =>
      root.render(
        <div className="flex h-svh flex-col items-center justify-center gap-2 p-8 text-center">
          <h1 className="text-lg font-medium">Sush Voice couldn’t load its settings</h1>
          <p className="max-w-md text-sm text-muted-foreground">{errorMessage(e)}</p>
        </div>,
      ),
  );
}
