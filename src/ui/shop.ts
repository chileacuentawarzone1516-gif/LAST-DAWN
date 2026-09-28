/**
 * Superposición de TIENDA: pinta los 6 artículos de SHOP[vendor] numerados 1-6 con precio,
 * descripción y disponibilidad. Las teclas 1-6 las procesa el módulo de misiones: aquí sólo
 * se muestra el estado y el feedback de 'shop:purchase' / 'shop:denied'.
 */
import { SHOP } from '../config';
import type { VendorId } from '../config';
import type { GameContext } from '../core/context';
import { AttrCell, TextCell, el, play } from './dom';
import { SHOP_DENIED_TEXT, SHOP_STATUS_TEXT, formatMoney, shopItemStatus } from './format';
import { icon } from './icons';

export interface ShopOverlay {
  readonly el: HTMLElement;
  setOpen(open: boolean): void;
  update(dt: number): void;
  dispose(): void;
}

interface Row {
  li: HTMLElement;
  name: TextCell;
  desc: TextCell;
  price: TextCell;
  tag: TextCell;
  status: AttrCell;
  itemId: string;
}

const MESSAGE_S = 2.6;

export function createShop(ctx: GameContext): ShopOverlay {
  const titleEl = el('h2', { class: 'shop-title', id: 'ds-shop-h' });
  const moneyEl = el('span', 'shop-money-val');
  const msgEl = el('p', { class: 'shop-msg', attrs: { role: 'status', 'aria-live': 'polite' } });
  const list = el('ol', { class: 'shop-items', attrs: { 'aria-label': 'Artículos a la venta' } });
  const rows: Row[] = [];
  for (let i = 0; i < 6; i++) {
    const name = el('span', 'item-name');
    const desc = el('span', 'item-desc');
    const price = el('span', 'item-price');
    const tag = el('span', 'item-tag');
    const li = el(
      'li',
      'shop-item',
      el('kbd', { class: 'item-key', text: String(i + 1), attrs: { 'aria-hidden': 'true' } }),
      el('span', 'item-body', name, desc),
      el('span', 'item-end', price, tag),
    );
    list.append(li);
    rows.push({ li, name: new TextCell(name), desc: new TextCell(desc), price: new TextCell(price), tag: new TextCell(tag), status: new AttrCell(li, 'data-status'), itemId: '' });
  }
  const root = el(
    'section',
    { class: 'shop', attrs: { role: 'dialog', 'aria-labelledby': 'ds-shop-h', hidden: '' } },
    el(
      'div',
      'shop-panel',
      el('header', 'shop-head', el('span', 'shop-ico', icon('crate')), titleEl, el('span', { class: 'shop-money', attrs: { 'aria-label': 'Dinero disponible' } }, icon('money'), moneyEl)),
      list,
      msgEl,
      el('footer', 'shop-foot', el('span', {}, 'Pulsa ', el('kbd', { text: '1' }), '–', el('kbd', { text: '6' }), ' para comprar'), el('span', {}, el('kbd', { text: 'E' }), ' o aléjate para cerrar')),
    ),
  );

  const title = new TextCell(titleEl);
  const money = new TextCell(moneyEl);
  let open = false;
  let vendor: VendorId | null = null;
  let lastMoney = Number.NaN;
  let msgLeft = 0;
  let acc = 1;

  const say = (text: string, tone: 'ok' | 'bad'): void => {
    msgEl.textContent = text;
    msgEl.dataset.tone = tone;
    msgLeft = MESSAGE_S;
  };

  const bind = (v: VendorId): void => {
    vendor = v;
    const def = SHOP[v];
    title.set(def.title.toUpperCase());
    def.items.forEach((item, i) => {
      const row = rows[i];
      if (!row) return;
      row.itemId = item.id;
      row.name.set(item.name);
      row.desc.set(item.desc);
      row.price.set(formatMoney(item.price));
    });
  };

  const rowFor = (v: VendorId, itemId: string): Row | undefined => (vendor === v ? rows.find((r) => r.itemId === itemId) : undefined);

  const scope = ctx.bus.scope();
  scope
    .on('shop:purchase', ({ vendor: v, itemId, price }) => {
      const item = SHOP[v].items.find((it) => it.id === itemId);
      say(`Comprado: ${item?.name ?? itemId} (−${formatMoney(price)})`, 'ok');
      const row = rowFor(v, itemId);
      if (row) play(row.li, [{ backgroundColor: 'rgba(95, 224, 183, 0.42)' }, { backgroundColor: 'rgba(95, 224, 183, 0)' }], { duration: 700, easing: 'ease-out' });
      lastMoney = Number.NaN;
    })
    .on('shop:denied', ({ vendor: v, itemId, reason }) => {
      say(SHOP_DENIED_TEXT[reason], 'bad');
      const row = rowFor(v, itemId);
      if (row) {
        play(row.li, [{ transform: 'translateX(0)' }, { transform: 'translateX(-0.5em)' }, { transform: 'translateX(0.5em)' }, { transform: 'translateX(-0.3em)' }, { transform: 'translateX(0)' }], { duration: 320 });
        play(row.li, [{ backgroundColor: 'rgba(255, 77, 77, 0.4)' }, { backgroundColor: 'rgba(255, 77, 77, 0)' }], { duration: 600, easing: 'ease-out' });
      }
    });

  const refreshStatus = (): void => {
    if (!vendor) return;
    const items = SHOP[vendor].items;
    const p = ctx.state.player;
    items.forEach((item, i) => {
      const row = rows[i];
      if (!row) return;
      const st = shopItemStatus(item, p);
      row.status.set(st);
      row.tag.set(st === 'ok' ? '' : SHOP_STATUS_TEXT[st]);
    });
  };

  return {
    el: root,
    setOpen(v) {
      if (v === open) return;
      open = v;
      root.hidden = !v;
      if (v) {
        acc = 1;
        msgEl.textContent = '';
        msgLeft = 0;
        lastMoney = Number.NaN;
      }
    },
    update(dt) {
      if (!open) return;
      const wanted: VendorId = ctx.state.ui.vendor ?? vendor ?? 'cage';
      if (wanted !== vendor) {
        bind(wanted);
        acc = 1;
      }
      const m = ctx.state.player.money;
      if (m !== lastMoney) {
        lastMoney = m;
        money.set(formatMoney(m));
        acc = 1;
      }
      acc += dt;
      if (acc >= 0.1) {
        acc = 0;
        refreshStatus();
      }
      if (msgLeft > 0) {
        msgLeft -= dt;
        if (msgLeft <= 0) msgEl.textContent = '';
      }
    },
    dispose() {
      scope.dispose();
      root.remove();
    },
  };
}
