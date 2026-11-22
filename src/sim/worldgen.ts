// Homeworld generation. Pure function of the seed: the same seed always
// grows the same world, so saves only need the seed plus what changed.

import { NAMES, TERRAIN, terrainId } from '../content';
import { colOf, distance, GridSize, hexesInRange, neighbors, rowOf } from './hex';
import { Noise3 } from './noise';
import { Rng } from './rng';

/** Bump when worldgen output changes, so old saves can warn. */
export const WORLDGEN_VERSION = 1;

export const DEFAULT_GRID: GridSize = { width: 72, height: 44 };

export interface World extends GridSize {
  seed: string;
  name: string;
  /** Short flavour line, e.g. "Cold ocean world". */
  kind: string;
  /** Terrain per tile, as an index into TERRAIN. */
  terrain: Uint8Array;
  /** Land elevation 0..1 (0 for water). Used for shading and future rules. */
  elevation: Float32Array;
  /** Where the AI wakes up. */
  start: number;
  rifts: number[];
  ruins: number[];
  checksum: number;
}

const T = {
  deepSea: terrainId('deep-sea'),
  shallowSea: terrainId('shallow-sea'),
  coast: terrainId('coast'),
  grassland: terrainId('grassland'),
  forest: terrainId('forest'),
  hills: terrainId('hills'),
  mountain: terrainId('mountain'),
  desert: terrainId('desert'),
  tundra: terrainId('tundra'),
  snow: terrainId('snow'),
  marsh: terrainId('marsh'),
  ruins: terrainId('ruins'),
  rift: terrainId('rift'),
};

export function isWater(t: number): boolean {
  return TERRAIN[t].water;
}

export function generateWorld(seed: string, grid: GridSize = DEFAULT_GRID): World {
  const rng = Rng.stream(seed, 'worldgen');
  const { width, height } = grid;
  const n = width * height;

  const elevNoise = new Noise3(rng);
  const moistNoise = new Noise3(rng);
  const heatNoise = new Noise3(rng);

  // Per-world personality.
  const oceanFrac = rng.range(0.5, 0.68);
  const continentFreq = rng.range(0.055, 0.085);
  const warmth = rng.range(-0.12, 0.12);
  const wetness = rng.range(-0.1, 0.1);

  // Sample noise on a cylinder so the east-west seam is invisible.
  const radius = width / (2 * Math.PI);
  const sample = (noise: Noise3, col: number, row: number, freq: number, octaves: number, offset = 0) => {
    const a = ((col + 0.5 * (row & 1)) / width) * Math.PI * 2;
    const x = Math.cos(a) * radius * freq;
    const z = Math.sin(a) * radius * freq;
    const y = row * 0.866 * freq;
    return noise.fbm(x + offset, y + offset, z + offset, octaves);
  };

  const rawElev = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const col = colOf(i, grid);
    const row = rowOf(i, grid);
    const lat = Math.abs(row / (height - 1) - 0.5) * 2;
    let e = sample(elevNoise, col, row, continentFreq, 5);
    // Ridges give mountain chains instead of round blobs.
    e += 0.25 * (1 - Math.abs(sample(elevNoise, col, row, continentFreq * 2.3, 3, 37.1))) - 0.12;
    // Polar seas, so continents don't all hug the map edge.
    e -= Math.pow(lat, 4) * 0.35;
    rawElev[i] = e;
  }

  const sorted = Array.from(rawElev).sort((a, b) => a - b);
  const seaLevel = sorted[Math.floor(oceanFrac * (n - 1))];
  const maxElev = sorted[n - 1];
  // Land relief by quantile, so every world gets a similar share of hills and peaks.
  const landSorted = sorted.filter((e) => e > seaLevel);
  const landQ = (q: number) => landSorted[Math.floor(q * (landSorted.length - 1))] ?? maxElev;
  const mountainLine = landQ(0.93);
  const hillLine = landQ(0.78);

  const terrain = new Uint8Array(n);
  const elevation = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const row = rowOf(i, grid);
    const col = colOf(i, grid);
    const lat = Math.abs(row / (height - 1) - 0.5) * 2;
    if (rawElev[i] <= seaLevel) {
      terrain[i] = T.deepSea; // depth refined below
      continue;
    }
    const e = (rawElev[i] - seaLevel) / Math.max(1e-6, maxElev - seaLevel);
    elevation[i] = e;
    const heat = 1 - Math.pow(lat, 1.4) - e * 0.3 + warmth + 0.12 * sample(heatNoise, col, row, 0.15, 2);
    const moist = 0.5 + 0.5 * sample(moistNoise, col, row, 0.11, 4) + wetness;

    let t: number;
    if (heat < 0.1) t = T.snow;
    else if (rawElev[i] > mountainLine) t = T.mountain;
    else if (heat < 0.24) t = T.tundra;
    else if (rawElev[i] > hillLine) t = T.hills;
    else if (heat > 0.55 && moist < 0.4) t = T.desert;
    else if (moist > 0.66 && e < 0.12) t = T.marsh;
    else if (moist > 0.52) t = T.forest;
    else t = T.grassland;
    terrain[i] = t;
  }

  // Water depth by distance from land: coast, shallows, then the deep.
  const waterDist = new Int32Array(n).fill(-1);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!isWater(terrain[i])) {
      waterDist[i] = 0;
      frontier.push(i);
    }
  }
  for (let d = 1; frontier.length && d <= 3; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const nb of neighbors(i, grid)) {
        if (waterDist[nb] === -1) {
          waterDist[nb] = d;
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  for (let i = 0; i < n; i++) {
    if (!isWater(terrain[i])) continue;
    const d = waterDist[i];
    terrain[i] = d === 1 ? T.coast : d === 2 ? T.shallowSea : T.deepSea;
  }

  // Ice caps on the outermost rows (after depth, so they don't grow a coast ring).
  for (let col = 0; col < width; col++) {
    for (const row of [0, height - 1]) terrain[row * width + col] = T.snow;
    for (const row of [1, height - 2]) {
      if (rng.chance(0.55)) terrain[row * width + col] = T.snow;
    }
  }

  // Ruins: echoes of whoever (or whatever) was here before.
  const landTiles: number[] = [];
  const deepTiles: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = terrain[i];
    if (t === T.deepSea) deepTiles.push(i);
    else if (!isWater(t) && t !== T.snow && t !== T.mountain) landTiles.push(i);
  }
  const ruins: number[] = [];
  const ruinCount = rng.int(4, 8);
  for (let tries = 0; ruins.length < ruinCount && tries < 500 && landTiles.length; tries++) {
    const i = rng.pick(landTiles);
    if (ruins.every((r) => distance(r, i, grid) > 6)) {
      ruins.push(i);
      terrain[i] = T.ruins;
    }
  }

  // Abyssal rifts, deep in the oceans, far apart.
  const rifts: number[] = [];
  const riftCount = rng.int(2, 4);
  for (let tries = 0; rifts.length < riftCount && tries < 500 && deepTiles.length; tries++) {
    const i = rng.pick(deepTiles);
    if (rifts.every((r) => distance(r, i, grid) > 12)) {
      rifts.push(i);
      terrain[i] = T.rift;
    }
  }

  const start = pickStart(terrain, grid, rng, rifts);
  const name = worldName(rng);
  const landShare = 1 - oceanFrac;
  const kind = `${warmth > 0.05 ? 'Warm' : warmth < -0.05 ? 'Cold' : 'Temperate'} ${
    landShare < 0.4 ? 'ocean' : landShare > 0.46 ? 'continental' : 'archipelago'
  } world`;

  return {
    seed,
    name,
    kind,
    width,
    height,
    terrain,
    elevation,
    start,
    rifts,
    ruins,
    checksum: checksum(terrain),
  };
}

