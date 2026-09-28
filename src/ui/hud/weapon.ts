/** Panel de arma y munición (abajo-derecha): cargador/reserva, modo de fuego, granadas y placas. */
import { HUD, PLAYER, WEAPONS } from '../../config';
import type { WeaponId } from '../../core/types';
import { ClassCell, TextCell, el } from '../dom';
import { FIRE_MODE_LABEL } from '../format';
import { icon } from '../icons';
import type { HudEnv, Widget } from './types';

/** "CR-5 Carabina" → "CR-5"; 'Magnum .44 "Marshal"' → "Magnum". Precalculado: sin asignaciones por frame. */
const SHORT_NAME = Object.fromEntries(
  (Object.keys(WEAPONS) as WeaponId[]).map((id) => [id, WEAPONS[id].name.split(' ')[0] ?? WEAPONS[id].name]),
) as Record<WeaponId, string>;

export function createWeapon(env: HudEnv): Widget {
  const { ctx } = env;

  const slotPills = [0, 1].map((i) => {
    const label = el('span', 'slot-name');
    const pill = el('span', { class: 'slot', attrs: { 'aria-hidden': 'true' } }, el('kbd', { text: String(i + 1) }), label);
    return { pill, label: new TextCell(label), active: new ClassCell(pill, 'on') };
  });
  const slots = el('div', 'weapon-slots', slotPills[0]!.pill, slotPills[1]!.pill);

  const nameEl = el('div', 'weapon-name');
  const modeEl = el('div', 'weapon-mode');
  const magEl = el('span', 'ammo-mag');
  const resEl = el('span', 'ammo-res');
  const ammo = el(
    'div',
    { class: 'ammo', attrs: { role: 'group' } },
    magEl,
    el('span', { class: 'ammo-sep', text: '/', attrs: { 'aria-hidden': 'true' } }),
    resEl,
  );
  const statusEl = el('div', 'weapon-status');
  const reloadFill = el('div', 'reload-fill');
  const reloadBar = el('div', { class: 'reload-bar', attrs: { 'aria-hidden': 'true' } }, reloadFill);

  const grenText = el('span', 'kit-count');
  const kit = el(
    'div',
    'kit',
    el('span', { class: 'kit-item', attrs: { title: 'Granadas (G)' } }, el('kbd', { text: 'G' }), icon('grenade'), grenText),
  );

  const root = el('div', 'weapon', slots, nameEl, modeEl, ammo, reloadBar, statusEl, kit);

  const name = new TextCell(nameEl);
  const mode = new TextCell(modeEl);
  const mag = new TextCell(magEl);
  const res = new TextCell(resEl);
  const status = new TextCell(statusEl);
  const gren = new TextCell(grenText);
  const low = new ClassCell(root, 'low');
  const empty = new ClassCell(root, 'empty');
  const reloading = new ClassCell(root, 'reloading');
  let lastMag = -1;
  let lastRes = -1;
  let lastId = '';

  let reloadAnim: Animation | null = null;
  const stopReload = (): void => {
    reloadAnim?.cancel();
    reloadAnim = null;
  };

  env.scope
    .on('player:reloadStarted', ({ durationS }) => {
      stopReload();
      const a = reloadFill.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
        duration: Math.max(100, durationS * 1000), easing: 'linear', fill: 'forwards',
      });
      reloadAnim = a;
      a.onfinish = () => {
        if (reloadAnim === a) reloadAnim = null;
      };
    })
    .on('player:reloadFinished', stopReload)
    .on('player:weaponSwitched', stopReload)
    .on('player:died', stopReload);

  return {
    el: root,
    update() {
      const p = ctx.state.player;
      const slot = p.slots[p.activeSlot];
      for (let i = 0; i < 2; i++) {
        const s = p.slots[i];
        const pill = slotPills[i]!;
        pill.label.set(s ? SHORT_NAME[s.id] : '—');
        pill.active.set(p.activeSlot === i);
      }
      gren.set(`×${p.grenades}/${p.hasPack ? PLAYER.cap.grenadesPack : PLAYER.cap.grenades}`);

      if (!slot) {
        name.set('Sin arma');
        mode.set('');
        mag.set('—');
        res.set('—');
        status.set('');
        low.set(false);
        empty.set(false);
        reloading.set(false);
        return;
      }
      const def = WEAPONS[slot.id];
      name.set(def.name);
      mode.set(FIRE_MODE_LABEL[def.fireMode]);
      mag.set(String(slot.mag));
      res.set(String(slot.reserve));

      const isReloading = reloadAnim !== null || p.reloading;
      const noAmmo = slot.mag <= 0 && slot.reserve <= 0;
      const isLow = slot.mag <= Math.ceil(def.magSize * HUD.lowAmmoFraction);
      low.set(isLow && !noAmmo);
      empty.set(noAmmo || (slot.mag <= 0 && !isReloading));
      reloading.set(isReloading);
      status.set(
        isReloading ? 'RECARGANDO…'
          : noAmmo ? 'SIN MUNICIÓN'
            : slot.mag <= 0 ? 'CARGADOR VACÍO — R'
              : isLow && slot.reserve > 0 ? 'RECARGAR — R'
                : '',
      );
      if (slot.mag !== lastMag || slot.reserve !== lastRes || slot.id !== lastId) {
        lastMag = slot.mag;
        lastRes = slot.reserve;
        lastId = slot.id;
        ammo.setAttribute('aria-label', `${def.name}: ${slot.mag} en el cargador, ${slot.reserve} de reserva`);
      }
    },
    dispose: stopReload,
  };
}
