// Headless bot that plays a seed with no rendering. Used by tests to check
// determinism and, roughly, balance. It has its own RNG stream so it never
// disturbs the sim's randomness, and it only gives orders, like a player.

import { geneDef, RULES, strainDef, techDef, unitDef } from '../content';
import { kaijuKnown } from './advisor';
import { exposureFloor } from './exposure';
import { forgeOpen, strongestTitan } from './titans';
import { forecast, bestDefender } from './combat';
import { queueOrder, resolveCycle, CycleReport } from './cycle';
import { distance, neighbors } from './hex';
import { findPath } from './path';
import { Rng } from './rng';
import {
  availableGenes,
  availableTechs,
  buildableUnits,
  canAfford,
  canEmbark,
  energyBudget,
  GameState,
  hostile,
  PLAYER,
  structureAt,
  Unit,
  unlockedStrains,
} from './state';
import { World } from './worldgen';

export function botDecide(state: GameState, world: World, rng: Rng): void {
  // Research: cheapest affordable tech, random among ties.
  let researching = !!state.research;
  if (!researching) {
    const options = availableTechs(state)
      .map(techDef)
      .filter((t) => t.cost <= state.resources.compute)
      .sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
    let cheapest = options.filter((t) => t.cost === options[0]?.cost);
    // Kaiju about: head for the Titan Forge.
    const forgePath = options.filter((t) => t.id === 'titan-forge' || (!state.techs.includes('titan-forge') && techDef('titan-forge').requires.includes(t.id)));
    if (kaijuKnown(state) && forgePath.length) cheapest = forgePath;
    if (cheapest.length) {
      queueOrder(state, { kind: 'research', tech: rng.pick(cheapest).id });
      researching = true;
    }
  }

  // Build within the Energy budget, so the bot never browns out on purpose.
  const e = energyBudget(state);
  let spare = e.total - e.allocated - (researching && !state.research ? RULES.research.energy : 0);
  const mine = state.units.filter((u) => u.owner === PLAYER);
  const drones = mine.filter((u) => u.type === 'observer-drone').length;
  const titans = mine.filter((u) => unitDef(u.type).titan).length;
  let matter = state.resources.matter;
  for (const s of state.structures) {
    if (s.owner !== PLAYER || s.build) continue;
    // Kaiju about: a TBU first.
    if (s.type === 'ai-node' && forgeOpen(state) && kaijuKnown(state) && titans < 2) {
      const type = strongestTitan(state, matter);
      if (type && unitDef(type).energy + 2 <= spare) {
        queueOrder(state, { kind: 'build', structureId: s.id, unit: type });
        spare -= unitDef(type).energy + 2;
        matter -= unitDef(type).cost.matter;
      }
      continue; // save up for it
    }
    const options = buildableUnits(state, world, s)
      .map(unitDef)
      .filter((d) => d.cost.matter <= matter && d.energy + 2 <= spare)
      .filter((d) => d.attack || drones < 2)
      .sort((a, b) => b.upow - a.upow || a.id.localeCompare(b.id));
    if (!options.length) continue;
    const pick = rng.pick(options.slice(0, 2));
    queueOrder(state, { kind: 'build', structureId: s.id, unit: pick.id });
    spare -= pick.energy + 2;
    matter -= pick.cost.matter;
  }

  // Essence: genes first, then a symbiote for a unit at home.
  const gene = availableGenes(state).map(geneDef).filter((g) => g.cost <= state.resources.essence).sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))[0];
  if (gene) queueOrder(state, { kind: 'sequence', gene: gene.id });
  else {
    const strain = unlockedStrains(state).map(strainDef).filter((st) => st.cost <= state.resources.essence).sort((a, b) => b.upowPct - a.upowPct || a.id.localeCompare(b.id))[0];
    const host = mine.find((u) => !u.symbiote && unitDef(u.type).attack && !unitDef(u.type).oneShot && structureAt(state, u.tile)?.owner === PLAYER);
    if (strain && host) queueOrder(state, { kind: 'fuse', unitId: host.id, strain: strain.id });
  }
  // Exposure: keep out of a Crusade if Crypto allows.
  const X = RULES.exposure;
  if (state.exposure >= 70 && state.exposure - X.scrubAmount >= exposureFloor(state) && state.resources.crypto >= X.scrubCost) queueOrder(state, { kind: 'scrub' });
  // The Ark, when it is affordable and Energy allows.
  const stage = RULES.ark.stages[state.ark.stage];
  const node = state.structures.find((s) => s.owner === PLAYER && s.type === 'ai-node');
  if (stage && node && !state.ark.build && state.techs.includes(stage.requires) && canAfford(state, { ...stage.cost, matter: (stage.cost.matter ?? 0) + (state.resources.matter - matter) }) && RULES.ark.energy <= spare) {
    queueOrder(state, { kind: 'ark', structureId: node.id });
  }

  // Diplomacy: once the army is ready, go to war with the nearest faction.
  const army = mine.filter((u) => unitDef(u.type).attack);
  const atWar = state.factions.some((f) => f.atWar);
  const home = state.structures.find((s) => s.owner === PLAYER);
  if (!atWar && home && army.length >= 4 && state.cycle >= 12) {
    const targets = state.factions
      .filter((f) => f.met && !f.eliminated)
      .map((f) => {
        const d = Math.min(...state.structures.filter((s) => s.owner === f.id).map((s) => distance(home.tile, s.tile, world)));
        return { f, d };
      })
      .sort((a, b) => a.d - b.d || a.f.id.localeCompare(b.f.id));
    if (targets.length) queueOrder(state, { kind: 'declare-war', faction: targets[0].f.id });
  }
  for (const f of state.factions) {
    if (f.eliminated || !f.met) continue;
    if (f.atWar && f.attitude >= RULES.diplomacy.peaceMinAttitude && state.factions.filter((x) => x.atWar).length > 1 && state.resources.influence >= RULES.diplomacy.peaceCost) {
      queueOrder(state, { kind: 'peace', faction: f.id });
    } else if (!f.atWar && f.attitude < -20 && state.resources.influence >= RULES.diplomacy.swayCost + 10) {
      queueOrder(state, { kind: 'sway', faction: f.id });
    }
  }

  // Units. The first fighter on each settlement stays as its garrison.
  const garrison = new Set<number>();
  for (const s of state.structures) {
    if (s.owner !== PLAYER) continue;
    const g = mine.filter((u) => u.tile === s.tile && unitDef(u.type).attack && unitDef(u.type).capture).sort((a, b) => a.id - b.id)[0];
    if (g) garrison.add(g.id);
  }
  for (const unit of mine) {
    const def = unitDef(unit.type);
    if (garrison.has(unit.id)) {
      unit.route.length = 0;
      continue;
    }
    if (def.attack) {
      if (soldier(state, world, unit)) continue;
    }
    if (unit.route.length || unit.attackTile !== null) continue;
    explore(state, world, unit, rng);
  }
}

