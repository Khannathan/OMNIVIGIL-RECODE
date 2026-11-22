// Draws one frame of the homeworld: terrain, fog, territory, grid,
// settlements, units, routes and selection, with the east-west wrap. Also
// plays the Watch beat (M2): units glide along their paths, weapons fire
// tracers, losers explode with hit-stop and shake, the camera follows the
// big moments, and Space skips (design bible sections 6 and 17).

import { REWARDS, TERRAIN, titanParts, unitDef, WeaponStyle } from '../content';
import { guardId, MOTHER, RIFT_HEART } from '../sim/abyss';
import { hexToPixel, indexToPixel, ROW_STEP, HEX_W, worldPixelWidth, wrapCol } from '../sim/hex';
import { ABYSS, GameEvent, GameState, PLAYER } from '../sim/state';
import { World } from '../sim/worldgen';
import { Renderer, rgb } from './renderer';
import { buildTimeline, FightShot, positionAt, Timeline } from './timeline';

type RGB = [number, number, number];
const VOID: RGB = [4 / 255, 7 / 255, 13 / 255];
const ENEMY: RGB = [1, 0x3a / 255, 0x4a / 255];
const ENGINE: RGB = [1, 0xb8 / 255, 0x4a / 255];
const AMBER: RGB = [1, 0xc6 / 255, 0x5a / 255];
const RIFT: RGB = [1, 0x28 / 255, 0x48 / 255];
const GOLD: RGB = [1, 0.82, 0.35];
const BIO: RGB = [0.78, 1, 0.35];

/** Sounds the view asks for while it plays the Watch. */
export type Cue =
  | 'shot-ballistic'
  | 'shot-laser'
  | 'shot-bio'
  | 'missile'
  | 'explosion-small'
  | 'explosion-large'
  | 'capture'
  | 'alert'
  | 'unit-online'
  | 'core-pulse'
  | 'abyss-roar'
  | 'rift-open'
  | 'rift-seal'
  | 'mother-call';

export interface ViewOptions {
  showGrid: boolean;
  selectedTile: number | null;
  selectedUnit: number | null;
  hoverTile: number | null;
  /** Routes from move orders queued this cycle, by unit id. */
  queuedRoutes: Map<number, number[]>;
  /** Attack targets queued this cycle, by unit id. */
  queuedStrikes: Map<number, number>;
  /** Owner of each claimed tile. */
  territory: Map<number, string>;
  /** The tile the advisor is pointing at. */
  adviceTile?: number | null;
  /** Dev aid: draw the whole map. */
  revealAll?: boolean;
}

export interface Label {
  x: number;
  y: number;
  text: string;
  cls: string;
  born: number;
  life: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: RGB;
  glow: boolean;
  gravity: number;
  sprite: string;
}

interface Shot {
  at: number;
  fromA: boolean;
  kind: WeaponStyle;
}

function weaponOf(type: string): WeaponStyle {
  if (type === 'walls') return 'ballistic';
  const d = unitDef(type);
  if (d.weapon) return d.weapon;
  return d.oneShot ? 'missile' : d.domain === 'air' ? 'laser' : d.domain === 'sea' ? 'shell' : 'ballistic';
}

const SHOT_COLOR: Record<WeaponStyle, RGB> = {
  ballistic: [1, 0xb8 / 255, 0x4a / 255],
  laser: [0.37, 0.88, 1],
  missile: [1, 0.6, 0.25],
  shell: [1, 0xb8 / 255, 0x4a / 255],
  bio: [0.78, 1, 0.35],
  blade: [0.85, 0.95, 1],
};

/** Every fight is a short exchange of fire, then the loser blows up. */
function shotsFor(f: FightShot): Shot[] {
  const a = unitDef(f.e.attackerType);
  const kind = weaponOf(f.e.attackerType);
  if (a.oneShot) return [{ at: 0.05, fromA: true, kind: 'missile' }];
  const back = weaponOf(f.e.defenderType);
  const n = f.big ? 5 : 4;
  const out: Shot[] = [];
  for (let i = 0; i < n; i++) {
    const fromA = i % 2 === 0;
    out.push({ at: (i / n) * f.impact * 0.85, fromA, kind: fromA ? kind : back });
  }
  return out;
}

const SHOT_FLIGHT = 0.12;
const MISSILE_FLIGHT = 0.42;

