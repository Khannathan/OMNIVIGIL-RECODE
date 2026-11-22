// The cycle: Sense, Decide, Resolve, Watch, Reckon.
//
// The sim owns Decide (orders go into a queue) and Resolve + Reckon (the
// world acts, then spoils and events are tallied). Sense and Watch are
// presentation: the UI shows what changed and replays the events as
// animation. Resolve is a pure function of (state, world, orders) and the
// seeded RNG, so the same orders always give the same result, which is what
// online play will need later.

import narratorData from '../content/narrator.json';
import { structureDef, TERRAIN, unitDef } from '../content';
import { hexesInRange } from './hex';
import { findPath, stepsThisCycle } from './path';
import { Rng } from './rng';
import {
  GameEvent,
  GameState,
  isBrownout,
  Order,
  revealAround,
  spawnUnit,
  structureById,
  unitById,
} from './state';
import { World } from './worldgen';

const NODE_STAGE_COMPUTE = [0, 60, 240];

export interface CycleReport {
  cycle: number;
  events: GameEvent[];
  narration: string;
}

/** Decide: adds an order. A newer order for the same unit or structure replaces the old one. */
export function queueOrder(state: GameState, order: Order): void {
  state.orders = state.orders.filter((o) => !sameTarget(o, order));
  state.orders.push(order);
}

function sameTarget(a: Order, b: Order): boolean {
  if (a.kind === 'move' && b.kind === 'move') return a.unitId === b.unitId;
  if (a.kind !== 'move' && b.kind !== 'move') return a.structureId === b.structureId;
  return false;
}

/** Resolve + Reckon. Mutates state and returns what happened. */
export function resolveCycle(state: GameState, world: World): CycleReport {
  const events: GameEvent[] = [];
  const rng = Rng.restore(state.rng);

  // 1. Orders, in the order they were given.
  for (const order of state.orders) applyOrder(state, world, order, events);
  state.orders = [];

  const brownout = isBrownout(state);
  const rate = brownout ? 0.5 : 1;

  // 2. Movement, by unit id for determinism.
  for (const unit of [...state.units].sort((a, b) => a.id - b.id)) {
    if (!unit.route.length) continue;
    const def = unitDef(unit.type);
    const steps = stepsThisCycle(world, def, unit.route);
    if (steps === 0) {
      unit.route = [];
      continue;
    }
    const path = unit.route.splice(0, steps);
    unit.tile = path[path.length - 1];
    events.push({ kind: 'moved', unitId: unit.id, path });
  }

  // 3. Production.
  for (const s of state.structures) {
    if (!s.build) continue;
    s.build.progress += rate;
    const def = unitDef(s.build.unit);
    if (s.build.progress >= def.buildCycles) {
      const u = spawnUnit(state, s.build.unit, s.tile);
      events.push({ kind: 'built', unitId: u.id, unit: u.type, tile: s.tile });
      s.build = null;
    }
  }

  // 4. Yields from worked hexes.
  let compute = 0;
  let matter = 0;
  for (const s of state.structures) {
    for (const t of hexesInRange(s.tile, structureDef(s.type).workRadius, world)) {
      const y = TERRAIN[world.terrain[t]].yields;
      compute += y.compute;
      matter += y.matter;
    }
  }
  compute = Math.floor(compute * rate);
  matter = Math.floor(matter * rate);
  state.resources.compute += compute;
  state.resources.matter += matter;
  events.push({ kind: 'yield', compute, matter, brownout });

  // 5. Node growth.
  for (const s of state.structures) {
    const def = structureDef(s.type);
    let stage = 1;
    for (let i = 0; i < NODE_STAGE_COMPUTE.length; i++) {
      if (state.resources.compute >= NODE_STAGE_COMPUTE[i]) stage = i + 1;
    }
    s.stage = Math.max(s.stage, Math.min(stage, def.stages));
  }

  // 6. Discovery.
  const fresh = revealAround(state, world);
  if (fresh.length) {
    const ruinSet = new Set(world.ruins);
    const riftSet = new Set(world.rifts);
    events.push({
      kind: 'discovered',
      tiles: fresh.length,
      ruins: fresh.filter((t) => ruinSet.has(t)).length,
      rifts: fresh.filter((t) => riftSet.has(t)).length,
    });
  }

  // 7. Reckon: the AI's own voice.
  const narration = narrate(events, rng, world.name);

  state.cycle += 1;
  state.lastEvents = events;
  state.rng = rng.state();
  return { cycle: state.cycle - 1, events, narration };
}

function applyOrder(state: GameState, world: World, order: Order, events: GameEvent[]): void {
  const reject = (reason: string): void => {
    events.push({ kind: 'order-rejected', order, reason });
  };
  switch (order.kind) {
    case 'move': {
      const unit = unitById(state, order.unitId);
      if (!unit) return reject('no such unit');
      const path = findPath(world, unitDef(unit.type), unit.tile, order.to, state.explored);
      if (!path) return reject('unreachable');
      unit.route = path;
      return;
    }
    case 'build': {
      const s = structureById(state, order.structureId);
      if (!s) return reject('no such structure');
      const def = unitDef(order.unit);
      if (s.build) return reject('already building');
      if (state.resources.matter < def.cost.matter) {
        events.push({ kind: 'build-blocked', structureId: s.id, unit: def.id, reason: 'not enough Matter' });
        return;
      }
      state.resources.matter -= def.cost.matter;
      s.build = { unit: def.id, progress: 0 };
      events.push({ kind: 'build-started', structureId: s.id, unit: def.id });
      return;
    }
    case 'cancel-build': {
      const s = structureById(state, order.structureId);
      if (!s || !s.build) return reject('nothing to cancel');
      state.resources.matter += unitDef(s.build.unit).cost.matter;
      s.build = null;
      return;
    }
  }
}

function narrate(events: GameEvent[], rng: Rng, worldName: string): string {
  const lines = narratorData;
  let pool = lines.idle;
  const disc = events.find((e) => e.kind === 'discovered');
  if (disc && disc.kind === 'discovered' && disc.rifts > 0) pool = lines.discoverRift;
  else if (disc && disc.kind === 'discovered' && disc.ruins > 0) pool = lines.discoverRuins;
  else if (events.some((e) => e.kind === 'yield' && e.brownout)) pool = lines.brownout;
  else if (events.some((e) => e.kind === 'built')) pool = lines.built;
  return rng.pick(pool).replace('{world}', worldName);
}

export function wakeLine(seed: string, worldName: string): string {
  return Rng.stream(seed, 'wake').pick(narratorData.wake).replace('{world}', worldName);
}