const STARTABLE = new Set([T.grassland, T.forest, T.desert, T.tundra]);

function pickStart(terrain: Uint8Array, grid: GridSize, rng: Rng, rifts: number[]): number {
  const scored: Array<[number, number]> = [];
  for (let i = 0; i < terrain.length; i++) {
    if (!STARTABLE.has(terrain[i])) continue;
    const lat = Math.abs(rowOf(i, grid) / (grid.height - 1) - 0.5) * 2;
    if (lat > 0.6) continue;
    let score = 0;
    for (const nb of hexesInRange(i, 1, grid)) {
      const y = TERRAIN[terrain[nb]].yields;
      score += y.compute + y.matter;
      // A Node boxed in by peaks is a miserable start.
      if (terrain[nb] === T.mountain) score -= 4;
      if (terrain[nb] === T.snow) score -= 2;
    }
    if (terrain[i] === T.grassland) score += 2;
    let land = 0;
    for (const nb of hexesInRange(i, 3, grid)) if (!isWater(terrain[nb])) land++;
    score += land * 0.25;
    if (rifts.some((r) => distance(r, i, grid) < 8)) score -= 5;
    scored.push([i, score]);
  }
  if (scored.length === 0) {
    // Pathological seed: fall back to any land tile.
    for (let i = 0; i < terrain.length; i++) if (!isWater(terrain[i])) return i;
    return 0;
  }
  scored.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const top = scored.slice(0, Math.max(1, Math.floor(scored.length * 0.08)));
  return rng.pick(top)[0];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A seeded world name. Never Earth (locked decision). */
export function worldName(rng: Rng): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const base =
      rng.pick(NAMES.worldStarts) + rng.pick(NAMES.worldMiddles) + rng.pick(NAMES.worldEnds);
    const name = capitalize(base.toLowerCase()) + rng.pick(NAMES.worldSuffixes);
    if (!isForbiddenWorldName(name)) return name;
  }
  return 'Vigil';
}

export function isForbiddenWorldName(name: string): boolean {
  const first = name.toLowerCase().split(/\s+/)[0];
  return (
    NAMES.forbidden.includes(first) || first.includes('earth') || first.includes('terra')
  );
}

function checksum(data: Uint8Array): number {
  let h = 2166136261;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
