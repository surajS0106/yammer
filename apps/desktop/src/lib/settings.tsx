// The settings window's shared state: settings (saved through Rust on every
// change), which API keys are stored, and a toast for errors.

import * as React from "react";

import { api, errorMessage, on, type SecretName, type Settings } from "./tauri";
import { setTheme } from "./theme";

interface Ctx {
  settings: Settings;
  /** Apply a change and save it. Resolves false (and shows the error) if Rust rejected it. */
  update: (change: Partial<Settings> | ((s: Settings) => Settings)) => Promise<boolean>;
  secrets: Record<SecretName, boolean>;
  setSecret: (name: SecretName, value: string) => Promise<void>;
  toast: (message: string, tone?: "error" | "info") => void;
}

const SettingsContext = React.createContext<Ctx | null>(null);

export function useSettings(): Ctx {
  const ctx = React.useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings outside SettingsProvider");
  return ctx;
}

export function SettingsProvider({ initial, children }: { initial: Settings; children: React.ReactNode }) {
  const [settings, setSettings] = React.useState(initial);
  const [secrets, setSecrets] = React.useState<Record<SecretName, boolean>>({ stt: false, cleanup: false });
  const [toastState, setToast] = React.useState<{ message: string; tone: "error" | "info"; id: number } | null>(null);
  const latest = React.useRef(settings);
  latest.current = settings;

  const toast = React.useCallback((message: string, tone: "error" | "info" = "error") => {
    setToast({ message, tone, id: Date.now() });
  }, []);

  // Before paint, so a saved light/dark choice doesn't flash the OS one first.
  React.useLayoutEffect(() => setTheme(settings.theme), [settings.theme]);

  React.useEffect(() => {
    api.secretStatus().then(setSecrets, () => {});
    const unlisten = on.settingsChanged(setSettings);
    return () => void unlisten.then((f) => f());
  }, []);

  React.useEffect(() => {
    if (!toastState) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toastState]);

  const update = React.useCallback(
    async (change: Partial<Settings> | ((s: Settings) => Settings)) => {
      const prev = latest.current;
      const next = typeof change === "function" ? change(prev) : { ...prev, ...change };
      setSettings(next);
      try {
        setSettings(await api.settingsSet(next));
        return true;
      } catch (e) {
        setSettings(prev);
        toast(errorMessage(e));
        return false;
      }
    },
    [toast],
  );

  const setSecret = React.useCallback(
    async (name: SecretName, value: string) => {
      try {
        await api.secretSet(name, value);
        setSecrets(await api.secretStatus());
        toast(value.trim() ? "Key saved to your system keychain." : "Key removed.", "info");
      } catch (e) {
        toast(errorMessage(e));
      }
    },
    [toast],
  );

  return (
    <SettingsContext.Provider value={{ settings, update, secrets, setSecret, toast }}>
      {children}
      {toastState && (
        <div
          key={toastState.id}
          role="status"
          className={
            "fixed right-4 bottom-4 z-50 max-w-sm rounded-lg border px-3.5 py-2.5 text-sm shadow-lg " +
            (toastState.tone === "error" ? "border-destructive/30 bg-card text-destructive" : "bg-card")
          }
          style={{ animation: "pill-in 160ms ease-out" }}
        >
          {toastState.message}
        </div>
      )}
    </SettingsContext.Provider>
  );
}
