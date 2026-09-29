import { MAP, THREAT_SCALE } from '../config';
import type { ZoneId } from '../core/types';

/** Zona a la que pertenece un punto (la primera de MAP.zones que lo contiene). */
export function zoneAt(x: number, z: number): ZoneId {
  for (const zone of MAP.zones) {
    const r = zone.rect;
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return zone.id;
  }
  // Fuera del mapa: se considera la zona más cercana por Z (perímetro al sur, complejo/refinería al norte).
  return z > 0 ? 'perimeter' : 'refinery';
}

export function threatOf(zone: ZoneId): number {
  const z = MAP.zones.find((zz) => zz.id === zone);
  return z ? z.threat : 1;
}

export function threatAt(x: number, z: number): number {
  return threatOf(zoneAt(x, z));
}

export function zoneName(zone: ZoneId): string {
  return MAP.zones.find((zz) => zz.id === zone)?.name ?? zone;
}

/** Multiplicador de botín/dinero de una zona. */
export function lootMultiplier(zone: ZoneId): number {
  return THREAT_SCALE.loot[threatOf(zone)] ?? 1;
}