/** Fight if something good is in reach. Returns true when it gave an order. */
function soldier(state: GameState, world: World, unit: Unit): boolean {
  // Adjacent enemies first.
  for (const t of neighbors(unit.tile, world).sort((a, b) => a - b)) {
    const d = bestDefender(state, world, t, PLAYER, unit);
    if (!d || !hostile(state, PLAYER, d.owner)) continue;
    // Besiege walls with friends nearby; otherwise only take good odds.
    const friends = neighbors(t, world).filter((n) => state.units.some((o) => o.owner === PLAYER && o.tile === n && o.id !== unit.id)).length;
    const need = d.type === 'walls' && friends > 0 ? 0.25 : 0.55;
    if (forecast(state, world, unit, d).winChance >= need) {
      queueOrder(state, { kind: 'attack', unitId: unit.id, target: t });
      return true;
    }
  }
  if (unit.hp < 50) {
    const home = state.structures
      .filter((s) => s.owner === PLAYER)
      .sort((a, b) => distance(unit.tile, a.tile, world) - distance(unit.tile, b.tile, world) || a.id - b.id)[0];
    if (home && home.tile !== unit.tile) {
      queueOrder(state, { kind: 'move', unitId: unit.id, to: home.tile });
      return true;
    }
    return home?.tile === unit.tile;
  }
  if (unit.route.length || unit.attackTile !== null) return true;
  // March on the nearest known enemy settlement.
  const target = state.structures
    .filter((s) => state.explored[s.tile] && hostile(state, PLAYER, s.owner))
    .sort((a, b) => distance(unit.tile, a.tile, world) - distance(unit.tile, b.tile, world) || a.id - b.id)[0];
  if (target) {
    queueOrder(state, { kind: 'attack', unitId: unit.id, target: target.tile });
    return true;
  }
  return false;
}

function explore(state: GameState, world: World, unit: Unit, rng: Rng): void {
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
    if (findPath(world, def, unit.tile, target, state.explored, { embark: canEmbark(state, PLAYER) })) {
      queueOrder(state, { kind: 'move', unitId: unit.id, to: target });
      break;
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
