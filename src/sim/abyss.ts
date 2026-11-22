// The Abyssians (design bible sections 9 and 13): kaiju that rise from the
// ocean rifts, wade ashore, smash a settlement's walls, ravage it, and go
// back to the deep. Conventional arms barely scratch them (the kaiju
// penalty), so the answer is a TBU from the Titan Forge or a hardened
// symbiote. A rift is closed by breaking its heart; the first rift holds the
// Abyss Mother, who retreats deeper each time she is beaten, until the other
// rifts are sealed and she can be killed for good (the Guardian victory).
// Everything draws from the run's 'abyss' RNG stream.

import { ABYSSIANS, Cost, RULES, strainDef, unitDef } from '../content';
import { actUnit, blockedTiles, Ctx, removeUnit, routeToStrike } from './actions';
import { addExposure } from './exposure';
import { distance, neighbors } from './hex';
import { findPath } from './path';
import { Rng } from './rng';
import {
  ABYSS,
  clampAttitude,
  GameState,
  hostile,
  PLAYER,
  riftAt,
  RiftState,
  spawnUnit,
  Structure,
  structureAt,
  Unit,
} from './state';

export const RIFT_HEART = 'rift-heart';
export const MOTHER = 'abyss-mother';

/** Rift hearts and the Mother are not map units: they stand in for a rift when it is attacked. */
export function isRiftGuard(u: { type: string }): boolean {
  return u.type === RIFT_HEART || u.type === MOTHER;
}

export function guardId(tile: number): number {
  return -(1_000_000 + tile);
}

/** What defends an open rift: its heart, or the Mother in hers. */
export function riftGuard(state: GameState, tile: number): Unit | undefined {
  const r = riftAt(state, tile);
  if (!r || r.sealed) return undefined;
  return { id: guardId(tile), type: r.mother ? MOTHER : RIFT_HEART, owner: ABYSS, tile, route: [], hp: r.hp, attackTile: null };
}

/** A rift guard's base UPow, before the tide and the Mother's growth. */
export function guardUpow(state: GameState, guard: Unit): number {
  const r = riftAt(state, guard.tile);
  if (guard.type === MOTHER) return unitDef(MOTHER).upow;
  return RULES.abyss.heartUpow[r?.tier ?? 0] ?? unitDef(RIFT_HEART).upow;
}

/** Weighted pick from the Abyssians that can rise by this cycle. */
export function pickAbyssian(cycle: number, rng: Rng): string {
  const pool = ABYSSIANS.filter((u) => (u.from ?? 0) <= cycle);
  const total = pool.reduce((a, u) => a + (u.weight ?? 1), 0);
  let roll = rng.next() * total;
  for (const u of pool) {
    roll -= u.weight ?? 1;
    if (roll < 0) return u.id;
  }
  return pool[pool.length - 1].id;
}

export function abyssPhase(ctx: Ctx, rng: Rng): void {
  const { state, events } = ctx;
  const A = RULES.abyss;
  if (state.cycle >= A.firstRise) {
    const open = state.rifts.filter((r) => !r.sealed);
    let room = A.capBase + A.capPerRift * open.length - state.units.filter((u) => u.owner === ABYSS).length;
    for (const r of open) {
      if (!preyInReach(state, ctx.world, r.tile)) continue; // nothing to hunt: the rift sleeps
      r.pressure = Math.min(A.riseAt, r.pressure + 1 + Math.floor(state.cycle / A.rampEvery));
      if (r.pressure < A.riseAt || room <= 0) continue;
      if (state.units.some((u) => u.tile === r.tile)) continue; // something stands on the rift and holds it shut
      const type = pickAbyssian(state.cycle, rng);
      const u = spawnUnit(state, type, r.tile, ABYSS);
      u.home = r.tile;
      u.sated = false;
      r.pressure = 0;
      room--;
      events.push({ kind: 'abyss-rise', tile: r.tile, unitId: u.id, unit: type });
    }
  }
  for (const u of state.units.filter((x) => x.owner === ABYSS).sort((a, b) => a.id - b.id)) {
    if (!state.units.includes(u)) continue;
    think(ctx, u);
    if (state.units.includes(u)) actUnit(ctx, u);
  }
}

