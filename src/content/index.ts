// Typed access to the JSON content files. Game rules read from here, so new
// terrain, units, techs or factions are data edits, not code edits.

import terrainData from './terrain.json';
import unitData from './units.json';
import structureData from './structures.json';
import nameData from './names.json';
import artData from './art.json';
import techData from './techs.json';
import forgeData from './forge.json';
import factionData from './factions.json';
import rulesData from './rules.json';
import rewardData from './rewards.json';
import advisorData from './advisor.json';
import audioData from './audio.json';

export type ResourceId = 'compute' | 'matter' | 'influence';
export const RESOURCE_IDS: readonly ResourceId[] = ['compute', 'matter', 'influence'];
export const RESOURCE_NAMES: Record<ResourceId, string> = {
  compute: 'Compute',
  matter: 'Matter',
  influence: 'Influence',
};

export interface Yields {
  compute: number;
  matter: number;
}

export interface TerrainDef {
  id: string;
  name: string;
  art: string;
  water: boolean;
  moveCost: number | null;
  yields: Yields;
  /** % bonus to a land unit defending here. */
  defense: number;
  color: string;
}

export type Domain = 'land' | 'air' | 'sea';

export interface UnitDef {
  id: string;
  name: string;
  side: 'player' | 'native' | 'structure';
  domain: Domain;
  speed: number;
  sight: number;
  upow: number;
  cost: { matter: number };
  buildCycles: number;
  energy: number;
  attack: boolean;
  capture: boolean;
  oneShot?: boolean;
  requires: string | null;
  blurb: string;
}

export interface StructureDef {
  id: string;
  name: string;
  workRadius: number;
  sight: number;
  energy: number;
  buildEnergy: number;
  stages: number;
}

export interface ArtDef {
  file: string;
  w: number;
  h: number;
  frames?: number;
  /** Shown in the HTML UI only, so it stays out of the WebGL atlas. */
  ui?: boolean;
}

/**
 * One rule change from a tech or a Forge choice. Read by src/sim/effects.ts.
 * `where` limits a yield or radius bonus to your Nodes or your captured cities.
 */
export type Effect =
  | { kind: 'yield'; resource: ResourceId; flat?: number; pct?: number; where?: 'node' | 'city' }
  | { kind: 'energy'; flat: number }
  | { kind: 'upow'; pct: number; domain?: Domain; role?: 'attack' | 'defense' }
  | { kind: 'research'; pct: number }
  | { kind: 'build'; pct: number }
  | { kind: 'sight'; flat: number; domain?: Domain }
  | { kind: 'speed'; flat: number; domain?: Domain }
  | { kind: 'heal'; flat: number }
  | { kind: 'workRadius'; flat: number; where?: 'node' | 'city' }
  | { kind: 'embark' }
  | { kind: 'attitude'; flat: number }
  | { kind: 'sway'; flat: number }
  | { kind: 'startUnit'; unit: string }
  | { kind: 'startResource'; resource: ResourceId; amount: number };

export interface TechDef {
  id: string;
  tier: number;
  name: string;
  cost: number;
  cycles: number;
  requires: string[];
  effects: Effect[];
  blurb: string;
}

export interface ForgeOption {
  id: string;
  name: string;
  blurb?: string;
  fantasy?: string;
  effects: Effect[];
}

export interface FactionArchetype {
  id: string;
  kind: string;
  culture: string;
  color: string;
  baseAttitude: number;
  aggression: number;
  names: string[];
  units: Array<{ unit: string; weight: number; from: number }>;
  terrainBonus?: Record<string, number>;
  blurb: string;
}

