// Typed bindings for the Rust commands (src-tauri/src/commands.rs, whisper.rs).
// The types mirror voice-core's serde shapes: camelCase fields, kebab-case enums.
// If you change a Rust command or serde type, update this file to match.

import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Engine = "local" | "cloud";
export type Theme = "system" | "light" | "dark";
export type SttApi = "transcriptions" | "ollama-chat" | "sarvam" | "xai";
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
/** How a meeting's notes are laid out: one of Yammer's own (`builtIn`), or the user's. */
export interface NoteTemplate {
  id: string;
  name: string;
  /** The layout, as the notes prompt tells it to the model. */
  instructions: string;
  /** What it's for, in a line. Only Yammer's own have one. */
  description?: string;
  /** Shipped with Yammer: can't be changed. Only set on what `meetingTemplates` returns. */
  builtIn?: boolean;
}
/** When another app starts a call: do nothing, ask to transcribe it, or count down and transcribe it. */
export type CallDetect = "off" | "ask" | "auto";
/** An app Sushi never offers to transcribe a call from. */
export interface IgnoredApp {
  id: string;
  name: string;
}

export interface MeetingSettings {
  /** Starts and stops a meeting transcript; "" for none. */
  hotkey: string;
  audio: CallAudio;
  engine: LiveEngine;
  /** The streaming engine's model; "" for its default. */
  model: string;
  /** Id of the template notes are written with, unless a meeting picks another. */
  summary: string;
  /** The user's own templates, after Yammer's. */
  templates: NoteTemplate[];
  /** Write the notes as soon as the meeting ends. */
  autoSummary: boolean;
  /** Offer to take notes when an event on the calendar begins. */
  calendarOffer: boolean;
  detect: CallDetect;
  ignoredApps: IgnoredApp[];
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
  /** The template the notes were written with. */
  template?: string;
  /** The calendar event it was recorded during: its title and who was invited. */
  event?: CalendarEvent;
  /** Questions asked about the meeting and their answers, oldest first. */
  chat?: ChatTurn[];
  /** Why writing the notes failed. */
  error?: string;
  /** Something that went wrong while transcribing. */
  notice?: string;
}

export interface Attendee {
  name: string;
  email?: string;
}

/** One occurrence of a calendar event (`voice_core::calendar::Event`); times in Unix ms. */
export interface CalendarEvent {
  uid: string;
  title: string;
  start: number;
  end: number;
  attendees: Attendee[];
  /** A video call link from the invite. */
  joinUrl?: string;
}

/** `calendar::Status`: sent as `calendar-updated` after every refresh. */
export interface CalendarStatus {
  connected: boolean;
  /** From now (and those under way) to a week ahead, soonest first. */
  events: CalendarEvent[];
  error: string | null;
  fetchedAt: number | null;
}

/** An occurrence's key (`Event::key`): a repeating event's occurrences share a UID. */
export const eventKey = (e: CalendarEvent) => `${e.uid}@${e.start}`;

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  /** Unix ms. */
  at: number;
}

/** A meeting that matches a search, and where. */
export interface MeetingHit {
  id: number;
  title: string;
  startedAt: number;
  /** Where the best match is: the title, the written notes ("summary"), the user's notes, or the transcript. */
  field: "title" | "summary" | "notes" | "transcript";
  snippet: string;
  score: number;
}

export interface MeetingOverview {
  id: number;
  title: string;
  startedAt: number;
  endedAt: number | null;
  words: number;
  preview: string;
  hasSummary: boolean;
  /** Who was invited, from its calendar event. */
  attendees?: string[];
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
/** `calendar` is the calendar's secret iCal address, kept like a key. */
export type SecretName = "openai" | "anthropic" | "groq" | "sarvam" | "xai" | "custom-stt" | "custom-cleanup" | "calendar";

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
  /** Sushi was last turned on (true) or off (false), from the app, its notification or the ✕; null before the service kept track. */
  wanted: boolean | null;
  /** Installed payment apps (by name) that refuse to work while "Paste for you" is on. */
  paymentApps: string[];
}

export type AndroidAction = "requestMic" | "requestNotifications" | "openOverlaySettings" | "openAccessibilitySettings" | "openAppSettings" | "startBubble" | "stopBubble" | "stopPasting" | "toggle" | "barsLight" | "barsDark";

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
  /** `app` started a call: offer to transcribe it. With `countdownMs`, it starts when the count runs out. */
  /** `app` is empty for a calendar event alone; `event` is the event's title when there is one. */
  | { phase: "call-started"; id: number; app: string; event: string | null; countdownMs: number | null }
  /** The call being transcribed ended: count down to stopping the meeting. */
  | { phase: "call-ended"; id: number; app: string; countdownMs: number }
  | { phase: "hidden" };