function lure(state: GameState): number {
  return state.exposureMax >= RULES.exposure.permanentLevel ? RULES.abyss.lureHexesWhenRevealed : 0;
}

/** Any settlement within a rift's hunting radius? */
export function preyInReach(state: GameState, world: Ctx['world'], rift: number): boolean {
  const reach = RULES.abyss.huntRadius;
  const extra = lure(state);
  return state.structures.some((s) => s.owner !== ABYSS && distance(rift, s.tile, world) <= reach + (s.owner === PLAYER ? extra : 0));
}

/** Is there something here an Abyssian can hit? */
function preyAt(state: GameState, tile: number): 'settlement' | 'unit' | null {
  const s = structureAt(state, tile);
  if (s && s.owner !== ABYSS) return 'settlement';
  if (state.units.some((u) => u.tile === tile && hostile(state, ABYSS, u.owner))) return 'unit';
  return null;
}

function think(ctx: Ctx, u: Unit): void {
  const { state, world } = ctx;
  const def = unitDef(u.type);
  const home = u.home ?? nearestRift(state, world, u.tile);

  if (u.sated) {
    u.attackTile = null;
    if (home === null || u.tile === home) return sink(ctx, u);
    const path = findPath(world, def, u.tile, home, undefined, { blocked: blockedTiles(state, ABYSS) });
    if (!path) return sink(ctx, u); // it dives where it stands
    u.route = path;
    return;
  }

  // Lash out at whatever is next to it: a settlement first, then the unit it is likeliest to crush.
  const adjacent = neighbors(u.tile, world)
    .map((t) => ({ t, kind: preyAt(state, t) }))
    .filter((x) => x.kind !== null)
    .sort((a, b) => (a.kind === b.kind ? a.t - b.t : a.kind === 'settlement' ? -1 : 1));
  if (adjacent.length) {
    u.route = [];
    u.attackTile = adjacent[0].t;
    return;
  }

  // Keep hunting a target that is still there.
  if (u.attackTile !== null && preyAt(state, u.attackTile)) {
    const r = routeToStrike(state, world, u, u.attackTile);
    if (r) {
      u.route = r;
      return;
    }
  }
  u.attackTile = null;

  const target = pickSettlement(state, world, u, home);
  if (target) {
    const r = routeToStrike(state, world, u, target.tile);
    if (r) {
      u.route = r;
      u.attackTile = target.tile;
      return;
    }
  }
  // Nothing in reach: back to the deep.
  u.sated = true;
  if (home !== null && home !== u.tile) u.route = findPath(world, def, u.tile, home, undefined, { blocked: blockedTiles(state, ABYSS) }) ?? [];
  else sink(ctx, u);
}

