/** Barras de vida y blindaje (abajo-izquierda) con nº de placas y progreso de colocación. */
import { HUD, PLAYER, THEME } from '../../config';
import { AttrCell, ClassCell, StyleCell, TextCell, el, num, play, quant } from '../dom';
import { icon } from '../icons';
import type { HudEnv, Widget } from './types';

interface Bar {
  root: HTMLElement;
  track: HTMLElement;
  fill: StyleCell;
  ghost: StyleCell;
  value: TextCell;
  meter: AttrCell;
  meterText: AttrCell;
  low: ClassCell;
}

function makeBar(kind: 'hp' | 'armor', label: string, ico: 'health' | 'shield'): Bar {
  const fill = el('div', 'vbar-fill');
  const ghost = el('div', 'vbar-ghost');
  const track = el('div', 'vbar-track', ghost, fill);
  const value = el('span', 'vbar-num');
  const root = el(
    'div',
    { class: `vbar vbar-${kind}`, attrs: { role: 'meter', 'aria-label': label, 'aria-valuemin': '0' } },
    el('span', 'vbar-ico', icon(ico)),
    track,
    value,
  );
  return {
    root, track,
    fill: new StyleCell(fill, '--v'),
    ghost: new StyleCell(ghost, '--v'),
    value: new TextCell(value),
    meter: new AttrCell(root, 'aria-valuenow'),
    meterText: new AttrCell(root, 'aria-valuetext'),
    low: new ClassCell(root, 'low'),
  };
}

export function createVitals(env: HudEnv): Widget {
  const { ctx } = env;
  const hp = makeBar('hp', 'Vida', 'health');
  const armor = makeBar('armor', 'Blindaje', 'shield');
  hp.root.setAttribute('aria-valuemax', String(ctx.state.player.maxHp));
  armor.root.setAttribute('aria-valuemax', String(ctx.state.player.maxArmor));

  // Progreso de colocación de placa (sobre la barra de blindaje).
  const plateProg = el('div', 'vbar-prog');
  armor.track.append(plateProg);
  const plateLabel = el('span', { class: 'vitals-plating', text: 'Colocando placa…', attrs: { 'aria-hidden': 'true' } });
  const platesText = el('span', 'plates-count');
  const plates = el(
    'div',
    { class: 'plates', attrs: { title: 'Placas de armadura (Q)' } },
    el('kbd', { text: 'Q' }),
    icon('plate'),
    platesText,
  );
  const armorRow = el('div', 'vrow', armor.root, plates);
  const hpRow = el('div', 'vrow', hp.root);
  const root = el('div', { class: 'vitals' }, hpRow, armorRow, plateLabel);

  const platesCell = new TextCell(platesText);
  const platingOn = new ClassCell(root, 'plating');
  const platingKick = { anim: null as Animation | null };
  let ghostHp = ctx.state.player.hp / Math.max(1, ctx.state.player.maxHp);
  let ghostArmor = ctx.state.player.armor / Math.max(1, ctx.state.player.maxArmor);

  const flash = (node: HTMLElement, color: string): void => {
    play(node, [{ boxShadow: `0 0 0 2px ${color}` }, { boxShadow: `0 0 0 0 transparent` }], { duration: 520, easing: 'ease-out' });
  };
  const stopPlating = (): void => {
    platingKick.anim?.cancel();
    platingKick.anim = null;
  };

  env.scope
    .on('player:damaged', ({ hpDamage, armorDamage }) => {
      if (hpDamage > 0) flash(hp.track, THEME.danger);
      if (armorDamage > 0) flash(armor.track, THEME.info);
    })
    .on('player:healed', () => flash(hp.track, THEME.accent))
    .on('player:plateStarted', ({ durationS }) => {
      stopPlating();
      const a = plateProg.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
        duration: Math.max(100, durationS * 1000), easing: 'linear', fill: 'forwards',
      });
      platingKick.anim = a;
      a.onfinish = () => {
        if (platingKick.anim === a) platingKick.anim = null;
      };
    })
    .on('player:plateUsed', () => {
      stopPlating();
      flash(armor.track, THEME.accent);
    })
    .on('player:died', stopPlating);

  return {
    el: root,
    update(dt) {
      const p = ctx.state.player;
      const maxHp = Math.max(1, p.maxHp);
      const maxArmor = Math.max(1, p.maxArmor);
      const fHp = Math.min(1, Math.max(0, p.hp / maxHp));
      const fArmor = Math.min(1, Math.max(0, p.armor / maxArmor));

      // El "fantasma" persigue a la barra real más despacio (muestra la pérdida reciente).
      ghostHp = fHp >= ghostHp ? fHp : ghostHp + (fHp - ghostHp) * Math.min(1, dt * 3);
      ghostArmor = fArmor >= ghostArmor ? fArmor : ghostArmor + (fArmor - ghostArmor) * Math.min(1, dt * 3);

      hp.fill.set(num(quant(fHp, 0.005)));
      hp.ghost.set(num(quant(ghostHp, 0.01)));
      armor.fill.set(num(quant(fArmor, 0.005)));
      armor.ghost.set(num(quant(ghostArmor, 0.01)));

      const hpInt = Math.ceil(p.hp);
      const arInt = Math.ceil(p.armor);
      hp.value.set(String(hpInt));
      armor.value.set(String(arInt));
      hp.meter.set(String(hpInt));
      hp.meterText.set(`${hpInt} de ${p.maxHp}`);
      armor.meter.set(String(arInt));
      armor.meterText.set(`${arInt} de ${p.maxArmor}, ${p.plates} placas`);
      hp.low.set(fHp <= HUD.lowHpFraction);
      armor.low.set(p.armor <= 0);

      const cap = p.hasPack ? PLAYER.cap.platesPack : PLAYER.cap.plates;
      platesCell.set(`×${p.plates}/${cap}`);

      const plating = p.usingPlate || platingKick.anim !== null;
      platingOn.set(plating);
      if (!p.usingPlate && platingKick.anim && ctx.state.flow !== 'playing') stopPlating();
    },
    dispose() {
      stopPlating();
    },
  };
}
