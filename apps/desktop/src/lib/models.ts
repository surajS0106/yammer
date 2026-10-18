// Whisper model list and downloads. Kept outside React so a download keeps
// going (and its progress shows) when you switch pages.

import * as React from "react";

import { api, errorMessage, type ModelInfo } from "./tauri";

interface ModelsState {
  models: ModelInfo[];
  /** Model id → fraction downloaded. */
  downloading: Record<string, number>;
  error: string | null;
}

let state: ModelsState = { models: [], downloading: {}, error: null };
const listeners = new Set<() => void>();

function set(change: Partial<ModelsState>) {
  state = { ...state, ...change };
  listeners.forEach((l) => l());
}

export async function refreshModels() {
  try {
    set({ models: await api.modelsList() });
  } catch (e) {
    set({ error: errorMessage(e) });
  }
}

export async function downloadModel(id: string): Promise<boolean> {
  if (id in state.downloading) return false;
  set({ downloading: { ...state.downloading, [id]: 0 }, error: null });
  try {
    await api.modelDownload(id, (p) => set({ downloading: { ...state.downloading, [id]: p.total ? p.received / p.total : 0 } }));
    return true;
  } catch (e) {
    set({ error: errorMessage(e) });
    return false;
  } finally {
    const { [id]: _, ...rest } = state.downloading;
    set({ downloading: rest });
    await refreshModels();
  }
}

export async function deleteModel(id: string) {
  try {
    await api.modelDelete(id);
  } catch (e) {
    set({ error: errorMessage(e) });
  }
  await refreshModels();
}

export function useModels(): ModelsState {
  React.useEffect(() => {
    if (state.models.length === 0) void refreshModels();
  }, []);
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
