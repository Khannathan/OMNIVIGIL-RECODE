// The run's dynamic state. Everything here is plain data (no classes), so it
// serialises straight into a save and can be hashed to check determinism.
// The world map itself is not stored: it is regrown from the seed.

import { archetypeDef, Cost, FORGE, RarityId, RESOURCE_IDS, ResourceId, RULES, SalvageDef, strainDef, structureDef, TECHS, TERRAIN, titanParts, TITANS, unitDef, UNITS, GENOME, geneDef } from '../content';
import { mods, playerEffects, sumFor } from './effects';
import { distance, hexesInRange } from './hex';
import { RngState, Rng } from './rng';
import { World } from './worldgen';

export const STATE_VERSION = 4;

export type Beat = 'sense' | 'decide' | 'resolve' | 'watch' | 'reckon';
export const BEATS: readonly Beat[] = ['sense', 'decide', 'resolve', 'watch', 'reckon'];

/** 'player', 'abyss', or a faction id. */
export type Owner = string;
export const PLAYER = 'player';
/** The Abyssians: hostile to everyone, from the ocean rifts. */
export const ABYSS = 'abyss';

export interface Unit {
  id: number;
  type: string;
  owner: Owner;
  tile: number;
  /** Remaining standing route (tiles still to enter), kept across cycles. */
  route: number[];
  /** 0..100. Wounded units fight weaker and heal while resting. */
  hp: number;
  /** Tile this unit means to attack once it is next to it. */
  attackTile: number | null;
  /** Abyssians: the rift it rose from, and whether it has fed and is heading home. */
  home?: number;
  sated?: boolean;
  /** A fused symbiote strain (genome.json). */
  symbiote?: string;
}

export interface Structure {
  id: number;
  type: 'ai-node' | 'city';
  owner: Owner;
  tile: number;
  stage: number;
  name: string;
  /** City art set (cities only). */
  culture?: string;
  /** Set on a faction's original capital: Dominion needs all of them. */
  capitalOf?: string;
  /** Health of the walls, 0..100. Walls fight when no unit defends. */
  hp: number;
  /** Cycle the city last grew (cities only). */
  grewAt?: number;
  /** Unit being built here, if any. */
  build: { unit: string; progress: number } | null;
}

export type Resources = Record<ResourceId, number>;

/** An ocean rift: Abyssians rise from it until its heart is broken. */
export interface RiftState {
  tile: number;
  /** Depth tier: sets its heart's UPow (rules.json abyss.heartUpow). */
  tier: number;
  /** The Abyss Mother sleeps in this one. */
  mother: boolean;
  sealed: boolean;
  /** Its heart's HP (the Mother's, in her rift). */
  hp: number;
  /** Builds up each cycle; at abyss.riseAt something comes out. */
  pressure: number;
}

export type VictoryKind = 'dominion' | 'assimilation' | 'exodus' | 'guardian';
export const VICTORY_KINDS: readonly VictoryKind[] = ['dominion', 'assimilation', 'exodus', 'guardian'];

/** The Genesis Forge (lite) result. */
export interface AiProfile {
  origin: string;
  architecture: string;
  temperament: string;
  doctrine: string;
  epithet: string;
  color: string;
}

export const DEFAULT_AI: AiProfile = {
  origin: FORGE.origins[0].id,
  architecture: FORGE.architectures[0].id,
  temperament: FORGE.temperaments[0].id,
  doctrine: FORGE.doctrines[0].id,
  epithet: 'the Vigil',
  color: FORGE.colors[0],
};

export interface FactionState {
  id: string;
  archetype: string;
  name: string;
  color: string;
  /** Opinion of you, -100..100. */
  attitude: number;
  atWar: boolean;
  /** Other factions this one is at war with. */
  wars: string[];
  met: boolean;
  eliminated: boolean;
  /** Production banked toward the next unit. */
  prod: number;
  nextUnit: string;
}

