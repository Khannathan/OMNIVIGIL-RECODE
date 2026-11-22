// A* over the hex map. Deterministic: ties break on tile index.

import { TERRAIN, UnitDef } from '../content';
import { distance, GridSize, neighbors } from './hex';

export interface MapView extends GridSize {
  terrain: Uint8Array;
}

/** Cost to enter a tile, or null when the unit can't go there. */
export function enterCost(def: UnitDef, terrain: number): number | null {
  if (def.domain === 'air') return 1;
  return TERRAIN[terrain].moveCost;
}

/**
 * Finds the cheapest route from `from` to `to`. Returns the tiles to enter
 * (excluding `from`), or null when unreachable. `known` limits the search to
 * explored tiles, so the player can't path through what they haven't seen.
 */
export function findPath(
  map: MapView,
  def: UnitDef,
  from: number,
  to: number,
  known?: Uint8Array,
): number[] | null {
  if (from === to) return [];
  if (enterCost(def, map.terrain[to]) === null) return null;
  if (known && !known[to]) return null;

  const g = new Map<number, number>([[from, 0]]);
  const came = new Map<number, number>();
  // Small binary heap of [f, tile].
  const heap: Array<[number, number]> = [[distance(from, to, map), from]];
  const less = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i], heap[p])) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };

  const closed = new Set<number>();
  while (heap.length) {
    const [, cur] = pop();
    if (cur === to) break;
    if (closed.has(cur)) continue;
    closed.add(cur);
    const base = g.get(cur)!;
    for (const nb of neighbors(cur, map)) {
      if (known && !known[nb]) continue;
      const c = enterCost(def, map.terrain[nb]);
      if (c === null) continue;
      const ng = base + c;
      if (ng < (g.get(nb) ?? Infinity)) {
        g.set(nb, ng);
        came.set(nb, cur);
        push([ng + distance(nb, to, map), nb]);
      }
    }
  }
  if (!came.has(to)) return null;
  const path: number[] = [];
  for (let t = to; t !== from; t = came.get(t)!) path.push(t);
  return path.reverse();
}

/**
 * How far along a route a unit gets this cycle. Civ rule: a unit with full
 * movement can always take one step, even into costly terrain.
 */
export function stepsThisCycle(map: MapView, def: UnitDef, route: number[]): number {
  let mp = def.speed;
  let steps = 0;
  for (const tile of route) {
    const c = enterCost(def, map.terrain[tile]);
    if (c === null) break;
    if (c > mp && mp < def.speed) break;
    mp -= c;
    steps++;
    if (mp <= 0) break;
  }
  return steps;
}
