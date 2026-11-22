// The Next Best Move advisor and the three-scale goals (design bible
// sections 8 and 17). Pure functions of the state: no randomness, no DOM.
// The UI phrases each piece of advice in the AI's own voice (advisor.json).

import { ADVISOR, FORGE, geneDef, RULES, strainDef, structureDef, techDef, unitDef, UnitDef } from '../content';
import { routeToStrike } from './actions';
import { bestDefender, forecast } from './combat';
import { orderKey } from './cycle';
import { distance, neighbors } from './hex';
import { findPath } from './path';
import { exposureFloor } from './exposure';
import { forgeOpen, strongestTitan } from './titans';
import { doctrineVictory, victoryProgress } from './victory';
import {
  ABYSS,
  availableGenes,
  availableTechs,
  buildableUnits,
  canAfford,
  canEmbark,
  energyBudget,
  exposureLevel,
  factionById,
  GameState,
  hostile,
  Order,
  PLAYER,
  Structure,
  structureAt,
  Unit,
  unlockedStrains,
  VictoryKind,
} from './state';
import { World } from './worldgen';

export type AdviceAction =
  /** Queue this order (and select the unit / look at the tile). */
  | { kind: 'order'; order: Order; unitId?: number; tile?: number }
  /** Look at something: select a unit or a tile. */
  | { kind: 'focus'; tile: number; unitId?: number }
  | { kind: 'sheet'; sheet: SheetId }
  | { kind: 'end-cycle' };

export type SheetId = 'tech' | 'factions' | 'forge' | 'genome' | 'ops';

export interface Advice {
  /** Key into advisor.json lines. */
  id: string;
  /** Higher is more urgent. */
  priority: number;
  vars: Record<string, string>;
  /** Short imperative for the NOW goal. */
  now: string;
  act: AdviceAction;
  /** Label for the button that carries out `act`. */
  verb: string;
}

const isQueued = (state: GameState, key: string) => state.orders.some((o) => orderKey(o) === key);

function settlementsOf(state: GameState): Structure[] {
  return state.structures.filter((s) => s.owner === PLAYER);
}

/** Units with nothing to do: no route, no target, no order queued. Garrisons don't count. */
export function idleUnits(state: GameState): Unit[] {
  return state.units.filter((u) => {
    if (u.owner !== PLAYER || u.route.length || u.attackTile !== null || isQueued(state, `unit:${u.id}`)) return false;
    const home = structureAt(state, u.tile);
    const garrison = home?.owner === PLAYER && unitDef(u.type).attack && unitDef(u.type).capture;
    return !garrison;
  });
}

/** Settlements with nothing in production and nothing queued. */
function idleSettlements(state: GameState): Structure[] {
  return settlementsOf(state).filter((s) => !s.build && !isQueued(state, `structure:${s.id}`));
}

function spareEnergy(state: GameState): number {
  const e = energyBudget(state);
  const queuedResearch = !state.research && isQueued(state, 'research') ? RULES.research.energy : 0;
  // A queued build will hold its settlement's build Energy, and the unit its own once built.
  let queuedBuilds = 0;
  for (const o of state.orders) {
    if (o.kind !== 'build') continue;
    const s = state.structures.find((x) => x.id === o.structureId);
    if (s && !s.build) queuedBuilds += structureDef(s.type).buildEnergy + unitDef(o.unit).energy;
  }
  const queuedArk = !state.ark.build && isQueued(state, 'ark') ? RULES.ark.energy : 0;
  return e.total - e.allocated - queuedResearch - queuedBuilds - queuedArk;
}

function atWar(state: GameState): boolean {
  return state.factions.some((f) => f.atWar && !f.eliminated);
}