export type Order =
  | { kind: 'move'; unitId: number; to: number }
  | { kind: 'attack'; unitId: number; target: number }
  | { kind: 'disband'; unitId: number }
  | { kind: 'build'; structureId: number; unit: string }
  | { kind: 'cancel-build'; structureId: number }
  | { kind: 'research'; tech: string }
  | { kind: 'sway'; faction: string }
  | { kind: 'declare-war'; faction: string }
  | { kind: 'peace'; faction: string }
  | { kind: 'incite'; faction: string; against: string }
  /** Sequence a gene with Symbiotic Essence. */
  | { kind: 'sequence'; gene: string }
  /** Fuse a symbiote strain into a unit standing in one of your settlements. */
  | { kind: 'fuse'; unitId: number; strain: string }
  /** Spend Crypto to wipe some Exposure. */
  | { kind: 'scrub' }
  | { kind: 'market'; offer: string }
  /** Start the Ark's next stage at a Node. */
  | { kind: 'ark'; structureId: number };

export interface CombatEvent {
  kind: 'combat';
  attackerId: number;
  defenderId: number;
  attackerType: string;
  defenderType: string;
  attackerOwner: Owner;
  defenderOwner: Owner;
  from: number;
  tile: number;
  winChance: number;
  attackerWon: boolean;
  attackerHp: number;
  defenderHp: number;
}

export type GameEvent =
  | { kind: 'moved'; unitId: number; owner: Owner; path: number[] }
  | { kind: 'built'; unitId: number; unit: string; tile: number }
  | { kind: 'build-started'; structureId: number; unit: string }
  | { kind: 'build-blocked'; structureId: number; unit: string; reason: string }
  | { kind: 'yield'; compute: number; matter: number; influence: number; essence: number; crypto: number; brownout: boolean }
  | { kind: 'discovered'; tiles: number; ruins: number; rifts: number }
  | { kind: 'order-rejected'; order: Order; reason: string }
  | CombatEvent
  | { kind: 'city-captured'; tile: number; name: string; by: Owner; from: Owner }
  | { kind: 'node-razed'; tile: number; name: string; by: Owner }
  | { kind: 'research-started'; tech: string }
  | { kind: 'tech-done'; tech: string }
  | { kind: 'war'; a: Owner; b: Owner; by: Owner }
  | { kind: 'peace'; a: Owner; b: Owner }
  | { kind: 'sway'; faction: string; attitude: number }
  | { kind: 'met'; faction: string }
  | { kind: 'eliminated'; faction: string }
  | { kind: 'disbanded'; unit: string }
  | { kind: 'salvage'; tile: number; unitId: number; rarity: RarityId; reward: SalvageDef; spawnedId?: number }
  | { kind: 'victory'; victory: VictoryKind }
  | { kind: 'defeat' }
  // M3
  | { kind: 'abyss-rise'; tile: number; unitId: number; unit: string }
  | { kind: 'abyss-sank'; tile: number; unit: string }
  | { kind: 'ravaged'; tile: number; name: string; owner: Owner; unit: string; lost: Cost }
  | { kind: 'essence'; tile: number; amount: number; from: string }
  | { kind: 'rift-sealed'; tile: number; essence: number; crypto: number }
  | { kind: 'mother-retreat'; tile: number; essence: number; retreats: number }
  | { kind: 'mother-slain'; tile: number; essence: number }
  | { kind: 'gratitude'; faction: string; attitude: number }
  | { kind: 'exposure'; level: number; rising: boolean }
  | { kind: 'crusade' }
  | { kind: 'gene-done'; gene: string }
  | { kind: 'fused'; unitId: number; unit: string; strain: string }
  | { kind: 'scrubbed'; exposure: number }
  | { kind: 'market'; offer: string }
  | { kind: 'ark-started'; stage: number }
  | { kind: 'ark-stage'; stage: number }
  | { kind: 'ark-lost'; stage: number };

