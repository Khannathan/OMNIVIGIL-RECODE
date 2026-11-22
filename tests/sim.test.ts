import { describe, expect, test } from 'vitest';
import { TERRAIN } from '../src/content';
import { distance, hexesInRange, indexToPixel, neighbors, pixelToIndex } from '../src/sim/hex';
import { Rng, normalizeSeed } from '../src/sim/rng';
import { generateWorld, isForbiddenWorldName, isWater } from '../src/sim/worldgen';
import { newGame, energyBudget, DEFAULT_AI, PLAYER, GameState, spawnUnit, dominionProgress, availableTechs } from '../src/sim/state';
import { queueOrder, resolveCycle } from '../src/sim/cycle';
import { fight, forecast } from '../src/sim/combat';
import { Rng as R2 } from '../src/sim/rng';
import { RULES, TECHS, UNITS, PLAYER_UNITS, techDef } from '../src/content';
import { botPlay } from '../src/sim/bot';
import { deserialize, listSaves, loadGame, memoryStore, saveGame, serialize } from '../src/save/save';

function mine(state: GameState) {
  return state.units.filter((u) => u.owner === PLAYER);
}

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
  test('a run starts with a Node, starting units and spare Energy', () => {
    const world = generateWorld(SEEDS[0]);
    const state = newGame(world, { ...DEFAULT_AI, origin: 'research-lab' });
    expect(state.structures.filter((s) => s.owner === PLAYER)).toHaveLength(1);
    expect(mine(state)).toHaveLength(2);
    const e = energyBudget(state);
    expect(e.allocated).toBeLessThanOrEqual(e.total);
    expect(state.explored.reduce((a, b) => a + b, 0)).toBeGreaterThan(10);
  });

  test('move orders resolve along a path and reveal the map', () => {
    const world = generateWorld(SEEDS[0]);
    const state = newGame(world);
    const drone = state.units.find((u) => u.type === 'observer-drone' && u.owner === PLAYER)!;
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
    const state = newGame(world, { ...DEFAULT_AI, origin: 'research-lab' });
    const node = state.structures[0];
    const before = state.resources.matter;
    queueOrder(state, { kind: 'build', structureId: node.id, unit: 'observer-drone' });
    resolveCycle(state, world);
    expect(state.resources.matter).toBeLessThan(before + 20);
    expect(mine(state)).toHaveLength(2);
    resolveCycle(state, world);
    expect(mine(state)).toHaveLength(3);
  });

  test.each(SEEDS)('bot run on %s is deterministic', (seed) => {
    const world = generateWorld(seed);
    const a = newGame(world);
    const b = newGame(world);
    botPlay(a, world, 40);
    botPlay(b, world, 40);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(a.cycle).toBe(41);
    expect(a.techs.length).toBeGreaterThan(0);
    expect(a.units.filter((u) => u.owner !== PLAYER).length).toBeGreaterThan(0);
  });
});

describe('M1 content', () => {
  test('the slice has 4 factions, 3 resources plus Energy, 20 techs and 6 units', () => {
    expect(generateWorld(SEEDS[0]).factions).toHaveLength(4);
    expect(Object.keys(RULES.start).sort()).toEqual(['compute', 'influence', 'matter']);
    expect(TECHS).toHaveLength(20);
    expect(PLAYER_UNITS).toHaveLength(6);
  });
  test('every tech prerequisite exists and every unit unlock is a tech', () => {
    const ids = new Set(TECHS.map((t) => t.id));
    for (const t of TECHS) for (const r of t.requires) expect(ids.has(r)).toBe(true);
    for (const u of UNITS) if (u.requires) expect(ids.has(u.requires)).toBe(true);
  });
});

describe('factions', () => {
  test.each(SEEDS)('%s places reachable, spaced faction capitals', (seed) => {
    const world = generateWorld(seed);
    expect(world.factions.length).toBeGreaterThanOrEqual(3);
    const sites = world.factions.flatMap((f) => [f.capital.tile, ...f.towns.map((t) => t.tile)]);
    expect(new Set(sites).size).toBe(sites.length);
    for (const t of sites) {
      expect(isWater(world.terrain[t])).toBe(false);
      expect(distance(t, world.start, world)).toBeGreaterThanOrEqual(4);
    }
    expect(generateWorld(seed).factions).toEqual(world.factions);
  });
  test('a new run garrisons every faction city', () => {
    const world = generateWorld(SEEDS[0]);
    const state = newGame(world);
    for (const s of state.structures.filter((x) => x.owner !== PLAYER)) {
      expect(state.units.some((u) => u.tile === s.tile && u.owner === s.owner)).toBe(true);
    }
  });
});

