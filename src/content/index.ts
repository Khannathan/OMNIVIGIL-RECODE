// Typed access to the JSON content files. Game rules read from here, so new
// terrain, units or structures are data edits, not code edits.

import terrainData from './terrain.json';
import unitData from './units.json';
import structureData from './structures.json';
import nameData from './names.json';
import artData from './art.json';

export interface Yields {
  compute: number;
  matter: number;
}

export interface TerrainDef {
  id: string;
  name: string;
  art: string;
  water: boolean;
  moveCost: number | null;
  yields: Yields;
  color: string;
}

export interface UnitDef {
  id: string;
  name: string;
  domain: 'land' | 'air';
  speed: number;
  sight: number;
  upow: number;
  cost: { matter: number };
  buildCycles: number;
  energy: number;
}

export interface StructureDef {
  id: string;
  name: string;
  workRadius: number;
  sight: number;
  energy: number;
  buildEnergy: number;
  stages: number;
}

export interface ArtDef {
  file: string;
  w: number;
  h: number;
  frames?: number;
}

export const TERRAIN: readonly TerrainDef[] = terrainData.terrain;
export const UNITS: readonly UnitDef[] = unitData.units as UnitDef[];
export const STRUCTURES: readonly StructureDef[] = structureData.structures;
export const NAMES = nameData;
export const ART: readonly ArtDef[] = artData.art;

/** Terrain is stored per tile as a small integer: its position in TERRAIN. */
export const TERRAIN_INDEX: Readonly<Record<string, number>> = Object.fromEntries(
  TERRAIN.map((t, i) => [t.id, i]),
);

export function terrainId(id: string): number {
  const i = TERRAIN_INDEX[id];
  if (i === undefined) throw new Error(`Unknown terrain: ${id}`);
  return i;
}

export function unitDef(id: string): UnitDef {
  const u = UNITS.find((d) => d.id === id);
  if (!u) throw new Error(`Unknown unit: ${id}`);
  return u;
}

export function structureDef(id: string): StructureDef {
  const s = STRUCTURES.find((d) => d.id === id);
  if (!s) throw new Error(`Unknown structure: ${id}`);
  return s;
}