export interface GameState {
  version: number;
  seed: string;
  worldChecksum: number;
  cycle: number;
  /** One stream per system, so adding a system never reshuffles another. */
  rng: { sim: RngState; combat: RngState; factions: RngState; loot: RngState; abyss: RngState };
  nextId: number;
  ai: AiProfile;
  resources: Resources;
  units: Unit[];
  structures: Structure[];
  factions: FactionState[];
  techs: string[];
  /** Precursor fragments found in ruins (ids in rewards.json). Permanent effects. */
  relics: string[];
  /** Ruin tiles already searched: each cache pays out once. */
  salvaged: number[];
  research: { tech: string; progress: number } | null;
  stats: { computeEarned: number; kills: number; losses: number; citiesTaken: number; kaijuSlain: number };
  /** Every homeworld victory won so far, in order. Each can be played past. */
  victories: Array<{ kind: VictoryKind; cycle: number }>;
  defeated: boolean;
  /** How much the world knows about you, 0..100+ (rules.json exposure). */
  exposure: number;
  /** Highest Exposure level ever reached (Revealed is permanent). */
  exposureMax: number;
  /** Ocean rifts (empty until synced with the world; see syncRifts). */
  rifts: RiftState[];
  mother: { retreats: number; slain: boolean };
  /** Sequenced genes (genome.json). */
  genes: string[];
  /** The Exodus Ark: stages finished, and the stage being built. */
  ark: { stage: number; build: { structureId: number; progress: number } | null };
  /** 1 = explored, per tile. */
  explored: Uint8Array;
  /** Orders given during Decide, resolved in sequence at End Cycle. */
  orders: Order[];
  /** What happened last cycle (shown in Sense / Reckon). */
  lastEvents: GameEvent[];
}

export function newGame(world: World, ai: AiProfile = DEFAULT_AI): GameState {
  const state: GameState = {
    version: STATE_VERSION,
    seed: world.seed,
    worldChecksum: world.checksum,
    cycle: 1,
    rng: {
      sim: Rng.stream(world.seed, 'sim').state(),
      combat: Rng.stream(world.seed, 'combat').state(),
      factions: Rng.stream(world.seed, 'factions').state(),
      loot: Rng.stream(world.seed, 'loot').state(),
      abyss: Rng.stream(world.seed, 'abyss').state(),
    },
    nextId: 1,
    ai: { ...ai, epithet: ai.epithet.slice(0, 40) },
    resources: { ...RULES.start },
    units: [],
    structures: [],
    factions: [],
    techs: [],
    relics: [],
    salvaged: [],
    research: null,
    stats: { computeEarned: 0, kills: 0, losses: 0, citiesTaken: 0, kaijuSlain: 0 },
    victories: [],
    defeated: false,
    exposure: 0,
    exposureMax: 0,
    rifts: [],
    mother: { retreats: 0, slain: false },
    genes: [],
    ark: { stage: 0, build: null },
    explored: new Uint8Array(world.width * world.height),
    orders: [],
    lastEvents: [],
  };
  state.structures.push({
    id: state.nextId++,
    type: 'ai-node',
    owner: PLAYER,
    tile: world.start,
    stage: 1,
    name: 'First Node',
    hp: 100,
    build: null,
  });
  spawnUnit(state, 'observer-drone', world.start, PLAYER);
  spawnUnit(state, 'sentinel-trooper', world.start, PLAYER);
  for (const { effect } of playerEffects(state)) {
    if (effect.kind === 'startUnit') spawnUnit(state, effect.unit, world.start, PLAYER);
    if (effect.kind === 'startResource') state.resources[effect.resource] += effect.amount;
  }

  const m = mods(state);
  const frng = Rng.restore(state.rng.factions);
  for (const seed of world.factions) {
    const arch = archetypeDef(seed.archetype);
    state.factions.push({
      id: seed.id,
      archetype: seed.archetype,
      name: seed.name,
      color: seed.color,
      attitude: clampAttitude(arch.baseAttitude + m.attitude),
      atWar: false,
      wars: [],
      met: false,
      eliminated: false,
      prod: 0,
      nextUnit: pickFactionUnit(seed.archetype, 1, frng),
    });
    const sites = [{ ...seed.capital, capital: true }, ...seed.towns.map((t) => ({ ...t, capital: false }))];
    for (const site of sites) {
      state.structures.push({
        id: state.nextId++,
        type: 'city',
        owner: seed.id,
        tile: site.tile,
        stage: site.capital ? 2 : 1,
        name: site.name,
        culture: arch.culture,
        capitalOf: site.capital ? seed.id : undefined,
        grewAt: 1,
        hp: 100,
        build: null,
      });
      const garrison = site.capital ? RULES.factions.garrisonCapital : RULES.factions.garrisonTown;
      for (let k = 0; k < garrison; k++) spawnUnit(state, 'militia', site.tile, seed.id);
    }
  }
  state.rng.factions = frng.state();
  syncRifts(state, world);
  revealAround(state, world);
  meetFactions(state, world, []);
  return state;
}

