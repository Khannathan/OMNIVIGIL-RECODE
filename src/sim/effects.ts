// Folds the player's Forge choices and researched techs into one set of
// modifiers. Every rule that a tech or Forge option can change reads from
// here, so adding a new tech is a data edit in techs.json.

import { Domain, Effect, FORGE, ForgeOption, ResourceId, techDef } from '../content';
import type { AiProfile, GameState } from './state';

export interface Mods {
  yieldFlat: Record<'node' | 'city', Record<ResourceId, number>>;
  yieldPct: Record<ResourceId, number>;
  energyFlat: number;
  upow: Array<{ pct: number; domain?: Domain; role?: 'attack' | 'defense'; source: string }>;
  research: number;
  build: number;
  sight: Array<{ flat: number; domain?: Domain }>;
  speed: Array<{ flat: number; domain?: Domain }>;
  heal: number;
  workRadius: Record<'node' | 'city', number>;
  embark: boolean;
  attitude: number;
  sway: number;
}

export function forgeOptions(ai: AiProfile): ForgeOption[] {
  const find = (list: ForgeOption[], id: string) => list.find((o) => o.id === id);
  return [
    find(FORGE.origins, ai.origin),
    find(FORGE.architectures, ai.architecture),
    find(FORGE.temperaments, ai.temperament),
    find(FORGE.doctrines, ai.doctrine),
  ].filter((o): o is ForgeOption => !!o);
}

/** Every effect the player has, tagged with where it came from. */
export function playerEffects(state: Pick<GameState, 'ai' | 'techs'>): Array<{ effect: Effect; source: string }> {
  const out: Array<{ effect: Effect; source: string }> = [];
  for (const o of forgeOptions(state.ai)) for (const effect of o.effects) out.push({ effect, source: o.name });
  for (const id of state.techs) {
    const t = techDef(id);
    for (const effect of t.effects) out.push({ effect, source: t.name });
  }
  return out;
}

const cache = new WeakMap<object, { key: string; mods: Mods }>();

export function mods(state: Pick<GameState, 'ai' | 'techs'>): Mods {
  const key = `${state.techs.length}|${state.ai.origin}|${state.ai.architecture}|${state.ai.temperament}|${state.ai.doctrine}`;
  const hit = cache.get(state);
  if (hit && hit.key === key) return hit.mods;
  const zero = (): Record<ResourceId, number> => ({ compute: 0, matter: 0, influence: 0 });
  const m: Mods = {
    yieldFlat: { node: zero(), city: zero() },
    yieldPct: zero(),
    energyFlat: 0,
    upow: [],
    research: 0,
    build: 0,
    sight: [],
    speed: [],
    heal: 0,
    workRadius: { node: 0, city: 0 },
    embark: false,
    attitude: 0,
    sway: 0,
  };
  for (const { effect: e, source } of playerEffects(state)) {
    switch (e.kind) {
      case 'yield':
        if (e.flat) {
          if (e.where !== 'city') m.yieldFlat.node[e.resource] += e.flat;
          if (e.where !== 'node') m.yieldFlat.city[e.resource] += e.flat;
        }
        if (e.pct) m.yieldPct[e.resource] += e.pct;
        break;
      case 'energy':
        m.energyFlat += e.flat;
        break;
      case 'upow':
        m.upow.push({ pct: e.pct, domain: e.domain, role: e.role, source });
        break;
      case 'research':
        m.research += e.pct;
        break;
      case 'build':
        m.build += e.pct;
        break;
      case 'sight':
        m.sight.push({ flat: e.flat, domain: e.domain });
        break;
      case 'speed':
        m.speed.push({ flat: e.flat, domain: e.domain });
        break;
      case 'heal':
        m.heal += e.flat;
        break;
      case 'workRadius':
        if (e.where !== 'city') m.workRadius.node += e.flat;
        if (e.where !== 'node') m.workRadius.city += e.flat;
        break;
      case 'embark':
        m.embark = true;
        break;
      case 'attitude':
        m.attitude += e.flat;
        break;
      case 'sway':
        m.sway += e.flat;
        break;
      case 'startUnit':
      case 'startResource':
        break; // applied once by newGame
    }
  }
  cache.set(state, { key, mods: m });
  return m;
}

export function sumFor(list: Array<{ flat: number; domain?: Domain }>, domain: Domain): number {
  return list.reduce((a, x) => a + (!x.domain || x.domain === domain ? x.flat : 0), 0);
}
