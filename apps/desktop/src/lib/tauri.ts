// Typed bindings for the Rust commands (src-tauri/src/commands.rs, whisper.rs).
// The types mirror voice-core's serde shapes: camelCase fields, kebab-case enums.
// If you change a Rust command or serde type, update this file to match.

import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Engine = "local" | "cloud";
export type SttApi = "transcriptions" | "ollama-chat";
export type LlmFormat = "openai-chat" | "anthropic-messages";

export interface CloudStt {
  preset: string;
  baseUrl: string;
  model: string;
  api: SttApi;
}

export interface Cleanup {
  enabled: boolean;
  preset: string;
  baseUrl: string;
  model: string;
  format: LlmFormat;
  instructions: string;
}

export interface Settings {
  hotkey: string;
  micDevice: string | null;
  sounds: boolean;
  restoreClipboard: boolean;
  trailingSpace: boolean;
  engine: Engine;
  localModel: string;
  language: string;
  vocabulary: string;
  cloud: CloudStt;
  cleanup: Cleanup;
  onboarded: boolean;
}

export interface ModelInfo {
  id: string;
  label: string;
  file: string;
  sizeBytes: number;
  englishOnly: boolean;
  description: string;
  downloaded: boolean;
}

export interface DownloadProgress {
  received: number;
  total: number;
}

export interface HistoryEntry {
  id: number;
  at: number;
  text: string;
  raw?: string;
  durationMs: number;
  engine: string;
}

export interface Platform {
  os: string;
  wayland: boolean;
  wtype: boolean;
  ydotool: boolean;
  accessibility: boolean | null;
  version: string;
}

export type SecretName = "stt" | "cleanup";

export type OverlayState =
  | { phase: "listening"; hint: string | null }
  | { phase: "transcribing" }
  | { phase: "polishing" }
  | { phase: "message"; text: string; error: boolean }
  | { phase: "hidden" };

export const api = {
  settingsGet: () => invoke<Settings>("settings_get"),
  settingsSet: (settings: Settings) => invoke<Settings>("settings_set", { settings }),
  hotkeySuspend: (suspended: boolean) => invoke<void>("hotkey_suspend", { suspended }),
  hotkeyError: () => invoke<string | null>("hotkey_error"),
  micDevices: () => invoke<string[]>("mic_devices"),
  secretStatus: () => invoke<Record<SecretName, boolean>>("secret_status"),
  secretSet: (name: SecretName, value: string) => invoke<void>("secret_set", { name, value }),
  historyList: () => invoke<HistoryEntry[]>("history_list"),
  historyDelete: (id: number) => invoke<void>("history_delete", { id }),
  historyClear: () => invoke<void>("history_clear"),
  copyText: (text: string) => invoke<void>("copy_text", { text }),
  platformInfo: () => invoke<Platform>("platform_info"),
  autostartGet: () => invoke<boolean>("autostart_get"),
  autostartSet: (enabled: boolean) => invoke<void>("autostart_set", { enabled }),
  openPermissionSettings: (pane: "microphone" | "accessibility") => invoke<void>("open_permission_settings", { pane }),
  modelsList: () => invoke<ModelInfo[]>("models_list"),
  modelDelete: (id: string) => invoke<void>("model_delete", { id }),
  modelDownload: (id: string, onProgress: (p: DownloadProgress) => void) => {
    const channel = new Channel<DownloadProgress>();
    channel.onmessage = onProgress;
    return invoke<void>("model_download", { id, onProgress: channel });
  },
};

export const on = {
  dictation: (f: (s: OverlayState) => void): Promise<UnlistenFn> => listen<OverlayState>("dictation", (e) => f(e.payload)),
  level: (f: (rms: number) => void): Promise<UnlistenFn> => listen<number>("level", (e) => f(e.payload)),
  historyAdded: (f: (entry: HistoryEntry) => void): Promise<UnlistenFn> =>
    listen<HistoryEntry>("history-added", (e) => f(e.payload)),
  settingsChanged: (f: (s: Settings) => void): Promise<UnlistenFn> => listen<Settings>("settings-changed", (e) => f(e.payload)),
};

/** Commands reject with the Rust error's message as a plain string. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
