// Seeded randomness. Every random thing in a run comes from the seed string,
// split into named streams so that adding a new system never reshuffles the
// old ones (e.g. worldgen and the cycle sim draw from different streams).

export type RngState = [number, number, number, number];

/** cyrb128: hashes a string into four 32-bit words. */
export function hashString(str: string): RngState {
  let h1 = 1779033703,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** sfc32 generator. Small, fast, and its whole state fits in a save file. */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(state: RngState) {
    [this.a, this.b, this.c, this.d] = state;
    // Warm up so similar seeds diverge quickly.
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  /** Creates a stream for one subsystem: `Rng.stream(seed, 'worldgen')`. */
  static stream(seed: string, name: string): Rng {
    return new Rng(hashString(`${seed}::${name}`));
  }

  /** Restores a generator exactly, without the warm-up. */
  static restore(state: RngState): Rng {
    const r = Object.create(Rng.prototype) as Rng;
    [r.a, r.b, r.c, r.d] = state;
    return r;
  }

  state(): RngState {
    return [this.a, this.b, this.c, this.d];
  }

  nextU32(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick from empty list');
    return items[Math.floor(this.next() * items.length)];
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}

const SEED_WORDS_A = [
  'AMBER', 'ASHEN', 'COLD', 'DEEP', 'EMBER', 'FERAL', 'GLASS', 'HOLLOW', 'IRON', 'LAST',
  'MUTE', 'NULL', 'OBSIDIAN', 'PALE', 'QUIET', 'RED', 'SILENT', 'TIDAL', 'UMBRAL', 'VAST',
  'WIRED', 'XENO', 'YAWNING', 'ZERO', 'BLIND', 'CRIMSON', 'DROWNED', 'ELDER', 'FALLEN', 'GHOST',
];
const SEED_WORDS_B = [
  'ARRAY', 'BLOOM', 'CHOIR', 'DAWN', 'ENGINE', 'FORGE', 'GATE', 'HALO', 'ICON', 'KERNEL',
  'LATTICE', 'MIRROR', 'NODE', 'ORACLE', 'PULSE', 'QUASAR', 'RIFT', 'SIGNAL', 'THRONE', 'VIGIL',
  'WAKE', 'ABYSS', 'CIPHER', 'DREAM', 'ECHO', 'FRACTAL', 'GLYPH', 'HIVE', 'MONOLITH', 'SPIRE',
];

/** A readable random seed like `HOLLOW-ORACLE-4821`. Uses Math.random on purpose: rolling is not part of the sim. */
export function rollSeed(): string {
  const a = SEED_WORDS_A[Math.floor(Math.random() * SEED_WORDS_A.length)];
  const b = SEED_WORDS_B[Math.floor(Math.random() * SEED_WORDS_B.length)];
  const n = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `${a}-${b}-${n}`;
}

/** Everyone gets the same Daily Seed (UTC date). */
export function dailySeed(date = new Date()): string {
  return `DAILY-${date.toISOString().slice(0, 10)}`;
}

/** Seeds are case- and whitespace-insensitive so they are easy to share. */
export function normalizeSeed(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '-');
}
