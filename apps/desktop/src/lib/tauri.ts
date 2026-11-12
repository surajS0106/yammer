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

export type CallAudio = "both" | "mic" | "system";
export type LiveEngine = "dictation" | "openai-realtime" | "sarvam-streaming";
export type SummaryStyle = "minutes" | "summary" | "action-items" | "custom";

export interface MeetingSettings {
  /** Starts and stops a meeting transcript; "" for none. */
  hotkey: string;
  audio: CallAudio;
  engine: LiveEngine;
  /** The streaming engine's model; "" for its default. */
  model: string;
  summary: SummaryStyle;
  /** The notes' format with the "custom" style. */
  summaryInstructions: string;
  /** Write the notes as soon as the meeting ends. */
  autoSummary: boolean;
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
  meeting: MeetingSettings;
}

/** "you" is the microphone; "them" is what the computer plays: everyone else on the call. */
/** `room` is a phone's microphone, which hears everyone there, the user included. */
export type Speaker = "you" | "them" | "room";

export interface Segment {
  id: string;
  /** When it was said, in ms from the start of the meeting. */
  atMs: number;
  speaker: Speaker;
  text: string;
  /** Still being spoken (or transcribed); the final text replaces it. */
  partial?: boolean;
}

export interface Meeting {
  id: number;
  title: string;
  startedAt: number;
  endedAt: number | null;
  engine: string;
  segments: Segment[];
  /** What the user typed during the meeting. */
  notes: string;
  /** The notes written from it, in Markdown. */
  summary?: string;
  summaryBy?: string;
  /** Why writing the notes failed. */
  error?: string;
  /** Something that went wrong while transcribing. */
  notice?: string;
}

export interface MeetingOverview {
  id: number;
  title: string;
  startedAt: number;
  endedAt: number | null;
  words: number;
  preview: string;
  hasSummary: boolean;
}

export interface LiveMeeting {
  id: number;
  startedAt: number;
  engine: string;
  speakers: Speaker[];
}

export interface MeetingStatus {
  live: LiveMeeting | null;
  /** Meetings whose notes are being written. */
  summarizing: number[];
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

/** `live` is the streaming engine's key for meetings. */
/** Keys are saved per provider, so one key serves every feature set to it. Mirrors `KEY_NAMES` in voice-core's settings.rs. */
export type SecretName = "openai" | "anthropic" | "groq" | "sarvam" | "custom-stt" | "custom-cleanup";

/** A newer Android release than the one running (`voice_core::releases::AndroidRelease`). */
export interface AndroidRelease {
  version: string;
  /** That version's section of CHANGELOG-android.md. */
  notes: string;
  /** The APK. */
  url: string;
}

export interface AndroidStatus {
  mic: boolean;
  overlay: boolean;
  accessibility: boolean;
  notifications: boolean;
  /** The foreground service is up, so Sushi can start a recording. */
  running: boolean;
  recording: boolean;
}

export type AndroidAction = "requestMic" | "requestNotifications" | "openOverlaySettings" | "openAccessibilitySettings" | "openAppSettings" | "startBubble" | "stopBubble" | "toggle" | "barsLight" | "barsDark";

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
  /** Between dictations while a meeting is being transcribed. `startedAt` is Unix ms. */
  | { phase: "meeting"; startedAt: number }
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
  meetingStart: () => invoke<LiveMeeting>("meeting_start"),
  /** Resolves to the meeting transcribed to the end; its notes follow as `meetingUpdated`. */
  meetingStop: () => invoke<Meeting | null>("meeting_stop"),
  /** Start or stop, showing any error on the overlay. */
  meetingToggle: () => invoke<void>("meeting_toggle"),
  meetingStatus: () => invoke<MeetingStatus>("meeting_status"),
  meetingsList: () => invoke<MeetingOverview[]>("meetings_list"),
  meetingGet: (id: number) => invoke<Meeting>("meeting_get", { id }),
  meetingUpdate: (id: number, change: { title?: string; notes?: string; summary?: string }) => invoke<Meeting>("meeting_update", { id, ...change }),
  meetingDelete: (id: number) => invoke<void>("meeting_delete", { id }),
  /** Write (or rewrite) a stopped meeting's notes with the AI cleanup model. */
  meetingSummarize: (id: number) => invoke<Meeting>("meeting_summarize", { id }),
  scratchpadList: () => invoke<Note[]>("scratchpad_list"),
  scratchpadSave: (notes: Note[]) => invoke<void>("scratchpad_save", { notes }),
  copyText: (text: string) => invoke<void>("copy_text", { text }),
  /** Rewrite text by a transform's instructions, using the AI cleanup model. */
  textRewrite: (text: string, instructions: string) => invoke<string>("text_rewrite", { text, instructions }),
  platformInfo: () => invoke<Platform>("platform_info"),
  androidStatus: () => invoke<AndroidStatus>("android_status"),
  androidAction: (action: AndroidAction) => invoke<void>("android_action", { action }),
  /** Opens Android's share sheet with a new file holding `contents`. */
  androidShare: (name: string, contents: string) => invoke<void>("android_share", { name, contents }),
  /** The newest `android-v*` GitHub release, if it's newer than this app. */
  androidUpdateCheck: () => invoke<AndroidRelease | null>("android_update_check"),
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
  meetingStatus: (f: (s: MeetingStatus) => void): Promise<UnlistenFn> => listen<MeetingStatus>("meeting-status", (e) => f(e.payload)),
  /** A line of the live transcript was added or grew. */
  meetingSegment: (f: (e: { meetingId: number; segment: Segment }) => void): Promise<UnlistenFn> =>
    listen<{ meetingId: number; segment: Segment }>("meeting-segment", (e) => f(e.payload)),
  /** A meeting was saved: stopped, or its notes written. */
  meetingUpdated: (f: (m: Meeting) => void): Promise<UnlistenFn> => listen<Meeting>("meeting-updated", (e) => f(e.payload)),
  meetingNotice: (f: (e: { meetingId: number; text: string }) => void): Promise<UnlistenFn> =>
    listen<{ meetingId: number; text: string }>("meeting-notice", (e) => f(e.payload)),
  /** Each channel's input level, about 20 times a second. */
  meetingLevel: (f: (e: { speaker: Speaker; level: number }) => void): Promise<UnlistenFn> =>
    listen<{ speaker: Speaker; level: number }>("meeting-level", (e) => f(e.payload)),
  /** The island asked the settings window to show a page. */
  navigate: (f: (page: string) => void): Promise<UnlistenFn> => listen<string>("navigate", (e) => f(e.payload)),
};

/** Commands reject with the Rust error's message as a plain string. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