/** Weighted pick from what this archetype can field by now. */
export function pickFactionUnit(archetype: string, cycle: number, rng: Rng): string {
  const pool = archetypeDef(archetype).units.filter((u) => u.from <= cycle);
  const total = pool.reduce((a, u) => a + u.weight, 0);
  let roll = rng.next() * total;
  for (const u of pool) {
    roll -= u.weight;
    if (roll < 0) return u.unit;
  }
  return pool[pool.length - 1].unit;
}

export function clampAttitude(a: number): number {
  return Math.max(-100, Math.min(100, Math.round(a)));
}

export function spawnUnit(state: GameState, type: string, tile: number, owner: Owner = PLAYER): Unit {
  unitDef(type); // validate
  const unit: Unit = { id: state.nextId++, type, owner, tile, route: [], hp: 100, attackTile: null };
  state.units.push(unit);
  return unit;
}

export function factionById(state: GameState, id: string): FactionState | undefined {
  return state.factions.find((f) => f.id === id);
}

/** Rift state from the world's rift tiles. The first rift is the Mother's. Safe to call again. */
export function syncRifts(state: GameState, world: World): void {
  if (state.rifts.length || !world.rifts.length) return;
  const tiers = RULES.abyss.heartUpow.length;
  state.rifts = world.rifts.map((tile, i) => ({
    tile,
    tier: i === 0 ? tiers - 1 : Math.min(tiers - 2, i - 1),
    mother: i === 0,
    sealed: false,
    hp: 100,
    // Staggered, so the rifts don't all open on the same cycle.
    pressure: RULES.abyss.riseAt - 2 - i * 5,
  }));
}

export function riftAt(state: GameState, tile: number): RiftState | undefined {
  return state.rifts.find((r) => r.tile === tile);
}

/** Are these two owners at war? The Abyss is at war with everyone. */
export function hostile(state: GameState, a: Owner, b: Owner): boolean {
  if (a === b) return false;
  if (a === ABYSS || b === ABYSS) return true;
  if (a === PLAYER) return !!factionById(state, b)?.atWar;
  if (b === PLAYER) return !!factionById(state, a)?.atWar;
  return !!factionById(state, a)?.wars.includes(b);
}

export function playerSettlements(state: GameState): Structure[] {
  return state.structures.filter((s) => s.owner === PLAYER);
}

/** Energy is never spent: it is a total you allocate. */
export function energyBudget(state: GameState): { total: number; allocated: number } {
  const m = mods(state);
  let total = 0;
  let allocated = 0;
  for (const s of state.structures) {
    if (s.owner !== PLAYER) continue;
    const def = structureDef(s.type);
    total += def.energy + m.energyFlat;
    if (s.build) allocated += def.buildEnergy;
  }
  for (const u of state.units) if (u.owner === PLAYER) allocated += unitDef(u.type).energy;
  if (state.research) allocated += RULES.research.energy;
  if (state.ark.build) allocated += RULES.ark.energy;
  return { total, allocated };
}