export class GameView {
  private tl: Timeline | null = null;
  /** Watch clock: stops during hit-stop. */
  private wt = 0;
  private hitstop = 0;
  private trauma = 0;
  private flash: { color: RGB; alpha: number } | null = null;
  private particles: Particle[] = [];
  private labels: Label[] = [];
  private fired = new Set<string>();
  private colors = new Map<string, RGB>();
  private now = 0;
  /** Set by the game: plays a sound. */
  onCue: (cue: Cue, intensity?: number) => void = () => {};
  /** Turns off shake, flashes and hit-stop. */
  reduceMotion = false;

  constructor(
    private r: Renderer,
    private world: World,
  ) {}

  private colorOf(state: GameState, owner: string): RGB {
    const key = owner === PLAYER ? `p:${state.ai.color}` : owner;
    let c = this.colors.get(key);
    if (!c) {
      const hex = owner === PLAYER ? state.ai.color : owner === ABYSS ? '#c8ff5a' : state.factions.find((f) => f.id === owner)?.color ?? '#ff3a4a';
      c = rgb(hex);
      this.colors.set(key, c);
    }
    return c;
  }

  /** Start the Watch beat for a resolved cycle. Returns its length in seconds. */
  playWatch(events: GameEvent[], before: Map<number, number>, visible: Set<number>, names: (e: GameEvent) => string): number {
    const seen = (e: GameEvent): boolean => {
      switch (e.kind) {
        case 'moved': {
          const from = before.get(e.unitId);
          return e.owner === PLAYER || (from !== undefined && visible.has(from)) || e.path.some((t) => visible.has(t));
        }
        case 'combat':
          return e.attackerOwner === PLAYER || e.defenderOwner === PLAYER || visible.has(e.tile) || visible.has(e.from);
        case 'city-captured':
        case 'node-razed':
          return visible.has(e.tile) || e.kind === 'node-razed' || e.by === PLAYER || e.from === PLAYER;
        default:
          return true;
      }
    };
    this.tl = buildTimeline(events, before, seen, { name: names });
    this.wt = 0;
    this.hitstop = 0;
    this.fired.clear();
    return this.tl.end;
  }

  skipWatch() {
    this.tl = null;
    this.hitstop = 0;
    this.particles = this.particles.filter((p) => p.age < p.life && p.life > 1);
  }

  isWatching(): boolean {
    return !!this.tl && this.wt < this.tl.end + 0.35;
  }

  /** Floating text in world pixels, read by the game to place DOM labels. */
  activeLabels(): Label[] {
    return this.labels;
  }

  addLabel(tile: number, text: string, cls: string, life = 1.6, dy = -30) {
    const [x, y] = indexToPixel(tile, this.world);
    this.labels.push({ x, y: y + dy, text, cls, born: this.now, life });
  }

  /** Where the camera should look during the Watch, if anywhere. */
  focusPoint(): [number, number] | null {
    const tl = this.tl;
    if (!tl) return null;
    const lead = 0.35;
    const f = tl.fights.find((x) => (x.mine || x.big) && this.wt >= x.t - lead && this.wt < x.t + x.dur);
    if (f) return this.midpoint(f.e.from, f.e.tile);
    const m = tl.marks.find((x) => (x.kind === 'capture' || x.kind === 'lost' || x.kind === 'razed') && this.wt >= x.t - lead && this.wt < x.t + 0.6);
    if (m) return indexToPixel(m.tile, this.world);
    return null;
  }

  private midpoint(a: number, b: number): [number, number] {
    const [ax, ay] = indexToPixel(a, this.world);
    let [bx, by] = indexToPixel(b, this.world);
    bx = this.near(bx, ax);
    return [(ax + bx) / 2, (ay + by) / 2];
  }

  /** The copy of x (across the wrap) closest to ref. */
  private near(x: number, ref: number): number {
    const lap = worldPixelWidth(this.world);
    while (x - ref > lap / 2) x -= lap;
    while (ref - x > lap / 2) x += lap;
    return x;
  }

  /** Advance the Watch clock and effects. Call once a frame. */
  update(dt: number, now: number) {
    this.now = now;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    if (this.flash) {
      this.flash.alpha -= dt * 2.2;
      if (this.flash.alpha <= 0) this.flash = null;
    }
    this.labels = this.labels.filter((l) => now - l.born < l.life);
    let sim = dt;
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      sim = 0;
    }
    for (const p of this.particles) {
      p.age += sim;
      p.vy += p.gravity * sim;
      p.x += p.vx * sim;
      p.y += p.vy * sim;
      p.vx *= 1 - Math.min(1, sim * 2.5);
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    if (!this.tl) return;
    const prev = this.wt;
    this.wt += sim;
    this.fireEvents(prev, this.wt);
  }

