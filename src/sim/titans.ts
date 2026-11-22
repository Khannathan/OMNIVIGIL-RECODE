// Titan Forge helpers (M3): which parts you can use, and good default
// blueprints for the advisor and the bot. Pure functions of the state.

import { Cost, slotKind, TitanPart, TITANS, TitanSlot, TITAN_SLOTS, titanType, unitDef } from '../content';
import { GameState } from './state';

export function partUnlocked(state: Pick<GameState, 'techs'>, p: TitanPart): boolean {
  return !p.requires || state.techs.includes(p.requires);
}

/** Parts that fit a slot, unlocked first. */
export function partsFor(slot: TitanSlot): TitanPart[] {
  return TITANS.parts.filter((p) => p.slot === slotKind(slot));
}

export function forgeOpen(state: Pick<GameState, 'techs'>): boolean {
  return state.techs.includes(TITANS.requires);
}

/** The cheap standard TBU anyone with the Titan Forge can build. */
export function defaultTitan(): string {
  return titanType(TITANS.default);
}

function onlyMatter(c: Cost): boolean {
  return Object.entries(c).every(([k, v]) => k === 'matter' || !v);
}

/**
 * The strongest TBU you could build from unlocked parts that cost only Matter,
 * within a Matter budget (greedy: upgrade the slot with the best UPow per
 * extra Matter until nothing more fits). Null if even the default won't fit.
 */
export function strongestTitan(state: GameState, matterBudget: number): string | null {
  const pick = { ...TITANS.default } as Record<TitanSlot, string>;
  const costOf = (id: string) => TITANS.parts.find((p) => p.id === id)!.cost.matter ?? 0;
  const upowOf = (id: string) => TITANS.parts.find((p) => p.id === id)!.upow;
  let spent = TITAN_SLOTS.reduce((a, s) => a + costOf(pick[s]), 0);
  if (spent > matterBudget) return null;
  for (;;) {
    let best: { slot: TitanSlot; id: string; score: number; extra: number } | null = null;
    for (const slot of TITAN_SLOTS) {
      for (const p of partsFor(slot)) {
        if (!partUnlocked(state, p) || !onlyMatter(p.cost) || p.id === pick[slot]) continue;
        if (p.amphibious || p.hover) continue; // the advisor keeps to plain legs; special legs are a player choice
        const gain = p.upow - upowOf(pick[slot]);
        const extra = (p.cost.matter ?? 0) - costOf(pick[slot]);
        if (gain <= 0 || spent + extra > matterBudget) continue;
        const score = gain / Math.max(1, extra);
        if (!best || score > best.score || (score === best.score && p.id < best.id)) best = { slot, id: p.id, score, extra };
      }
    }
    if (!best) break;
    pick[best.slot] = best.id;
    spent += best.extra;
  }
  return titanType(pick);
}

export function titanName(type: string): string {
  return unitDef(type).name;
}
