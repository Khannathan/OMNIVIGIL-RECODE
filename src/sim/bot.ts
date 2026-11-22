// Headless bot that plays a seed with no rendering. Used by tests to check
// determinism and, later, balance. It has its own RNG stream so it never
// disturbs the sim's randomness.

import { unitDef, UNITS } from '../content';
import { distance, neighbors } from './hex';
import { queueOrder, resolveCycle, CycleReport } from './cycle';
import { findPath } from './path';
import { Rng } from './rng';
import { GameState } from './state';
import { World } from './worldgen';

export function botDecide(state: GameState, world: World, rng: Rng): void {
  // Explore: idle units head for the nearest reachable frontier tile.
  for (const unit of state.units) {
    if (unit.route.length) continue;
    const def = unitDef(unit.type);
    const frontier: number[] = [];
    for (let t = 0; t < state.explored.length; t++) {
      if (!state.explored[t]) continue;
      if (neighbors(t, world).some((n) => !state.explored[n])) frontier.push(t);
    }
    frontier.sort((a, b) => distance(unit.tile, a, world) - distance(unit.tile, b, world) || a - b);
    const candidates = frontier.slice(0, 12);
    rng.shuffle(candidates);
    for (const target of candidates) {
      if (target === unit.tile) continue;
      if (findPath(world, def, unit.tile, target, state.explored)) {
        queueOrder(state, { kind: 'move', unitId: unit.id, to: target });
        break;
      }
    }
  }
  // Build whenever affordable.
  for (const s of state.structures) {
    if (s.build) continue;
    const choice = rng.pick(UNITS);
    if (state.resources.matter >= choice.cost.matter) {
      queueOrder(state, { kind: 'build', structureId: s.id, unit: choice.id });
    }
  }
}

export function botPlay(state: GameState, world: World, cycles: number): CycleReport[] {
  const rng = Rng.stream(state.seed, `bot:${state.cycle}`);
  const reports: CycleReport[] = [];
  for (let i = 0; i < cycles; i++) {
    botDecide(state, world, rng);
    reports.push(resolveCycle(state, world));
  }
  return reports;
}
