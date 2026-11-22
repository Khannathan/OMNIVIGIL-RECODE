// Draws one frame of the homeworld: terrain, fog, territory, grid,
// settlements, units, routes and selection, with the east-west wrap. Also
// plays the Watch beat: units glide along their paths, then fights flash.

import { TERRAIN, unitDef } from '../content';
import { hexToPixel, indexToPixel, ROW_STEP, HEX_W, worldPixelWidth, wrapCol } from '../sim/hex';
import { CombatEvent, GameEvent, GameState, PLAYER } from '../sim/state';
import { World } from '../sim/worldgen';
import { Renderer, rgb } from './renderer';

type RGB = [number, number, number];
const VOID: RGB = [4 / 255, 7 / 255, 13 / 255];
const ENEMY: RGB = [1, 0x3a / 255, 0x4a / 255];
const STEP_SECONDS = 0.16;
const FIGHT_SECONDS = 0.45;

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
  /** Dev aid: draw the whole map. */
  revealAll?: boolean;
}

interface Glide {
  path: number[]; // includes the start tile
  start: number;
}

interface Flash {
  tile: number;
  from: number;
  start: number;
  won: boolean;
  mine: boolean;
}

export class GameView {
  private glides = new Map<number, Glide>();
  private flashes: Flash[] = [];
  private watchStart = 0;
  private watchEnd = 0;
  private colors = new Map<string, RGB>();

  constructor(
    private r: Renderer,
    private world: World,
  ) {}

  private colorOf(state: GameState, owner: string): RGB {
    const key = owner === PLAYER ? `p:${state.ai.color}` : owner;
    let c = this.colors.get(key);
    if (!c) {
      const hex = owner === PLAYER ? state.ai.color : state.factions.find((f) => f.id === owner)?.color ?? '#ff3a4a';
      c = rgb(hex);
      this.colors.set(key, c);
    }
    return c;
  }

  /** Start the Watch beat for a resolved cycle. Returns its length in seconds. */
  playWatch(events: GameEvent[], before: Map<number, number>, visible: Set<number>, now: number): number {
    this.glides.clear();
    this.flashes = [];
    let longest = 0;
    for (const e of events) {
      if (e.kind !== 'moved') continue;
      const from = before.get(e.unitId);
      if (from === undefined) continue;
      const seen = e.owner === PLAYER || visible.has(from) || e.path.some((t) => visible.has(t));
      if (!seen) continue;
      const g = this.glides.get(e.unitId);
      // A unit can move twice (walk, then advance after a win): chain them.
      if (g) g.path.push(...e.path);
      else this.glides.set(e.unitId, { path: [from, ...e.path], start: now });
      longest = Math.max(longest, (this.glides.get(e.unitId)!.path.length - 1));
    }
    let t = now + longest * STEP_SECONDS;
    const fights = events.filter((e): e is CombatEvent => e.kind === 'combat' && (visible.has(e.tile) || e.attackerOwner === PLAYER || e.defenderOwner === PLAYER));
    for (const f of fights.slice(0, 8)) {
      this.flashes.push({ tile: f.tile, from: f.from, start: t, won: f.attackerWon, mine: f.attackerOwner === PLAYER || f.defenderOwner === PLAYER });
      t += FIGHT_SECONDS;
    }
    this.watchStart = now;
    this.watchEnd = t;
    return t - now;
  }

  skipWatch() {
    this.glides.clear();
    this.flashes = [];
    this.watchEnd = 0;
  }

  isWatching(now: number): boolean {
    return now < this.watchEnd;
  }

  private unitPos(unitId: number, tile: number, now: number): [number, number] {
    const g = this.glides.get(unitId);
    const grid = this.world;
    if (!g || now >= this.watchEnd) return indexToPixel(tile, grid);
    const t = Math.max(0, (now - this.watchStart) / STEP_SECONDS);
    const i = Math.min(Math.floor(t), g.path.length - 1);
    const f = Math.min(1, t - i);
    const [ax, ay] = indexToPixel(g.path[i], grid);
    if (i >= g.path.length - 1) return [ax, ay];
    let [bx, by] = indexToPixel(g.path[i + 1], grid);
    // Glide the short way across the wrap seam.
    const lap = worldPixelWidth(grid);
    if (bx - ax > lap / 2) bx -= lap;
    if (ax - bx > lap / 2) bx += lap;
    const ease = f * f * (3 - 2 * f);
    return [ax + (bx - ax) * ease, ay + (by - ay) * ease];
  }

