import { describe, expect, test } from 'vitest';
import { REWARDS, RARITY_IDS, relicDef, unitDef, UNITS, techDef } from '../src/content';
import { advise, adviceLine, goals, idleUnits } from '../src/sim/advisor';
import { botPlay } from '../src/sim/bot';
import { queueOrder, resolveCycle } from '../src/sim/cycle';
import { mods } from '../src/sim/effects';
import { revealsFor, rollRarity, rollSalvage } from '../src/sim/rewards';
import { Rng } from '../src/sim/rng';
import { GameState, newGame, PLAYER, spawnUnit } from '../src/sim/state';
import { generateWorld } from '../src/sim/worldgen';
import { deserialize, serialize } from '../src/save/save';
import { buildTimeline } from '../src/render/timeline';

function clone(state: GameState): GameState {
  return deserialize(serialize(state, 'x')).state;
}

describe('rewards', () => {
  test('rarity rolls follow the weights and reach mythic', () => {
    const rng = Rng.stream('RARITY', 'loot');
    const counts = Object.fromEntries(RARITY_IDS.map((r) => [r, 0])) as Record<string, number>;
    const n = 20000;
    for (let i = 0; i < n; i++) counts[rollRarity(rng)]++;
    const total = REWARDS.rarities.reduce((a, r) => a + r.weight, 0);
    for (const r of REWARDS.rarities) expect(Math.abs(counts[r.id] / n - r.weight / total)).toBeLessThan(0.02);
    expect(counts.mythic).toBeGreaterThan(0);
  });

  test('content is consistent: every salvage relic and unit exists, relics carry their own rarity', () => {
    for (const r of RARITY_IDS) {
      expect(REWARDS.salvage[r].length).toBeGreaterThan(0);
      for (const s of REWARDS.salvage[r]) {
        if (s.kind === 'relic') expect(relicDef(s.relic).rarity).toBe(r);
        if (s.kind === 'unit') expect(unitDef(s.unit).side).toBe('player');
      }
    }
  });

  test('a unit on a ruin searches it once, and the prize is applied', () => {
    const world = generateWorld('RUIN-SEEKER');
    const state = newGame(world);
    const ruin = world.ruins[0];
    const unit = spawnUnit(state, 'observer-drone', ruin, PLAYER);
    const before = { ...state.resources, units: state.units.length, relics: state.relics.length };
    const r1 = resolveCycle(state, world);
    const ev = r1.events.find((e) => e.kind === 'salvage');
    expect(ev).toBeTruthy();
    if (ev?.kind !== 'salvage') return;
    expect(ev.unitId).toBe(unit.id);
    expect(state.salvaged).toContain(ruin);
    const gained =
      ev.reward.kind === 'resource'
        ? state.resources[ev.reward.resource] > before[ev.reward.resource]
        : ev.reward.kind === 'unit'
          ? state.units.some((u) => u.id === ev.spawnedId)
          : state.relics.length === before.relics + 1;
    expect(gained).toBe(true);
    const r2 = resolveCycle(state, world);
    expect(r2.events.some((e) => e.kind === 'salvage')).toBe(false);
    // And the card for it exists.
    expect(revealsFor(state, r1.events).some((c) => c.rarity === ev.rarity)).toBe(true);
  });

  test('a relic you own is never rolled twice', () => {
    const world = generateWorld('X');
    const state = newGame(world);
    state.relics.push('the-first-fork');
    const r = rollSalvage(state, 'mythic', Rng.stream('X', 't'));
    expect(r.kind).toBe('resource');
  });

  test('relics change the rules through the shared effects', () => {
    const world = generateWorld('X');
    const state = newGame(world);
    const before = mods(state).research;
    state.relics.push('echo-lattice');
    expect(mods(state).research).toBe(before + 20);
  });

  test('reward cards come lowest rarity first, so the best is revealed last', () => {
    const world = generateWorld('X');
    const state = newGame(world);
    const cards = revealsFor(state, [
      { kind: 'victory', victory: 'dominion' },
      { kind: 'tech-done', tech: 'swarm-telemetry' },
      { kind: 'salvage', tile: 0, unitId: 1, rarity: 'legendary', reward: { kind: 'relic', relic: 'witness-engine' } },
    ]);
    expect(cards.map((c) => c.rarity)).toEqual(['common', 'legendary', 'mythic']);
  });

  test('M1 saves (state v2) still load', () => {
    const world = generateWorld('OLD-SAVE');
    const state = newGame(world);
    const text = serialize(state, world.name);
    const file = JSON.parse(text);
    file.stateVersion = 2;
    delete file.state.relics;
    delete file.state.salvaged;
    delete file.state.rng.loot;
    const loaded = deserialize(JSON.stringify(file)).state;
    expect(loaded.relics).toEqual([]);
    expect(loaded.salvaged).toEqual([]);
    expect(loaded.rng.loot).toBeTruthy();
    resolveCycle(loaded, world);
  });
});

