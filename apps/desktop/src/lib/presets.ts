// Ready-made provider settings. Picking one fills in the URL and model; the
// user can still edit both. Anything OpenAI-compatible works under "custom".

import type { CloudStt, Cleanup, SecretName, Settings } from "./tauri";

/** A model the provider offers. The first in a preset's list is the newest recommended one. */
export interface ModelOption {
  id: string;
  label?: string;
}

export interface SttPreset extends Omit<CloudStt, "preset"> {
  id: string;
  label: string;
  needsKey: boolean;
  keyUrl?: string;
  models: ModelOption[];
}

export const sttPresets: SttPreset[] = [
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "whisper-large-v3-turbo",
    api: "transcriptions",
    needsKey: true,
    keyUrl: "https://console.groq.com/keys",
    models: [
      { id: "whisper-large-v3-turbo", label: "Whisper Large v3 Turbo — fast" },
      { id: "whisper-large-v3", label: "Whisper Large v3 — most accurate" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-transcribe",
    api: "transcriptions",
    needsKey: true,
    keyUrl: "https://platform.openai.com/api-keys",
    // OpenAI retires whisper-1 and the gpt-4o transcribe models on 2027-02-26.
    models: [
      { id: "gpt-transcribe", label: "GPT Transcribe" },
      { id: "gpt-4o-transcribe", label: "GPT-4o Transcribe (retiring)" },
      { id: "gpt-4o-mini-transcribe", label: "GPT-4o mini Transcribe (retiring)" },
      { id: "whisper-1", label: "Whisper (retiring)" },
    ],
  },
  {
    id: "sarvam",
    label: "Sarvam AI (Indian languages)",
    baseUrl: "https://api.sarvam.ai",
    model: "saaras:v4",
    api: "sarvam",
    needsKey: true,
    keyUrl: "https://dashboard.sarvam.ai/key-management",
    models: [
      { id: "saaras:v4", label: "Saaras v4" },
      { id: "saaras:v3", label: "Saaras v3" },
      { id: "saarika:v2.5", label: "Saarika v2.5 (legacy)" },
    ],
  },
  {
    id: "ollama",
    label: "Ollama (local server)",
    baseUrl: "http://localhost:11434/v1",
    model: "gemma4:e4b",
    api: "ollama-chat",
    needsKey: false,
    models: [{ id: "gemma4:e4b", label: "Gemma 4 E4B" }],
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    baseUrl: "",
    model: "",
    api: "transcriptions",
    needsKey: true,
    models: [],
  },
];

export interface CleanupPreset extends Omit<Cleanup, "preset" | "enabled" | "instructions"> {
  id: string;
  label: string;
  needsKey: boolean;
  keyUrl?: string;
  models: ModelOption[];
}

export const cleanupPresets: CleanupPreset[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-haiku-5-5",
    format: "anthropic-messages",
    needsKey: true,
    keyUrl: "https://console.anthropic.com/settings/keys",
    models: [
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 — fast" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
      { id: "claude-opus-5-5", label: "Claude Opus 5.5 — most capable" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-6.1-terra",
    format: "openai-chat",
    needsKey: true,
    keyUrl: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-6.1-terra", label: "GPT-6.1 Terra — fast" },
      { id: "gpt-6-luna", label: "GPT-6 Luna — cheapest" },
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
      { id: "gpt-6-astra", label: "GPT-6 Astra — most capable" },
    ],
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b",
    format: "openai-chat",
    needsKey: true,
    keyUrl: "https://console.groq.com/keys",
    models: [
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
      { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B — fastest" },
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B" },
    ],
  },
  {
    id: "sarvam",
    label: "Sarvam AI",
    baseUrl: "https://api.sarvam.ai/v1",
    model: "sarvam-105b",
    format: "openai-chat",
    needsKey: true,
    keyUrl: "https://dashboard.sarvam.ai/key-management",
    models: [
      { id: "sarvam-105b", label: "Sarvam 105B" },
      { id: "sarvam-105b-conversations", label: "Sarvam 105B Conversations" },
    ],
  },
  {
    id: "ollama",
    label: "Ollama (local server)",
    baseUrl: "http://localhost:11434/v1",
    model: "gemma4:e4b",
    format: "openai-chat",
    needsKey: false,
    models: [{ id: "gemma4:e4b", label: "Gemma 4 E4B" }],
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    baseUrl: "",
    model: "",
    format: "openai-chat",
    needsKey: true,
    models: [],
  },
];

/** The saved key a provider preset uses, or null when it needs none. Mirrors `key_name` in voice-core's settings.rs. */
export function keyName(preset: string, feature: "stt" | "cleanup"): SecretName | null {
  switch (preset) {
    case "ollama":
      return null;
    case "openai":
    case "anthropic":
    case "groq":
    case "sarvam":
      return preset;
    default:
      return feature === "stt" ? "custom-stt" : "custom-cleanup";
  }
}

/** Whether the key `preset` needs is saved; true when it needs none. */
export function hasKey(secrets: Partial<Record<SecretName, boolean>>, preset: string, feature: "stt" | "cleanup"): boolean {
  const name = keyName(preset, feature);
  return !name || !!secrets[name];
}

/** The features (by page name) whose provider uses `name`. */
export function keyUsers(settings: Settings, name: SecretName): string[] {
  const live = { "openai-realtime": "openai", "sarvam-streaming": "sarvam", dictation: null }[settings.meeting.engine];
  return [
    settings.engine === "cloud" && keyName(settings.cloud.preset, "stt") === name && "Speech engine",
    keyName(settings.cleanup.preset, "cleanup") === name && "AI cleanup",
    live === name && "Meetings",
  ].filter((x): x is string => !!x);
}

// Short provider names for status lines. Mirrors `provider_name` in voice-core's settings.rs.
const providerNames: Record<string, string> = {
  groq: "Groq",
  openai: "OpenAI",
  sarvam: "Sarvam",
  anthropic: "Anthropic",
  ollama: "Ollama",
};

/** "Sarvam · saaras:v4" */
export function providerLabel(preset: string, model: string): string {
  return `${providerNames[preset] ?? "Custom"} · ${model.trim()}`;
}

// The same list as LANGUAGES in voice-core's settings.rs, which the tray uses; keep the two in sync.
export const languages: [code: string, name: string][] = [
  ["auto", "Detect automatically"],
  ["en", "English"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["nl", "Dutch"],
  ["hi", "Hindi"],
  ["ta", "Tamil"],
  ["te", "Telugu"],
  ["kn", "Kannada"],
  ["ml", "Malayalam"],
  ["bn", "Bengali"],
  ["mr", "Marathi"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh", "Chinese"],
  ["ar", "Arabic"],
  ["ru", "Russian"],
  ["tr", "Turkish"],
  ["pl", "Polish"],
  ["uk", "Ukrainian"],
];
