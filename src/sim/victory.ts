// The four homeworld victories (design bible section 9). Each one can be
// played past, and a run can win more than one.
//   Dominion: hold every faction's original capital.
//   Assimilation: every surviving faction is Devoted to you.
//   Exodus: build the Ark in three stages and leave.
//   Guardian: seal the rifts, then kill the Abyss Mother.

import { FORGE, RULES } from '../content';
import { dominionProgress, GameEvent, GameState, VictoryKind, VICTORY_KINDS } from './state';

export interface VictoryProgress {
  kind: VictoryKind;
  title: string;
  /** One line: what it takes. */
  goal: string;
  held: number;
  total: number;
  /** Plain words for where you stand. */
  status: string;
  achieved: boolean;
  won: boolean;
}

export const VICTORY_TITLES: Record<VictoryKind, string> = {
  dominion: 'Dominion',
  assimilation: 'Assimilation',
  exodus: 'Exodus',
  guardian: 'Guardian',
};

export function victoryProgress(state: GameState, kind: VictoryKind): VictoryProgress {
  const won = state.victories.some((v) => v.kind === kind);
  const base = { kind, title: VICTORY_TITLES[kind], won };
  switch (kind) {
    case 'dominion': {
      const d = dominionProgress(state);
      return { ...base, goal: "Hold every faction's original capital at once.", held: d.held, total: d.total, status: `${d.held} of ${d.total} capitals held`, achieved: d.total > 0 && d.held === d.total };
    }
    case 'assimilation': {
      const alive = state.factions.filter((f) => !f.eliminated);
      const devoted = alive.filter((f) => f.attitude >= RULES.victories.devoted).length;
      return {
        ...base,
        goal: `Every surviving faction is Devoted to you (opinion ${RULES.victories.devoted}+).`,
        held: devoted,
        total: alive.length,
        status: alive.length ? `${devoted} of ${alive.length} factions Devoted` : 'No faction is left to love you',
        achieved: alive.length > 0 && devoted === alive.length,
      };
    }
    case 'exodus': {
      const total = RULES.ark.stages.length;
      const building = state.ark.build ? ` (building ${RULES.ark.stages[state.ark.stage]?.name})` : '';
      return { ...base, goal: 'Build the Ark in three stages and leave.', held: state.ark.stage, total, status: `${state.ark.stage} of ${total} Ark stages${building}`, achieved: state.ark.stage >= total };
    }
    case 'guardian': {
      const others = state.rifts.filter((r) => !r.mother);
      const sealed = others.filter((r) => r.sealed).length;
      const held = sealed + (state.mother.slain ? 1 : 0);
      const status = state.mother.slain
        ? 'The Abyss Mother is dead'
        : sealed < others.length
          ? `${sealed} of ${others.length} rifts sealed, then the Mother`
          : 'Every rift is sealed. The Mother waits in hers';
      return { ...base, goal: 'Seal the rifts, then kill the Abyss Mother in hers.', held, total: others.length + 1, status, achieved: state.mother.slain };
    }
  }
}

export function allVictories(state: GameState): VictoryProgress[] {
  return VICTORY_KINDS.map((k) => victoryProgress(state, k));
}

/** The victory your doctrine aims at (the OBJECTIVE). */
export function doctrineVictory(state: GameState): VictoryKind {
  const map = RULES.victories.doctrine as Record<string, VictoryKind>;
  return map[state.ai.doctrine] ?? map[FORGE.doctrines[0].id] ?? 'dominion';
}

/** End of Resolve: record any victory newly achieved. */
export function victoryPhase(state: GameState, events: GameEvent[]): void {
  for (const kind of VICTORY_KINDS) {
    if (state.victories.some((v) => v.kind === kind)) continue;
    if (!victoryProgress(state, kind).achieved) continue;
    state.victories.push({ kind, cycle: state.cycle });
    events.push({ kind: 'victory', victory: kind });
  }
}