export const TERRAIN: readonly TerrainDef[] = terrainData.terrain;
export const UNITS: readonly UnitDef[] = unitData.units as UnitDef[];
export const PLAYER_UNITS: readonly UnitDef[] = UNITS.filter((u) => u.side === 'player');
export const STRUCTURES: readonly StructureDef[] = structureData.structures;
export const NAMES = nameData;
export const ART: readonly ArtDef[] = artData.art;
export const TECHS: readonly TechDef[] = techData.techs as TechDef[];
export const FORGE = forgeData as {
  origins: ForgeOption[];
  architectures: ForgeOption[];
  temperaments: ForgeOption[];
  doctrines: ForgeOption[];
  colors: string[];
};
export const FACTION_DATA = factionData as {
  archetypes: FactionArchetype[];
  roots: string[];
  words: string[];
  towns: string[];
  attitudeLabels: Array<{ min: number; label: string }>;
};
export const RULES = rulesData;

// ---------------------------------------------------------------- rewards (M2)

export type RarityId = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';
export const RARITY_IDS: readonly RarityId[] = ['common', 'rare', 'epic', 'legendary', 'mythic'];

export interface RarityDef {
  id: RarityId;
  name: string;
  color: string;
  weight: number;
}

export type SalvageDef =
  | { kind: 'resource'; resource: ResourceId; amount: number }
  | { kind: 'unit'; unit: string }
  | { kind: 'relic'; relic: string };

export interface RelicDef {
  id: string;
  rarity: RarityId;
  name: string;
  effects: Effect[];
  blurb: string;
}

export const REWARDS = rewardData as unknown as {
  rarities: RarityDef[];
  salvage: Record<RarityId, SalvageDef[]>;
  relics: RelicDef[];
  reveal: {
    techTier: Record<string, RarityId>;
    cityTaken: RarityId;
    capitalTaken: RarityId;
    factionFallen: RarityId;
    firstContact: RarityId;
    victory: RarityId;
  };
};

export function rarityDef(id: RarityId): RarityDef {
  const r = REWARDS.rarities.find((d) => d.id === id);
  if (!r) throw new Error(`Unknown rarity: ${id}`);
  return r;
}

export function relicDef(id: string): RelicDef {
  const r = REWARDS.relics.find((d) => d.id === id);
  if (!r) throw new Error(`Unknown relic: ${id}`);
  return r;
}

// ---------------------------------------------------------------- advisor voice (M2)

/** Lines per advice id: `default`, plus optional per-temperament pools. */
export const ADVISOR = advisorData as unknown as {
  lines: Record<string, Record<string, string[]>>;
  ambition: Record<string, string>;
};

// ---------------------------------------------------------------- audio (M2)

export interface AudioDef {
  id: string;
  file: string;
  /** Relative loudness, 0..1. */
  volume?: number;
}

export const AUDIO = audioData as unknown as { music: AudioDef[]; sfx: AudioDef[] };

/** Terrain is stored per tile as a small integer: its position in TERRAIN. */
export const TERRAIN_INDEX: Readonly<Record<string, number>> = Object.fromEntries(
  TERRAIN.map((t, i) => [t.id, i]),
);

export function terrainId(id: string): number {
  const i = TERRAIN_INDEX[id];
  if (i === undefined) throw new Error(`Unknown terrain: ${id}`);
  return i;
}

export function unitDef(id: string): UnitDef {
  const u = UNITS.find((d) => d.id === id);
  if (!u) throw new Error(`Unknown unit: ${id}`);
  return u;
}

export function structureDef(id: string): StructureDef {
  const s = STRUCTURES.find((d) => d.id === id);
  if (!s) throw new Error(`Unknown structure: ${id}`);
  return s;
}

export function techDef(id: string): TechDef {
  const t = TECHS.find((d) => d.id === id);
  if (!t) throw new Error(`Unknown tech: ${id}`);
  return t;
}

export function archetypeDef(id: string): FactionArchetype {
  const a = FACTION_DATA.archetypes.find((d) => d.id === id);
  if (!a) throw new Error(`Unknown faction archetype: ${id}`);
  return a;
}

export function attitudeLabel(attitude: number): string {
  return FACTION_DATA.attitudeLabels.find((l) => attitude >= l.min)?.label ?? 'Hostile';
}