/** An answer to a call card, from its buttons or its countdown running out. */
export type CallAnswer = "start" | "not-now" | "never" | "stop" | "keep-going";

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
  /** `event`: the calendar event it's for (`eventKey`), from "Start notes" on it; else the one under way. */
  meetingStart: (event?: string) => invoke<LiveMeeting>("meeting_start", { event }),
  calendarStatus: () => invoke<CalendarStatus>("calendar_status"),
  /** Save the calendar's secret iCal address (it's read first), or forget it with "". */
  calendarConnect: (url: string) => invoke<CalendarStatus>("calendar_connect", { url }),
  calendarRefresh: () => invoke<CalendarStatus>("calendar_refresh"),
  /** Resolves to the meeting transcribed to the end; its notes follow as `meetingUpdated`. */
  meetingStop: () => invoke<Meeting | null>("meeting_stop"),
  /** Start or stop, showing any error on the overlay. */
  meetingToggle: () => invoke<void>("meeting_toggle"),
  /** Answer call card `id`; an answer to a card that's gone is ignored. */
  callAnswer: (id: number, answer: CallAnswer) => invoke<void>("call_answer", { id, answer }),
  meetingStatus: () => invoke<MeetingStatus>("meeting_status"),
  meetingsList: () => invoke<MeetingOverview[]>("meetings_list"),
  meetingGet: (id: number) => invoke<Meeting>("meeting_get", { id }),
  meetingUpdate: (id: number, change: { title?: string; notes?: string; summary?: string; clearChat?: boolean }) =>
    invoke<Meeting>("meeting_update", { id, ...change }),
  meetingDelete: (id: number) => invoke<void>("meeting_delete", { id }),
  /** Write (or rewrite) a meeting's notes with the AI cleanup model; one in progress gets notes of what's been said so far. */
  meetingSummarize: (id: number, template?: string) => invoke<Meeting>("meeting_summarize", { id, template }),
  /** Rewrite a meeting's written notes as asked ("make it shorter"). */
  meetingRevise: (id: number, request: string) => invoke<Meeting>("meeting_revise", { id, request }),
  /** Resolves to the meeting with the question and its answer added to `chat`. */
  meetingAsk: (id: number, question: string) => invoke<Meeting>("meeting_ask", { id, question }),
  meetingDeleteSegments: (id: number, segments: string[]) => invoke<Meeting>("meeting_delete_segments", { id, segments }),
  meetingSearch: (query: string) => invoke<MeetingHit[]>("meeting_search", { query }),
  /** Pick the template a meeting's notes will be written with, without writing them. */
  meetingSetTemplate: (id: number, template: string) => invoke<Meeting>("meeting_set_template", { id, template }),
  /** Whether Sush is installed and takes `sush://` links (desktop only). */
  sushInstalled: () => invoke<boolean>("sush_installed"),
  /** Open Sush on a chat about this meeting: "copied" when Sush is too old for links, so it was opened with the question on the clipboard. */
  askInSush: (id: number, title: string) => invoke<"opened" | "copied">("ask_in_sush", { id, title }),
  /** Yammer's templates, then the user's. */
  meetingTemplates: () => invoke<NoteTemplate[]>("meeting_templates"),
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
  calendarUpdated: (f: (s: CalendarStatus) => void): Promise<UnlistenFn> => listen<CalendarStatus>("calendar-updated", (e) => f(e.payload)),
  /** Show this meeting (`yammer --open-meeting=<id>`, from a link Sush cited). */
  openMeeting: (f: (id: number) => void): Promise<UnlistenFn> => listen<number>("open-meeting", (e) => f(e.payload)),
};

/** What's shown when an error's own text is too technical to show. */
export const SOMETHING_WRONG = "Something went wrong. Try again, or restart Yammer.";

/** Text that comes from a library or the OS rather than Yammer: codes, stack details, raw protocol words. */
const TECHNICAL =
  /os error|[Ee]xit ?[Ss]tatus|\bHTTP \d{3}\b|error sending request|\b([Tt]cp|TCP|DNS|dns|TLS|tls|SSL|ssl|IPC|ipc|JNI|jni|errno)\b|[Cc]ertificate|\bE[A-Z]{3,}\b|panicked|unwrap|[Dd]eseriali[sz]|[Ss]eriali[sz]|invalid type|at line \d|Command \S+ not found|is not a function|\b(undefined|null|NaN)\b|::|\(\)/;

/**
 * An error as the user should read it. Commands reject with a sentence from Rust (`AppError`), shown as is.
 * Anything technical (a JavaScript exception, a plugin's raw message) is logged for debugging and replaced
 * with a plain sentence, so the UI never shows a library's own words.
 */
export function errorMessage(e: unknown, fallback = SOMETHING_WRONG): string {
  const text = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  if (e instanceof Error || !text.trim() || TECHNICAL.test(text)) {
    console.error(e);
    return fallback;
  }
  return text;
}
