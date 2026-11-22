// Pointy-top hex grid in "odd-r" offset layout (odd rows are shoved right).
// The map wraps east-west like a globe's longitude, so a tile index is
// row * width + col with col always kept in [0, width).
//
// Art: a hex tile is 64 px wide and 74 px tall (64 * 2 / sqrt(3), rounded).

export const HEX_W = 64;
export const HEX_SIZE = HEX_W / Math.sqrt(3); // centre to corner
export const HEX_H = 74; // image height of a tile
export const ROW_STEP = HEX_SIZE * 1.5;

export interface GridSize {
  width: number;
  height: number;
}

export function wrapCol(col: number, width: number): number {
  return ((col % width) + width) % width;
}

export function toIndex(col: number, row: number, grid: GridSize): number {
  return row * grid.width + wrapCol(col, grid.width);
}

export function colOf(index: number, grid: GridSize): number {
  return index % grid.width;
}

export function rowOf(index: number, grid: GridSize): number {
  return Math.floor(index / grid.width);
}

const EVEN_ROW_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1],
];
const ODD_ROW_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1],
];

/** Neighbouring tile indices (4-6 of them: rows don't wrap at the poles). */
export function neighbors(index: number, grid: GridSize): number[] {
  const col = colOf(index, grid);
  const row = rowOf(index, grid);
  const dirs = row & 1 ? ODD_ROW_DIRS : EVEN_ROW_DIRS;
  const out: number[] = [];
  for (const [dc, dr] of dirs) {
    const r = row + dr;
    if (r < 0 || r >= grid.height) continue;
    out.push(toIndex(col + dc, r, grid));
  }
  return out;
}

function toAxial(col: number, row: number): [number, number] {
  return [col - (row - (row & 1)) / 2, row];
}

/** Hex distance, taking the east-west wrap into account. */
export function distance(a: number, b: number, grid: GridSize): number {
  const [aq, ar] = toAxial(colOf(a, grid), rowOf(a, grid));
  let best = Infinity;
  for (const shift of [-grid.width, 0, grid.width]) {
    const [bq, br] = toAxial(colOf(b, grid) + shift, rowOf(b, grid));
    const dq = aq - bq;
    const dr = ar - br;
    const d = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    if (d < best) best = d;
  }
  return best;
}

/** All tiles within `radius` of `center` (including it). */
export function hexesInRange(center: number, radius: number, grid: GridSize): number[] {
  const seen = new Set<number>([center]);
  let frontier = [center];
  for (let step = 0; step < radius; step++) {
    const next: number[] = [];
    for (const idx of frontier) {
      for (const n of neighbors(idx, grid)) {
        if (!seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return [...seen];
}

/** Centre of a tile in world pixels (unwrapped copy 0). */
export function hexToPixel(col: number, row: number): [number, number] {
  const x = HEX_W * (col + 0.5 * (row & 1)) + HEX_W / 2;
  const y = ROW_STEP * row + HEX_SIZE;
  return [x, y];
}

export function indexToPixel(index: number, grid: GridSize): [number, number] {
  return hexToPixel(colOf(index, grid), rowOf(index, grid));
}

/** World-space width of one full lap of the map. */
export function worldPixelWidth(grid: GridSize): number {
  return HEX_W * grid.width;
}

export function worldPixelHeight(grid: GridSize): number {
  return ROW_STEP * (grid.height - 1) + HEX_SIZE * 2;
}

/** World pixel -> tile index (wrapped), or -1 when off the top or bottom. */
export function pixelToIndex(x: number, y: number, grid: GridSize): number {
  const px = x - HEX_W / 2;
  const py = y - HEX_SIZE;
  const q = ((Math.sqrt(3) / 3) * px - (1 / 3) * py) / HEX_SIZE;
  const r = ((2 / 3) * py) / HEX_SIZE;
  // Cube round.
  let rx = Math.round(q);
  let rz = Math.round(r);
  const s = -q - r;
  let ry = Math.round(s);
  const dx = Math.abs(rx - q);
  const dy = Math.abs(ry - s);
  const dz = Math.abs(rz - r);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy <= dz) rz = -rx - ry;
  const row = rz;
  const col = rx + (rz - (rz & 1)) / 2;
  if (row < 0 || row >= grid.height) return -1;
  return toIndex(col, row, grid);
}
