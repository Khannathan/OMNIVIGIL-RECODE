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
import titanData from './titans.json';
import genomeData from './genome.json';

/** The five early-game resources (design bible section 7). Energy is separate: allocated, never spent. */
export type ResourceId = 'compute' | 'matter' | 'influence' | 'essence' | 'crypto';
export const RESOURCE_IDS: readonly ResourceId[] = ['compute', 'matter', 'influence', 'essence', 'crypto'];
export const RESOURCE_NAMES: Record<ResourceId, string> = {
  compute: 'Compute',
  matter: 'Matter',
  influence: 'Influence',
  essence: 'Symbiotic Essence',
  crypto: 'Crypto',
};
/** Short names for tight spots (costs, buttons). */
export const RESOURCE_SHORT: Record<ResourceId, string> = {
  compute: 'Compute',
  matter: 'Matter',
  influence: 'Influence',
  essence: 'Essence',
  crypto: 'Crypto',
};

/** A price in any mix of resources. */
export type Cost = Partial<Record<ResourceId, number>>;

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

export type WeaponStyle = 'ballistic' | 'laser' | 'missile' | 'shell' | 'bio' | 'blade';

/** A conditional UPow bonus (TBU parts, symbiotes). */
export interface UpowLine {
  pct: number;
  role?: 'attack' | 'defense';
  /** Only against kaiju. */
  vsKaiju?: boolean;
  label: string;
}