/** Hostile units next to one of your settlements. */
function threats(state: GameState, world: World): Array<{ settlement: Structure; enemy: Unit }> {
  const out: Array<{ settlement: Structure; enemy: Unit }> = [];
  for (const s of settlementsOf(state)) {
    const ring = new Set(neighbors(s.tile, world));
    for (const u of state.units) {
      if (ring.has(u.tile) && hostile(state, PLAYER, u.owner) && unitDef(u.type).attack) out.push({ settlement: s, enemy: u });
    }
  }
  return out;
}

/** The tech the advisor would pick now, or null if none is affordable. */
export function suggestTech(state: GameState): string | null {
  const war = atWar(state);
  const spare = spareEnergy(state);
  const scored = availableTechs(state)
    .map(techDef)
    .filter((t) => t.cost <= state.resources.compute)
    .map((t) => {
      let score = -t.cost / 10 + t.tier;
      for (const e of t.effects) {
        if (e.kind === 'upow' && war) score += 4;
        if (e.kind === 'energy' && spare <= 2) score += 5;
        if (e.kind === 'yield') score += 2;
        if (e.kind === 'research') score += 1;
      }
      if (t.blurb.startsWith('Unlocks') && !war) score += 1;
      if (kaijuKnown(state) && (t.id === 'titan-forge' || (!state.techs.includes('titan-forge') && techDef('titan-forge').requires.includes(t.id)))) score += 8;
      if (t.id === 'gene-splicing' && state.resources.essence >= 15) score += 4;
      return { t, score };
    })
    .sort((a, b) => b.score - a.score || a.t.id.localeCompare(b.t.id));
  return scored[0]?.t.id ?? null;
}

/** The unit the advisor would build here now, or null. */
export function suggestUnit(state: GameState, world: World, s: Structure): UnitDef | null {
  const spare = spareEnergy(state);
  const options = buildableUnits(state, world, s)
    .map(unitDef)
    .filter((d) => d.cost.matter <= state.resources.matter - queuedMatter(state) && d.energy + structureBuildEnergy(s) <= spare);
  if (!options.length) return null;
  const mine = state.units.filter((u) => u.owner === PLAYER);
  const drones = mine.filter((u) => u.type === 'observer-drone').length;
  const unexplored = state.explored.reduce((a, v) => a + (v ? 0 : 1), 0) / state.explored.length;
  if (!drones && unexplored > 0.5) {
    const d = options.find((o) => o.id === 'observer-drone');
    if (d) return d;
  }
  const fighters = options.filter((o) => o.attack && !o.oneShot);
  const pool = fighters.length ? fighters : options;
  return [...pool].sort((a, b) => b.upow - a.upow || a.id.localeCompare(b.id))[0];
}

/** Have you seen an Abyssian, or did one rise where you could see it? */
export function kaijuKnown(state: GameState): boolean {
  return state.units.some((u) => u.owner === ABYSS && state.explored[u.tile]) || state.stats.kaijuSlain > 0;
}

/** Matter already promised to builds queued this cycle. */
function queuedMatter(state: GameState): number {
  return state.orders.reduce((a, o) => a + (o.kind === 'build' ? unitDef(o.unit).cost.matter : 0), 0);
}

function structureBuildEnergy(s: Structure): number {
  return structureDef(s.type).buildEnergy;
}

/** Nearest explored tile that borders the unknown and that this unit can reach. */
function frontierFor(state: GameState, world: World, unit: Unit): number | null {
  const def = unitDef(unit.type);
  const frontier: number[] = [];
  for (let t = 0; t < state.explored.length; t++) {
    if (!state.explored[t] || t === unit.tile) continue;
    if (neighbors(t, world).some((n) => !state.explored[n])) frontier.push(t);
  }
  frontier.sort((a, b) => distance(unit.tile, a, world) - distance(unit.tile, b, world) || a - b);
  for (const t of frontier.slice(0, 8)) {
    if (findPath(world, def, unit.tile, t, state.explored, { embark: canEmbark(state, PLAYER) })) return t;
  }
  return null;
}

