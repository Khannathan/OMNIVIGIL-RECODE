// The run's dynamic state. Everything here is plain data (no classes), so it
// serialises straight into a save and can be hashed to check determinism.
// The world map itself is not stored: it is regrown from the seed.

import { archetypeDef, FORGE, RULES, structureDef, TECHS, TERRAIN, unitDef, UNITS } from '../content';
import { mods, playerEffects, sumFor } from './effects';
import { distance, hexesInRange } from './hex';
import { RngState, Rng } from './rng';
import { World } from './worldgen';

export const STATE_VERSION = 2;

export type Beat = 'sense' | 'decide' | 'resolve' | 'watch' | 'reckon';
export const BEATS: readonly Beat[] = ['sense', 'decide', 'resolve', 'watch', 'reckon'];

/** 'player', or a faction id. */
export type Owner = string;
export const PLAYER = 'player';

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

export interface Resources {
  compute: number;
  matter: number;
  influence: number;
}

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
  | { kind: 'incite'; faction: string; against: string };

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
  | { kind: 'yield'; compute: number; matter: number; influence: number; brownout: boolean }
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
  | { kind: 'victory'; victory: 'dominion' }
  | { kind: 'defeat' };

export interface GameState {
  version: number;
  seed: string;
  worldChecksum: number;
  cycle: number;
  /** One stream per system, so adding a system never reshuffles another. */
  rng: { sim: RngState; combat: RngState; factions: RngState };
  nextId: number;
  ai: AiProfile;
  resources: Resources;
  units: Unit[];
  structures: Structure[];
  factions: FactionState[];
  techs: string[];
  research: { tech: string; progress: number } | null;
  stats: { computeEarned: number; kills: number; losses: number; citiesTaken: number };
  victory: { kind: 'dominion'; cycle: number } | null;
  defeated: boolean;
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
    },
    nextId: 1,
    ai: { ...ai, epithet: ai.epithet.slice(0, 40) },
    resources: { ...RULES.start },
    units: [],
    structures: [],
    factions: [],
    techs: [],
    research: null,
    stats: { computeEarned: 0, kills: 0, losses: 0, citiesTaken: 0 },
    victory: null,
    defeated: false,
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

/** Are these two owners at war? */
export function hostile(state: GameState, a: Owner, b: Owner): boolean {
  if (a === b) return false;
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
  return { total, allocated };
}

export function isBrownout(state: GameState): boolean {
  const { total, allocated } = energyBudget(state);
  return allocated > total;
}

export function unitSight(state: GameState, unit: Unit): number {
  const def = unitDef(unit.type);
  if (unit.owner !== PLAYER) return def.sight;
  return def.sight + sumFor(mods(state).sight, def.domain);
}

export function unitSpeed(state: GameState, unit: Unit): number {
  const def = unitDef(unit.type);
  if (unit.owner !== PLAYER) return def.speed;
  return def.speed + sumFor(mods(state).speed, def.domain);
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

