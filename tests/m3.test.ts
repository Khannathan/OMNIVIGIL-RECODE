import { describe, expect, test } from 'vitest';
import { GENOME, RULES, TITANS, titanParts, titanType, unitDef } from '../src/content';
import { riftBroken, riftGuard } from '../src/sim/abyss';
import { Ctx } from '../src/sim/actions';
import { forecast } from '../src/sim/combat';
import { queueOrder, resolveCycle } from '../src/sim/cycle';
import { addExposure, exposureFloor } from '../src/sim/exposure';
import { Rng } from '../src/sim/rng';
import { ABYSS, exposureLevel, GameState, newGame, PLAYER, spawnUnit, syncRifts, titanBlocker } from '../src/sim/state';
import { strongestTitan } from '../src/sim/titans';
import { victoryPhase, victoryProgress } from '../src/sim/victory';
import { generateWorld, World } from '../src/sim/worldgen';
import { deserialize, serialize } from '../src/save/save';
import { neighbors } from '../src/sim/hex';

function setup(seed = 'DEPTH'): { world: World; state: GameState; node: GameState['structures'][number] } {
  const world = generateWorld(seed);
  const state = newGame(world);
  syncRifts(state, world);
  const node = state.structures.find((s) => s.owner === PLAYER)!;
  return { world, state, node };
}

function ctxOf(state: GameState, world: World): Ctx {
  return { state, world, events: [], combat: Rng.stream(state.seed, 'test'), acted: new Set() };
}

describe('the Abyss', () => {
  test('every world has rifts, and the first holds the Mother', () => {
    const { state } = setup();
    expect(state.rifts.length).toBeGreaterThan(1);
    expect(state.rifts[0].mother).toBe(true);
    expect(state.rifts.filter((r) => r.mother).length).toBe(1);
  });

  test('conventional units fight kaiju at the kaiju penalty; TBUs and hardened symbiotes do not', () => {
    const { world, state, node } = setup();
    const kaiju = spawnUnit(state, 'tidecrawler', node.tile, ABYSS);
    const trooper = spawnUnit(state, 'sentinel-trooper', node.tile, PLAYER);
    const titan = spawnUnit(state, titanType(TITANS.default), node.tile, PLAYER);
    const fused = spawnUnit(state, 'sentinel-trooper', node.tile, PLAYER);
    fused.symbiote = 'chitin-mantle';
    const hide = (u: typeof trooper) => forecast(state, world, u, kaiju).attacker.lines.some((l) => l.pct === RULES.abyss.kaijuHidePct);
    expect(hide(trooper)).toBe(true);
    expect(hide(titan)).toBe(false);
    expect(hide(fused)).toBe(false);
  });

  test('sealing every other rift lets the Mother die, which wins Guardian', () => {
    const { world, state } = setup();
    const ctx = ctxOf(state, world);
    const jet = spawnUnit(state, 'shrike-jet', state.rifts[0].tile, PLAYER);
    const mother = state.rifts[0];
    riftBroken(ctx, mother, jet);
    expect(mother.sealed).toBe(false);
    expect(state.mother.retreats).toBe(1);
    expect(state.resources.essence).toBeGreaterThan(0);
    for (const r of state.rifts.slice(1)) riftBroken(ctx, r, jet);
    expect(state.rifts.slice(1).every((r) => r.sealed)).toBe(true);
    expect(riftGuard(state, mother.tile)?.type).toBe('abyss-mother');
    riftBroken(ctx, mother, jet);
    expect(state.mother.slain).toBe(true);
    expect(riftGuard(state, mother.tile)).toBeUndefined();
    victoryPhase(state, ctx.events);
    expect(state.victories.map((v) => v.kind)).toContain('guardian');
    expect(state.exposure).toBeGreaterThan(0);
  });

  test('an Abyssian next to your Node ravages it instead of taking it', () => {
    const { world, state, node } = setup('RAVAGE');
    state.resources.matter = 100;
    const by = neighbors(node.tile, world).find((t) => !state.units.some((u) => u.tile === t))!;
    const beast = spawnUnit(state, 'sovereign', by, ABYSS);
    beast.home = state.rifts[0].tile;
    // Clear the defenders so the walls are all that stands.
    state.units = state.units.filter((u) => u.owner !== PLAYER);
    node.hp = 1;
    let ravaged = false;
    for (let i = 0; i < 4 && !ravaged; i++) ravaged = resolveCycle(state, world).events.some((e) => e.kind === 'ravaged');
    expect(ravaged).toBe(true);
    expect(state.structures.find((s) => s.id === node.id)?.owner).toBe(PLAYER);
    expect(state.resources.matter).toBeLessThan(100 + 50);
  });
});

