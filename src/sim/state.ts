// The run's dynamic state. Everything here is plain data (no classes), so it
// serialises straight into a save and can be hashed to check determinism.
// The world map itself is not stored: it is regrown from the seed.

import { structureDef, unitDef } from '../content';
import { hexesInRange } from './hex';
import { RngState, Rng } from './rng';
import { World } from './worldgen';

export const STATE_VERSION = 1;

export type Beat = 'sense' | 'decide' | 'resolve' | 'watch' | 'reckon';
export const BEATS: readonly Beat[] = ['sense', 'decide', 'resolve', 'watch', 'reckon'];

export interface Unit {
  id: number;
  type: string;
  owner: 'player';
  tile: number;
  /** Remaining standing route (tiles still to enter), kept across cycles. */
  route: number[];
}

export interface Structure {
  id: number;
  type: string;
  owner: 'player';
  tile: number;
  stage: number;
  /** Unit being built here, if any. */
  build: { unit: string; progress: number } | null;
}

export interface Resources {
  compute: number;
  matter: number;
}

export type Order =
  | { kind: 'move'; unitId: number; to: number }
  | { kind: 'build'; structureId: number; unit: string }
  | { kind: 'cancel-build'; structureId: number };

export type GameEvent =
  | { kind: 'moved'; unitId: number; path: number[] }
  | { kind: 'built'; unitId: number; unit: string; tile: number }
  | { kind: 'build-started'; structureId: number; unit: string }
  | { kind: 'build-blocked'; structureId: number; unit: string; reason: string }
  | { kind: 'yield'; compute: number; matter: number; brownout: boolean }
  | { kind: 'discovered'; tiles: number; ruins: number; rifts: number }
  | { kind: 'order-rejected'; order: Order; reason: string };

export interface GameState {
  version: number;
  seed: string;
  worldChecksum: number;
  cycle: number;
  rng: RngState;
  nextId: number;
  resources: Resources;
  units: Unit[];
  structures: Structure[];
  /** 1 = explored, per tile. */
  explored: Uint8Array;
  /** Orders given during Decide, resolved in sequence at End Cycle. */
  orders: Order[];
  /** What happened last cycle (shown in Sense / Reckon). */
  lastEvents: GameEvent[];
}

export function newGame(world: World): GameState {
  const rng = Rng.stream(world.seed, 'sim');
  const state: GameState = {
    version: STATE_VERSION,
    seed: world.seed,
    worldChecksum: world.checksum,
    cycle: 1,
    rng: rng.state(),
    nextId: 1,
    resources: { compute: 0, matter: 30 },
    units: [],
    structures: [],
    explored: new Uint8Array(world.width * world.height),
    orders: [],
    lastEvents: [],
  };
  state.structures.push({
    id: state.nextId++,
    type: 'ai-node',
    owner: 'player',
    tile: world.start,
    stage: 1,
    build: null,
  });
  spawnUnit(state, 'observer-drone', world.start);
  spawnUnit(state, 'sentinel-trooper', world.start);
  revealAround(state, world);
  return state;
}

export function spawnUnit(state: GameState, type: string, tile: number): Unit {
  unitDef(type); // validate
  const unit: Unit = { id: state.nextId++, type, owner: 'player', tile, route: [] };
  state.units.push(unit);
  return unit;
}

/** Energy is never spent: it is a total you allocate. */
export function energyBudget(state: GameState): { total: number; allocated: number } {
  let total = 0;
  let allocated = 0;
  for (const s of state.structures) {
    const def = structureDef(s.type);
    total += def.energy;
    if (s.build) allocated += def.buildEnergy;
  }
  for (const u of state.units) allocated += unitDef(u.type).energy;
  return { total, allocated };
}

export function isBrownout(state: GameState): boolean {
  const { total, allocated } = energyBudget(state);
  return allocated > total;
}

/** Tiles currently in sight of any of your units or structures. */
export function visibleTiles(state: GameState, world: World): Set<number> {
  const seen = new Set<number>();
  for (const u of state.units) {
    for (const t of hexesInRange(u.tile, unitDef(u.type).sight, world)) seen.add(t);
  }
  for (const s of state.structures) {
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

export function unitById(state: GameState, id: number): Unit | undefined {
  return state.units.find((u) => u.id === id);
}

export function structureById(state: GameState, id: number): Structure | undefined {
  return state.structures.find((s) => s.id === id);
}