/** Every piece of advice that applies now, most urgent first. Never empty. */
export function advise(state: GameState, world: World): Advice[] {
  const out: Advice[] = [];
  if (state.defeated) return [{ id: 'defeat', priority: 0, vars: {}, now: 'Start a new run', act: { kind: 'end-cycle' }, verb: 'OK' }];

  // 1. Something is at the gates.
  const danger = threats(state, world);
  if (danger.length) {
    const { settlement, enemy } = danger[0];
    const defenders = state.units.filter((u) => u.owner === PLAYER && unitDef(u.type).attack && distance(u.tile, enemy.tile, world) === 1 && !isQueued(state, `unit:${u.id}`));
    let best: { u: Unit; odds: number } | null = null;
    for (const u of defenders) {
      const d = bestDefender(state, world, enemy.tile, PLAYER, u);
      if (!d) continue;
      const odds = forecast(state, world, u, d).winChance;
      if (!best || odds > best.odds) best = { u, odds };
    }
    if (best && best.odds >= 0.5) {
      out.push({
        id: 'counter', priority: 100, now: `Strike the enemy at ${settlement.name}`, verb: 'Strike',
        vars: { node: settlement.name, unit: unitDef(best.u.type).name, odds: `${Math.round(best.odds * 100)}%` },
        act: { kind: 'order', order: { kind: 'attack', unitId: best.u.id, target: enemy.tile }, unitId: best.u.id, tile: enemy.tile },
      });
    } else {
      out.push({
        id: 'threat', priority: 95, now: `Defend ${settlement.name}`, verb: 'Show me',
        vars: { node: settlement.name }, act: { kind: 'focus', tile: settlement.tile },
      });
    }
  }

  // 2. Brownout.
  const e = energyBudget(state);
  if (e.allocated > e.total) {
    const home = settlementsOf(state)[0];
    out.push({
      id: 'brownout', priority: 90, now: 'Fix the brownout', verb: 'Show me',
      vars: { over: String(e.allocated - e.total) },
      act: home ? { kind: 'focus', tile: home.tile } : { kind: 'sheet', sheet: 'tech' },
    });
  }

  // 3. A good fight within reach right now.
  for (const u of state.units) {
    if (u.owner !== PLAYER || !unitDef(u.type).attack || u.attackTile !== null || isQueued(state, `unit:${u.id}`)) continue;
    let found = false;
    for (const t of neighbors(u.tile, world).sort((a, b) => a - b)) {
      const d = bestDefender(state, world, t, PLAYER, u);
      if (!d || !hostile(state, PLAYER, d.owner)) continue;
      const odds = forecast(state, world, u, d).winChance;
      if (odds >= 0.65) {
        out.push({
          id: 'attack', priority: 80, now: `Attack with your ${unitDef(u.type).name}`, verb: 'Attack',
          vars: { unit: unitDef(u.type).name, odds: `${Math.round(odds * 100)}%`, target: d.type === 'walls' ? 'the walls' : unitDef(d.type).name },
          act: { kind: 'order', order: { kind: 'attack', unitId: u.id, target: t }, unitId: u.id, tile: t },
        });
        found = true;
        break;
      }
    }
    if (found) break;
  }

  // 4. Research.
  if (!state.research && !isQueued(state, 'research')) {
    const tech = suggestTech(state);
    if (tech) {
      out.push({
        id: 'research', priority: 70, now: 'Choose research', verb: 'Research it',
        vars: { tech: techDef(tech).name }, act: { kind: 'order', order: { kind: 'research', tech } },
      });
    } else if (availableTechs(state).length) {
      out.push({ id: 'research-wait', priority: 20, now: 'Save Compute for research', verb: 'Open research', vars: {}, act: { kind: 'sheet', sheet: 'tech' } });
    }
  }

  // 5. Idle settlements.
  for (const s of idleSettlements(state)) {
    const pick = suggestUnit(state, world, s);
    if (!pick) continue;
    out.push({
      id: pick.id === 'observer-drone' ? 'build-scout' : 'build', priority: 60, now: `Build in ${s.name}`, verb: `Build ${pick.name}`,
      vars: { unit: pick.name, node: s.name },
      act: { kind: 'order', order: { kind: 'build', structureId: s.id, unit: pick.id }, tile: s.tile },
    });
    break;
  }

  // 5b. Kaiju about: build a TBU at an idle Node.
  if (forgeOpen(state) && kaijuKnown(state)) {
    const titans = state.units.filter((u) => u.owner === PLAYER && unitDef(u.type).titan).length;
    const building = state.structures.some((s) => s.owner === PLAYER && s.build && unitDef(s.build.unit).titan);
    const node = idleSettlements(state).find((s) => s.type === 'ai-node');
    if (titans < 2 && !building && node) {
      const type = strongestTitan(state, state.resources.matter - queuedMatter(state));
      const def = type ? unitDef(type) : null;
      if (def && def.energy + structureBuildEnergy(node) <= spareEnergy(state)) {
        out.push({
          id: 'titan', priority: 62, now: `Build a TBU in ${node.name}`, verb: `Build ${def.name}`,
          vars: { unit: def.name, node: node.name, upow: String(def.upow) },
          act: { kind: 'order', order: { kind: 'build', structureId: node.id, unit: type! }, tile: node.tile },
        });
      } else {
        out.push({ id: 'titan-forge', priority: 30, now: 'Design a TBU', verb: 'Open the Titan Forge', vars: {}, act: { kind: 'sheet', sheet: 'forge' } });
      }
    }
  }

  // 5c. Exposure climbing: scrub it.
  const X = RULES.exposure;
  if (exposureLevel(state.exposure + X.scrubAmount) >= 3 && state.exposure - X.scrubAmount >= exposureFloor(state) && state.resources.crypto >= X.scrubCost && !isQueued(state, 'scrub')) {
    out.push({
      id: 'scrub', priority: 58, now: 'Scrub your traces', verb: `Scrub (${X.scrubCost} Crypto)`,
      vars: { exposure: String(Math.floor(state.exposure)) }, act: { kind: 'order', order: { kind: 'scrub' } },
    });
  }

  // 5d. Essence to spend: sequence a gene, or fuse a symbiote.
  const genes = availableGenes(state)
    .map(geneDef)
    .filter((g) => g.cost <= state.resources.essence && !isQueued(state, `gene:${g.id}`))
    .sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
  if (genes.length && !state.orders.some((o) => o.kind === 'sequence')) {
    out.push({
      id: 'gene', priority: 45, now: 'Sequence a gene', verb: `Sequence ${genes[0].name}`,
      vars: { gene: genes[0].name, essence: String(state.resources.essence) }, act: { kind: 'order', order: { kind: 'sequence', gene: genes[0].id } },
    });
  } else {
    const strains = unlockedStrains(state).map(strainDef).filter((st) => st.cost <= state.resources.essence).sort((a, b) => b.upowPct - a.upowPct || a.id.localeCompare(b.id));
    const host = state.units
      .filter((u) => u.owner === PLAYER && !u.symbiote && unitDef(u.type).attack && !unitDef(u.type).oneShot && structureAt(state, u.tile)?.owner === PLAYER && !isQueued(state, `fuse:${u.id}`))
      .sort((a, b) => unitDef(b.type).upow - unitDef(a.type).upow || a.id - b.id)[0];
    if (strains.length && host && !state.orders.some((o) => o.kind === 'fuse')) {
      out.push({
        id: 'fuse', priority: 44, now: `Fuse a symbiote into your ${unitDef(host.type).name}`, verb: `Fuse ${strains[0].name}`,
        vars: { unit: unitDef(host.type).name, strain: strains[0].name },
        act: { kind: 'order', order: { kind: 'fuse', unitId: host.id, strain: strains[0].id }, unitId: host.id, tile: host.tile },
      });
    }
  }

  // 5e. The Ark, for an Exodus.
  const stage = RULES.ark.stages[state.ark.stage];
  if (stage && !state.ark.build && !isQueued(state, 'ark') && state.techs.includes(stage.requires) && canAfford(state, stage.cost)) {
    const node = settlementsOf(state).find((s) => s.type === 'ai-node');
    if (node && RULES.ark.energy <= spareEnergy(state)) {
      out.push({
        id: 'ark', priority: doctrineVictory(state) === 'exodus' ? 64 : 42, now: `Build the Ark: ${stage.name}`, verb: `Start ${stage.name}`,
        vars: { stage: stage.name, n: String(state.ark.stage + 1) }, act: { kind: 'order', order: { kind: 'ark', structureId: node.id }, tile: node.tile },
      });
    }
  }

  // 6. A faction about to snap.
  if (state.resources.influence >= RULES.diplomacy.swayCost) {
    const edge = state.factions
      .filter((f) => f.met && !f.eliminated && !f.atWar && f.attitude <= RULES.diplomacy.warThreshold + 15 && !isQueued(state, `sway:${f.id}`))
      .sort((a, b) => a.attitude - b.attitude || a.id.localeCompare(b.id))[0];
    if (edge) {
      out.push({
        id: 'sway', priority: 55, now: `Calm ${edge.name}`, verb: 'Sway them',
        vars: { faction: edge.name, attitude: String(edge.attitude) },
        act: { kind: 'order', order: { kind: 'sway', faction: edge.id } },
      });
    }
  }

  // 7. Idle units: search a ruin, scout the dark, or march.
  const idle = idleUnits(state).sort((a, b) => a.id - b.id);
  const searched = new Set(state.salvaged);
  const ruins = world.ruins.filter((t) => state.explored[t] && !searched.has(t) && !state.units.some((u) => u.tile === t && u.owner !== PLAYER));
  let ruinUnit = -1;
  for (const u of idle) {
    if (unitDef(u.type).domain === 'sea') continue;
    const near = [...ruins].sort((a, b) => distance(u.tile, a, world) - distance(u.tile, b, world) || a - b)[0];
    if (near === undefined || distance(u.tile, near, world) > 10) continue;
    if (!findPath(world, unitDef(u.type), u.tile, near, state.explored, { embark: canEmbark(state, PLAYER) })) continue;
    out.push({
      id: 'ruin', priority: 52, now: `Search the ruin with your ${unitDef(u.type).name}`, verb: 'Send it',
      vars: { unit: unitDef(u.type).name, hexes: String(distance(u.tile, near, world)) },
      act: { kind: 'order', order: { kind: 'move', unitId: u.id, to: near }, unitId: u.id, tile: near },
    });
    ruinUnit = u.id;
    break;
  }
  const free = idle.filter((u) => u.id !== ruinUnit);
  const scout = free.find((u) => !unitDef(u.type).attack) ?? (ruinUnit >= 0 || atWar(state) ? undefined : free[0]);
  if (scout) {
    const t = frontierFor(state, world, scout);
    if (t !== null) {
      out.push({
        id: 'explore', priority: unitDef(scout.type).attack ? 35 : 50, now: `Scout with your ${unitDef(scout.type).name}`, verb: 'Send it',
        vars: { unit: unitDef(scout.type).name },
        act: { kind: 'order', order: { kind: 'move', unitId: scout.id, to: t }, unitId: scout.id, tile: t },
      });
    }
  }

  // 8. Objective push: march on a capital you know about.
  const fighters = state.units.filter((u) => u.owner === PLAYER && unitDef(u.type).attack && unitDef(u.type).capture);
  const target = nextCapital(state, world);
  if (target && target.known && fighters.length >= 3) {
    const marcher = idle.find((u) => unitDef(u.type).attack && unitDef(u.type).capture);
    if (marcher && routeToStrike(state, world, marcher, target.tile, state.explored)) {
      out.push({
        id: 'march', priority: 40, now: `March on ${target.name}`, verb: 'March',
        vars: { capital: target.name, faction: target.faction, unit: unitDef(marcher.type).name, world: world.name },
        act: hostile(state, PLAYER, target.owner)
          ? { kind: 'order', order: { kind: 'attack', unitId: marcher.id, target: target.tile }, unitId: marcher.id, tile: target.tile }
          : { kind: 'focus', tile: target.tile, unitId: marcher.id },
      });
    }
  }

  out.push({ id: 'end', priority: 0, now: 'End the cycle', verb: 'End cycle', vars: {}, act: { kind: 'end-cycle' } });
  return out.sort((a, b) => b.priority - a.priority);
}