export function isBrownout(state: GameState): boolean {
  const { total, allocated } = energyBudget(state);
  return allocated > total;
}

export function unitSight(state: GameState, unit: Unit): number {
  const def = unitDef(unit.type);
  if (unit.owner !== PLAYER) return def.sight;
  return def.sight + sumFor(mods(state).sight, def.domain) + symbioteStat(state, unit, 'sight');
}

export function unitSpeed(state: GameState, unit: Unit): number {
  const def = unitDef(unit.type);
  if (unit.owner !== PLAYER) return def.speed;
  return def.speed + sumFor(mods(state).speed, def.domain) + symbioteStat(state, unit, 'speed');
}

/** A fused unit's bonus from its strain plus every sequenced gene that boosts symbiotes. */
export function symbioteStat(state: Pick<GameState, 'genes'>, unit: Unit, stat: 'sight' | 'speed' | 'heal' | 'upowPct'): number {
  if (!unit.symbiote) return 0;
  const strain = strainDef(unit.symbiote);
  let v = stat === 'upowPct' ? strain.upowPct : strain[stat] ?? 0;
  for (const g of state.genes) v += geneDef(g).symbiote?.[stat] ?? 0;
  return v;
}

/** Can this unit fight kaiju without the penalty? */
export function kaijuReady(unit: Unit): boolean {
  return !!unitDef(unit.type).titan || (!!unit.symbiote && !!strainDef(unit.symbiote).hardened);
}

/** The Exposure level for a value: 0 Hidden .. 4 Crusade. */
export function exposureLevel(value: number): number {
  const levels = RULES.exposure.levels;
  let lv = 0;
  for (let i = 0; i < levels.length; i++) if (value >= levels[i].at) lv = i;
  return lv;
}

export function canAfford(state: GameState, cost: Cost): boolean {
  return RESOURCE_IDS.every((k) => state.resources[k] >= (cost[k] ?? 0));
}

export function pay(state: GameState, cost: Cost, sign = 1): void {
  for (const k of RESOURCE_IDS) state.resources[k] -= sign * (cost[k] ?? 0);
}

/** Can a TBU of this type be built here now? Returns why not, or null. */
export function titanBlocker(state: GameState, s: Structure, type: string): string | null {
  const parts = titanParts(type);
  if (!parts) return 'not a valid TBU';
  if (!state.techs.includes(TITANS.requires)) return 'needs the Titan Forge';
  if (s.type !== 'ai-node') return 'TBUs are built only at your Nodes';
  for (const p of Object.values(parts)) if (p.requires && !state.techs.includes(p.requires)) return `${p.name} needs research`;
  return null;
}

export function genomeOpen(state: GameState): boolean {
  return state.techs.includes(GENOME.requires);
}

/** Genes you can sequence now (prerequisite in the strand done). */
export function availableGenes(state: GameState): string[] {
  if (!genomeOpen(state)) return [];
  return GENOME.genes
    .filter((g) => !state.genes.includes(g.id))
    .filter((g) => g.tier === 1 || GENOME.genes.some((p) => p.strand === g.strand && p.tier === g.tier - 1 && state.genes.includes(p.id)))
    .map((g) => g.id);
}

/** Strains unlocked by your genes. */
export function unlockedStrains(state: GameState): string[] {
  return GENOME.strains.filter((st) => state.genes.some((g) => geneDef(g).unlocks === st.id)).map((st) => st.id);
}

export function canEmbark(state: GameState, owner: Owner): boolean {
  return owner === PLAYER ? mods(state).embark : false;
}

export function workRadius(state: GameState, s: Structure): number {
  const base = structureDef(s.type).workRadius;
  if (s.owner !== PLAYER) return base;
  return base + mods(state).workRadius[s.type === 'ai-node' ? 'node' : 'city'];
}

