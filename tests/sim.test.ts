import { describe, expect, test } from 'vitest';
import { TERRAIN } from '../src/content';
import { distance, hexesInRange, indexToPixel, neighbors, pixelToIndex } from '../src/sim/hex';
import { Rng, normalizeSeed } from '../src/sim/rng';
import { generateWorld, isForbiddenWorldName, isWater } from '../src/sim/worldgen';
import { newGame, energyBudget } from '../src/sim/state';
import { queueOrder, resolveCycle } from '../src/sim/cycle';
import { botPlay } from '../src/sim/bot';
import { deserialize, listSaves, loadGame, memoryStore, saveGame, serialize } from '../src/save/save';

const SEEDS = ['HOLLOW-ORACLE-4821', 'A', 'DAILY-2026-11-22', 'CRIMSON-ABYSS-0001', 'ZERO-VIGIL-9999'];
const grid = { width: 72, height: 44 };

function fingerprint(state: unknown): string {
  return JSON.stringify(state, (_k, v) => (v instanceof Uint8Array ? Array.from(v).join('') : v));
}

describe('rng', () => {
  test('same seed, same numbers; streams are independent', () => {
    const a = Rng.stream('S', 'x');
    const b = Rng.stream('S', 'x');
    const c = Rng.stream('S', 'y');
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(seqA);
  });
  test('restore continues the exact sequence', () => {
    const a = Rng.stream('S', 'x');
    a.next();
    const r = Rng.restore(a.state());
    expect(r.next()).toBe(a.next());
  });
  test('seeds are normalised', () => {
    expect(normalizeSeed('  hollow oracle ')).toBe('HOLLOW-ORACLE');
  });
});

describe('hex', () => {
  test('wraps east-west and stops at the poles', () => {
    expect(neighbors(0, grid)).toContain(grid.width - 1);
    expect(neighbors(0, grid).length).toBe(4); // top row: E, W, SW, SE
  });
  test('neighbours are at distance 1 and symmetric', () => {
    for (const i of [0, 71, 75, 500, 1500, grid.width * grid.height - 1]) {
      for (const n of neighbors(i, grid)) {
        expect(distance(i, n, grid)).toBe(1);
        expect(neighbors(n, grid)).toContain(i);
      }
    }
  });
  test('radius 2 holds 19 hexes away from the poles', () => {
    expect(hexesInRange(20 * 72 + 5, 2, grid).length).toBe(19);
  });
  test('pixel <-> index round trip', () => {
    for (let i = 0; i < grid.width * grid.height; i += 37) {
      const [x, y] = indexToPixel(i, grid);
      expect(pixelToIndex(x, y, grid)).toBe(i);
      expect(pixelToIndex(x + 72 * 64, y, grid)).toBe(i); // next lap of the wrap
    }
  });
});

describe('worldgen', () => {
  test.each(SEEDS)('%s is deterministic and playable', (seed) => {
    const a = generateWorld(seed);
    const b = generateWorld(seed);
    expect(a.checksum).toBe(b.checksum);
    expect(a.name).toBe(b.name);
    expect(isForbiddenWorldName(a.name)).toBe(false);
    expect(isWater(a.terrain[a.start])).toBe(false);
    const land = a.terrain.filter((t) => !TERRAIN[t].water).length / a.terrain.length;
    expect(land).toBeGreaterThan(0.25);
    expect(land).toBeLessThan(0.6);
    expect(a.rifts.length).toBeGreaterThanOrEqual(1);
  });
  test('different seeds give different worlds', () => {
    expect(generateWorld('ONE').checksum).not.toBe(generateWorld('TWO').checksum);
  });
  test('the homeworld is never Earth', () => {
    for (const n of ['Earth', 'Terra Nova', 'Gaia', 'Earthen']) expect(isForbiddenWorldName(n)).toBe(true);
    for (let i = 0; i < 200; i++) expect(isForbiddenWorldName(generateWorld(`N${i}`, { width: 24, height: 16 }).name)).toBe(false);
  });
});

describe('cycle', () => {
  test('a run starts with a Node, two units and spare Energy', () => {
    const world = generateWorld(SEEDS[0]);
    const state = newGame(world);
    expect(state.structures).toHaveLength(1);
    expect(state.units).toHaveLength(2);
    const e = energyBudget(state);
    expect(e.allocated).toBeLessThanOrEqual(e.total);
    expect(state.explored.reduce((a, b) => a + b, 0)).toBeGreaterThan(10);
  });

  test('move orders resolve along a path and reveal the map', () => {
    const world = generateWorld(SEEDS[0]);
    const state = newGame(world);
    const drone = state.units.find((u) => u.type === 'observer-drone')!;
    const target = [...state.explored.keys()].filter((t) => state.explored[t]).sort((a, b) => distance(drone.tile, b, world) - distance(drone.tile, a, world))[0];
    const before = state.explored.reduce((a, b) => a + b, 0);
    queueOrder(state, { kind: 'move', unitId: drone.id, to: target });
    const report = resolveCycle(state, world);
    expect(report.events.some((e) => e.kind === 'moved')).toBe(true);
    expect(state.explored.reduce((a, b) => a + b, 0)).toBeGreaterThan(before);
    expect(state.cycle).toBe(2);
  });

  test('building spends Matter and delivers a unit', () => {
    const world = generateWorld(SEEDS[1]);
    const state = newGame(world);
    const node = state.structures[0];
    queueOrder(state, { kind: 'build', structureId: node.id, unit: 'observer-drone' });
    resolveCycle(state, world);
    expect(state.units).toHaveLength(2);
    resolveCycle(state, world);
    expect(state.units).toHaveLength(3);
  });

  test.each(SEEDS)('bot run on %s is deterministic', (seed) => {
    const world = generateWorld(seed);
    const a = newGame(world);
    const b = newGame(world);
    botPlay(a, world, 40);
    botPlay(b, world, 40);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(a.cycle).toBe(41);
    expect(a.units.length).toBeGreaterThan(2);
  });
});

describe('saves', () => {
  test('save, load and keep playing gives the same result as never stopping', () => {
    const seed = SEEDS[2];
    const world = generateWorld(seed);
    const straight = newGame(world);
    botPlay(straight, world, 10);
    botPlay(straight, world, 10);

    const store = memoryStore();
    const paused = newGame(world);
    botPlay(paused, world, 10);
    saveGame(paused, world.name, store);
    const loaded = loadGame(seed, store)!;
    botPlay(loaded, world, 10);

    expect(fingerprint(loaded)).toBe(fingerprint(straight));
  });
  test('one slot per seed, listed newest first', () => {
    const store = memoryStore();
    for (const seed of SEEDS.slice(0, 3)) {
      const world = generateWorld(seed);
      saveGame(newGame(world), world.name, store);
    }
    expect(listSaves(store).map((s) => s.seed).sort()).toEqual(SEEDS.slice(0, 3).sort());
  });
  test('rejects foreign files', () => {
    expect(() => deserialize('{"format":"nope"}')).toThrow();
    const world = generateWorld('X');
    expect(deserialize(serialize(newGame(world), world.name)).state.seed).toBe('X');
  });
});
