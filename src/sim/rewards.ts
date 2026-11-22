// Rewards (M2). Ruins hold Precursor caches: the first of your units to stand
// on a ruin searches it, and the run's seeded 'loot' stream rolls a rarity and
// a prize. `revealsFor` turns a cycle's good news into reward cards for the
// Reckon reveal (design bible section 17: reward reveals with rarity flashes).

import { RarityId, RARITY_IDS, rarityDef, relicDef, REWARDS, SalvageDef, techDef, unitDef, RESOURCE_NAMES } from '../content';
import { Rng } from './rng';
import { factionById, GameEvent, GameState, PLAYER, spawnUnit, structureAt } from './state';
import { World } from './worldgen';

/** Weighted rarity roll. */
export function rollRarity(rng: Rng): RarityId {
  const total = REWARDS.rarities.reduce((a, r) => a + r.weight, 0);
  let roll = rng.next() * total;
  for (const r of REWARDS.rarities) {
    roll -= r.weight;
    if (roll < 0) return r.id;
  }
  return REWARDS.rarities[REWARDS.rarities.length - 1].id;
}

/** A prize of this rarity. A relic you already own falls back to the best resource of that tier or below. */
export function rollSalvage(state: GameState, rarity: RarityId, rng: Rng): SalvageDef {
  const pool = REWARDS.salvage[rarity].filter((r) => r.kind !== 'relic' || !state.relics.includes(r.relic));
  if (pool.length) return rng.pick(pool);
  for (let i = RARITY_IDS.indexOf(rarity); i >= 0; i--) {
    const res = REWARDS.salvage[RARITY_IDS[i]].filter((r) => r.kind === 'resource');
    if (res.length) {
      const pick = rng.pick(res);
      // Scale a fallback up so a high roll never feels like a downgrade.
      return pick.kind === 'resource' ? { ...pick, amount: pick.amount * (1 + RARITY_IDS.indexOf(rarity) - i) } : pick;
    }
  }
  return { kind: 'resource', resource: 'compute', amount: 25 };
}

/** Search every unsearched ruin one of your units stands on, by unit id. */
export function salvagePhase(state: GameState, world: World, events: GameEvent[], rng: Rng): void {
  const ruins = new Set(world.ruins);
  const searched = new Set(state.salvaged);
  const units = state.units.filter((u) => u.owner === PLAYER && ruins.has(u.tile) && !searched.has(u.tile)).sort((a, b) => a.id - b.id);
  for (const unit of units) {
    if (searched.has(unit.tile)) continue;
    searched.add(unit.tile);
    state.salvaged.push(unit.tile);
    const rarity = rollRarity(rng);
    const reward = rollSalvage(state, rarity, rng);
    const event: Extract<GameEvent, { kind: 'salvage' }> = { kind: 'salvage', tile: unit.tile, unitId: unit.id, rarity, reward };
    switch (reward.kind) {
      case 'resource':
        state.resources[reward.resource] += reward.amount;
        break;
      case 'unit':
        event.spawnedId = spawnUnit(state, reward.unit, unit.tile, PLAYER).id;
        break;
      case 'relic':
        state.relics.push(reward.relic);
        break;
    }
    events.push(event);
  }
}

export interface RewardCard {
  rarity: RarityId;
  /** Small caps line above the title, e.g. "Research complete". */
  kicker: string;
  title: string;
  /** What it gives you, in plain words. */
  lines: string[];
  /** Optional flavour. */
  blurb?: string;
  /** Art for the card face, if any (UI art file). */
  icon?: string;
  tile?: number;
  /** Set when the card is a relic or a tech, so the UI can list its effects. */
  relic?: string;
  tech?: string;
}

export function salvageText(r: SalvageDef): string {
  switch (r.kind) {
    case 'resource':
      return `+${r.amount} ${RESOURCE_NAMES[r.resource]}`;
    case 'unit':
      return `A ${unitDef(r.unit).name} reactivates and joins you`;
    case 'relic':
      return relicDef(r.relic).name;
  }
}

/** Reward cards for a cycle's events, lowest rarity first so the best is revealed last. Pure: reads state for names only. */
export function revealsFor(state: GameState, events: GameEvent[]): RewardCard[] {
  const R = REWARDS.reveal;
  const fname = (id: string) => factionById(state, id)?.name ?? 'a faction';
  const cards: RewardCard[] = [];
  for (const e of events) {
    switch (e.kind) {
      case 'salvage': {
        const r = e.reward;
        if (r.kind === 'relic') {
          const def = relicDef(r.relic);
          cards.push({ rarity: e.rarity, kicker: 'Precursor fragment', title: def.name, lines: [], blurb: def.blurb, icon: `icon_relic_${def.id}.png`, tile: e.tile, relic: def.id });
        } else {
          cards.push({ rarity: e.rarity, kicker: 'Ruin cache', title: r.kind === 'unit' ? unitDef(r.unit).name : salvageText(r), lines: r.kind === 'unit' ? [salvageText(r)] : [], tile: e.tile });
        }
        break;
      }
      case 'tech-done': {
        const t = techDef(e.tech);
        cards.push({ rarity: R.techTier[String(t.tier)] ?? 'common', kicker: 'Research complete', title: t.name, lines: [], blurb: t.blurb, tech: t.id });
        break;
      }
      case 'city-captured': {
        if (e.by !== PLAYER) break;
        const s = structureAt(state, e.tile);
        const capital = !!s?.capitalOf;
        cards.push({
          rarity: capital ? R.capitalTaken : R.cityTaken,
          kicker: capital ? 'Capital taken' : 'City taken',
          title: e.name,
          lines: [`Taken from ${fname(e.from)}`],
          tile: e.tile,
        });
        break;
      }
      case 'eliminated':
        cards.push({ rarity: R.factionFallen, kicker: 'Faction fallen', title: fname(e.faction), lines: ['Their last city is gone'] });
        break;
      case 'met':
        cards.push({ rarity: R.firstContact, kicker: 'First contact', title: fname(e.faction), lines: ['A new voice on the map'] });
        break;
      case 'victory':
        cards.push({ rarity: R.victory, kicker: 'Homeworld victory', title: 'Dominion', lines: ['Every capital answers to you'] });
        break;
      default:
        break;
    }
  }
  // Effects text for relics and techs lives in the UI (describe.ts), which knows how to phrase effects.
  return cards.sort((a, b) => RARITY_IDS.indexOf(a.rarity) - RARITY_IDS.indexOf(b.rarity));
}

export function rarityColor(r: RarityId): string {
  return rarityDef(r).color;
}
