// The cycle: Sense, Decide, Resolve, Watch, Reckon.
//
// The sim owns Decide (orders go into a queue) and Resolve + Reckon (the
// world acts, then spoils and events are tallied). Sense and Watch are
// presentation: the UI shows what changed and replays the events as
// animation. Resolve is a pure function of (state, world, orders) and the
// seeded RNG streams, so the same orders always give the same result, which
// is what online play will need later.

import narratorData from '../content/narrator.json';
import { RULES, structureDef, techDef, TERRAIN, unitDef } from '../content';
import { actUnit, Ctx, declareWar, makePeace, removeUnit, routeToStrike } from './actions';
import { mods } from './effects';
import { diplomacyPhase, eliminationPhase, factionPhase } from './factions';
import { hexesInRange } from './hex';
import { findPath } from './path';
import { Rng } from './rng';
import {
  availableTechs,
  buildableUnits,
  canEmbark,
  clampAttitude,
  dominionProgress,
  factionById,
  GameEvent,
  GameState,
  hostile,
  isBrownout,
  meetFactions,
  Order,
  PLAYER,
  revealAround,
  spawnUnit,
  structureAt,
  structureById,
  unitById,
  workRadius,
} from './state';
import { World } from './worldgen';

export interface CycleReport {
  cycle: number;
  events: GameEvent[];
  narration: string;
}

/** Decide: adds an order. A newer order for the same unit, structure or faction replaces the old one. */
export function queueOrder(state: GameState, order: Order): void {
  state.orders = state.orders.filter((o) => orderKey(o) !== orderKey(order));
  state.orders.push(order);
}

export function orderKey(o: Order): string {
  switch (o.kind) {
    case 'move':
    case 'attack':
    case 'disband':
      return `unit:${o.unitId}`;
    case 'build':
    case 'cancel-build':
      return `structure:${o.structureId}`;
    case 'research':
      return 'research';
    case 'sway':
      return `sway:${o.faction}`;
    case 'declare-war':
    case 'peace':
      return `stance:${o.faction}`;
    case 'incite':
      return `incite:${o.faction}`;
  }
}

