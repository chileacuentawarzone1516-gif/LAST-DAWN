/**
 * Utilidades PURAS de presentación (sin DOM): formato de dinero, textos de fin de
 * partida, estadísticas y estado de artículos de tienda. Testeadas en tests/ui.format.test.ts.
 */
import { PLAYER, WEAPONS } from '../config';
import type { ShopItem, WeaponDef } from '../config';
import type { PlayerState, RunState } from '../core/state';
import type { EndReason, MissionId } from '../core/types';
import type { ObjectiveLine, ObjectiveStatus } from '../rules/markers';

/** 3000 → "$3.000" (separador de millar español); negativos → "-$200". */
export function formatMoney(amount: number): string {
  if (!Number.isFinite(amount)) return '$0';
  const n = Math.round(Math.abs(amount));
  const body = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${amount < 0 && n > 0 ? '-' : ''}$${body}`;
}

/** Variación con signo explícito: "+$150" / "-$200". */
export function formatDelta(delta: number): string {
  const n = Math.round(delta);
  return n >= 0 ? `+${formatMoney(n)}` : formatMoney(n);
}

export const END_HEADLINE: Record<'won' | 'lost', string> = {
  won: 'Victoria',
  lost: 'Derrota',
};

export const END_REASON_TEXT: Record<EndReason, string> = {
  extracted: 'Extracción completada',
  dead: 'Has muerto',
  sealed: 'El distrito fue sellado',
  heli_left: 'El helicóptero se fue sin ti',
};

/** Frase secundaria con el contexto de cada final. */
export const END_REASON_DETAIL: Record<EndReason, string> = {
  extracted: 'Has cruzado la zona de exclusión con vida.',
  dead: 'La zona de exclusión se cobra otra víctima.',
  sealed: 'La cuarentena se cerró antes de que pudieras llamar a la extracción.',
  heli_left: 'La ventana de abordaje se agotó y el helicóptero despegó sin ti.',
};

export function endReasonText(reason: EndReason | null | undefined): string {
  return reason ? END_REASON_TEXT[reason] : 'Partida terminada';
}

/** Resultado coherente aunque falte el evento: la extracción es la única victoria. */
export function resultFor(reason: EndReason | null | undefined): 'won' | 'lost' {
  return reason === 'extracted' ? 'won' : 'lost';
}

export interface RunSummary {
  timeS: number;
  kills: number;
  headshots: number;
  /** 0..1 o null si no se disparó. */
  accuracy: number | null;
  moneyEarned: number;
  moneySpent: number;
  contractsDone: number;
  contractsTotal: number;
  contracts: Record<MissionId, boolean>;
}

/** Estadísticas de fin de partida a partir del estado (tolerante a datos incoherentes). */
export function summarizeRun(state: Pick<RunState, 'match' | 'missions'>): RunSummary {
  const m = state.match;
  const ms = state.missions;
  const contracts: Record<MissionId, boolean> = {
    relay: ms.relay.status === 'completed' || ms.relay.paid,
    warden: ms.warden.status === 'completed' || ms.warden.paid,
    extraction: ms.extraction.status === 'completed' || ms.extraction.paid,
  };
  const done = (Object.values(contracts) as boolean[]).filter(Boolean).length;
  const accuracy = m.shotsFired > 0 ? Math.min(1, Math.max(0, m.shotsHit / m.shotsFired)) : null;
  return {
    timeS: m.elapsed,
    kills: m.kills,
    headshots: m.headshots,
    accuracy,
    moneyEarned: m.moneyEarned,
    moneySpent: m.moneySpent,
    contractsDone: done,
    contractsTotal: 3,
    contracts,
  };
}

export function formatAccuracy(accuracy: number | null): string {
  return accuracy === null ? '—' : `${Math.round(accuracy * 100)} %`;
}

export const FIRE_MODE_LABEL: Record<WeaponDef['fireMode'], string> = {
  semi: 'SEMIAUTO',
  auto: 'AUTOMÁTICO',
  pump: 'CORREDERA',
};

// ─────────────────────────────────────────────────────────────────────────────
// Tienda
// ─────────────────────────────────────────────────────────────────────────────
export type ShopStatus = 'ok' | 'funds' | 'owned' | 'full';

export const SHOP_STATUS_TEXT: Record<Exclude<ShopStatus, 'ok'>, string> = {
  funds: 'Fondos insuficientes',
  owned: 'Ya la tienes',
  full: 'Lleno',
};

/** Motivo de rechazo del evento 'shop:denied' → texto en español. */
export const SHOP_DENIED_TEXT: Record<'funds' | 'full' | 'owned', string> = {
  funds: 'Fondos insuficientes',
  full: 'No puedes llevar más',
  owned: 'Ya la tienes',
};

/** Vista previa (informativa) de si un artículo se puede comprar ahora; manda el módulo de economía. */
export function shopItemStatus(item: ShopItem, player: PlayerState): ShopStatus {
  switch (item.kind) {
    case 'weapon':
      if (item.weapon && player.slots.some((s) => s?.id === item.weapon)) return 'owned';
      break;
    case 'pack':
      if (player.hasPack) return 'owned';
      break;
    case 'plate':
      if (player.plates >= (player.hasPack ? PLAYER.cap.platesPack : PLAYER.cap.plates)) return 'full';
      break;
    case 'grenade':
      if (player.grenades >= (player.hasPack ? PLAYER.cap.grenadesPack : PLAYER.cap.grenades)) return 'full';
      break;
    case 'medkit':
      if (player.hp >= player.maxHp) return 'full';
      break;
    case 'armorFull':
      if (player.armor >= player.maxArmor) return 'full';
      break;
    case 'ammoSlot0':
    case 'ammoSlot1': {
      const slot = player.slots[item.kind === 'ammoSlot0' ? 0 : 1];
      if (!slot || slot.reserve >= WEAPONS[slot.id].reserveMax) return 'full';
      break;
    }
  }
  return player.money < item.price ? 'funds' : 'ok';
}

// ─────────────────────────────────────────────────────────────────────────────
// Rastreador plegado (táctil)
// ─────────────────────────────────────────────────────────────────────────────
const SUMMARY_PRIORITY: Record<ObjectiveStatus, number> = { active: 0, todo: 1, locked: 2, failed: 3, done: 4 };

/**
 * Contrato que resume el rastreador plegado: el activo; si no hay, el siguiente pendiente;
 * luego bloqueados y fallidos. Con todos completados devuelve null.
 */
export function pickActiveObjective(lines: readonly ObjectiveLine[]): ObjectiveLine | null {
  let best: ObjectiveLine | null = null;
  for (const l of lines) {
    if (l.status === 'done') continue;
    if (!best || SUMMARY_PRIORITY[l.status] < SUMMARY_PRIORITY[best.status]) best = l;
  }
  return best;
}
