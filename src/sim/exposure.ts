// Exposure (design bible section 6): how much the homeworld knows about you.
// Loud acts raise it; Crypto can scrub some of it away. At 25 you are
// Noticed, at 50 Revealed (and you never go below 50 again), at 75 Hunted,
// and at 100 the world unites in a Crusade against you.

import { RULES } from '../content';
import { declareWar, makePeace } from './actions';
import { mods } from './effects';
import { exposureLevel, GameEvent, GameState, PLAYER } from './state';

/** Raise Exposure by a base amount, scaled by your Exposure effects (Cover Stories, Inevitable). */
export function addExposure(state: GameState, amount: number): void {
  if (amount <= 0) return;
  const k = Math.max(0, 1 + mods(state).exposure / 100);
  state.exposure = Math.round((state.exposure + amount * k) * 100) / 100;
}

/** The lowest Exposure can go: once Revealed, always Revealed. */
export function exposureFloor(state: GameState): number {
  const X = RULES.exposure;
  return state.exposureMax >= X.permanentLevel ? X.levels[X.permanentLevel].at : 0;
}

export function exposureName(level: number): string {
  return RULES.exposure.levels[Math.max(0, Math.min(level, RULES.exposure.levels.length - 1))].name;
}

export function crusade(state: GameState): boolean {
  return exposureLevel(state.exposure) >= RULES.exposure.levels.length - 1;
}

/** End of Resolve: passive gain, the permanent floor, level changes, and the Crusade. */
export function exposurePhase(state: GameState, events: GameEvent[], levelBefore: number): void {
  const X = RULES.exposure;
  const settlements = state.structures.filter((s) => s.owner === PLAYER).length;
  addExposure(state, X.passivePerCycle + X.perExtraSettlement * Math.max(0, settlements - 1));
  state.exposure = Math.max(state.exposure, exposureFloor(state));
  const level = exposureLevel(state.exposure);
  if (level !== levelBefore) events.push({ kind: 'exposure', level, rising: level > levelBefore });
  state.exposureMax = Math.max(state.exposureMax, level);
  state.exposure = Math.max(state.exposure, exposureFloor(state));
  if (level >= X.levels.length - 1 && levelBefore < X.levels.length - 1) {
    events.push({ kind: 'crusade' });
    const alive = state.factions.filter((f) => !f.eliminated);
    for (const f of alive) declareWar(state, events, f.id, PLAYER, f.id);
    for (const a of alive) for (const b of alive) if (a.id < b.id) makePeace(state, events, a.id, b.id);
  }
}

/** Where a faction's opinion drifts to is pulled down by your Exposure. */
export function exposureAttitude(state: GameState): number {
  return RULES.exposure.attitude[exposureLevel(state.exposure)] ?? 0;
}
