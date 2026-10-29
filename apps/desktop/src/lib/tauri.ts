// Typed bindings for the Rust commands (src-tauri/src/commands.rs, whisper.rs).
// The types mirror voice-core's serde shapes: camelCase fields, kebab-case enums.
// If you change a Rust command or serde type, update this file to match.

import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Engine = "local" | "cloud";
export type Theme = "system" | "light" | "dark";
export type SttApi = "transcriptions" | "ollama-chat" | "sarvam";
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

export interface Replacement {
  from: string;
  to: string;
}

export interface Snippet {
  trigger: string;
  text: string;
}

export interface Transform {
  id: string;
  name: string;
  instructions: string;
  /** Dictates with this transform, whichever one is active; "" for none. */
  hotkey: string;
}

export interface Settings {
  hotkey: string;
  /** Select text, then hold this and say how to change it; "" for none. */
  editHotkey: string;
  micDevice: string | null;
  sounds: boolean;
  /** Mute the computer's sound output while recording. */
  muteAudio: boolean;
  restoreClipboard: boolean;
  trailingSpace: boolean;
  overlayAlwaysVisible: boolean;
  /** Where the pill was dragged to (physical px, window top-left); null is bottom centre. */
  overlayPosition: { x: number; y: number } | null;
  engine: Engine;
  localModel: string;
  language: string;
  vocabulary: string;
  /** After a dictation, offer to add names and jargon it heard to the vocabulary. */
  suggestWords: boolean;
  /** Suggested words the user turned down, so they aren't offered again. */
  ignoredWords: string[];
  cloud: CloudStt;
  cleanup: Cleanup;
  theme: Theme;
  /** Dictionary corrections applied to every transcript. */
  replacements: Replacement[];
  snippets: Snippet[];
  transforms: Transform[];
  /** Id of the transform applied to dictations; "" for none. */
  activeTransform: string;
  /** How many of the newest dictations keep their audio for "Transcribe again"; 0 keeps none. */
  keepRecordings: number;
  /** Delete dictations older than this many days; 0 keeps them forever. */
  historyDays: number;
  onboarded: boolean;
  /** The newest version whose "What's new" the user has seen; "" before the first. */
  seenChangelog: string;
}

/** A rectangle in CSS px from the overlay window's top-left. */
export interface HitArea {
  x: number;
  y: number;
  width: number;
  height: number;
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
  engineLabel?: string;
  cleanup?: string;
  /** ISO 639-1 code; missing when a cloud engine auto-detected it, and on older entries. */
  language?: string;
  /** Id of the transform whose hotkey dictated it. */
  transform?: string;
  /** An edit by voice: the selected text it rewrote (`raw` is then the spoken instruction). */
  selection?: string;
  /** Why it failed (`text` is then empty). */
  error?: string;
  /** Its recording is kept, so it can be transcribed again. */
  audio?: boolean;
}

export interface Note {
  id: string;
  text: string;
  updatedAt: number;
}

export interface Platform {
  os: string;
  wayland: boolean;
  gnomeShortcut: boolean;
  wtype: boolean;
  ydotool: boolean;
  accessibility: boolean | null;
  version: string;
}

export type SecretName = "stt" | "cleanup";

export type OverlayState =
  | { phase: "listening"; hint: string | null }
  | { phase: "transcribing"; engine: string }
  | { phase: "polishing"; model: string }
  /** Rewriting the selection as asked (the edit hotkey). */
  | { phase: "editing"; model: string }
  | { phase: "message"; text: string; error: boolean }
  /** The dictation failed and its recording was kept: offer to retry history entry `id`. */
  | { phase: "failed"; text: string; id: number }
  /** No text box had focus, so the transcript is shown to copy instead of pasted. */
  | { phase: "transcript"; text: string; words: string[] }
  /** Pasted, and it heard words the Dictionary doesn't know: offer to add them. */
  | { phase: "words"; words: string[] }
  | { phase: "idle" }
  | { phase: "hidden" };

export const api = {
  settingsGet: () => invoke<Settings>("settings_get"),
  settingsSet: (settings: Settings) => invoke<Settings>("settings_set", { settings }),
  overlayState: () => invoke<OverlayState>("overlay_state"),
  overlayHitAreas: (areas: HitArea[]) => invoke<void>("overlay_hit_areas", { areas }),
  overlayResetPosition: () => invoke<void>("overlay_reset_position"),
  overlayToggleDictation: () => invoke<void>("overlay_toggle_dictation"),
  overlayOpen: (page: string) => invoke<void>("overlay_open", { page }),
  overlayHide: () => invoke<void>("overlay_hide"),
  /** Close the transcript card (no-op if something newer is showing). */
  overlayDismiss: () => invoke<void>("overlay_dismiss"),
  /** The failed card's Retry: transcribe the entry again and paste it. */
  overlayRetry: (id: number) => invoke<void>("overlay_retry", { id }),
  /** Add words to the Dictionary, and never offer `ignore` again. */
  dictionaryAdd: (add: string[], ignore: string[]) => invoke<void>("dictionary_add", { add, ignore }),
  quit: () => invoke<void>("quit"),
  hotkeyLabel: () => invoke<string>("hotkey_label"),
  hotkeySuspend: (suspended: boolean) => invoke<void>("hotkey_suspend", { suspended }),
  hotkeyError: () => invoke<string | null>("hotkey_error"),
  micDevices: () => invoke<string[]>("mic_devices"),
  secretStatus: () => invoke<Record<SecretName, boolean>>("secret_status"),
  secretSet: (name: SecretName, value: string) => invoke<void>("secret_set", { name, value }),
  historyList: () => invoke<HistoryEntry[]>("history_list"),
  historyDelete: (id: number) => invoke<void>("history_delete", { id }),
  historyClear: () => invoke<void>("history_clear"),
  /** Transcribe a kept recording again with the current settings; resolves to the updated entry. */
  historyRetry: (id: number) => invoke<HistoryEntry>("history_retry", { id }),
  /** Save a file to Downloads and show it; resolves to its path. */
  exportFile: (name: string, contents: string) => invoke<string>("export_file", { name, contents }),
  scratchpadList: () => invoke<Note[]>("scratchpad_list"),
  scratchpadSave: (notes: Note[]) => invoke<void>("scratchpad_save", { notes }),
  copyText: (text: string) => invoke<void>("copy_text", { text }),
  /** Rewrite text by a transform's instructions, using the AI cleanup model. */
  textRewrite: (text: string, instructions: string) => invoke<string>("text_rewrite", { text, instructions }),
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
  /** An entry was transcribed again. */
  historyUpdated: (f: (entry: HistoryEntry) => void): Promise<UnlistenFn> =>
    listen<HistoryEntry>("history-updated", (e) => f(e.payload)),
  settingsChanged: (f: (s: Settings) => void): Promise<UnlistenFn> => listen<Settings>("settings-changed", (e) => f(e.payload)),
  /** Where the cursor is over the overlay window (CSS px), or null when it's off it. */
  overlayCursor: (f: (p: { x: number; y: number } | null) => void): Promise<UnlistenFn> =>
    listen<{ x: number; y: number } | null>("overlay-cursor", (e) => f(e.payload)),
  /** The island asked the settings window to show a page. */
  navigate: (f: (page: string) => void): Promise<UnlistenFn> => listen<string>("navigate", (e) => f(e.payload)),
};

/** Commands reject with the Rust error's message as a plain string. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
