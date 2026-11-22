// Turns a cycle's events into a Watch timeline (design bible section 6, beat
// 4). Moves that happen together glide together; each fight waits for the
// moves before it and plays on its own, so cause comes before effect. Units
// that die keep being drawn ("ghosts") until the moment they are destroyed.
// Pure data in, pure data out, so it is unit-tested without a browser.

import { unitDef } from '../content';
import { CombatEvent, GameEvent, Owner, PLAYER } from '../sim/state';

export interface Segment {
  t0: number;
  /** Tiles in order, starting with the tile the unit stood on. */
  path: number[];
}

export interface FightShot {
  t: number;
  dur: number;
  /** Seconds after `t` when the loser blows up. */
  impact: number;
  e: CombatEvent;
  /** Involves you. */
  mine: boolean;
  /** A capital, walls, a missile or one of yours dying: worth a bigger show. */
  big: boolean;
}

export interface Ghost {
  type: string;
  owner: Owner;
  tile: number;
  /** Watch time at which it is destroyed. */
  until: number;
}

export interface Mark {
  t: number;
  tile: number;
  kind: 'capture' | 'lost' | 'razed' | 'salvage' | 'built';
  text: string;
  /** Rarity id for salvage. */
  rarity?: string;
}

export interface Timeline {
  step: number;
  segments: Map<number, Segment[]>;
  fights: FightShot[];
  ghosts: Map<number, Ghost>;
  marks: Mark[];
  end: number;
}

export interface TimelineOpts {
  /** Seconds per hex of movement. */
  step?: number;
  /** Seconds per fight. */
  fight?: number;
  /** Longest a Watch may run; longer cycles play faster. */
  maxSeconds?: number;
  /** Names for marks (cities, units). */
  name?: (e: GameEvent) => string;
}

export function buildTimeline(
  events: GameEvent[],
  before: Map<number, number>,
  seen: (e: GameEvent) => boolean,
  opts: TimelineOpts = {},
): Timeline {
  const step = opts.step ?? 0.16;
  const fightDur = opts.fight ?? 0.85;
  const segments = new Map<number, Segment[]>();
  const fights: FightShot[] = [];
  const ghosts = new Map<number, Ghost>();
  const marks: Mark[] = [];
  const ready = new Map<number, number>();
  const where = new Map(before);
  const arrival = new Map<number, number>();
  let batchStart = 0;
  let batchEnd = 0;
  let fightCursor = 0;
  const name = opts.name ?? (() => '');

  for (const e of events) {
    switch (e.kind) {
      case 'moved': {
        const from = where.get(e.unitId);
        where.set(e.unitId, e.path[e.path.length - 1]);
        if (from === undefined || !seen(e)) break;
        const t0 = Math.max(batchStart, ready.get(e.unitId) ?? 0);
        const end = t0 + e.path.length * step;
        const list = segments.get(e.unitId) ?? [];
        list.push({ t0, path: [from, ...e.path] });
        segments.set(e.unitId, list);
        ready.set(e.unitId, end);
        batchEnd = Math.max(batchEnd, end);
        arrival.set(e.path[e.path.length - 1], end);
        break;
      }
      case 'combat': {
        if (!seen(e)) break;
        const t = Math.max(batchEnd, fightCursor, ready.get(e.attackerId) ?? 0, ready.get(e.defenderId) ?? 0);
        const mine = e.attackerOwner === PLAYER || e.defenderOwner === PLAYER;
        const oneShot = unitDef(e.attackerType).oneShot === true;
        const loserMine = (e.attackerWon ? e.defenderOwner : e.attackerOwner) === PLAYER;
        const big = e.defenderType === 'walls' || oneShot || (mine && loserMine);
        const dur = fightDur * (big ? 1.25 : 1);
        const impact = dur * 0.68;
        fights.push({ t, dur, impact, e, mine, big });
        if (e.attackerWon && e.defenderType !== 'walls') ghosts.set(e.defenderId, { type: e.defenderType, owner: e.defenderOwner, tile: e.tile, until: t + impact });
        if (!e.attackerWon || oneShot) ghosts.set(e.attackerId, { type: e.attackerType, owner: e.attackerOwner, tile: e.from, until: t + impact });
        fightCursor = t + dur;
        batchStart = fightCursor;
        batchEnd = Math.max(batchEnd, fightCursor);
        break;
      }
      case 'city-captured':
      case 'node-razed': {
        if (!seen(e)) break;
        const t = arrival.get(e.tile) ?? batchEnd;
        const kind = e.kind === 'node-razed' ? 'razed' : e.by === PLAYER ? 'capture' : e.from === PLAYER ? 'lost' : 'capture';
        marks.push({ t, tile: e.tile, kind, text: name(e) });
        batchEnd = Math.max(batchEnd, t + 0.5);
        fightCursor = Math.max(fightCursor, t + 0.5);
        break;
      }
      case 'built':
        marks.push({ t: 0, tile: e.tile, kind: 'built', text: name(e) });
        break;
      default:
        break;
    }
  }

  let end = Math.max(batchEnd, fightCursor);
  // Searching ruins happens once everyone has stopped moving.
  for (const e of events) {
    if (e.kind !== 'salvage') continue;
    marks.push({ t: end, tile: e.tile, kind: 'salvage', text: name(e), rarity: e.rarity });
  }
  // Let the big moments breathe before the Reckon.
  if (marks.some((m) => m.kind === 'salvage')) end += 0.9;
  for (const m of marks) {
    if (m.kind === 'capture' || m.kind === 'lost' || m.kind === 'razed') end = Math.max(end, m.t + 1.1);
    if (m.kind === 'built') end = Math.max(end, 0.6);
  }
  if (fights.length) end = Math.max(end, fights[fights.length - 1].t + fights[fights.length - 1].dur + 0.35);

  // Long cycles play faster, never slower.
  const max = opts.maxSeconds ?? 9;
  const k = end > max ? max / end : 1;
  if (k < 1) {
    for (const list of segments.values()) for (const s of list) s.t0 *= k;
    for (const f of fights) {
      f.t *= k;
      f.dur *= k;
      f.impact *= k;
    }
    for (const g of ghosts.values()) g.until *= k;
    for (const m of marks) m.t *= k;
    end *= k;
  }
  return { step: step * k, segments, fights, ghosts, marks, end };
}

/** Where a unit is at watch time t, as a fractional position along its path: [tileA, tileB, f]. */
export function positionAt(tl: Timeline, unitId: number, t: number): [number, number, number] | null {
  const segs = tl.segments.get(unitId);
  if (!segs || !segs.length) return null;
  let seg = segs[0];
  if (t < seg.t0) return [seg.path[0], seg.path[0], 0];
  for (const s of segs) if (s.t0 <= t) seg = s;
  const x = (t - seg.t0) / tl.step;
  const i = Math.min(Math.floor(x), seg.path.length - 1);
  if (i >= seg.path.length - 1) {
    const last = seg.path[seg.path.length - 1];
    return [last, last, 0];
  }
  return [seg.path[i], seg.path[i + 1], x - i];
}