  render(state: GameState, visible: Set<number>, opts: ViewOptions, now: number) {
    const r = this.r;
    const world = this.world;
    const lap = worldPixelWidth(world);
    const b = r.viewBounds();
    const seen = (t: number) => !!opts.revealAll || visible.has(t);
    r.begin();

    // Terrain, territory, fog and grid.
    const row0 = Math.max(0, Math.floor(b.y0 / ROW_STEP) - 1);
    const row1 = Math.min(world.height - 1, Math.ceil(b.y1 / ROW_STEP) + 1);
    const col0 = Math.floor(b.x0 / HEX_W) - 1;
    const col1 = Math.ceil(b.x1 / HEX_W) + 1;
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
        r.draw(TERRAIN[world.terrain[idx]].art, x, y, { tint });
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

    // Hover and selection.
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

    // Settlements (seen ones keep their last look in the fog).
    for (const s of state.structures) {
      if (!state.explored[s.tile] && !opts.revealAll) continue;
      const [px, py] = indexToPixel(s.tile, world);
      const art = s.type === 'ai-node' ? `structure_ai-node_stage${s.stage}.png` : `structure_city-${s.culture}_stage${s.stage}.png`;
      const team = this.colorOf(state, s.owner);
      const lit = seen(s.tile) ? 1 : 0.55;
      for (const x of laps(px)) {
        r.draw(art, x, py - 12, { team, tint: [lit, lit, lit, 1] });
        if (s.capitalOf) r.draw('gen:dot', x + 22, py - 34, { scale: 1.4, tint: [1, 0.82, 0.35, 1] });
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

    // Units: spread out when several share a hex. Foreign units only in sight.
    const byTile = new Map<number, number[]>();
    for (const u of state.units) {
      const list = byTile.get(u.tile) ?? [];
      list.push(u.id);
      byTile.set(u.tile, list);
    }
    const hasSettlement = new Set(state.structures.map((s) => s.tile));
    for (const u of [...state.units].sort((a, b) => a.tile - b.tile || a.id - b.id)) {
      const gliding = this.glides.has(u.id) && this.isWatching(now);
      if (u.owner !== PLAYER && !seen(u.tile) && !gliding) continue;
      const [px, py] = this.unitPos(u.id, u.tile, now);
      const mates = byTile.get(u.tile)!;
      let ox = 0;
      let oy = hasSettlement.has(u.tile) ? 10 : -4;
      if (mates.length > 1 && !gliding) {
        const k = mates.indexOf(u.id);
        ox = (k - (mates.length - 1) / 2) * 18;
        oy += k % 2 ? 4 : 0;
      }
      const def = unitDef(u.type);
      const frame = Math.floor(now * 6 + u.id * 1.7);
      const selected = u.id === opts.selectedUnit;
      const air = def.domain === 'air' ? -6 : 0;
      const team = selected ? ([1, 1, 1] as RGB) : this.colorOf(state, u.owner);
      for (const x of laps(px)) {
        r.draw(`unit_${u.type}_idle.png`, x + ox, py + oy + air, { frame, scale: 0.75, team });
        if (u.hp < 100) bar(x + ox, py + oy + air + 24, u.hp / 100, u.hp > 50 ? [0.37, 0.88, 0.54] : [1, 0.23, 0.29]);
      }
    }

    // Fights, one after another.
    for (const f of this.flashes) {
      const t = now - f.start;
      if (t < 0 || t > FIGHT_SECONDS * 1.6) continue;
      const k = Math.min(1, t / FIGHT_SECONDS);
      const [px, py] = indexToPixel(f.tile, world);
      const frame = Math.min(5, Math.floor(k * 6));
      const color: RGB = f.mine ? (f.won ? player : ENEMY) : [1, 0.85, 0.5];
      for (const x of laps(px)) {
        r.draw('gen:hex-ring', x, py, { tint: [...color, 1 - k * 0.6] });
        r.draw('fx_impact.png', x, py - 6, { frame, scale: 0.9 });
      }
    }

    r.end(VOID);
  }

  /** Centre the camera on a tile. */
  focus(tile: number) {
    const [x, y] = indexToPixel(tile, this.world);
    this.r.camera.x = x;
    this.r.camera.y = y;
  }
}