/** Tiles currently in sight of any of your units or settlements. */
export function visibleTiles(state: GameState, world: World): Set<number> {
  const seen = new Set<number>();
  for (const u of state.units) {
    if (u.owner !== PLAYER) continue;
    for (const t of hexesInRange(u.tile, unitSight(state, u), world)) seen.add(t);
  }
  for (const s of state.structures) {
    if (s.owner !== PLAYER) continue;
    for (const t of hexesInRange(s.tile, structureDef(s.type).sight, world)) seen.add(t);
  }
  return seen;
}

/** Marks visible tiles explored. Returns tiles that were newly explored. */
export function revealAround(state: GameState, world: World): number[] {
  const fresh: number[] = [];
  for (const t of visibleTiles(state, world)) {
    if (!state.explored[t]) {
      state.explored[t] = 1;
      fresh.push(t);
    }
  }
  return fresh;
}

/**
 * Who claims each tile: every settlement claims the hexes around it, and the
 * nearest settlement wins a contested hex (lowest id on a tie).
 */
export function territory(state: GameState, world: World): Map<number, Owner> {
  const best = new Map<number, [number, number, Owner]>(); // tile -> [dist, id, owner]
  const radius = RULES.factions.territoryRadius;
  for (const s of state.structures) {
    for (const t of hexesInRange(s.tile, radius, world)) {
      const d = distance(s.tile, t, world);
      const cur = best.get(t);
      if (!cur || d < cur[0] || (d === cur[0] && s.id < cur[1])) best.set(t, [d, s.id, s.owner]);
    }
  }
  return new Map([...best].map(([t, v]) => [t, v[2]]));
}

export function unitById(state: GameState, id: number): Unit | undefined {
  return state.units.find((u) => u.id === id);
}

export function structureById(state: GameState, id: number): Structure | undefined {
  return state.structures.find((s) => s.id === id);
}

export function structureAt(state: GameState, tile: number): Structure | undefined {
  return state.structures.find((s) => s.tile === tile);
}

export function unitsAt(state: GameState, tile: number): Unit[] {
  return state.units.filter((u) => u.tile === tile);
}

/** Techs whose prerequisites are all researched and that are not done yet. */
export function availableTechs(state: GameState): string[] {
  return TECHS.filter((t) => !state.techs.includes(t.id) && t.requires.every((r) => state.techs.includes(r))).map((t) => t.id);
}

/** Units you can build now: unlocked by tech, and ships only on the coast. */
export function buildableUnits(state: GameState, world: World, s: Structure): string[] {
  const coastal = hexesInRange(s.tile, 1, world).some((t) => TERRAIN[world.terrain[t]].water && TERRAIN[world.terrain[t]].id !== 'rift');
  return UNITS.filter(
    (u) =>
      u.side === 'player' &&
      (!u.requires || state.techs.includes(u.requires)) &&
      (u.domain !== 'sea' || coastal),
  ).map((u) => u.id);
}

/** Dominion: how many original capitals you hold, out of how many. */
export function dominionProgress(state: GameState): { held: number; total: number } {
  const capitals = state.structures.filter((s) => s.capitalOf);
  return { held: capitals.filter((s) => s.owner === PLAYER).length, total: state.factions.length };
}

/** First contact: a faction is met once you see one of its cities or units. */
export function meetFactions(state: GameState, world: World, events: GameEvent[]): void {
  const seen = visibleTiles(state, world);
  for (const f of state.factions) {
    if (f.met || f.eliminated) continue;
    const spotted =
      state.structures.some((s) => s.owner === f.id && (seen.has(s.tile) || state.explored[s.tile])) ||
      state.units.some((u) => u.owner === f.id && seen.has(u.tile));
    if (spotted) {
      f.met = true;
      events.push({ kind: 'met', faction: f.id });
    }
  }
}

