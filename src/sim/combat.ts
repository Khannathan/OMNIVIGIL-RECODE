// Combat: UPow, modifiers, and the forecast shown before every fight
// (design bible sections 6 and 17: Civ-style odds, no hidden math).
//
// A fight is a series of rounds. Each round the attacker wins with chance
// A / (A + D), where A and D are the two sides' strengths, and the loser of
// the round takes damage. The first side to reach 0 HP loses and is
// destroyed. Because the rules are this simple, the forecast is exact: the
// win chance shown is the true probability the seeded combat roll uses.

import { archetypeDef, RULES, TERRAIN, unitDef } from '../content';
import { mods } from './effects';
import { isEmbarked } from './path';
import { Rng } from './rng';
import { factionById, GameState, PLAYER, Structure, structureAt, Unit } from './state';
import { World } from './worldgen';

export interface StrengthLine {
  label: string;
  pct: number;
}

export interface Side {
  unitId: number;
  type: string;
  owner: string;
  hp: number;
  /** Base UPow from the unit's data. */
  upow: number;
  /** UPow after every modifier, before wounds. */
  power: number;
  /** What actually fights: power x (0.5 + 0.5 x HP/100), so wounds cost up to half. */
  strength: number;
  lines: StrengthLine[];
}

export interface Forecast {
  attacker: Side;
  defender: Side;
  /** Chance the attacker wins one round. */
  roundChance: number;
  /** Damage per round won, dealt to the other side. */
  attackerHit: number;
  defenderHit: number;
  winChance: number;
  /** Expected HP left on the winner, for each outcome. */
  attackerHpIfWin: number;
  defenderHpIfHold: number;
}

/** UPow for one side of a fight, with every modifier listed. */
export function sideOf(state: GameState, world: World, unit: Unit, role: 'attack' | 'defense', fightTile: number): Side {
  const def = unitDef(unit.type);
  const lines: StrengthLine[] = [];
  let upow = def.upow;
  if (unit.type === WALLS) {
    const s = structureAt(state, unit.tile)!;
    const w = RULES.walls;
    upow = (s.type === 'ai-node' ? w.node : w.city) + w.perStage * s.stage;
  } else if (unit.owner === PLAYER) {
    for (const u of mods(state).upow) {
      if (u.domain && u.domain !== def.domain) continue;
      if (u.role && u.role !== role) continue;
      lines.push({ label: u.source, pct: u.pct });
    }
  } else {
    const f = factionById(state, unit.owner);
    const esc = Math.min(RULES.factions.escalationCapPct, Math.floor(state.cycle * RULES.factions.escalationPerCyclePct));
    if (esc > 0) lines.push({ label: 'Native escalation', pct: esc });
    const bonus = f ? archetypeDef(f.archetype).terrainBonus?.[TERRAIN[world.terrain[fightTile]].id] : undefined;
    if (bonus && def.domain === 'land') lines.push({ label: `Home ground (${TERRAIN[world.terrain[fightTile]].name})`, pct: bonus });
  }
  if (role === 'defense') {
    const terr = TERRAIN[world.terrain[unit.tile]];
    if (def.domain === 'land' && terr.defense) lines.push({ label: terr.name, pct: terr.defense });
    const s = structureAt(state, unit.tile);
    if (s && s.owner === unit.owner && def.domain !== 'air') lines.push({ label: `Fortified in ${s.name}`, pct: RULES.combat.settlementDefensePct });
    if (isEmbarked(def, world.terrain[unit.tile])) lines.push({ label: 'Embarked', pct: RULES.combat.embarkedDefensePct });
  }
  const pct = lines.reduce((a, l) => a + l.pct, 0);
  const power = Math.max(0.5, upow * (1 + pct / 100));
  const strength = power * (0.5 + (0.5 * unit.hp) / 100);
  return { unitId: unit.id, type: unit.type, owner: unit.owner, hp: unit.hp, upow, power, strength, lines };
}

export const WALLS = 'walls';

/** A settlement's walls, as a stand-in unit so they fight by the same rules. id = -settlement id. */
export function wallsOf(s: Structure): Unit {
  return { id: -s.id, type: WALLS, owner: s.owner, tile: s.tile, route: [], hp: s.hp, attackTile: null };
}

/** The defender that would meet an attack on this tile: the strongest unit, else the walls. */
export function bestDefender(state: GameState, world: World, tile: number, attackerOwner: string): Unit | undefined {
  let best: Unit | undefined;
  let bestS = -1;
  for (const u of state.units) {
    if (u.tile !== tile || u.owner === attackerOwner) continue;
    const s = sideOf(state, world, u, 'defense', tile).strength;
    if (s > bestS || (s === bestS && best && u.id < best.id)) {
      best = u;
      bestS = s;
    }
  }
  if (best) return best;
  const s = structureAt(state, tile);
  if (s && s.owner !== attackerOwner && s.hp > 0) return wallsOf(s);
  return undefined;
}

function hit(a: number, d: number): number {
  const c = RULES.combat;
  const raw = (c.baseDamage * (3 * a + d)) / (3 * d + a);
  return Math.max(c.minDamage, Math.min(c.maxDamage, Math.round(raw)));
}

export function forecast(state: GameState, world: World, attacker: Unit, defender: Unit): Forecast {
  const a = sideOf(state, world, attacker, 'attack', defender.tile);
  const d = sideOf(state, world, defender, 'defense', defender.tile);
  const p = a.strength / (a.strength + d.strength);
  const attackerHit = hit(a.strength, d.strength);
  const defenderHit = hit(d.strength, a.strength);
  const need = Math.ceil(defender.hp / attackerHit); // rounds the attacker must win
  const survive = Math.ceil(attacker.hp / defenderHit); // rounds the attacker can lose
  // P(win) = sum over k losses (k < survive) of C(need-1+k, k) p^need (1-p)^k.
  let win = 0;
  let hpIfWin = 0;
  let coef = 1;
  const pn = Math.pow(p, need);
  for (let k = 0; k < survive; k++) {
    if (k > 0) coef = (coef * (need - 1 + k)) / k;
    const pk = coef * pn * Math.pow(1 - p, k);
    win += pk;
    hpIfWin += pk * (attacker.hp - k * defenderHit);
  }
  // Defender's expected HP when it holds: it lost j < need rounds.
  let lose = 0;
  let hpIfHold = 0;
  coef = 1;
  const qs = Math.pow(1 - p, survive);
  for (let j = 0; j < need; j++) {
    if (j > 0) coef = (coef * (survive - 1 + j)) / j;
    const pj = coef * qs * Math.pow(p, j);
    lose += pj;
    hpIfHold += pj * (defender.hp - j * attackerHit);
  }
  return {
    attacker: a,
    defender: d,
    roundChance: p,
    attackerHit,
    defenderHit,
    winChance: win,
    attackerHpIfWin: win > 0 ? Math.max(1, Math.round(hpIfWin / win)) : 0,
    defenderHpIfHold: lose > 0 ? Math.max(1, Math.round(hpIfHold / lose)) : 0,
  };
}

/** Plays the rounds with the combat stream. Returns both sides' HP after. */
export function fight(fc: Forecast, rng: Rng): { attackerWon: boolean; attackerHp: number; defenderHp: number } {
  let ah = fc.attacker.hp;
  let dh = fc.defender.hp;
  while (ah > 0 && dh > 0) {
    if (rng.next() < fc.roundChance) dh -= fc.attackerHit;
    else ah -= fc.defenderHit;
  }
  return { attackerWon: dh <= 0, attackerHp: Math.max(0, ah), defenderHp: Math.max(0, dh) };
}
