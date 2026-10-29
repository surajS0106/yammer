// Ready-made provider settings. Picking one fills in the URL and model; the
// user can still edit both. Anything OpenAI-compatible works under "custom".

import type { CloudStt, Cleanup } from "./tauri";

export interface SttPreset extends Omit<CloudStt, "preset"> {
  id: string;
  label: string;
  needsKey: boolean;
  keyUrl?: string;
  models: string[];
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
    models: ["whisper-large-v3-turbo", "whisper-large-v3"],
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini-transcribe",
    api: "transcriptions",
    needsKey: true,
    keyUrl: "https://platform.openai.com/api-keys",
    models: ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"],
  },
  {
    id: "sarvam",
    label: "Sarvam AI (Indian languages)",
    baseUrl: "https://api.sarvam.ai",
    model: "saaras:v4",
    api: "sarvam",
    needsKey: true,
    keyUrl: "https://dashboard.sarvam.ai/",
    models: ["saaras:v4", "saaras:v3"],
  },
  {
    id: "ollama",
    label: "Ollama (local server)",
    baseUrl: "http://localhost:11434/v1",
    model: "gemma4:e4b",
    api: "ollama-chat",
    needsKey: false,
    models: ["gemma4:e4b"],
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
  models: string[];
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
    models: ["claude-haiku-5-5", "claude-sonnet-5-5"],
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    format: "openai-chat",
    needsKey: true,
    keyUrl: "https://platform.openai.com/api-keys",
    models: [],
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    format: "openai-chat",
    needsKey: true,
    keyUrl: "https://console.groq.com/keys",
    models: [],
  },
  {
    id: "sarvam",
    label: "Sarvam AI",
    baseUrl: "https://api.sarvam.ai/v1",
    model: "sarvam-105b",
    format: "openai-chat",
    needsKey: true,
    keyUrl: "https://dashboard.sarvam.ai/",
    models: ["sarvam-105b", "sarvam-105b-conversations"],
  },
  {
    id: "ollama",
    label: "Ollama (local server)",
    baseUrl: "http://localhost:11434/v1",
    model: "gemma4:e4b",
    format: "openai-chat",
    needsKey: false,
    models: [],
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
