// What a unit does during Resolve: walk its route, then strike the tile it
// was told to attack. Shared by your units and the factions' armies, so both
// play by exactly the same rules.

import { RULES, unitDef } from '../content';
import { bestDefender, fight, forecast, WALLS } from './combat';
import { distance, neighbors } from './hex';
import { enterCost, findPath } from './path';
import { Rng } from './rng';
import {
  canEmbark,
  clampAttitude,
  factionById,
  GameEvent,
  GameState,
  hostile,
  Owner,
  PLAYER,
  structureAt,
  Structure,
  Unit,
  unitSpeed,
} from './state';
import { World } from './worldgen';

export interface Ctx {
  state: GameState;
  world: World;
  events: GameEvent[];
  combat: Rng;
  /** Units that moved or fought this cycle (they don't heal). */
  acted: Set<number>;
}

/** May this unit step onto that tile right now? */
export function canEnter(state: GameState, unit: Unit, tile: number): boolean {
  for (const o of state.units) if (o.tile === tile && o.owner !== unit.owner) return false;
  const s = structureAt(state, tile);
  if (s && s.owner !== unit.owner) return hostile(state, unit.owner, s.owner) && unitDef(unit.type).capture && s.hp <= 0;
  return true;
}

/** Tiles a route should avoid: foreign units and foreign settlements. */
export function blockedTiles(state: GameState, owner: Owner): Set<number> {
  const out = new Set<number>();
  for (const u of state.units) if (u.owner !== owner) out.add(u.tile);
  for (const s of state.structures) if (s.owner !== owner) out.add(s.tile);
  return out;
}

/**
 * Route to a hex next to `target`, from where the unit can strike it.
 * Returns [] when already adjacent, null when there is no way in.
 */
export function routeToStrike(state: GameState, world: World, unit: Unit, target: number, known?: Uint8Array): number[] | null {
  if (distance(unit.tile, target, world) === 1) return [];
  const def = unitDef(unit.type);
  const opts = { embark: canEmbark(state, unit.owner), blocked: blockedTiles(state, unit.owner) };
  const spots = neighbors(target, world)
    .filter((n) => enterCost(def, world.terrain[n], opts) !== null && (n === unit.tile || !opts.blocked.has(n)))
    .sort((a, b) => distance(unit.tile, a, world) - distance(unit.tile, b, world) || a - b);
  let best: number[] | null = null;
  for (const n of spots.slice(0, 3)) {
    if (n === unit.tile) return [];
    const p = findPath(world, def, unit.tile, n, known, opts);
    if (p && (!best || p.length < best.length)) best = p;
  }
  return best;
}

export function removeUnit(state: GameState, unit: Unit): void {
  state.units = state.units.filter((u) => u !== unit);
}

/** Walk the route as far as movement allows, then attack if in reach. */
export function actUnit(ctx: Ctx, unit: Unit): void {
  const { state, world } = ctx;
  const def = unitDef(unit.type);
  const full = unitSpeed(state, unit);
  const opts = { embark: canEmbark(state, unit.owner) };
  let mp = full;
  const path: number[] = [];
  while (unit.route.length && mp > 0) {
    const next = unit.route[0];
    const c = enterCost(def, world.terrain[next], opts);
    if (c === null) {
      unit.route = [];
      break;
    }
    if (c > mp && mp < full) break; // Civ rule: full movement can always take one step
    if (!canEnter(state, unit, next)) break; // blocked: try again next cycle
    unit.route.shift();
    unit.tile = next;
    path.push(next);
    mp -= c;
    const s = structureAt(state, next);
    if (s && s.owner !== unit.owner) {
      capture(ctx, s, unit.owner);
      unit.route = [];
    }
  }
  if (path.length) {
    ctx.events.push({ kind: 'moved', unitId: unit.id, owner: unit.owner, path });
    ctx.acted.add(unit.id);
  }
  if (unit.attackTile !== null && mp > 0) strike(ctx, unit);
}