  private once(key: string, at: number, from: number, to: number): boolean {
    if (at < from || at >= to || this.fired.has(key)) return false;
    this.fired.add(key);
    return true;
  }

  private fireEvents(from: number, to: number) {
    const tl = this.tl!;
    const w = this.world;
    tl.fights.forEach((f, i) => {
      for (const [k, s] of shotsFor(f).entries()) {
        if (!this.once(`f${i}s${k}`, f.t + s.at, from, to)) continue;
        this.onCue(s.kind === 'missile' ? 'missile' : s.kind === 'laser' ? 'shot-laser' : s.kind === 'bio' ? 'shot-bio' : 'shot-ballistic', f.mine ? 1 : 0.5);
      }
      if (this.once(`f${i}x`, f.t + f.impact, from, to)) {
        const loserTile = f.e.attackerWon ? f.e.tile : f.e.from;
        const [x, y] = indexToPixel(loserTile, w);
        const walls = f.e.defenderType === 'walls';
        this.explode(x, y - 4, f.big ? 1.5 : 1, walls && f.e.attackerWon ? AMBER : ENGINE);
        this.onCue(f.big ? 'explosion-large' : 'explosion-small', f.mine ? 1 : 0.5);
        if (!this.reduceMotion) {
          this.hitstop = f.big ? 0.12 : f.mine ? 0.07 : 0.03;
          this.trauma = Math.min(1, this.trauma + (f.big ? 0.55 : f.mine ? 0.3 : 0.12));
        }
        const loserOwner = f.e.attackerWon ? f.e.defenderOwner : f.e.attackerOwner;
        const winnerOwner = f.e.attackerWon ? f.e.attackerOwner : f.e.defenderOwner;
        if (loserOwner === PLAYER && !this.reduceMotion) this.flash = { color: ENEMY, alpha: walls ? 0.12 : 0.22 };
        let text: string;
        let cls: string;
        if (walls) {
          text = f.e.attackerWon ? 'Walls breached' : 'Repelled';
          cls = (f.e.attackerOwner === PLAYER) === f.e.attackerWon ? 'good' : 'bad';
        } else {
          const loserType = f.e.attackerWon ? f.e.defenderType : f.e.attackerType;
          text = `✕ ${unitDef(loserType).name}`;
          cls = loserOwner === PLAYER ? 'bad' : winnerOwner === PLAYER ? 'good' : 'neutral';
        }
        this.addLabel(loserTile, text, cls, 1.8);
      }
    });
    tl.marks.forEach((m, i) => {
      if (!this.once(`m${i}`, m.t, from, to)) return;
      const [x, y] = indexToPixel(m.tile, w);
      switch (m.kind) {
        case 'built':
          this.pillar(x, y, [0.37, 0.88, 1], 0.9);
          this.addLabel(m.tile, `${m.text} online`, 'good', 1.8, -40);
          this.onCue('unit-online');
          break;
        case 'capture':
          this.burst(x, y, GOLD, 26);
          if (!this.reduceMotion) {
            this.trauma = Math.min(1, this.trauma + 0.25);
            this.flash = { color: GOLD, alpha: 0.12 };
          }
          this.addLabel(m.tile, `Captured ${m.text}`, 'gold', 2.4, -44);
          this.onCue('capture');
          break;
        case 'lost':
        case 'razed':
          this.explode(x, y - 6, 1.6, ENEMY);
          if (!this.reduceMotion) this.flash = { color: ENEMY, alpha: 0.25 };
          this.addLabel(m.tile, m.kind === 'razed' ? `${m.text} razed` : `${m.text} lost`, 'bad', 2.4, -44);
          this.onCue('alert');
          break;
        case 'rise':
          this.burst(x, y, BIO, 22);
          this.pillar(x, y, RIFT, 1.1);
          this.addLabel(m.tile, `${m.text} rises`, 'bad', 2.2, -54);
          if (!this.reduceMotion) this.trauma = Math.min(1, this.trauma + 0.2);
          this.onCue('abyss-roar');
          break;
        case 'ravaged':
          this.burst(x, y - 6, BIO, 30);
          this.explode(x, y - 6, 1.3, RIFT);
          if (!this.reduceMotion) this.flash = { color: RIFT, alpha: 0.18 };
          this.addLabel(m.tile, `${m.text} ravaged`, 'bad', 2.4, -48);
          this.onCue('alert');
          break;
        case 'sealed':
          this.pillar(x, y, [0.37, 0.88, 1], 1.4);
          this.burst(x, y, [0.37, 0.88, 1], 30);
          if (!this.reduceMotion) this.flash = { color: [0.37, 0.88, 1], alpha: 0.16 };
          this.addLabel(m.tile, 'Rift sealed', 'good', 2.6, -52);
          this.onCue('rift-seal');
          break;
        case 'mother':
        case 'slain':
          this.explode(x, y - 10, 2.2, RIFT);
          this.burst(x, y, BIO, 40);
          if (!this.reduceMotion) {
            this.trauma = 1;
            this.flash = { color: m.kind === 'slain' ? GOLD : RIFT, alpha: 0.3 };
          }
          this.addLabel(m.tile, m.kind === 'slain' ? 'The Abyss Mother is dead' : 'The Mother retreats', m.kind === 'slain' ? 'gold' : 'good', 3, -64);
          this.onCue('mother-call');
          break;
        case 'essence':
          this.burst(x, y - 6, [0.37, 0.62, 0.61], 12);
          this.addLabel(m.tile, m.text, 'essence', 2, -36);
          break;
        case 'salvage': {
          const c = rarityRgb(m.rarity);
          this.pillar(x, y, c, 1.4);
          this.burst(x, y - 10, c, 18);
          this.addLabel(m.tile, `${cap(m.rarity ?? 'common')} cache`, `rarity-${m.rarity}`, 2.4, -48);
          this.onCue('core-pulse');
          break;
        }
      }
    });
  }

