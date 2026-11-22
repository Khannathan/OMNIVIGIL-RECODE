// The homeworld's factions: their production, their armies' simple minds,
// their opinion of you, and their wars with you and with each other.
// Everything draws from the 'factions' RNG stream, so it is deterministic.

import { archetypeDef, RULES, unitDef } from '../content';
import { actUnit, blockedTiles, Ctx, declareWar, makePeace, removeUnit, routeToStrike } from './actions';
import { bestDefender, forecast } from './combat';
import { mods } from './effects';
import { crusade, exposureAttitude } from './exposure';
import { distance, hexesInRange } from './hex';
import { enterCost, findPath } from './path';
import { Rng } from './rng';
import {
  ABYSS,
  clampAttitude,
  FactionState,
  hostile,
  pickFactionUnit,
  PLAYER,
  spawnUnit,
  Structure,
  territory,
  Unit,
} from './state';

export function factionPhase(ctx: Ctx, rng: Rng): void {
  for (const f of ctx.state.factions) {
    if (f.eliminated) continue;
    produce(ctx, f, rng);
    const army = ctx.state.units.filter((u) => u.owner === f.id).sort((a, b) => a.id - b.id);
    for (const u of army) {
      if (!ctx.state.units.includes(u)) continue; // fell earlier this cycle
      think(ctx, f, u, rng);
      actUnit(ctx, u);
    }
  }
}

function citiesOf(ctx: Ctx, f: FactionState): Structure[] {
  return ctx.state.structures.filter((s) => s.owner === f.id);
}

function produce(ctx: Ctx, f: FactionState, rng: Rng): void {
  const { state } = ctx;
  const cfg = RULES.factions;
  const cities = citiesOf(ctx, f);
  if (!cities.length) return;
  f.prod += cities.reduce((a, c) => a + cfg.prodBase + c.stage * cfg.prodPerStage, 0);
  const count = state.units.filter((u) => u.owner === f.id).length;
  const cap = cfg.unitCapBase + cfg.unitCapPerCity * cities.length;
  const cost = unitDef(f.nextUnit).cost.matter;
  if (count >= cap) {
    f.prod = Math.min(f.prod, cost);
    return;
  }
  if (f.prod < cost) return;
  // Reinforce the emptiest city, capital first on a tie.
  const load = (c: Structure) => state.units.filter((u) => u.tile === c.tile).length;
  const home = [...cities].sort((a, b) => load(a) - load(b) || (b.capitalOf ? 1 : 0) - (a.capitalOf ? 1 : 0) || a.id - b.id)[0];
  spawnUnit(state, f.nextUnit, home.tile, f.id);
  f.prod -= cost;
  f.nextUnit = pickFactionUnit(f.archetype, state.cycle, rng);
}

/** Is there something of an enemy's on this tile worth attacking? */
function enemyAt(ctx: Ctx, owner: string, tile: number): boolean {
  const { state } = ctx;
  if (state.units.some((u) => u.tile === tile && hostile(state, owner, u.owner))) return true;
  const s = state.structures.find((x) => x.tile === tile);
  return !!s && hostile(state, owner, s.owner);
}

function think(ctx: Ctx, f: FactionState, u: Unit, rng: Rng): void {
  const { state, world } = ctx;
  const cfg = RULES.factions;
  const def = unitDef(u.type);
  const cities = citiesOf(ctx, f);
  // Kaiju ashore count as a war: everyone takes up arms.
  const abyssNear = state.units.some((o) => o.owner === ABYSS && distance(o.tile, u.tile, world) <= cfg.huntRadius);
  const atWar = f.atWar || f.wars.length > 0 || abyssNear;

  // Garrison: the first unit on each city stays home unless a fight is next door and winnable.
  const onCity = cities.find((c) => c.tile === u.tile);
  const garrison = !!onCity && state.units.filter((x) => x.owner === f.id && x.tile === u.tile).sort((a, b) => a.id - b.id)[0] === u;

  if (atWar && def.attack) {
    // Strike anything adjacent we can probably beat.
    const adjacent = hexesInRange(u.tile, 1, world).filter((t) => t !== u.tile && enemyAt(ctx, f.id, t));
    for (const t of adjacent.sort((a, b) => a - b)) {
      const d = bestDefender(state, world, t, f.id, u);
      const odds = d ? forecast(state, world, u, d).winChance : 1;
      const need = garrison ? cfg.attackOdds + 0.15 : cfg.attackOdds;
      if (!d && !def.capture) continue;
      if (odds >= need) {
        u.route = [];
        u.attackTile = t;
        return;
      }
    }
    if (garrison) {
      u.route = [];
      u.attackTile = null;
      return;
    }
    // Keep marching on a target that is still there.
    if (u.attackTile !== null && enemyAt(ctx, f.id, u.attackTile) && u.hp >= 40) {
      const r = routeToStrike(state, world, u, u.attackTile);
      if (r) {
        u.route = r;
        return;
      }
    }
    u.attackTile = null;
    if (u.hp >= 50) {
      const target = pickTarget(ctx, f, u, rng);
      if (target !== null) {
        const r = routeToStrike(state, world, u, target);
        if (r) {
          u.route = r;
          u.attackTile = target;
          return;
        }
      }
    }
  } else if (garrison) {
    u.route = [];
    u.attackTile = null;
    return;
  }

  // Nothing to fight: heal at home, or patrol the territory.
  u.attackTile = null;
  if (!cities.length) return;
  const home = [...cities].sort((a, b) => distance(u.tile, a.tile, world) - distance(u.tile, b.tile, world) || a.id - b.id)[0];
  const away = distance(u.tile, home.tile, world);
  if (u.hp < 60 || away > cfg.territoryRadius + 1) {
    u.route = away === 0 ? [] : findPath(world, def, u.tile, home.tile, undefined, { blocked: blockedTiles(state, f.id) }) ?? [];
    return;
  }
  if (rng.chance(0.3)) {
    const spots = hexesInRange(home.tile, cfg.territoryRadius, world).filter(
      (t) => t !== u.tile && enterCost(def, world.terrain[t]) !== null && !state.units.some((o) => o.tile === t && o.owner !== f.id) && !state.structures.some((s) => s.tile === t && s.owner !== f.id),
    );
    if (spots.length) {
      const to = rng.pick(spots.sort((a, b) => a - b));
      u.route = findPath(world, def, u.tile, to, undefined, { blocked: blockedTiles(state, f.id) }) ?? [];
    }
  } else {
    u.route = [];
  }
}