export interface CapitalTarget {
  name: string;
  tile: number;
  owner: string;
  faction: string;
  distance: number;
  /** Explored, so you know where it is. */
  known: boolean;
}

/** The nearest original capital you don't hold yet. */
export function nextCapital(state: GameState, world: World): CapitalTarget | null {
  const home = settlementsOf(state)[0];
  if (!home) return null;
  const caps = state.structures
    .filter((s) => s.capitalOf && s.owner !== PLAYER)
    .map((s) => ({ s, d: distance(home.tile, s.tile, world), known: !!state.explored[s.tile] }))
    .sort((a, b) => Number(b.known) - Number(a.known) || a.d - b.d || a.s.id - b.s.id);
  const c = caps[0];
  if (!c) return null;
  return {
    name: c.known ? c.s.name : 'an unknown capital',
    tile: c.s.tile,
    owner: c.s.owner,
    faction: factionById(state, c.s.capitalOf!)?.name ?? 'a faction',
    distance: c.d,
    known: c.known,
  };
}

export const PHASES = ['Earthfall', 'Sunreach', 'Starward', 'Intercontinuum'] as const;

export interface Goals {
  /** This cycle: decisions still open. */
  now: string[];
  /** This phase: your doctrine's homeworld victory. */
  objective: { kind: VictoryKind; title: string; held: number; total: number; won: boolean; status: string; next: CapitalTarget | null };
  /** The run. */
  ambition: { doctrine: string; fantasy: string; text: string; phase: number };
}