function strike(ctx: Ctx, unit: Unit): void {
  const { state, world } = ctx;
  const target = unit.attackTile!;
  if (distance(unit.tile, target, world) !== 1) {
    if (!unit.route.length) unit.attackTile = null; // lost the way
    return;
  }
  unit.route = [];
  unit.attackTile = null;
  const def = unitDef(unit.type);
  const defender = bestDefender(state, world, target, unit.owner);
  if (!defender) {
    // Nobody home: walk in and take it.
    const s = structureAt(state, target);
    if (s && s.owner !== unit.owner && canEnter(state, unit, target) && enterCost(def, world.terrain[target], { embark: canEmbark(state, unit.owner) }) !== null) {
      unit.tile = target;
      ctx.events.push({ kind: 'moved', unitId: unit.id, owner: unit.owner, path: [target] });
      ctx.acted.add(unit.id);
      capture(ctx, s, unit.owner);
    }
    return;
  }
  if (!def.attack || !hostile(state, unit.owner, defender.owner)) return;

  const fc = forecast(state, world, unit, defender);
  const r = fight(fc, ctx.combat);
  unit.hp = r.attackerHp;
  defender.hp = r.defenderHp;
  ctx.acted.add(unit.id);
  ctx.acted.add(defender.id);
  ctx.events.push({
    kind: 'combat',
    attackerId: unit.id,
    defenderId: defender.id,
    attackerType: unit.type,
    defenderType: defender.type,
    attackerOwner: unit.owner,
    defenderOwner: defender.owner,
    from: unit.tile,
    tile: target,
    winChance: fc.winChance,
    attackerWon: r.attackerWon,
    attackerHp: r.attackerHp,
    defenderHp: r.defenderHp,
  });
  const loser = r.attackerWon ? defender : unit;
  if (defender.type === WALLS) {
    structureAt(state, target)!.hp = r.defenderHp;
    if (!r.attackerWon) {
      removeUnit(state, unit);
      if (unit.owner === PLAYER) state.stats.losses++;
    }
  } else {
    removeUnit(state, loser);
    if (loser.owner === PLAYER) state.stats.losses++;
    else if ((r.attackerWon ? unit : defender).owner === PLAYER) state.stats.kills++;
  }

  if (def.oneShot && r.attackerWon) {
    removeUnit(state, unit);
    return;
  }
  if (!r.attackerWon) return;
  // The winner advances if the hex is now clear and it can hold ground.
  if (def.capture && canEnter(state, unit, target) && enterCost(def, world.terrain[target], { embark: canEmbark(state, unit.owner) }) !== null) {
    unit.tile = target;
    ctx.events.push({ kind: 'moved', unitId: unit.id, owner: unit.owner, path: [target] });
    const s = structureAt(state, target);
    if (s && s.owner !== unit.owner) capture(ctx, s, unit.owner);
  }
}

/** A settlement changes hands. Natives raze a captured Node. */
export function capture(ctx: Ctx, s: Structure, by: Owner): void {
  const { state } = ctx;
  const from = s.owner;
  if (s.type === 'ai-node' && by !== PLAYER) {
    state.structures = state.structures.filter((x) => x !== s);
    ctx.events.push({ kind: 'node-razed', tile: s.tile, name: s.name, by });
    return;
  }
  s.owner = by;
  s.build = null;
  s.hp = RULES.walls.hpAfterCapture;
  ctx.events.push({ kind: 'city-captured', tile: s.tile, name: s.name, by, from });
  if (by === PLAYER) {
    state.stats.citiesTaken++;
    for (const f of state.factions) {
      if (f.id !== from && !f.eliminated) f.attitude = clampAttitude(f.attitude + RULES.diplomacy.cityTakenOthers);
    }
  }
}

/** `by` starts a war between a and b (one of them may be the player). */
export function declareWar(state: GameState, events: GameEvent[], a: Owner, b: Owner, by: Owner): void {
  if (hostile(state, a, b)) return;
  if (a === PLAYER || b === PLAYER) {
    const f = factionById(state, a === PLAYER ? b : a)!;
    f.atWar = true;
    if (by === PLAYER) {
      f.attitude = -100;
      for (const o of state.factions) {
        if (o !== f && !o.eliminated) o.attitude = clampAttitude(o.attitude + RULES.diplomacy.attackedOthers);
      }
    } else {
      f.attitude = Math.min(f.attitude, RULES.diplomacy.warThreshold);
    }
  } else {
    factionById(state, a)!.wars.push(b);
    factionById(state, b)!.wars.push(a);
  }
  events.push({ kind: 'war', a, b, by });
}

export function makePeace(state: GameState, events: GameEvent[], a: Owner, b: Owner): void {
  if (!hostile(state, a, b)) return;
  if (a === PLAYER || b === PLAYER) {
    const f = factionById(state, a === PLAYER ? b : a)!;
    f.atWar = false;
    f.attitude = Math.max(f.attitude, RULES.diplomacy.peaceAttitudeAfter);
  } else {
    const fa = factionById(state, a)!;
    const fb = factionById(state, b)!;
    fa.wars = fa.wars.filter((x) => x !== b);
    fb.wars = fb.wars.filter((x) => x !== a);
  }
  for (const u of state.units) {
    if ((u.owner === a || u.owner === b) && u.attackTile !== null) u.attackTile = null;
  }
  events.push({ kind: 'peace', a, b });
}