/** Nearest enemy within the hunting radius, or (when on the march) the nearest enemy settlement anywhere. */
function pickTarget(ctx: Ctx, f: FactionState, u: Unit, rng: Rng): number | null {
  const { state, world } = ctx;
  const def = unitDef(u.type);
  const cfg = RULES.factions;
  let best: number | null = null;
  let bestD = Infinity;
  const consider = (tile: number, bonus: number) => {
    const d = distance(u.tile, tile, world) - bonus;
    if (d < bestD || (d === bestD && best !== null && tile < best)) {
      best = tile;
      bestD = d;
    }
  };
  for (const o of state.units) {
    if (!hostile(state, f.id, o.owner)) continue;
    if (distance(u.tile, o.tile, world) <= cfg.huntRadius) consider(o.tile, 0);
  }
  const march = rng.chance(archetypeDef(f.archetype).aggression * 0.35);
  for (const s of state.structures) {
    if (!hostile(state, f.id, s.owner)) continue;
    const d = distance(u.tile, s.tile, world);
    if (d <= cfg.huntRadius || march) consider(s.tile, def.capture ? 2 : 0);
  }
  return best;
}

/** Opinion drift, trespassing, war declarations, and wars between factions. */
export function diplomacyPhase(ctx: Ctx, rng: Rng): void {
  const { state, world, events } = ctx;
  const cfg = RULES.diplomacy;
  const terr = territory(state, world);
  const bonus = mods(state).attitude + exposureAttitude(state);
  const united = crusade(state);
  for (const f of state.factions) {
    if (f.eliminated) continue;
    const base = archetypeDef(f.archetype).baseAttitude + bonus;
    let delta = f.attitude < base ? Math.min(cfg.driftPerCycle, base - f.attitude) : f.attitude > base ? -Math.min(cfg.driftPerCycle, f.attitude - base) : 0;
    if (!f.atWar) {
      const trespassers = state.units.filter((u) => u.owner === PLAYER && terr.get(u.tile) === f.id).length;
      delta += trespassers * cfg.trespassPerUnit;
    }
    f.attitude = clampAttitude(f.attitude + delta);
    if (!f.atWar && (f.attitude <= cfg.warThreshold || united)) declareWar(state, events, f.id, PLAYER, f.id);
  }
  if (united) return; // the Crusade holds: no wars between them
  const alive = state.factions.filter((f) => !f.eliminated);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];
      const roll = rng.next();
      if (a.wars.includes(b.id)) {
        if (roll < RULES.factions.peaceChance) makePeace(state, events, a.id, b.id);
      } else if (roll < RULES.factions.warChance) {
        declareWar(state, events, a.id, b.id, a.id);
      }
    }
  }
}

/** Factions with no cities left fall; their armies scatter. */
export function eliminationPhase(ctx: Ctx): void {
  const { state, events } = ctx;
  for (const f of state.factions) {
    if (f.eliminated || state.structures.some((s) => s.owner === f.id)) continue;
    f.eliminated = true;
    f.atWar = false;
    for (const u of state.units.filter((x) => x.owner === f.id)) removeUnit(state, u);
    for (const o of state.factions) o.wars = o.wars.filter((x) => x !== f.id);
    f.wars = [];
    events.push({ kind: 'eliminated', faction: f.id });
  }
}
