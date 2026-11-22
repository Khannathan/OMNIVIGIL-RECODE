// Local saves, one slot per seed. A save holds only the dynamic state: the
// map is regrown from the seed on load and checked against a checksum.

import { GameState, STATE_VERSION } from '../sim/state';
import { WORLDGEN_VERSION } from '../sim/worldgen';

const PREFIX = 'omnivigil.save.';

export interface SaveFile {
  format: 'omnivigil-save';
  stateVersion: number;
  worldgenVersion: number;
  savedAt: string;
  worldName: string;
  state: Omit<GameState, 'explored'> & { explored: string };
}

export interface SaveSummary {
  seed: string;
  worldName: string;
  cycle: number;
  savedAt: string;
}

/** Minimal storage interface, so tests can run without a browser. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
  };
}

function defaultStore(): KeyValueStore {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* storage blocked (private mode, sandboxed iframe) */
  }
  return fallback;
}
const fallback = memoryStore();

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function serialize(state: GameState, worldName: string): string {
  const file: SaveFile = {
    format: 'omnivigil-save',
    stateVersion: STATE_VERSION,
    worldgenVersion: WORLDGEN_VERSION,
    savedAt: new Date().toISOString(),
    worldName,
    state: { ...state, explored: toBase64(state.explored) },
  };
  return JSON.stringify(file);
}

export function deserialize(text: string): { state: GameState; file: SaveFile } {
  const file = JSON.parse(text) as SaveFile;
  if (file.format !== 'omnivigil-save') throw new Error('Not an OMNIVIGIL save');
  if (file.stateVersion !== STATE_VERSION) {
    throw new Error(`Save is version ${file.stateVersion}, this build reads ${STATE_VERSION}`);
  }
  const state: GameState = { ...file.state, explored: fromBase64(file.state.explored) };
  return { state, file };
}

export function saveGame(state: GameState, worldName: string, store = defaultStore()): void {
  store.setItem(PREFIX + state.seed, serialize(state, worldName));
}

export function loadGame(seed: string, store = defaultStore()): GameState | null {
  const text = store.getItem(PREFIX + seed);
  if (!text) return null;
  return deserialize(text).state;
}

export function deleteSave(seed: string, store = defaultStore()): void {
  store.removeItem(PREFIX + seed);
}

/** All saves, newest first. Unreadable saves are skipped. */
export function listSaves(store = defaultStore()): SaveSummary[] {
  const out: SaveSummary[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    try {
      const { file } = deserialize(store.getItem(key)!);
      out.push({
        seed: file.state.seed,
        worldName: file.worldName,
        cycle: file.state.cycle,
        savedAt: file.savedAt,
      });
    } catch {
      /* ignore broken or old saves */
    }
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
