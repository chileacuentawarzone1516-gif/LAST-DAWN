/**
 * Economía: dinero, recompensas por muerte y compras en tiendas.
 * REGLAS PURAS (sin three.js ni DOM): operan sobre `RunState` y devuelven datos planos.
 *
 * Invariantes:
 *  - El dinero nunca es negativo ni fraccionario.
 *  - Toda compra es atómica: o se aplica completa (efecto + cobro) o no cambia nada.
 *  - `moneyEarned` / `moneySpent` reflejan exactamente lo ingresado / gastado.
 */
import { ECONOMY, ENEMIES, PLAYER, SHOP, THREAT_SCALE, WEAPONS } from '../config';
import type { ShopItem, VendorId } from '../config';
import type { RunState } from '../core/state';
import type { EnemyType } from '../core/types';
import { clamp, roundTo } from '../core/util';

// ── Dinero ───────────────────────────────────────────────────────────────────

/** Ingresa dinero (importes no válidos o ≤ 0 se ignoran). Devuelve lo realmente ingresado. */
export function addMoney(state: RunState, amount: number): number {
  const a = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (a <= 0) return 0;
  state.player.money += a;
  state.match.moneyEarned += a;
  return a;
}

/** Cobra `amount`; devuelve false (sin tocar nada) si no hay fondos o el importe es inválido. */
export function spend(state: RunState, amount: number): boolean {
  if (!Number.isFinite(amount)) return false;
  const a = Math.round(amount);
  if (a < 0 || state.player.money < a) return false;
  state.player.money -= a;
  state.match.moneySpent += a;
  return true;
}

// ── Recompensa por muerte ────────────────────────────────────────────────────

/** Índice de amenaza válido (1..4) para las tablas de `THREAT_SCALE`. */
export function clampThreat(threat: number): number {
  const t = Number.isFinite(threat) ? Math.round(threat) : 1;
  return clamp(t, 1, THREAT_SCALE.loot.length - 1);
}

/** Dinero por muerte = bounty × THREAT_SCALE.loot[amenaza], redondeado a ECONOMY.bountyRounding. */
export function killReward(type: EnemyType, threat: number): number {
  // El Warden no tiene bounty propio: su recompensa es el contrato.
  if (type === 'warden') return 0;
  return roundTo(ENEMIES[type].bounty * (THREAT_SCALE.loot[clampThreat(threat)] ?? 1), ECONOMY.bountyRounding);
}

// ── Capacidades ──────────────────────────────────────────────────────────────

/** Máximo de placas que puede llevar el jugador (la mochila lo amplía). */
export function plateCap(state: RunState): number {
  return state.player.hasPack ? PLAYER.cap.platesPack : PLAYER.cap.plates;
}

/** Máximo de granadas que puede llevar el jugador (la mochila lo amplía). */
export function grenadeCap(state: RunState): number {
  return state.player.hasPack ? PLAYER.cap.grenadesPack : PLAYER.cap.grenades;
}

// ── Compras ──────────────────────────────────────────────────────────────────

export type PurchaseDenial = 'funds' | 'full' | 'owned';

export interface PurchaseResult {
  ok: boolean;
  /** Motivo del rechazo (sólo si `ok` es false y el artículo existe). */
  reason?: PurchaseDenial;
  /** Artículo pedido (null si el índice no corresponde a ninguno). */
  item: ShopItem | null;
}

/** ¿El artículo serviría ahora mismo? Devuelve el motivo de rechazo o null si es aplicable. */
function inapplicable(state: RunState, item: ShopItem): PurchaseDenial | null {
  const p = state.player;
  switch (item.kind) {
    case 'ammoSlot0':
    case 'ammoSlot1': {
      const slot = p.slots[item.kind === 'ammoSlot0' ? 0 : 1];
      return !slot || slot.reserve >= WEAPONS[slot.id].reserveMax ? 'full' : null;
    }
    case 'grenade':
      return p.grenades >= grenadeCap(state) ? 'full' : null;
    case 'plate':
      return p.plates >= plateCap(state) ? 'full' : null;
    case 'medkit':
      return p.hp >= p.maxHp ? 'full' : null;
    case 'armorFull':
      return p.armor >= p.maxArmor ? 'full' : null;
    case 'weapon': {
      if (!item.weapon) return 'owned';
      const slot = p.slots[WEAPONS[item.weapon].slot];
      return slot && slot.id === item.weapon ? 'owned' : null;
    }
    case 'pack':
      return p.hasPack ? 'owned' : null;
  }
}

/** Aplica el efecto del artículo (ya validado como aplicable). */
function applyItem(state: RunState, item: ShopItem): void {
  const p = state.player;
  switch (item.kind) {
    case 'ammoSlot0':
    case 'ammoSlot1': {
      const slot = p.slots[item.kind === 'ammoSlot0' ? 0 : 1];
      if (slot) slot.reserve = WEAPONS[slot.id].reserveMax;
      break;
    }
    case 'grenade':
      p.grenades = Math.min(grenadeCap(state), p.grenades + (item.amount ?? 1));
      break;
    case 'plate':
      p.plates = Math.min(plateCap(state), p.plates + (item.amount ?? 1));
      break;
    case 'medkit':
      p.hp = Math.min(p.maxHp, p.hp + (item.amount ?? 0));
      break;
    case 'armorFull':
      p.armor = p.maxArmor;
      break;
    case 'weapon': {
      if (!item.weapon) break;
      const def = WEAPONS[item.weapon];
      p.slots[def.slot] = {
        id: def.id,
        mag: def.magSize,
        reserve: Math.min(def.reserveMax, def.magSize * ECONOMY.newWeaponReserveMags),
      };
      break;
    }
    case 'pack':
      p.hasPack = true;
      break;
  }
}

/**
 * Compra el artículo `index` (0..5, tecla = index + 1) de `vendor`.
 * Orden de comprobaciones: existe → es útil ahora ('full' / 'owned') → hay fondos ('funds').
 * Si algo falla no se cobra ni se modifica nada.
 */
export function purchase(state: RunState, vendor: VendorId, index: number): PurchaseResult {
  const items = SHOP[vendor]?.items;
  const item = items && Number.isInteger(index) && index >= 0 ? (items[index] ?? null) : null;
  if (!item) return { ok: false, item: null };
  const denial = inapplicable(state, item);
  if (denial) return { ok: false, reason: denial, item };
  if (!spend(state, item.price)) return { ok: false, reason: 'funds', item };
  applyItem(state, item);
  return { ok: true, item };
}