describe('combat', () => {
  test('the forecast is the true win chance', () => {
    const world = generateWorld(SEEDS[0]);
    const state = newGame(world);
    const f = state.factions[0];
    const city = state.structures.find((s) => s.capitalOf === f.id)!;
    const tank = spawnUnit(state, 'bastion-tank', world.start, PLAYER);
    const defender = state.units.find((u) => u.tile === city.tile)!;
    const fc = forecast(state, world, tank, defender);
    expect(fc.winChance).toBeGreaterThan(0);
    expect(fc.winChance).toBeLessThan(1);
    const rng = R2.stream('test', 'combat');
    let wins = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) if (fight(fc, rng).attackerWon) wins++;
    expect(Math.abs(wins / N - fc.winChance)).toBeLessThan(0.015);
  });

  test('attacking declares war, and an emptied capital can be taken', () => {
    const world = generateWorld(SEEDS[0]);
    const state = newGame(world);
    const f = state.factions[0];
    const city = state.structures.find((s) => s.capitalOf === f.id)!;
    // Clear the garrison and break the walls, then walk a trooper in from next door.
    state.units = state.units.filter((u) => u.tile !== city.tile);
    city.hp = 0;
    const next = neighbors(city.tile, world).find((t) => !isWater(world.terrain[t]) && !state.structures.some((s) => s.tile === t) && !state.units.some((u) => u.tile === t))!;
    for (const t of hexesInRange(city.tile, 2, world)) state.explored[t] = 1;
    const trooper = spawnUnit(state, 'sentinel-trooper', next, PLAYER);
    queueOrder(state, { kind: 'attack', unitId: trooper.id, target: city.tile });
    const report = resolveCycle(state, world);
    expect(report.events.some((e) => e.kind === 'war' && e.by === PLAYER)).toBe(true);
    expect(f.atWar).toBe(true);
    expect(city.owner).toBe(PLAYER);
    expect(trooper.tile).toBe(city.tile);
  });

  test('walls fight when no unit defends', () => {
    const world = generateWorld(SEEDS[0]);
    const state = newGame(world);
    const f = state.factions[0];
    f.atWar = true;
    const city = state.structures.find((s) => s.capitalOf === f.id)!;
    state.units = state.units.filter((u) => u.tile !== city.tile);
    const next = neighbors(city.tile, world).find((t) => !isWater(world.terrain[t]) && !state.structures.some((s) => s.tile === t))!;
    for (const t of hexesInRange(city.tile, 2, world)) state.explored[t] = 1;
    const tank = spawnUnit(state, 'bastion-tank', next, PLAYER);
    queueOrder(state, { kind: 'attack', unitId: tank.id, target: city.tile });
    const report = resolveCycle(state, world);
    const fightEvent = report.events.find((e) => e.kind === 'combat');
    expect(fightEvent && fightEvent.kind === 'combat' && fightEvent.defenderType).toBe('walls');
  });
});

describe('research and victory', () => {
  test('research spends Compute, holds Energy and applies its effects', () => {
    const world = generateWorld(SEEDS[1]);
    const state = newGame(world, { ...DEFAULT_AI, origin: 'research-lab' });
    expect(availableTechs(state)).toContain('grid-siphon');
    const e0 = energyBudget(state);
    state.resources.compute = 100;
    queueOrder(state, { kind: 'research', tech: 'grid-siphon' });
    resolveCycle(state, world);
    expect(state.research?.tech).toBe('grid-siphon');
    expect(energyBudget(state).allocated).toBe(e0.allocated + RULES.research.energy);
    for (let i = 0; i < techDef('grid-siphon').cycles; i++) resolveCycle(state, world);
    expect(state.techs).toContain('grid-siphon');
    expect(energyBudget(state).total).toBe(e0.total + 2);
  });

  test('holding every original capital wins Dominion, and the run goes on', () => {
    const world = generateWorld(SEEDS[3]);
    const state = newGame(world);
    for (const s of state.structures) if (s.capitalOf) s.owner = PLAYER;
    state.units = state.units.filter((u) => u.owner === PLAYER);
    expect(dominionProgress(state).held).toBe(dominionProgress(state).total);
    const report = resolveCycle(state, world);
    expect(report.events.some((e) => e.kind === 'victory')).toBe(true);
    expect(state.victory?.kind).toBe('dominion');
    const again = resolveCycle(state, world);
    expect(again.events.some((e) => e.kind === 'victory')).toBe(false);
  });

  test('a faction with no cities falls', () => {
    const world = generateWorld(SEEDS[0]);
    const state = newGame(world);
    const f = state.factions[1];
    for (const s of state.structures) if (s.owner === f.id) s.owner = PLAYER;
    resolveCycle(state, world);
    expect(f.eliminated).toBe(true);
    expect(state.units.some((u) => u.owner === f.id)).toBe(false);
  });

  test('losing every settlement is a shutdown', () => {
    const world = generateWorld(SEEDS[0]);
    const state = newGame(world);
    state.structures = state.structures.filter((s) => s.owner !== PLAYER);
    const report = resolveCycle(state, world);
    expect(report.events.some((e) => e.kind === 'defeat')).toBe(true);
    expect(state.defeated).toBe(true);
  });
});

describe('long bot runs', () => {
  test.each(['ZERO-VIGIL-9999', 'C'])('%s keeps the rules intact for 150 cycles', (seed) => {
    const world = generateWorld(seed);
    const state = newGame(world);
    for (let i = 0; i < 15; i++) {
      botPlay(state, world, 10);
      const owners = new Map<number, string>();
      for (const u of state.units) {
        expect(u.hp).toBeGreaterThan(0);
        expect(u.hp).toBeLessThanOrEqual(100);
        const o = owners.get(u.tile);
        if (o !== undefined) expect(o).toBe(u.owner); // never two sides on one hex
        owners.set(u.tile, u.owner);
      }
      for (const s of state.structures) {
        const o = owners.get(s.tile);
        if (o !== undefined) expect(o).toBe(s.owner);
      }
      for (const f of state.factions) {
        expect(Math.abs(f.attitude)).toBeLessThanOrEqual(100);
        if (f.eliminated) expect(state.units.some((u) => u.owner === f.id)).toBe(false);
      }
    }
  }, 30000);
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
