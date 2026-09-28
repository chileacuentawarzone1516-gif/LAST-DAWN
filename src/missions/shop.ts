/**
 * Tiendas: banco de armería (LZ) y jaulas de suministro (una por zona).
 * E abre la tienda (state.ui.modal = 'shop'), E de nuevo o alejarse más de ECONOMY.shopRange la cierra,
 * y las teclas 1-6 (evento 'input:digit') compran mientras esté abierta. La lógica de compra vive en
 * `rules/economy.purchase`; aquí sólo se enlaza con estado, eventos e interacción.
 */
import { ECONOMY, MAP, PLAYER, SHOP } from '../config';
import type { VendorId } from '../config';
import type { GameContext } from '../core/context';
import type { EventScope } from '../core/events';
import type { Vec3 } from '../core/types';
import { purchase } from '../rules/economy';
import type { PurchaseDenial } from '../rules/economy';
import { announceMoney, distToPlayer, makeVec3, notify } from './common';

export interface Vendor {
  id: string;
  vendor: VendorId;
  pos: Vec3;
  label: string;
}

/** Vendedores del mapa: un banco de armería y las jaulas. */
export function listVendors(): Vendor[] {
  const out: Vendor[] = [{ id: 'bench', vendor: 'bench', pos: makeVec3(MAP.armory.x, 0, MAP.armory.z), label: 'Abrir armería' }];
  for (const c of MAP.cages) {
    out.push({ id: c.id, vendor: 'cage', pos: makeVec3(c.x, 0, c.z), label: 'Abrir jaula de suministro' });
  }
  return out;
}

const DENIAL_TEXT: Record<PurchaseDenial, string> = {
  funds: 'Fondos insuficientes',
  full: 'Ya lo tienes al máximo',
  owned: 'Ya lo tienes',
};

export interface ShopController {
  readonly isOpen: boolean;
  open(vendor: Vendor): void;
  /** Abre el vendedor más cercano de ese tipo si el jugador está en rango. */
  openNearest(kind: VendorId): void;
  close(): void;
  /** Cierra por distancia, muerte o fin de partida, y detecta cierres externos (mapa). */
  update(): void;
  registerInteractables(): Array<() => void>;
}

export function createShop(ctx: GameContext, scope: EventScope): ShopController {
  const { state, bus } = ctx;
  const vendors = listVendors();
  let current: Vendor | null = null;

  function open(v: Vendor): void {
    if (state.flow !== 'playing' || !state.player.alive || state.match.phase !== 'playing') return;
    if (current === v && state.ui.modal === 'shop') return;
    if (current) close();
    current = v;
    // Abrir la tienda cierra el mapa si estaba abierto (la UI es dueña de 'map').
    state.ui.modal = 'shop';
    state.ui.vendor = v.vendor;
    bus.emit('shop:opened', { vendor: v.vendor });
  }

  function close(): void {
    if (!current) return;
    const vendor = current.vendor;
    current = null;
    if (state.ui.modal === 'shop') {
      state.ui.modal = null;
      state.ui.vendor = null;
    }
    bus.emit('shop:closed', { vendor });
  }

  function buy(n: number): void {
    if (!current || state.ui.modal !== 'shop') return;
    const vendor = current.vendor;
    const before = state.player.money;
    const hpBefore = state.player.hp;
    const res = purchase(state, vendor, n - 1);
    const item = res.item;
    if (!item) return;
    if (res.ok) {
      bus.emit('shop:purchase', { vendor, itemId: item.id, price: item.price });
      announceMoney(ctx, before, 'shop');
      bus.emit('loadout:changed', {});
      if (item.kind === 'medkit') bus.emit('player:healed', { amount: state.player.hp - hpBefore, hp: state.player.hp });
      notify(ctx, `Comprado: ${item.name}`, 'info');
    } else if (res.reason) {
      bus.emit('shop:denied', { vendor, itemId: item.id, reason: res.reason });
      notify(ctx, DENIAL_TEXT[res.reason], 'warn');
    }
  }

  scope.on('input:digit', ({ n }) => {
    if (current && n >= 1 && n <= SHOP[current.vendor].items.length) buy(n);
  });

  return {
    get isOpen() {
      return current !== null;
    },
    open,
    openNearest(kind) {
      let best: Vendor | null = null;
      let bestD = ECONOMY.shopRange;
      for (const v of vendors) {
        if (v.vendor !== kind) continue;
        const d = distToPlayer(ctx, v.pos.x, v.pos.z);
        if (d <= bestD) {
          best = v;
          bestD = d;
        }
      }
      if (best) open(best);
    },
    close,
    update() {
      if (!current) return;
      if (state.ui.modal !== 'shop') {
        // Otro sistema (mapa, menú) tomó el modal: la tienda ya no está abierta.
        const vendor = current.vendor;
        current = null;
        bus.emit('shop:closed', { vendor });
        return;
      }
      if (
        state.flow !== 'playing' || !state.player.alive || state.match.phase !== 'playing'
        || distToPlayer(ctx, current.pos.x, current.pos.z) > ECONOMY.shopRange
      ) close();
    },
    registerInteractables() {
      return vendors.map((v) => ctx.interactions.register({
        id: `shop:${v.id}`,
        position: () => v.pos,
        radius: PLAYER.interactReach,
        prompt: () => (current === v ? 'Cerrar tienda' : v.label),
        holdSeconds: 0,
        priority: 1,
        onComplete: () => {
          if (current === v) close();
          else open(v);
        },
      }));
    },
  };
}
