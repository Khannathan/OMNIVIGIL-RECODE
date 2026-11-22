// Draws one frame of the homeworld: terrain, fog, grid, structures, units,
// routes and selection, with the east-west wrap. Also plays the Watch beat:
// unit moves from the last cycle glide along their paths.

import { TERRAIN, unitDef } from '../content';
import { hexToPixel, indexToPixel, ROW_STEP, HEX_W, worldPixelWidth, wrapCol } from '../sim/hex';
import { GameEvent, GameState } from '../sim/state';
import { World } from '../sim/worldgen';
import { Renderer } from './renderer';

const PLAYER: [number, number, number] = [0x5f / 255, 0xe0 / 255, 1];
const VOID: [number, number, number] = [4 / 255, 7 / 255, 13 / 255];
const STEP_SECONDS = 0.16;

export interface ViewOptions {
  showGrid: boolean;
  selectedTile: number | null;
  selectedUnit: number | null;
  hoverTile: number | null;
  /** Routes from move orders queued this cycle, by unit id. */
  queuedRoutes: Map<number, number[]>;
  /** Dev aid: draw the whole map. */
  revealAll?: boolean;
}

interface Glide {
  path: number[]; // includes the start tile
  start: number;
}

export class GameView {
  private glides = new Map<number, Glide>();
  private watchStart = 0;
  private watchEnd = 0;

  constructor(
    private r: Renderer,
    private world: World,
  ) {}

  /** Start the Watch beat for a resolved cycle. Returns its length in seconds. */
  playWatch(events: GameEvent[], before: Map<number, number>, now: number): number {
    this.glides.clear();
    let longest = 0;
    for (const e of events) {
      if (e.kind !== 'moved') continue;
      const from = before.get(e.unitId);
      if (from === undefined) continue;
      this.glides.set(e.unitId, { path: [from, ...e.path], start: now });
      longest = Math.max(longest, e.path.length);
    }
    this.watchStart = now;
    this.watchEnd = now + longest * STEP_SECONDS;
    return longest * STEP_SECONDS;
  }

  skipWatch() {
    this.glides.clear();
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
    r.begin();

    // Terrain, fog and grid.
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
        if (opts.showGrid) r.draw('gen:hex-line', x, y, { tint: [0.04, 0.09, 0.13, 0.55] });
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

    // Hover and selection.
    if (opts.hoverTile !== null && opts.hoverTile >= 0) {
      const [hx, hy] = indexToPixel(opts.hoverTile, world);
      for (const x of laps(hx)) r.draw('gen:hex-line', x, hy, { tint: [0.9, 0.95, 1, 0.5] });
    }
    if (opts.selectedTile !== null) {
      const [sx, sy] = indexToPixel(opts.selectedTile, world);
      const pulse = 0.65 + 0.35 * Math.sin(now * 5);
      for (const x of laps(sx)) r.draw('gen:hex-ring', x, sy, { tint: [...PLAYER, pulse] });
    }

    // Structures.
    for (const s of state.structures) {
      const [px, py] = indexToPixel(s.tile, world);
      for (const x of laps(px)) {
        r.draw(`structure_${s.type}_stage${s.stage}.png`, x, py - 12, { team: PLAYER });
      }
    }

    // Routes: the previewed one, then every standing route.
    const drawRoute = (route: number[], alpha: number) => {
      for (let i = 0; i < route.length; i++) {
        const [px, py] = indexToPixel(route[i], world);
        const last = i === route.length - 1;
        for (const x of laps(px)) {
          r.draw('gen:dot', x, py, { scale: last ? 1.5 : 1, tint: [...PLAYER, alpha] });
        }
      }
    };
    for (const u of state.units) {
      const queued = opts.queuedRoutes.get(u.id);
      if (queued) drawRoute(queued, u.id === opts.selectedUnit ? 1 : 0.8);
      else if (u.route.length) drawRoute(u.route, 0.4);
    }

    // Units: spread out when several share a hex.
    const byTile = new Map<number, number[]>();
    for (const u of state.units) {
      const list = byTile.get(u.tile) ?? [];
      list.push(u.id);
      byTile.set(u.tile, list);
    }
    const hasNode = new Set(state.structures.map((s) => s.tile));
    for (const u of [...state.units].sort((a, b) => a.tile - b.tile || a.id - b.id)) {
      const [px, py] = this.unitPos(u.id, u.tile, now);
      const mates = byTile.get(u.tile)!;
      const gliding = this.glides.has(u.id) && this.isWatching(now);
      let ox = 0;
      let oy = hasNode.has(u.tile) ? 10 : -4;
      if (mates.length > 1 && !gliding) {
        const k = mates.indexOf(u.id);
        ox = (k - (mates.length - 1) / 2) * 18;
        oy += k % 2 ? 4 : 0;
      }
      const def = unitDef(u.type);
      const frame = Math.floor(now * 6 + u.id * 1.7);
      const selected = u.id === opts.selectedUnit;
      const air = def.domain === 'air' ? -6 : 0;
      for (const x of laps(px)) {
        r.draw(`unit_${u.type}_idle.png`, x + ox, py + oy + air, {
          frame,
          scale: 0.75,
          team: selected ? [1, 1, 1] : PLAYER,
        });
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