describe('Titan Forge', () => {
  test('a TBU type is its parts, and its stats are their sums', () => {
    const type = titanType(TITANS.default);
    const parts = titanParts(type)!;
    const def = unitDef(type);
    expect(def.titan).toBe(true);
    expect(def.upow).toBe(Object.values(parts).reduce((a, p) => a + p.upow, 0));
    expect(titanParts('tbu:nope.nope.nope.nope.nope.nope')).toBeNull();
  });

  test('TBUs need the Titan Forge and a Node, then build', () => {
    const { world, state, node } = setup();
    const type = titanType(TITANS.default);
    expect(titanBlocker(state, node, type)).toMatch(/Titan Forge/);
    state.techs.push(TITANS.requires);
    expect(titanBlocker(state, node, type)).toBeNull();
    state.resources.matter = 500;
    queueOrder(state, { kind: 'build', structureId: node.id, unit: type });
    let built = false;
    for (let i = 0; i < 20 && !built; i++) built = resolveCycle(state, world).events.some((e) => e.kind === 'built' && e.unit === type);
    expect(built).toBe(true);
  });

  test('the advisor design only upgrades within budget', () => {
    const { state } = setup();
    state.techs.push(TITANS.requires);
    const cheap = strongestTitan(state, unitDef(titanType(TITANS.default)).cost.matter);
    expect(cheap).toBe(titanType(TITANS.default));
    expect(strongestTitan(state, 1)).toBeNull();
  });
});

describe('Genome', () => {
  test('genes sequence in order for Essence, then strains fuse into units in a settlement', () => {
    const { world, state, node } = setup();
    const first = GENOME.genes.find((g) => g.tier === 1 && g.unlocks)!;
    const second = GENOME.genes.find((g) => g.strand === first.strand && g.tier === 2)!;
    state.resources.essence = 500;
    queueOrder(state, { kind: 'sequence', gene: first.id });
    resolveCycle(state, world);
    expect(state.genes).not.toContain(first.id); // needs Gene Splicing
    state.techs.push(GENOME.requires);
    queueOrder(state, { kind: 'sequence', gene: second.id });
    resolveCycle(state, world);
    expect(state.genes).not.toContain(second.id); // tier 1 first
    queueOrder(state, { kind: 'sequence', gene: first.id });
    resolveCycle(state, world);
    expect(state.genes).toContain(first.id);
    const trooper = spawnUnit(state, 'sentinel-trooper', node.tile, PLAYER);
    queueOrder(state, { kind: 'fuse', unitId: trooper.id, strain: first.unlocks! });
    resolveCycle(state, world);
    expect(trooper.symbiote).toBe(first.unlocks);
  });
});

describe('Exposure and victories', () => {
  test('Revealed is a permanent floor, and 100 starts the Crusade', () => {
    const { world, state } = setup();
    for (const f of state.factions) f.met = true;
    addExposure(state, 55);
    resolveCycle(state, world);
    expect(exposureLevel(state.exposure)).toBeGreaterThanOrEqual(2);
    expect(exposureFloor(state)).toBe(RULES.exposure.levels[RULES.exposure.permanentLevel].at);
    state.resources.crypto = 1000;
    for (let i = 0; i < 6; i++) {
      queueOrder(state, { kind: 'scrub' });
      resolveCycle(state, world);
    }
    expect(state.exposure).toBeGreaterThanOrEqual(exposureFloor(state));
    state.exposure = 99.99; // the passive gain this cycle tips it over
    const r = resolveCycle(state, world);
    expect(r.events.some((e) => e.kind === 'crusade')).toBe(true);
    expect(state.factions.filter((f) => !f.eliminated).every((f) => f.atWar)).toBe(true);
  });

  test('Assimilation and Exodus are recorded when achieved', () => {
    const { state } = setup();
    for (const f of state.factions) f.attitude = 100;
    state.ark.stage = RULES.ark.stages.length;
    expect(victoryProgress(state, 'assimilation').achieved).toBe(true);
    expect(victoryProgress(state, 'exodus').achieved).toBe(true);
    const events: Parameters<typeof victoryPhase>[1] = [];
    victoryPhase(state, events);
    expect(state.victories.map((v) => v.kind).sort()).toEqual(['assimilation', 'exodus']);
    victoryPhase(state, events);
    expect(state.victories.length).toBe(2);
  });

  test('M2 saves (state v3) still load', () => {
    const { world, state } = setup('OLD-M2');
    const file = JSON.parse(serialize(state, world.name));
    file.stateVersion = 3;
    const st = file.state;
    delete st.resources.essence;
    delete st.resources.crypto;
    for (const k of ['exposure', 'exposureMax', 'rifts', 'mother', 'genes', 'ark', 'victories']) delete st[k];
    st.victory = { kind: 'dominion', cycle: 40 };
    delete st.stats.kaijuSlain;
    delete st.rng.abyss;
    const loaded = deserialize(JSON.stringify(file)).state;
    expect(loaded.resources.essence).toBe(0);
    expect(loaded.victories).toEqual([{ kind: 'dominion', cycle: 40 }]);
    expect(loaded.rifts).toEqual([]);
    resolveCycle(loaded, world);
    expect(loaded.rifts.length).toBeGreaterThan(0);
  });
});