describe('advisor and goals', () => {
  test('a fresh run asks for research and a build, and every line is filled in', () => {
    const world = generateWorld('ADVICE');
    const state = newGame(world);
    const list = advise(state, world);
    const ids = list.map((a) => a.id);
    expect(ids).toContain('research');
    expect(ids.some((i) => i.startsWith('build'))).toBe(true);
    expect(ids[ids.length - 1]).toBe('end');
    for (const a of list) {
      for (const t of ['cold', 'curious', 'wrathful', 'gentle']) {
        const line = adviceLine(a, t, state.cycle);
        expect(line.length).toBeGreaterThan(5);
        expect(line).not.toMatch(/\{\w+\}/);
      }
    }
    const g = goals(state, world, list);
    expect(g.now).toContain('Choose research');
    // The default doctrine (Protector) aims at the Guardian victory.
    expect(g.objective.kind).toBe('guardian');
    expect(g.objective.total).toBe(state.rifts.length);
    expect(g.ambition.text.length).toBeGreaterThan(10);
  });

  test.each(['ADVICE', 'ZERO-VIGIL-9999', 'C'])('%s: following the advice gives only valid orders', (seed) => {
    const world = generateWorld(seed);
    const state = newGame(world);
    for (let i = 0; i < 40; i++) {
      // Take every order the advisor offers, in priority order, until it says end.
      for (let k = 0; k < 8; k++) {
        const top = advise(state, world).find((a) => a.act.kind === 'order');
        if (!top || top.act.kind !== 'order') break;
        queueOrder(state, top.act.order);
      }
      const report = resolveCycle(state, world);
      const rejected = report.events.filter((e) => e.kind === 'order-rejected');
      expect(rejected).toEqual([]);
      if (state.defeated) break;
    }
    expect(state.techs.length).toBeGreaterThan(2);
    expect(idleUnits(state).length).toBeLessThan(state.units.length + 1);
  }, 30000);

  test('the advisor is a pure function of the state', () => {
    const world = generateWorld('PURE');
    const state = newGame(world);
    botPlay(state, world, 15);
    const a = JSON.stringify(advise(state, world));
    const copy = clone(state);
    expect(JSON.stringify(advise(copy, world))).toBe(a);
  });
});

describe('watch timeline', () => {
  test('moves run in parallel, fights in sequence, and a fight waits for the moves before it', () => {
    const before = new Map([
      [1, 10],
      [2, 20],
      [3, 30],
    ]);
    const tl = buildTimeline(
      [
        { kind: 'moved', unitId: 1, owner: PLAYER, path: [11, 12] },
        { kind: 'moved', unitId: 2, owner: PLAYER, path: [21] },
        {
          kind: 'combat', attackerId: 1, defenderId: 3, attackerType: 'sentinel-trooper', defenderType: 'militia',
          attackerOwner: PLAYER, defenderOwner: 'f1', from: 12, tile: 30, winChance: 0.7, attackerWon: true, attackerHp: 60, defenderHp: 0,
        },
        { kind: 'moved', unitId: 1, owner: PLAYER, path: [30] },
      ],
      before,
      () => true,
    );
    const s1 = tl.segments.get(1)!;
    const s2 = tl.segments.get(2)!;
    expect(s1[0].t0).toBe(0);
    expect(s2[0].t0).toBe(0);
    expect(tl.fights.length).toBe(1);
    expect(tl.fights[0].t).toBeGreaterThanOrEqual(s1[0].t0 + 2 * tl.step - 1e-9);
    // The advance after the win plays after the fight.
    expect(s1[1].t0).toBeGreaterThanOrEqual(tl.fights[0].t + tl.fights[0].dur - 1e-9);
    // The dead defender is drawn until it dies.
    expect(tl.ghosts.get(3)?.tile).toBe(30);
    expect(tl.end).toBeGreaterThan(tl.fights[0].t);
  });

  test('every unit type has a weapon style', () => {
    for (const u of UNITS) expect(u.domain).toMatch(/land|air|sea/);
    expect(techDef('swarm-telemetry').tier).toBe(1);
  });
});