export interface UnitDef {
  id: string;
  name: string;
  side: 'player' | 'native' | 'structure' | 'abyssian';
  domain: Domain;
  speed: number;
  sight: number;
  upow: number;
  cost: Cost & { matter: number };
  buildCycles: number;
  energy: number;
  attack: boolean;
  capture: boolean;
  oneShot?: boolean;
  requires: string | null;
  blurb: string;
  /** Walks on any water, deep sea and rifts included (Abyssians, Tidewalker legs). */
  amphibious?: boolean;
  /** Every land hex costs 1 (Skylance jets). */
  hover?: boolean;
  /** A kaiju: conventional units fight it at rules.json abyss.kaijuHidePct. */
  kaiju?: boolean;
  /** A TBU: never suffers the kaiju penalty, built only at Nodes. */
  titan?: boolean;
  /** Symbiotic Essence dropped when you kill it. */
  essence?: number;
  /** Abyssians: first cycle a rift can spawn it, and how often. */
  from?: number;
  weight?: number;
  weapon?: WeaponStyle;
  drawScale?: number;
  /** Extra HP per cycle at rest. */
  heal?: number;
  lines?: UpowLine[];
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
  | { kind: 'startResource'; resource: ResourceId; amount: number }
  /** % change to every Exposure gain (negative hides you). */
  | { kind: 'exposure'; pct: number }
  /** Every rift on the world is charted. */
  | { kind: 'revealRifts' };

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
export const ABYSSIANS: readonly UnitDef[] = UNITS.filter((u) => u.side === 'abyssian' && u.from !== undefined);
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
    riftSealed: RarityId;
    motherRetreat: RarityId;
    motherSlain: RarityId;
    arkStage: RarityId;
    gene: RarityId;
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

const unitIndex = new Map(UNITS.map((u) => [u.id, u]));

/** A unit type's rules. TBU types ('tbu:<parts>') are assembled from titans.json on first use. */
export function unitDef(id: string): UnitDef {
  const u = unitIndex.get(id) ?? (id.startsWith(TBU_PREFIX) ? titanDef(id) : undefined);
  if (!u) throw new Error(`Unknown unit: ${id}`);
  return u;
}

// ---------------------------------------------------------------- Titan Forge (M3)

export type TitanSlot = 'head' | 'core' | 'armL' | 'armR' | 'back' | 'legs';
export const TITAN_SLOTS: readonly TitanSlot[] = ['head', 'core', 'armL', 'armR', 'back', 'legs'];
export const TBU_PREFIX = 'tbu:';

export interface TitanPart {
  id: string;
  slot: 'head' | 'core' | 'arm' | 'back' | 'legs';
  name: string;
  callsign?: string;
  upow: number;
  sight?: number;
  speed?: number;
  energy: number;
  heal?: number;
  amphibious?: boolean;
  hover?: boolean;
  weapon?: WeaponStyle;
  cost: Cost;
  requires: string | null;
  lines?: UpowLine[];
  blurb: string;
}

export const TITANS = titanData as unknown as {
  slots: TitanSlot[];
  buildCycles: number;
  buildPerUpow: number;
  requires: string;
  parts: TitanPart[];
  default: Record<TitanSlot, string>;
};

/** The part kind a slot takes (both arm slots take arms). */
export function slotKind(slot: TitanSlot): TitanPart['slot'] {
  return slot === 'armL' || slot === 'armR' ? 'arm' : slot;
}

export function titanPart(id: string): TitanPart {
  const p = TITANS.parts.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown TBU part: ${id}`);
  return p;
}

/** A TBU's type string holds its parts, so it needs no saved design: tbu:head.core.armL.armR.back.legs */
export function titanType(parts: Record<TitanSlot, string>): string {
  return TBU_PREFIX + TITAN_SLOTS.map((s) => parts[s]).join('.');
}

/** The parts of a TBU type, or null if the string is not a valid TBU. */
export function titanParts(type: string): Record<TitanSlot, TitanPart> | null {
  if (!type.startsWith(TBU_PREFIX)) return null;
  const ids = type.slice(TBU_PREFIX.length).split('.');
  if (ids.length !== TITAN_SLOTS.length) return null;
  const out = {} as Record<TitanSlot, TitanPart>;
  for (let i = 0; i < TITAN_SLOTS.length; i++) {
    const p = TITANS.parts.find((x) => x.id === ids[i]);
    if (!p || p.slot !== slotKind(TITAN_SLOTS[i])) return null;
    out[TITAN_SLOTS[i]] = p;
  }
  return out;
}

export function addCost(a: Cost, b: Cost): Cost {
  const out: Cost = { ...a };
  for (const k of RESOURCE_IDS) if (b[k]) out[k] = (out[k] ?? 0) + b[k]!;
  return out;
}

const titanCache = new Map<string, UnitDef>();

function titanDef(type: string): UnitDef | undefined {
  const hit = titanCache.get(type);
  if (hit) return hit;
  const parts = titanParts(type);
  if (!parts) return undefined;
  const list = TITAN_SLOTS.map((s) => parts[s]);
  let cost: Cost = {};
  for (const p of list) cost = addCost(cost, p.cost);
  const upow = list.reduce((a, p) => a + p.upow, 0);
  const def: UnitDef = {
    id: type,
    name: `${parts.legs.callsign ?? 'Titan'} ${parts.core.callsign ?? ''}`.trim(),
    side: 'player',
    domain: 'land',
    speed: Math.max(1, list.reduce((a, p) => a + (p.speed ?? 0), 0)),
    sight: Math.max(1, list.reduce((a, p) => a + (p.sight ?? 0), 0)),
    upow,
    cost: { matter: 0, ...cost },
    buildCycles: Math.round(TITANS.buildCycles + upow * TITANS.buildPerUpow),
    energy: Math.max(0, list.reduce((a, p) => a + p.energy, 0)),
    attack: true,
    capture: true,
    requires: TITANS.requires,
    blurb: `TBU: ${parts.head.name}, ${parts.core.name}, ${parts.armL.name} and ${parts.armR.name}, ${parts.back.name}, ${parts.legs.name}.`,
    titan: true,
    amphibious: !!parts.legs.amphibious,
    hover: !!parts.legs.hover,
    heal: list.reduce((a, p) => a + (p.heal ?? 0), 0),
    weapon: parts.armR.weapon ?? parts.armL.weapon ?? 'ballistic',
    lines: list.flatMap((p) => p.lines ?? []),
    drawScale: 0.56,
  };
  titanCache.set(type, def);
  return def;
}

// ---------------------------------------------------------------- Genome and symbiotes (M3)

export interface GeneDef {
  id: string;
  strand: string;
  tier: number;
  name: string;
  cost: number;
  unlocks?: string;
  symbiote?: { upowPct?: number; sight?: number; speed?: number; heal?: number };
  effects?: Effect[];
  blurb: string;
}

export interface StrainDef {
  id: string;
  name: string;
  cost: number;
  upowPct: number;
  role?: 'attack' | 'defense';
  vsKaijuPct?: number;
  hardened?: boolean;
  feeder?: boolean;
  heal?: number;
  sight?: number;
  speed?: number;
  influence?: number;
  blurb: string;
}

export const GENOME = genomeData as unknown as {
  requires: string;
  strands: Array<{ id: string; name: string; color: string }>;
  genes: GeneDef[];
  strains: StrainDef[];
};

export function geneDef(id: string): GeneDef {
  const g = GENOME.genes.find((x) => x.id === id);
  if (!g) throw new Error(`Unknown gene: ${id}`);
  return g;
}

export function strainDef(id: string): StrainDef {
  const s = GENOME.strains.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown symbiote strain: ${id}`);
  return s;
}

/** The gene that unlocks a strain. */
export function strainGene(id: string): GeneDef | undefined {
  return GENOME.genes.find((g) => g.unlocks === id);
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
