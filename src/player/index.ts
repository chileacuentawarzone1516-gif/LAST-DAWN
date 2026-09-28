/**
 * createPlayer(ctx): controlador FPS + armas + granadas + placas. Implementa PlayerApi.
 */
import { WEAPON_HANDLING } from '../config';
import type { GameContext, PlayerApi } from '../core/context';
import type { DamageSource, Vec3 } from '../core/types';
import { applyDamageToPlayer, applyHeal } from '../rules/combat';
import { threatOf } from '../rules/zones';
import { WeaponSystem } from '../weapons';
import { PlayerController } from './PlayerController';

export function createPlayer(ctx: GameContext): PlayerApi {
  const bus = ctx.bus;
  const scope = bus.scope();
  let stateRef: object = ctx.state.player;
  const dmg = { armorDamage: 0, hpDamage: 0 };

  const api: PlayerApi = {
    position: null as unknown as Vec3,
    eye: null as unknown as Vec3,
    forward: null as unknown as Vec3,
    velocity: null as unknown as Vec3,
    godMode: false,
    damage(amount, source, from = null) {
      const st = ctx.state.player;
      if (!ctl.alive || api.godMode || !(amount > 0)) return;
      applyDamageToPlayer(st, amount, source, dmg);
      bus.emit('player:damaged', {
        amount, hpDamage: dmg.hpDamage, armorDamage: dmg.armorDamage, source, from, hp: st.hp, armor: st.armor,
      });
      if (from) ctl.flinch((from.x - ctl.position.x) * ctl.right.x + (from.z - ctl.position.z) * ctl.right.z);
      else ctl.flinch(0);
      if (st.hp <= 0) die(source, from);
    },
    heal(amount) {
      const st = ctx.state.player;
      if (!ctl.alive) return;
      const r = applyHeal(st.hp, st.maxHp, amount);
      if (r.healed > 0) {
        st.hp = r.hp;
        bus.emit('player:healed', { amount: r.healed, hp: st.hp });
      }
    },
    teleport(x, z, yaw) {
      ctl.teleport(x, z, yaw);
    },
    setControlEnabled(e) {
      ctl.controlEnabled = e;
    },
    update(dt) {
      const st = ctx.state.player;
      if (stateRef !== st) {
        stateRef = st;
        ctl.syncFromState();
      }
      const H = WEAPON_HANDLING;
      ctl.simulate(dt, weapons, H.recoilRecoverRate, H.recoilRecoverDelayS);
      ctl.applyCamera();
      if (dt > 0) weapons.update(dt);
      ctl.applyCamera();
      st.pos.x = ctl.position.x;
      st.pos.y = ctl.position.y;
      st.pos.z = ctl.position.z;
      st.yaw = ctl.yaw;
      st.crouched = ctl.crouched;
      st.sprinting = ctl.sprinting;
      const zone = ctx.world.zoneAt(ctl.position.x, ctl.position.z);
      if (zone !== st.zone) {
        st.zone = zone;
        bus.emit('zone:entered', { zone, threat: threatOf(zone) });
      }
    },
    dispose() {
      scope.dispose();
      weapons.dispose();
    },
  };

  const ctl: PlayerController = new PlayerController(ctx, (a, s) => api.damage(a, s));
  const weapons = new WeaponSystem(ctx, ctl);
  (api as { position: Vec3 }).position = ctl.position;
  (api as { eye: Vec3 }).eye = ctl.eye;
  (api as { forward: Vec3 }).forward = ctl.forward;
  (api as { velocity: Vec3 }).velocity = ctl.velocity;

  function die(source: DamageSource, from: Vec3 | null): void {
    const st = ctx.state.player;
    st.alive = false;
    st.hp = 0;
    const side = from ? (from.x - ctl.position.x) * ctl.right.x + (from.z - ctl.position.z) * ctl.right.z : 1;
    ctl.die(side);
    weapons.onDeath();
    bus.emit('player:died', { source });
  }

  scope.on('player:jumped', () => weapons.onJump());
  scope.on('player:landed', (e) => weapons.onLand(e.impact));
  return api;
}