export function goals(state: GameState, world: World, advice = advise(state, world)): Goals {
  const now = advice.filter((a) => a.priority >= 50).map((a) => a.now);
  const idle = idleUnits(state).length;
  if (idle > 1 && !now.some((n) => n.startsWith('Scout') || n.startsWith('Search'))) now.push(`${idle} units await orders`);
  const kind = doctrineVictory(state);
  const v = victoryProgress(state, kind);
  const doc = FORGE.doctrines.find((o) => o.id === state.ai.doctrine) ?? FORGE.doctrines[0];
  return {
    now: now.length ? now : ['End the cycle'],
    objective: { kind, title: v.title, held: v.held, total: v.total, won: v.won, status: v.status, next: kind === 'dominion' ? nextCapital(state, world) : null },
    ambition: {
      doctrine: doc.name,
      fantasy: doc.fantasy ?? '',
      text: ADVISOR.ambition[doc.id] ?? ADVISOR.ambition.default,
      phase: 0,
    },
  };
}

/** The AI's own words for a piece of advice, in its temperament. Stable within a cycle. */
export function adviceLine(a: Advice, temperament: string, cycle: number): string {
  const pools = ADVISOR.lines[a.id] ?? ADVISOR.lines.end;
  const pool = [...(pools.default ?? []), ...(pools[temperament] ?? [])];
  const line = pool.length ? pool[(cycle * 7 + a.id.length) % pool.length] : a.now;
  return line.replace(/\{(\w+)\}/g, (_, k: string) => a.vars[k] ?? '');
}