  private explode(x: number, y: number, size: number, color: RGB) {
    this.particles.push({ x, y, vx: 0, vy: 0, age: 0, life: 0.55, size, color, glow: false, gravity: 0, sprite: 'fx_explosion.png' });
    this.particles.push({ x, y, vx: 0, vy: 0, age: 0, life: 0.45, size: 3.2 * size, color, glow: true, gravity: 0, sprite: 'gen:glow' });
    const n = Math.round(14 * size);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 60 + Math.random() * 160 * size;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, age: 0, life: 0.35 + Math.random() * 0.4, size: 1 + Math.random() * 1.5, color: Math.random() < 0.5 ? color : [1, 0.93, 0.7], glow: true, gravity: 260, sprite: 'gen:px' });
    }
    for (let i = 0; i < Math.round(6 * size); i++) {
      const a = -Math.PI * (0.15 + Math.random() * 0.7);
      const v = 50 + Math.random() * 90;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: 0.6 + Math.random() * 0.4, size: 1.5 + Math.random(), color: [0.12, 0.13, 0.14], glow: false, gravity: 320, sprite: 'gen:px' });
    }
  }

  private burst(x: number, y: number, color: RGB, n: number) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const v = 70 + Math.random() * 50;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6, age: 0, life: 0.7, size: 1.4, color, glow: true, gravity: 0, sprite: 'gen:px' });
    }
  }

  private pillar(x: number, y: number, color: RGB, life: number) {
    this.particles.push({ x, y: y - 40, vx: 0, vy: 0, age: 0, life, size: -1, color, glow: true, gravity: 0, sprite: 'pillar' });
  }

  /** Smooth pixel position of a unit at the current Watch time. */
  private unitPos(unitId: number, tile: number): [number, number] {
    const grid = this.world;
    const p = this.tl ? positionAt(this.tl, unitId, this.wt) : null;
    if (!p) return indexToPixel(tile, grid);
    const [a, b, f] = p;
    const [ax, ay] = indexToPixel(a, grid);
    if (a === b) return [ax, ay];
    let [bx, by] = indexToPixel(b, grid);
    bx = this.near(bx, ax);
    const ease = f * f * (3 - 2 * f);
    return [ax + (bx - ax) * ease, ay + (by - ay) * ease];
  }

  render(state: GameState, visible: Set<number>, opts: ViewOptions, now: number) {
    const r = this.r;
    const world = this.world;
    const lap = worldPixelWidth(world);
    // Screen shake: offset the camera for this frame only.
    const cam = r.camera;
    const baseX = cam.x;
    const baseY = cam.y;
    if (this.trauma > 0 && !this.reduceMotion) {
      const s = this.trauma * this.trauma * 9 / cam.zoom;
      cam.x += s * Math.sin(now * 71.3);
      cam.y += s * Math.cos(now * 53.9);
    }
    const b = r.viewBounds();
    const seen = (t: number) => !!opts.revealAll || visible.has(t);
    r.begin();

    // Terrain, territory, fog and grid.
    const row0 = Math.max(0, Math.floor(b.y0 / ROW_STEP) - 1);
    const row1 = Math.min(world.height - 1, Math.ceil(b.y1 / ROW_STEP) + 1);
    const col0 = Math.floor(b.x0 / HEX_W) - 1;
    const col1 = Math.ceil(b.x1 / HEX_W) + 1;
    const riftPulse = 0.16 + 0.1 * Math.sin(now * 2.2);
    for (let row = row0; row <= row1; row++) {
      for (let ucol = col0; ucol <= col1; ucol++) {
        const idx = row * world.width + wrapCol(ucol, world.width);
        const [x, y] = hexToPixel(ucol, row);
        if (!state.explored[idx] && !opts.revealAll) {
          // Fog: the shape of the world, nothing more.
          r.draw('gen:hex-fill', x, y, { tint: [0.035, 0.07, 0.1, 1] });
          if (opts.showGrid) r.draw('gen:hex-line', x, y, { tint: [0.07, 0.12, 0.16, 0.8] });
          continue;
        }
        const lit = visible.has(idx) || (!!opts.revealAll && !state.explored[idx]);
        const tint: [number, number, number, number] = lit ? [1, 1, 1, 1] : [0.42, 0.5, 0.58, 1];
        const terr = TERRAIN[world.terrain[idx]];
        r.draw(terr.art, x, y, { tint });
        if (terr.id === 'rift') r.draw('gen:glow', x, y, { scale: 2.6, tint: [...RIFT, lit ? riftPulse : riftPulse * 0.5], additive: true });
        const owner = opts.territory.get(idx);
        if (owner) {
          const c = this.colorOf(state, owner);
          const mine = owner === PLAYER;
          r.draw('gen:hex-fill', x, y, { tint: [c[0], c[1], c[2], mine ? 0.06 : 0.14] });
          r.draw('gen:hex-line', x, y, { tint: [c[0], c[1], c[2], mine ? 0.25 : 0.4] });
        } else if (opts.showGrid) r.draw('gen:hex-line', x, y, { tint: [0.04, 0.09, 0.13, 0.55] });
      }
    }

    // Draw anything with a tile position once per visible lap of the wrap.
    const laps = (px: number): number[] => {
      const out: number[] = [];
      for (let k = Math.floor((b.x0 - px) / lap) - 1; k <= Math.ceil((b.x1 - px) / lap) + 1; k++) {
        const x = px + k * lap;
        if (x > b.x0 - 128 && x < b.x1 + 128) out.push(x);
      }
      return out;
    };
    const bar = (x: number, y: number, frac: number, color: RGB) => {
      r.draw('gen:px', x, y, { size: [26, 5], tint: [0.02, 0.03, 0.05, 0.85] });
      const w = Math.max(1, 24 * frac);
      r.draw('gen:px', x - 12 + w / 2, y, { size: [w, 3], tint: [color[0], color[1], color[2], 1] });
    };

    // Unsearched ruins you know about shimmer, so they read as loot.
    const searched = new Set(state.salvaged);
    for (const t of world.ruins) {
      if (!state.explored[t] || searched.has(t)) continue;
      const [px, py] = indexToPixel(t, world);
      const a = 0.18 + 0.12 * Math.sin(now * 3 + t);
      for (const x of laps(px)) r.draw('gen:glow', x, py - 6, { scale: 1.6, tint: [0.72, 0.55, 1, a], additive: true });
    }

    // Open rifts breathe; sealed ones are a cold ring. The heart, or the Mother, waits in each open one.
    const guardGhost = (tile: number) => !!this.tl && (this.tl.ghosts.get(guardId(tile))?.until ?? -1) > this.wt;
    for (const rift of state.rifts) {
      if (!state.explored[rift.tile] && !opts.revealAll) continue;
      const [px, py] = indexToPixel(rift.tile, world);
      const lit = seen(rift.tile) ? 1 : 0.5;
      for (const x of laps(px)) {
        if (rift.sealed) {
          r.draw('gen:hex-ring', x, py, { scale: 0.7, tint: [0.37, 0.88, 1, 0.35 * lit] });
          continue;
        }
        const k = 0.5 + 0.5 * Math.sin(now * (rift.mother ? 1.3 : 2) + rift.tile);
        r.draw('gen:glow', x, py, { scale: rift.mother ? 4 : 3, tint: [...RIFT, (0.2 + 0.15 * k) * lit], additive: true });
        r.draw('gen:glow', x, py - 6, { scale: 1.6, tint: [...BIO, (0.12 + 0.1 * k) * lit], additive: true });
        if (guardGhost(rift.tile)) continue;
        const type = rift.mother ? MOTHER : RIFT_HEART;
        r.draw(`unit_${type}_idle.png`, x, py - 8, { frame: Math.floor(now * 4 + rift.tile), scale: unitDef(type).drawScale ?? 0.5, team: BIO, tint: [lit, lit, lit, 1] });
        if (rift.hp < 100 && seen(rift.tile)) bar(x, py + 28, rift.hp / 100, RIFT);
      }
    }

    // Hover, selection and the advisor's pointer.
    const player = this.colorOf(state, PLAYER);
    if (opts.hoverTile !== null && opts.hoverTile >= 0) {
      const [hx, hy] = indexToPixel(opts.hoverTile, world);
      for (const x of laps(hx)) r.draw('gen:hex-line', x, hy, { tint: [0.9, 0.95, 1, 0.5] });
    }
    if (opts.selectedTile !== null) {
      const [sx, sy] = indexToPixel(opts.selectedTile, world);
      const pulse = 0.65 + 0.35 * Math.sin(now * 5);
      for (const x of laps(sx)) r.draw('gen:hex-ring', x, sy, { tint: [...player, pulse] });
    }
    if (opts.adviceTile !== null && opts.adviceTile !== undefined && !this.tl) {
      const [ax, ay] = indexToPixel(opts.adviceTile, world);
      const k = (now * 0.9) % 1;
      for (const x of laps(ax)) {
        r.draw('gen:hex-ring', x, ay, { scale: 1 + k * 0.5, tint: [...GOLD, 0.7 * (1 - k)] });
        r.draw('gen:hex-line', x, ay, { tint: [...GOLD, 0.55] });
      }
    }

    // Settlements (seen ones keep their last look in the fog), with window light.
    for (const s of state.structures) {
      if (!state.explored[s.tile] && !opts.revealAll) continue;
      const [px, py] = indexToPixel(s.tile, world);
      const art = s.type === 'ai-node' ? `structure_ai-node_stage${s.stage}.png` : `structure_city-${s.culture}_stage${s.stage}.png`;
      const team = this.colorOf(state, s.owner);
      const lit = seen(s.tile) ? 1 : 0.55;
      const mine = s.owner === PLAYER;
      const glow: RGB = mine ? player : AMBER;
      const breathe = mine ? 0.22 + 0.06 * Math.sin(now * 1.7) : 0.14;
      for (const x of laps(px)) {
        r.draw('gen:glow', x, py - 8, { scale: 2.2 + s.stage * 0.3, tint: [...glow, breathe * lit], additive: true });
        r.draw(art, x, py - 12, { team, tint: [lit, lit, lit, 1] });
        if (s.capitalOf) r.draw('gen:dot', x + 22, py - 34, { scale: 1.4, tint: [...GOLD, 1] });
        if (s.hp < 100 && seen(s.tile)) bar(x, py + 26, s.hp / 100, [1, 0.78, 0.3]);
      }
    }

    // Routes and strikes: queued ones bright, standing ones faint.
    const drawRoute = (route: number[], alpha: number, color: RGB) => {
      for (let i = 0; i < route.length; i++) {
        const [px, py] = indexToPixel(route[i], world);
        const last = i === route.length - 1;
        for (const x of laps(px)) r.draw('gen:dot', x, py, { scale: last ? 1.5 : 1, tint: [...color, alpha] });
      }
    };
    if (!this.tl) {
      for (const u of state.units) {
        if (u.owner !== PLAYER) continue;
        const queued = opts.queuedRoutes.get(u.id);
        if (queued) drawRoute(queued, u.id === opts.selectedUnit ? 1 : 0.8, player);
        else if (u.route.length) drawRoute(u.route, 0.4, player);
        const strike = opts.queuedStrikes.get(u.id) ?? u.attackTile;
        if (strike !== null && strike !== undefined) {
          const [px, py] = indexToPixel(strike, world);
          const pulse = 0.6 + 0.4 * Math.sin(now * 8);
          for (const x of laps(px)) r.draw('gen:hex-ring', x, py, { tint: [...ENEMY, opts.queuedStrikes.has(u.id) ? pulse : 0.45] });
        }
      }
    }

    // Units: spread out when several share a hex. Foreign units only in sight.
    const byTile = new Map<number, number[]>();
    for (const u of state.units) {
      const list = byTile.get(u.tile) ?? [];
      list.push(u.id);
      byTile.set(u.tile, list);
    }
    const hasSettlement = new Set(state.structures.map((s) => s.tile));
    const drawUnit = (id: number, type: string, owner: string, px: number, py: number, ox: number, oy: number, hp: number, alpha: number) => {
      const def = unitDef(type);
      const frame = Math.floor(now * 6 + id * 1.7);
      const selected = id === opts.selectedUnit;
      const air = def.domain === 'air' ? -6 + Math.sin(now * 2 + id) * 1.5 : 0;
      const team = selected ? ([1, 1, 1] as RGB) : this.colorOf(state, owner);
      const scale = def.drawScale ?? 0.75;
      // Big art stands on the hex rather than floating over it.
      const lift = def.kaiju || def.titan ? -10 : 0;
      for (const x of laps(px)) {
        if (owner === PLAYER) r.draw('gen:glow', x + ox, py + oy + air + 6, { scale: def.titan ? 1.8 : 1.1, tint: [...team, 0.18 * alpha], additive: true });
        else if (owner === ABYSS) r.draw('gen:glow', x + ox, py + oy + 6, { scale: def.kaiju ? 2.2 : 1.2, tint: [...RIFT, 0.22 * alpha], additive: true });
        if (def.titan) this.drawTitan(type, x + ox, py + oy + lift, scale, team, alpha, now, id);
        else r.draw(`unit_${type}_idle.png`, x + ox, py + oy + air + lift, { frame, scale, team, tint: [1, 1, 1, alpha] });
        if (hp < 100) bar(x + ox, py + oy + air + 24, hp / 100, hp > 50 ? [0.37, 0.88, 0.54] : [1, 0.23, 0.29]);
      }
    };
    const watching = !!this.tl;
    for (const u of [...state.units].sort((a, b) => a.tile - b.tile || a.id - b.id)) {
      const moving = watching && this.tl!.segments.has(u.id);
      if (u.owner !== PLAYER && !seen(u.tile) && !moving) continue;
      const [px, py] = this.unitPos(u.id, u.tile);
      const mates = byTile.get(u.tile)!;
      let ox = 0;
      let oy = hasSettlement.has(u.tile) ? 10 : -4;
      if (mates.length > 1 && !moving) {
        const k = mates.indexOf(u.id);
        ox = (k - (mates.length - 1) / 2) * 18;
        oy += k % 2 ? 4 : 0;
      }
      drawUnit(u.id, u.type, u.owner, px, py, ox, oy, u.hp, 1);
    }
    // The dead, until the moment they die.
    if (watching) {
      for (const [id, g] of this.tl!.ghosts) {
        if (this.wt >= g.until) continue;
        if (id < 0) {
          // A rift's heart or the Mother: drawn in its rift until the blow lands.
          const [px, py] = indexToPixel(g.tile, this.world);
          const flick = g.until - this.wt < 0.25 ? (Math.floor(now * 30) % 2 ? 0.4 : 1) : 1;
          for (const x of laps(px)) r.draw(`unit_${g.type}_idle.png`, x, py - 8, { frame: Math.floor(now * 4), scale: unitDef(g.type).drawScale ?? 0.5, team: BIO, tint: [1, 1, 1, flick] });
          continue;
        }
        const [px, py] = this.unitPos(id, g.tile);
        const left = g.until - this.wt;
        const flicker = left < 0.25 ? (Math.floor(now * 30) % 2 ? 0.4 : 1) : 1;
        drawUnit(id, g.type, g.owner, px, py, 0, hasSettlement.has(g.tile) ? 10 : -4, 100, flicker);
      }
      this.drawFights(laps);
    }

    // Particles and one-shot FX.
    for (const p of this.particles) {
      const k = p.age / p.life;
      for (const x of laps(p.x)) {
        if (p.sprite === 'fx_explosion.png') {
          r.draw('fx_explosion.png', x, p.y, { frame: Math.min(7, Math.floor(k * 8)), scale: p.size });
        } else if (p.sprite === 'pillar') {
          const a = Math.sin(Math.min(1, k) * Math.PI);
          r.draw('gen:glow', x, p.y, { size: [26, 150], tint: [...p.color, 0.65 * a], additive: true });
          r.draw('gen:glow', x, p.y + 40, { scale: 2.4, tint: [...p.color, 0.5 * a], additive: true });
        } else {
          r.draw(p.sprite, x, p.y, { scale: p.sprite === 'gen:glow' ? p.size * (0.6 + k) : p.size, tint: [...p.color, p.sprite === 'gen:glow' ? 0.9 * (1 - k) : 1 - k * k], additive: p.glow });
        }
      }
    }

    // Screen flash.
    if (this.flash) {
      r.draw('gen:px', (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, { size: [b.x1 - b.x0 + 20, b.y1 - b.y0 + 20], tint: [...this.flash.color, this.flash.alpha], additive: true });
    }

    r.end(VOID);
    cam.x = baseX;
    cam.y = baseY;
  }

  private drawFights(laps: (px: number) => number[]) {
    const r = this.r;
    const w = this.world;
    for (const f of this.tl!.fights) {
      const lt = this.wt - f.t;
      if (lt < -0.05 || lt > f.dur + 0.2) continue;
      const [ax, ay] = indexToPixel(f.e.from, w);
      let [dx, dy] = indexToPixel(f.e.tile, w);
      dx = this.near(dx, ax);
      // The fight hex glows while it is live.
      const live = Math.max(0, 1 - Math.max(0, lt - f.impact) / 0.4);
      for (const x of laps(dx)) r.draw('gen:hex-ring', x, dy, { tint: [...(f.mine ? ENEMY : AMBER), 0.75 * live] });
      for (const s of shotsFor(f)) {
        const flight = s.kind === 'missile' ? MISSILE_FLIGHT : SHOT_FLIGHT;
        const st = lt - s.at;
        if (st < 0 || st > flight + 0.12) continue;
        const [sx, sy] = s.fromA ? [ax, ay - 6] : [dx, dy - 6];
        const [tx, ty] = s.fromA ? [dx, dy - 6] : [ax, ay - 6];
        const ang = Math.atan2(ty - sy, tx - sx);
        const color: RGB = SHOT_COLOR[s.kind];
        // Muzzle flash.
        if (st < 0.08) {
          for (const x of laps(sx)) {
            r.draw('fx_muzzle.png', x + Math.cos(ang) * 12, sy + Math.sin(ang) * 12, { frame: Math.floor((st / 0.08) * 4), rotation: ang, additive: true, tint: [...color, 1] });
          }
        }
        if (st <= flight) {
          const k = st / flight;
          const e = s.kind === 'missile' ? k * k : k;
          const px = sx + (tx - sx) * e;
          const py = sy + (ty - sy) * e - (s.kind === 'missile' || s.kind === 'shell' || s.kind === 'bio' ? Math.sin(k * Math.PI) * 18 : 0);
          for (const x of laps(px)) {
            r.draw('fx_tracer.png', x, py, { rotation: ang, scale: s.kind === 'missile' ? 1.4 : 1, tint: [...color, 1], additive: true });
            r.draw('gen:glow', x, py, { scale: s.kind === 'missile' ? 1.2 : 0.6, tint: [...color, 0.7], additive: true });
          }
          if (s.kind === 'missile' && Math.random() < 0.6) {
            this.particles.push({ x: px, y: py, vx: (Math.random() - 0.5) * 20, vy: -10, age: 0, life: 0.5, size: 1.6, color: [0.5, 0.5, 0.52], glow: false, gravity: -20, sprite: 'gen:dot' });
          }
        } else {
          // Hit spark where it lands.
          for (const x of laps(tx)) r.draw('fx_impact.png', x, ty, { frame: Math.min(5, Math.floor(((st - flight) / 0.12) * 6)), scale: 0.45, additive: true });
        }
      }
    }
  }

  /** A TBU, layered from its parts' art: back, far arm, legs, core, near arm, head. */
  private drawTitan(type: string, x: number, y: number, scale: number, team: RGB, alpha: number, now: number, id: number) {
    const parts = titanParts(type);
    if (!parts) return;
    const r = this.r;
    const bob = Math.round(Math.sin(now * 3 + id) * 1);
    const s = 128 * scale;
    const order = ['back', 'armL', 'legs', 'core', 'armR', 'head'] as const;
    for (const slot of order) {
      const file = `tbu_${slot === 'armL' || slot === 'armR' ? 'arm' : slot}_${parts[slot].id}.png`;
      const far = slot === 'armL';
      const dy = slot === 'legs' ? 0 : bob;
      r.draw(file, x + (far ? -6 * scale : slot === 'armR' ? 4 * scale : 0), y + dy, {
        size: far ? [-s, s] : [s, s],
        team,
        tint: far ? [0.7, 0.7, 0.75, alpha] : [1, 1, 1, alpha],
      });
    }
  }

  /** Centre the camera on a tile. */
  focus(tile: number) {
    const [x, y] = indexToPixel(tile, this.world);
    this.r.camera.x = x;
    this.r.camera.y = y;
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function rarityRgb(r?: string): RGB {
  const def = REWARDS.rarities.find((d) => d.id === r) ?? REWARDS.rarities[0];
  return rgb(def.color);
}
