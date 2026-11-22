// Plain-language text for effects, units and events, shared by the HUD and
// the Genesis Forge. Clarity rule (bible section 17): numbers, not adjectives.

import { Cost, Effect, RESOURCE_IDS, RESOURCE_NAMES, RESOURCE_SHORT, RULES, TITANS, unitDef, UNITS } from '../content';

const DOMAIN: Record<string, string> = { land: 'land units', air: 'air units', sea: 'sea units' };

export function effectText(e: Effect): string {
  const where = (w?: 'node' | 'city') => (w === 'city' ? 'per captured city' : w === 'node' ? 'per Node' : 'per settlement');
  switch (e.kind) {
    case 'yield': {
      const name = RESOURCE_NAMES[e.resource];
      const parts: string[] = [];
      if (e.flat) parts.push(`+${e.flat} ${name} ${where(e.where)}`);
      if (e.pct) parts.push(`+${e.pct}% ${name}`);
      return parts.join(', ');
    }
    case 'energy':
      return `+${e.flat} Energy per settlement`;
    case 'upow': {
      const who = e.domain ? DOMAIN[e.domain] : 'all units';
      const when = e.role === 'attack' ? ' when attacking' : e.role === 'defense' ? ' when defending' : '';
      return `+${e.pct}% UPow, ${who}${when}`;
    }
    case 'research':
      return `Research ${e.pct}% faster`;
    case 'build':
      return `Units build ${e.pct}% faster`;
    case 'sight':
      return `+${e.flat} sight${e.domain ? `, ${DOMAIN[e.domain]}` : ''}`;
    case 'speed':
      return `+${e.flat} speed${e.domain ? `, ${DOMAIN[e.domain]}` : ''}`;
    case 'heal':
      return `Units heal +${e.flat} HP per cycle`;
    case 'workRadius':
      return `${e.where === 'node' ? 'Nodes' : e.where === 'city' ? 'Cities' : 'Settlements'} work +${e.flat} hex further`;
    case 'embark':
      return 'Land units can cross coast and shallow sea';
    case 'attitude':
      return `${e.flat > 0 ? '+' : ''}${e.flat} starting opinion with every faction`;
    case 'sway':
      return `Sway gains +${e.flat} more opinion`;
    case 'startUnit':
      return `Start with an extra ${unitDef(e.unit).name}`;
    case 'startResource':
      return `Start with +${e.amount} ${RESOURCE_NAMES[e.resource]}`;
    case 'exposure':
      return `${e.pct > 0 ? '+' : ''}${e.pct}% Exposure from everything you do`;
    case 'revealRifts':
      return 'Charts every abyssal rift on the world';
  }
}

/** Units, parts and projects a tech unlocks. */
export function unlocksOf(techId: string): string[] {
  const out = UNITS.filter((u) => u.requires === techId).map((u) => u.name);
  if (TITANS.requires === techId) out.push('the Titan Forge (TBUs)');
  for (const p of TITANS.parts) if (p.requires === techId) out.push(`${p.name} (TBU part)`);
  RULES.ark.stages.forEach((st, i) => {
    if (st.requires === techId) out.push(`Ark stage ${i + 1}: ${st.name}`);
  });
  return out;
}

/** "40 Matter, 10 Essence" */
export function costText(c: Cost): string {
  const parts = RESOURCE_IDS.filter((k) => c[k]).map((k) => `${c[k]} ${RESOURCE_SHORT[k]}`);
  return parts.length ? parts.join(', ') : 'free';
}

export function pct(p: number): string {
  if (p > 0.995 && p < 1) return '>99%';
  if (p < 0.005 && p > 0) return '<1%';
  return `${Math.round(p * 100)}%`;
}