/** Resolve + Reckon. Mutates state and returns what happened. */
export function resolveCycle(state: GameState, world: World): CycleReport {
  const events: GameEvent[] = [];
  const sim = Rng.restore(state.rng.sim);
  const frng = Rng.restore(state.rng.factions);
  const ctx: Ctx = { state, world, events, combat: Rng.restore(state.rng.combat), acted: new Set() };
  const m = mods(state);

  // 1. Your orders, in the order they were given.
  for (const order of state.orders) applyOrder(ctx, order);
  state.orders = [];

  const brownout = isBrownout(state);
  const rate = brownout ? 0.5 : 1;

  // 2. Your units move and strike, by id.
  for (const unit of state.units.filter((u) => u.owner === PLAYER).sort((a, b) => a.id - b.id)) {
    if (state.units.includes(unit)) actUnit(ctx, unit);
  }

  // 3. The factions answer.
  factionPhase(ctx, frng);

  // 4. Production.
  for (const s of state.structures) {
    if (s.owner !== PLAYER || !s.build) continue;
    s.build.progress = round2(s.build.progress + rate * (1 + m.build / 100));
    const def = unitDef(s.build.unit);
    if (s.build.progress >= def.buildCycles) {
      const u = spawnUnit(state, s.build.unit, s.tile, PLAYER);
      events.push({ kind: 'built', unitId: u.id, unit: u.type, tile: s.tile });
      s.build = null;
    }
  }

  // 5. Research.
  if (state.research) {
    const r = state.research;
    r.progress = round2(r.progress + rate * (1 + m.research / 100));
    if (r.progress >= techDef(r.tech).cycles) {
      state.techs.push(r.tech);
      events.push({ kind: 'tech-done', tech: r.tech });
      state.research = null;
    }
  }

  // 6. Units that held still mend.
  const heal = mods(state).heal;
  for (const u of state.units) {
    if (ctx.acted.has(u.id) || u.hp >= 100) continue;
    const home = structureAt(state, u.tile);
    let h = home && home.owner === u.owner ? RULES.heal.inSettlement : RULES.heal.base;
    if (u.owner === PLAYER) h += heal;
    u.hp = Math.min(100, u.hp + h);
  }
  for (const s of state.structures) {
    if (!ctx.acted.has(-s.id)) s.hp = Math.min(100, s.hp + RULES.walls.healPerCycle);
  }

  // 7. Yields from worked hexes (each hex counts once).
  const after = mods(state);
  const worked = new Set<number>();
  let compute = 0;
  let matter = 0;
  let influence = 0;
  for (const s of state.structures) {
    if (s.owner !== PLAYER) continue;
    for (const t of hexesInRange(s.tile, workRadius(state, s), world)) worked.add(t);
    const where = s.type === 'ai-node' ? 'node' : 'city';
    compute += after.yieldFlat[where].compute;
    matter += after.yieldFlat[where].matter;
    influence += after.yieldFlat[where].influence + RULES.influence[where];
  }
  for (const t of worked) {
    const y = TERRAIN[world.terrain[t]].yields;
    compute += y.compute;
    matter += y.matter;
  }
  compute = Math.floor(compute * (1 + after.yieldPct.compute / 100) * rate);
  matter = Math.floor(matter * (1 + after.yieldPct.matter / 100) * rate);
  influence = Math.floor(influence * (1 + after.yieldPct.influence / 100) * rate);
  state.resources.compute += compute;
  state.resources.matter += matter;
  state.resources.influence += influence;
  state.stats.computeEarned += compute;
  events.push({ kind: 'yield', compute, matter, influence, brownout });

  // 8. Growth: Nodes grow with Compute earned, cities with time.
  const stages = RULES.growth.nodeStageComputeEarned;
  for (const s of state.structures) {
    const max = structureDef(s.type).stages;
    if (s.type === 'ai-node') {
      let stage = 1;
      for (let i = 0; i < stages.length; i++) if (state.stats.computeEarned >= stages[i]) stage = i + 1;
      s.stage = Math.max(s.stage, Math.min(stage, max));
    } else if (s.stage < Math.min(max, RULES.growth.cityMaxStage) && state.cycle - (s.grewAt ?? 0) >= RULES.growth.cityGrowEvery) {
      s.stage++;
      s.grewAt = state.cycle;
    }
  }

  // 9. Opinion, wars, falls.
  diplomacyPhase(ctx, frng);
  eliminationPhase(ctx);

  // 10. Discovery and first contact.
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
  meetFactions(state, world, events);

  // 11. Endings. Victory can be played past.
  if (!state.victory) {
    const d = dominionProgress(state);
    if (d.total > 0 && d.held === d.total) {
      state.victory = { kind: 'dominion', cycle: state.cycle };
      events.push({ kind: 'victory', victory: 'dominion' });
    }
  }
  if (!state.defeated && !state.structures.some((s) => s.owner === PLAYER)) {
    state.defeated = true;
    events.push({ kind: 'defeat' });
  }

  // 12. Reckon: the AI's own voice.
  const narration = narrate(state, events, sim, world.name);

  state.cycle += 1;
  state.lastEvents = events;
  state.rng = { sim: sim.state(), combat: ctx.combat.state(), factions: frng.state() };
  return { cycle: state.cycle - 1, events, narration };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function applyOrder(ctx: Ctx, order: Order): void {
  const { state, world, events } = ctx;
  const reject = (reason: string): void => {
    events.push({ kind: 'order-rejected', order, reason });
  };
  const D = RULES.diplomacy;
  switch (order.kind) {
    case 'move': {
      const unit = unitById(state, order.unitId);
      if (!unit || unit.owner !== PLAYER) return reject('no such unit');
      const path = findPath(world, unitDef(unit.type), unit.tile, order.to, state.explored, { embark: canEmbark(state, PLAYER) });
      if (!path) return reject('unreachable');
      unit.route = path;
      unit.attackTile = null;
      return;
    }
    case 'attack': {
      const unit = unitById(state, order.unitId);
      if (!unit || unit.owner !== PLAYER) return reject('no such unit');
      if (!unitDef(unit.type).attack) return reject(`${unitDef(unit.type).name} cannot attack`);
      const owner = targetOwner(ctx, order.target);
      if (!owner) return reject('nothing to attack there');
      if (!hostile(state, PLAYER, owner)) declareWar(state, events, PLAYER, owner, PLAYER);
      const route = routeToStrike(state, world, unit, order.target, state.explored);
      if (!route) return reject('no way to reach the target');
      unit.route = route;
      unit.attackTile = order.target;
      return;
    }
    case 'disband': {
      const unit = unitById(state, order.unitId);
      if (!unit || unit.owner !== PLAYER) return reject('no such unit');
      removeUnit(state, unit);
      events.push({ kind: 'disbanded', unit: unit.type });
      return;
    }
    case 'build': {
      const s = structureById(state, order.structureId);
      if (!s || s.owner !== PLAYER) return reject('no such settlement');
      const def = unitDef(order.unit);
      if (s.build) return reject('already building');
      if (!buildableUnits(state, world, s).includes(def.id)) return reject(`${def.name} is not available there`);
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
      if (!s || !s.build || s.owner !== PLAYER) return reject('nothing to cancel');
      state.resources.matter += unitDef(s.build.unit).cost.matter;
      s.build = null;
      return;
    }
    case 'research': {
      if (state.research) return reject('already researching');
      if (!availableTechs(state).includes(order.tech)) return reject('that tech is not available');
      const t = techDef(order.tech);
      if (state.resources.compute < t.cost) return reject('not enough Compute');
      state.resources.compute -= t.cost;
      state.research = { tech: t.id, progress: 0 };
      events.push({ kind: 'research-started', tech: t.id });
      return;
    }
    case 'sway': {
      const f = factionById(state, order.faction);
      if (!f || !f.met || f.eliminated) return reject('unknown faction');
      if (state.resources.influence < D.swayCost) return reject('not enough Influence');
      state.resources.influence -= D.swayCost;
      f.attitude = clampAttitude(f.attitude + D.swayGain + mods(state).sway);
      events.push({ kind: 'sway', faction: f.id, attitude: f.attitude });
      return;
    }
    case 'declare-war': {
      const f = factionById(state, order.faction);
      if (!f || !f.met || f.eliminated) return reject('unknown faction');
      declareWar(state, events, PLAYER, f.id, PLAYER);
      return;
    }
    case 'peace': {
      const f = factionById(state, order.faction);
      if (!f || !f.atWar) return reject('not at war');
      if (f.attitude < D.peaceMinAttitude) return reject(`${f.name} will not talk yet`);
      if (state.resources.influence < D.peaceCost) return reject('not enough Influence');
      state.resources.influence -= D.peaceCost;
      makePeace(state, events, PLAYER, f.id);
      return;
    }
    case 'incite': {
      const f = factionById(state, order.faction);
      const g = factionById(state, order.against);
      if (!f || !g || f === g || !f.met || f.eliminated || g.eliminated) return reject('unknown faction');
      if (f.atWar) return reject(`${f.name} is at war with you`);
      if (f.attitude < D.inciteMinAttitude) return reject(`${f.name} does not trust you enough`);
      if (f.wars.includes(g.id)) return reject('already at war');
      if (state.resources.influence < D.inciteCost) return reject('not enough Influence');
      state.resources.influence -= D.inciteCost;
      declareWar(state, events, f.id, g.id, PLAYER);
      return;
    }
  }
}

/** Whose is the thing on this tile (units first, then a settlement)? */
function targetOwner(ctx: Ctx, tile: number): string | null {
  const u = ctx.state.units.find((x) => x.tile === tile && x.owner !== PLAYER);
  if (u) return u.owner;
  const s = structureAt(ctx.state, tile);
  return s && s.owner !== PLAYER ? s.owner : null;
}

type Pools = typeof narratorData;

function narrate(state: GameState, events: GameEvent[], rng: Rng, worldName: string): string {
  const L: Pools = narratorData;
  const fname = (id: string) => factionById(state, id)?.name ?? 'them';
  const fill = (line: string, vars: Record<string, string> = {}) =>
    line.replace('{world}', worldName).replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
  const find = <K extends GameEvent['kind']>(kind: K) => events.find((e) => e.kind === kind) as Extract<GameEvent, { kind: K }> | undefined;

  const victory = find('victory');
  if (victory) return fill(rng.pick(L.victory));
  if (find('defeat')) return fill(rng.pick(L.defeat));
  const gone = find('eliminated');
  if (gone) return fill(rng.pick(L.eliminated), { faction: fname(gone.faction) });
  const taken = events.find((e) => e.kind === 'city-captured' && e.by === PLAYER);
  if (taken && taken.kind === 'city-captured') return fill(rng.pick(L.cityTaken), { city: taken.name });
  const lost = events.find((e) => (e.kind === 'city-captured' && e.from === PLAYER) || e.kind === 'node-razed');
  if (lost && (lost.kind === 'city-captured' || lost.kind === 'node-razed')) return fill(rng.pick(L.cityLost), { city: lost.name });
  const war = events.find((e) => e.kind === 'war' && (e.a === PLAYER || e.b === PLAYER));
  if (war && war.kind === 'war') return fill(rng.pick(L.war), { faction: fname(war.a === PLAYER ? war.b : war.a) });
  const peace = events.find((e) => e.kind === 'peace' && (e.a === PLAYER || e.b === PLAYER));
  if (peace && peace.kind === 'peace') return fill(rng.pick(L.peace), { faction: fname(peace.a === PLAYER ? peace.b : peace.a) });
  const fights = events.filter((e) => e.kind === 'combat' && (e.attackerOwner === PLAYER || e.defenderOwner === PLAYER));
  if (fights.length) {
    const won = fights.filter((e) => e.kind === 'combat' && (e.attackerOwner === PLAYER) === e.attackerWon).length;
    return fill(rng.pick(won * 2 >= fights.length ? L.combatWon : L.combatLost));
  }
  const tech = find('tech-done');
  if (tech) return fill(rng.pick(L.tech), { tech: techDef(tech.tech).name });
  const disc = find('discovered');
  if (disc && disc.rifts > 0) return fill(rng.pick(L.discoverRift));
  if (disc && disc.ruins > 0) return fill(rng.pick(L.discoverRuins));
  if (events.some((e) => e.kind === 'yield' && e.brownout)) return fill(rng.pick(L.brownout));
  if (events.some((e) => e.kind === 'built')) return fill(rng.pick(L.built));
  const mood = (L.byTemperament as Record<string, string[]>)[state.ai.temperament] ?? [];
  return fill(rng.pick([...L.idle, ...mood]));
}

export function wakeLine(seed: string, worldName: string): string {
  return Rng.stream(seed, 'wake').pick(narratorData.wake).replace('{world}', worldName);
}