/** The settlement nearest its rift, within the hunting radius. Once you are Revealed, the Abyss smells you from further off. */
function pickSettlement(state: GameState, world: Ctx['world'], u: Unit, home: number | null): Structure | null {
  const A = RULES.abyss;
  const from = home ?? u.tile;
  const extra = lure(state);
  let best: Structure | null = null;
  let bestD = Infinity;
  for (const s of state.structures) {
    if (s.owner === ABYSS) continue;
    const raw = distance(from, s.tile, world);
    if (raw > A.huntRadius + (s.owner === PLAYER ? extra : 0)) continue;
    const d = distance(u.tile, s.tile, world) - (s.owner === PLAYER ? extra : 0);
    if (d < bestD || (d === bestD && best && s.id < best.id)) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

function nearestRift(state: GameState, world: Ctx['world'], tile: number): number | null {
  let best: RiftState | null = null;
  for (const r of state.rifts) {
    if (!best || distance(tile, r.tile, world) < distance(tile, best.tile, world)) best = r;
  }
  return best?.tile ?? null;
}

function sink(ctx: Ctx, u: Unit): void {
  removeUnit(ctx.state, u);
  ctx.events.push({ kind: 'abyss-sank', tile: u.tile, unit: u.type });
}

/** An Abyssian broke through: it feeds, then heads home. */
export function ravage(ctx: Ctx, s: Structure, by: Unit): void {
  const { state, events } = ctx;
  by.sated = true;
  by.attackTile = null;
  by.route = [];
  const lost: Cost = {};
  if (s.owner === PLAYER) {
    const pct = RULES.abyss.ravageStealPct / 100;
    for (const k of ['matter', 'compute'] as const) {
      const take = Math.floor(state.resources[k] * pct);
      state.resources[k] -= take;
      if (take) lost[k] = take;
    }
    if (s.build) s.build.progress = Math.floor(s.build.progress / 2);
    if (state.ark.build?.structureId === s.id) state.ark.build.progress = Math.floor(state.ark.build.progress / 2);
  } else if (s.stage > 1) {
    s.stage--;
    s.grewAt = state.cycle;
  }
  events.push({ kind: 'ravaged', tile: s.tile, name: s.name, owner: s.owner, unit: by.type, lost });
}

/** You (or anyone) broke a rift's heart: seal it, or drive the Mother deeper. */
export function riftBroken(ctx: Ctx, rift: RiftState, by: Unit): void {
  const { state, events } = ctx;
  const A = RULES.abyss;
  const mine = by.owner === PLAYER;
  if (rift.mother) {
    const othersOpen = state.rifts.some((r) => !r.mother && !r.sealed);
    if (!othersOpen) {
      rift.sealed = true;
      rift.hp = 0;
      state.mother.slain = true;
      if (mine) state.resources.essence += A.motherSlainEssence;
      events.push({ kind: 'mother-slain', tile: rift.tile, essence: mine ? A.motherSlainEssence : 0 });
    } else {
      state.mother.retreats++;
      rift.hp = 100;
      const essence = unitDef(MOTHER).essence ?? 0;
      if (mine) state.resources.essence += essence;
      events.push({ kind: 'mother-retreat', tile: rift.tile, essence: mine ? essence : 0, retreats: state.mother.retreats });
    }
  } else {
    rift.sealed = true;
    rift.hp = 0;
    if (mine) {
      state.resources.essence += A.sealEssence;
      state.resources.crypto += A.sealCrypto;
    }
    events.push({ kind: 'rift-sealed', tile: rift.tile, essence: mine ? A.sealEssence : 0, crypto: mine ? A.sealCrypto : 0 });
  }
  if (mine) addExposure(state, RULES.exposure.riftSealed);
}

/** A kill: Essence from Abyssians you slay, and gratitude from the factions you saved. */
export function onKill(ctx: Ctx, winner: Unit, loser: Unit, tile: number): void {
  const { state, world, events } = ctx;
  if (winner.owner !== PLAYER || loser.owner !== ABYSS) return;
  const def = unitDef(loser.type);
  const feeder = !!winner.symbiote && !!strainDef(winner.symbiote).feeder;
  const essence = Math.round((def.essence ?? 0) * (feeder ? 1.5 : 1));
  if (essence) {
    state.resources.essence += essence;
    events.push({ kind: 'essence', tile, amount: essence, from: loser.type });
  }
  if (def.kaiju) state.stats.kaijuSlain++;
  addExposure(state, RULES.exposure.kaijuKill);
  const A = RULES.abyss;
  for (const f of state.factions) {
    if (f.eliminated) continue;
    const near = state.structures.some((s) => s.owner === f.id && distance(s.tile, tile, world) <= A.gratitudeRadius);
    if (!near) continue;
    f.attitude = clampAttitude(f.attitude + A.gratitude);
    events.push({ kind: 'gratitude', faction: f.id, attitude: f.attitude });
  }
}
