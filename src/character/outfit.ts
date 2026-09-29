/**
 * Ropa del maniquí a partir de la tabla de conjuntos (outfitSpec.ts): chaqueta, mangas, pantalón, botas,
 * guantes, cuello/capucha, bolsillos, cremallera, botones, cinturón, correas/arnés, chaleco y mochila,
 * bandas reflectantes, cruz sanitaria, rodilleras… Todas las prendas son «cáscaras» ligeramente más
 * grandes que el cuerpo (mismas secciones + holgura), por lo que siguen la silueta de cada género.
 */
import { clamp, smoothstep } from '../core/util';
import { armRing, handStations } from './body';
import type { BuildCtx, Role } from './build';
import { newRow, ringZ } from './geo';
import type { RibbonPoint, RingRow, Skin, Station, StationZ, Xf } from './geo';
import { sideBone } from './rig';
import type { Side } from './rig';

const TAU = Math.PI * 2;
const SIDES: readonly Side[] = [1, -1];

export interface OutfitInfo {
  /** z (negativa) del punto más atrás de la ropa a la altura y: el pelo largo se apoya por fuera. */
  backZ(y: number): number;
  /** Radio y altura superior del cuello de la prenda (el pañuelo se coloca por encima). */
  collarR: number;
  collarTopY: number;
  /** z de la superficie delantera de la ropa en (x, y) (sobre el cuello: el cuello desnudo). */
  frontZ(x: number, y: number): number;
}

export function buildOutfit(c: BuildCtx): OutfitInfo {
  const { body: b, outfit: s, kit, skins } = c;
  const fem = b.gender === 'female';
  const off = fem ? 0.009 : 0.011;
  const hemY = b.hipY + s.hem;
  const topY = b.torso.maxY;
  const nb = b.neckBaseY;
  const k = fem ? 0.9 : 1;
  const t1 = newRow();
  const t2 = newRow();

  // ── Superficie de la chaqueta ──────────────────────────────────────────────
  const wave = (y: number, y0: number): number => (s.baffle > 0 ? 0.3 + 0.7 * (0.5 + 0.5 * Math.cos(((y - y0) / s.baffle) * TAU)) : 1);

  const jacketRow = (y: number, out: RingRow): RingRow => {
    b.torso.at(Math.max(y, b.hipY - 0.06), out);
    const flare = s.flare * (fem ? 1.2 : 1) * (1 - smoothstep(hemY, hemY + 0.22, y));
    const g = off + s.puff * wave(y, hemY) + flare;
    out.rx += g;
    out.rz += g;
    return out;
  };

  const zSurf = (x: number, y: number, back: boolean): number => {
    jacketRow(y, t1);
    return ringZ(t1, clamp(x, -0.93 * t1.rx, 0.93 * t1.rx), !back, 2.4);
  };

  /** Punto de la superficie de la chaqueta con su normal (diferencias finitas). */
  const surfPoint = (x: number, y: number, back: boolean, lift: number, out: RibbonPoint): RibbonPoint => {
    const d = 0.004;
    const dzdx = (zSurf(x + d, y, back) - zSurf(x - d, y, back)) / (2 * d);
    const dzdy = (zSurf(x, y + d, back) - zSurf(x, y - d, back)) / (2 * d);
    const sg = back ? -1 : 1;
    const nx = -dzdx * sg;
    const ny = -dzdy * sg;
    const nz = sg;
    const l = Math.hypot(nx, ny, nz);
    out.nx = nx / l;
    out.ny = ny / l;
    out.nz = nz / l;
    out.x = x + out.nx * lift;
    out.y = y + out.ny * lift;
    out.z = zSurf(x, y, back) + out.nz * lift;
    return out;
  };

  const _pt: RibbonPoint = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1 };
  /** Transformación para colocar una pieza plana sobre la chaqueta (centro a `lift` de la superficie). */
  const place = (x: number, y: number, back: boolean, lift: number): Xf => {
    surfPoint(x, y, back, lift, _pt);
    const ry = back ? Math.PI - Math.atan2(-_pt.nx, -_pt.nz) : Math.atan2(_pt.nx, _pt.nz);
    return { x: _pt.x, y: _pt.y, z: _pt.z, rx: Math.atan2(_pt.ny, Math.abs(_pt.nz)) * (back ? 1 : -1), ry };
  };

  const path = (x0: number, y0: number, x1: number, y1: number, back: boolean, lift: number, n = 8): RibbonPoint[] => {
    const pts: RibbonPoint[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push(surfPoint(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, back, lift, { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1 }));
    }
    return pts;
  };

  const band = (role: Role, skin: Skin, y0: number, y1: number, grow: number, rowFn: (y: number, out: RingRow) => RingRow, seg = 18, p = 2.4): void => {
    const st: Station[] = [];
    const at = (y: number, g: number): void => {
      rowFn(y, t2);
      st.push({ y, rx: t2.rx + g, rz: t2.rz + g, cx: t2.cx ?? 0, cz: t2.cz });
    };
    const ch = 0.004;
    at(y0, grow - ch);
    at(y0 + ch, grow);
    at(y1 - ch, grow);
    at(y1, grow - ch);
    kit.paint(role, skin).loftY(st, { seg, p });
  };

  // ── Chaqueta ───────────────────────────────────────────────────────────────
  const vDepth = fem ? 0.115 : 0.125;
  const vCut = (th: number): number => {
    const a = Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
    return topY - vDepth * Math.max(0, 1 - a / 0.8);
  };
  const jacket = (): void => {
    const ys: number[] = [];
    const step = s.baffle > 0 ? s.baffle / 4 : 0.055;
    for (let y = hemY; y < topY - 0.02; y += step) ys.push(y);
    ys.push(topY);
    const st = ys.map((y): Station => {
      jacketRow(y, t1);
      return { y, rx: t1.rx, rz: t1.rz, cz: t1.cz };
    });
    const v = s.collar === 'vneck';
    kit.paint('jacket', s.skirt ? skins.skirt : skins.torso).loftY(st, {
      seg: v ? 40 : 22, p: 2.4,
      ...(v ? { yMax: vCut, rowAt: (y: number, out: Station): void => { jacketRow(y, t1); out.rx = t1.rx; out.rz = t1.rz; out.cz = t1.cz; out.cx = 0; } } : {}),
    });
    if (s.undershirt) {
      const us: Station[] = [];
      for (let y = b.chestJ - 0.08; y <= topY + 1e-6; y += 0.05) {
        b.torso.at(y, t2);
        us.push({ y, rx: t2.rx + 0.005, rz: t2.rz + 0.005, cz: t2.cz });
      }
      kit.paint('pants', skins.torso).loftY(us, { seg: 18, p: 2.4 });
    }
    if (s.trim) band('accent', skins.skirt, hemY, hemY + 0.035, off + 0.006 + s.puff * 0.6, (y, out) => jacketRow(y, out), 22);
  };

  // ── Mangas ─────────────────────────────────────────────────────────────────
  const sleeveRow = (sd: Side) => (y: number, out: RingRow): RingRow => {
    armRing(b, y, sd, out);
    const g = off + s.puff * wave(y, b.shoulderY);
    out.rx += g;
    out.rz += g;
    return out;
  };

  const sleeveEnd = (): number => (s.sleeve === 'long' ? b.wristY + 0.03 : s.sleeve === 'short' ? b.elbowY + 0.07 : b.elbowY - 0.045);

  const sleeves = (): void => {
    const y1 = sleeveEnd();
    for (const sd of SIDES) {
      const rowFn = sleeveRow(sd);
      const armSkin = skins.arm(sd);
      const st: Station[] = [];
      const yTop = b.shoulderY + 0.02;
      const n = Math.max(4, Math.ceil((yTop - y1) / (s.baffle > 0 ? s.baffle / 3 : 0.06)));
      for (let i = 0; i <= n; i++) {
        const y = y1 + ((yTop - y1) * i) / n;
        rowFn(y, t1);
        st.push({ y, rx: t1.rx, rz: t1.rz, cx: t1.cx ?? 0, cz: 0 });
      }
      kit.paint('jacket', armSkin).loftY(st, { seg: 12, caps: 'bottom' });
      // Hombrera redondeada (deltoides).
      armRing(b, b.shoulderY, sd, t1);
      const r = t1.rx + off * 0.9 + s.puff * 0.8;
      kit.paint('jacket', sideBone('uArm', sd)).blob(r, r * 1.0, r * 1.02, { x: sd * b.shoulderX, y: b.shoulderY - 0.01 }, 12, 8);
      // Puño.
      const rolled = s.sleeve === 'rolled';
      band(s.trim ? 'accent' : 'jacket', armSkin, y1, y1 + (rolled ? 0.06 : 0.045), rolled ? 0.014 : 0.007 + s.puff * 0.5, rowFn, 12, 2);
      if (rolled) band('jacket', armSkin, y1 + 0.06, y1 + 0.085, 0.006, rowFn, 12, 2);
    }
  };

  // ── Pantalón y botas ───────────────────────────────────────────────────────
  const legRowFn = (sd: Side, grow: number) => (y: number, out: RingRow): RingRow => {
    b.leg.at(y, out);
    out.rx += grow;
    out.rz += grow;
    out.cx = sd * b.hipX;
    return out;
  };

  const pants = (): void => {
    const g = 0.01 + s.pantsBag;
    const yBot = 0.1;
    const yTop = b.hipY + 0.03;
    for (const sd of SIDES) {
      const rowFn = legRowFn(sd, g);
      const st: Station[] = [];
      const n = 11;
      for (let i = 0; i <= n; i++) {
        const y = yBot + ((yTop - yBot) * i) / n;
        rowFn(y, t1);
        st.push({ y, rx: t1.rx, rz: t1.rz, cx: t1.cx ?? 0, cz: t1.cz });
      }
      kit.paint('pants', skins.leg(sd)).loftY(st, { seg: 14, p: 2 });
    }
    // Cadera / cintura del pantalón (bajo la chaqueta).
    const pst: Station[] = [];
    for (let y = b.torso.minY; y <= b.waistJ + 0.14; y += 0.045) {
      b.torso.at(y, t1);
      pst.push({ y, rx: t1.rx + 0.007, rz: t1.rz + 0.007, cz: t1.cz });
    }
    kit.paint('pants', skins.torso).loftY(pst, { seg: 20, p: 2.4, caps: 'bottom' });
  };

  const boots = (): void => {
    const top = s.bootHeight;
    const g = Math.max(0.016, 0.009 + s.pantsBag);
    for (const sd of SIDES) {
      const st: Station[] = [];
      const n = Math.max(3, Math.round((top - 0.06) / 0.05));
      for (let i = 0; i <= n; i++) {
        const y = 0.06 + ((top - 0.06) * i) / n;
        legRowFn(sd, g + (i === n ? 0.005 : 0))(y, t1);
        st.push({ y, rx: t1.rx, rz: t1.rz, cx: t1.cx ?? 0, cz: t1.cz });
      }
      kit.paint('glove', skins.boot(sd)).loftY(st, { seg: 14, p: 2.1, caps: 'bottom' });
      const foot = b.foot;
      const upper: StationZ[] = foot.map((f) => ({ z: f[0], rx: f[1], ry: (f[2] - f[3]) / 2, cy: (f[2] + f[3]) / 2, cx: sd * b.hipX, p: 2.6 }));
      kit.paint('glove', sideBone('foot', sd)).loftZ(upper, { seg: 14, caps: 'both' });
      const sole: StationZ[] = foot.map((f) => ({ z: f[0] * 1.012, rx: f[1] + 0.004, ry: 0.016, cy: 0.016, cx: sd * b.hipX, p: 2.6 }));
      kit.paint('dark', sideBone('foot', sd)).loftZ(sole, { seg: 14, caps: 'both' });
      if (s.kneePads) {
        kit.paint('dark', sideBone('shin', sd)).tbox(0.07 * k, 0.03, 0.085 * k, 0.05, 0.1, {
          x: sd * b.hipX, y: b.kneeY + 0.01, z: b.leg.at(b.kneeY, t1).cz + t1.rz + 0.012 + 0.006, rx: -0.12,
        });
      }
      if (s.cargo) {
        const y = b.hipY - 0.2;
        b.leg.at(y, t1);
        const px = sd * (b.hipX + t1.rx + 0.01 + s.pantsBag + 0.006);
        const p = kit.paint('pants', skins.leg(sd));
        p.box(0.02, 0.13, 0.1, { x: px, y, z: t1.cz + 0.005 });
        p.box(0.024, 0.035, 0.104, { x: px + sd * 0.002, y: y + 0.06, z: t1.cz + 0.005 });
      }
    }
  };

  // ── Guantes ────────────────────────────────────────────────────────────────
  const gloves = (): void => {
    const full = s.glove === 'full';
    const puffy = s.puff > 0.02;
    const grow = puffy ? 0.012 : full ? 0.0055 : 0.0045;
    const hk = b.handK;
    for (const sd of SIDES) {
      const hand = kit.paint('glove', sideBone('hand', sd));
      const w1 = full ? b.handLen + 0.002 : 0.105 * hk;
      const st = handStations(b, sd, 0, w1, grow, 6);
      armRing(b, b.wristY + 0.035, sd, t1);
      st.push({ y: b.wristY + 0.035, rx: t1.rx + 0.0085, rz: t1.rz + 0.0085, cx: sd * b.shoulderX, cz: 0 });
      hand.loftY(st, { seg: 10, p: 2.6, caps: 'bottom' });
      const xi = sd * (b.shoulderX - 0.033 * hk);
      const th = [
        { x: xi, y: b.wristY - 0.03 * hk, z: 0.014 * hk, ra: 0.0135 * hk + grow },
        { x: xi - sd * 0.004 * hk, y: b.wristY - 0.07 * hk, z: 0.03 * hk, ra: 0.0118 * hk + grow },
        { x: xi - sd * 0.008 * hk, y: b.wristY - 0.103 * hk, z: 0.043 * hk, ra: 0.0085 * hk + grow },
      ];
      hand.tube(full ? th : th.slice(0, 2), { seg: 6 });
    }
  };

  // ── Cuello, capucha ────────────────────────────────────────────────────────
  let collarR = b.neckR + 0.012;
  let collarTopY = nb;
  const collar = (): void => {
    const nr = b.neckR;
    const neckSkin = skins.neck;
    const ring = (y0: number, y1: number, r0: number, r1: number, role: Role = 'jacket'): void => {
      const st: Station[] = [];
      for (let i = 0; i <= 3; i++) {
        const t = i / 3;
        const r = r0 + (r1 - r0) * t;
        st.push({ y: y0 + (y1 - y0) * t, rx: r * 1.02, rz: r * 0.95, cz: 0.0 });
      }
      kit.paint(role, neckSkin).loftY(st, { seg: 16, p: 2.2 });
    };
    switch (s.collar) {
      case 'stand':
        ring(nb - 0.02, nb + 0.04, nr + 0.022, nr + 0.02);
        collarR = nr + 0.024;
        collarTopY = nb + 0.04;
        break;
      case 'mandarin':
        ring(nb - 0.02, nb + 0.06, nr + 0.024, nr + 0.02);
        ring(nb + 0.052, nb + 0.064, nr + 0.024, nr + 0.024, 'accent');
        collarR = nr + 0.028;
        collarTopY = nb + 0.064;
        break;
      case 'fold': {
        ring(nb - 0.025, nb + 0.03, nr + 0.024, nr + 0.038);
        if (s.trim) ring(nb + 0.026, nb + 0.033, nr + 0.038, nr + 0.04, 'accent');
        // Solapas.
        const lp = kit.paint('jacket', skins.torso);
        for (const sd of SIDES) {
          const y = nb - 0.055;
          const x = sd * (0.05 * k);
          lp.tbox(0.02, 0.006, 0.05 * k, 0.014, 0.13, { x, y, z: zSurf(x, y, false) + 0.008, rz: sd * 0.32, rx: -0.12 });
        }
        collarR = nr + 0.042;
        collarTopY = nb + 0.033;
        break;
      }
      case 'high': {
        const top = b.chinY - 0.012;
        ring(nb - 0.03, top, nr + 0.05, nr + 0.06);
        for (let y = nb + 0.012; y < top - 0.01; y += 0.03) ring(y, y + 0.014, nr + 0.06, nr + 0.066);
        if (s.trim) ring(top - 0.012, top + 0.004, nr + 0.06, nr + 0.06, 'accent');
        collarR = nr + 0.07;
        collarTopY = top;
        break;
      }
      case 'vneck':
        collarR = nr + 0.012;
        collarTopY = nb;
        break;
    }
    if (s.hood) {
      // Capucha caída: rollo grueso tras el cuello + punta colgando por la espalda.
      const kk = fem ? 0.86 : 1;
      const hp = kit.paint('jacket', skins.neck);
      const back = -(b.neckR + 0.05);
      hp.tube(
        [
          { x: -0.115 * kk, y: nb + 0.0, z: -0.03, ra: 0.03 * kk, rb: 0.03 * kk },
          { x: -0.075 * kk, y: nb + 0.02, z: back + 0.005, ra: 0.036 * kk, rb: 0.042 * kk },
          { x: 0, y: nb + 0.034, z: back - 0.01, ra: 0.04 * kk, rb: 0.05 * kk },
          { x: 0.075 * kk, y: nb + 0.02, z: back + 0.005, ra: 0.036 * kk, rb: 0.042 * kk },
          { x: 0.115 * kk, y: nb + 0.0, z: -0.03, ra: 0.03 * kk, rb: 0.03 * kk },
        ],
        { seg: 8 },
      );
      hp.tbox(0.1 * kk, 0.05, 0.05 * kk, 0.02, 0.19 * kk, { y: nb - 0.045, z: back - 0.035, rx: 0.12 });
      kit.paint(s.trim ? 'accent' : 'dark', skins.neck).tbox(0.07 * kk, 0.012, 0.03 * kk, 0.006, 0.13 * kk, { y: nb - 0.035, z: back - 0.006, rx: 0.12 });
      collarTopY = Math.max(collarTopY, nb + 0.06);
      collarR = Math.max(collarR, nr + 0.05);
    }
  };

  // ── Bolsillos, cremallera, botones, cruz, hombreras ────────────────────────
  const pocket = (x: number, y: number, w: number, h: number, flap: boolean, role: Role = 'jacket'): void => {
    const p = kit.paint(role, skins.torso);
    p.box(w, h, 0.012, place(x, y, false, 0.006));
    if (flap) {
      p.box(w + 0.004, 0.032, 0.012, place(x, y + h * 0.5 - 0.012, false, 0.01));
      kit.paint('metal', skins.torso).blob(0.005, 0.005, 0.003, place(x, y + h * 0.5 - 0.02, false, 0.0175), 6, 4);
    }
  };

  const details = (): void => {
    const chestY = b.chestJ + (fem ? 0.075 : 0.06);
    const zip = kit.paint('metal', skins.torso);
    if (s.chestPockets && !s.vest) {
      for (const sd of SIDES) pocket(sd * (fem ? 0.062 : 0.076), chestY, 0.07 * k, 0.068 * k, s.flaps);
    }
    if (s.hipPockets) {
      for (const sd of SIDES) {
        const y = hemY + 0.11;
        const x = sd * (fem ? 0.108 : 0.112);
        pocket(x, y, 0.085 * k, 0.075 * k, s.flaps);
      }
    }
    if (s.zipper) {
      const y0 = hemY + 0.012;
      const y1 = topY - 0.03;
      if (s.trim) kit.paint('accent', skins.torso).ribbon(path(0, y0, 0, y1, false, 0.0, 10), 0.05, 0.0025);
      zip.ribbon(path(0, y0, 0, y1, false, 0.0, 10), 0.009, 0.0045);
      zip.box(0.014, 0.03, 0.006, place(0.0, y1 - 0.02, false, 0.008));
    }
    if (s.buttons !== 'none') {
      const y1 = s.collar === 'vneck' ? topY - vDepth - 0.03 : topY - 0.1;
      const y0 = hemY + 0.06;
      const n = s.buttons === 'double' ? 5 : 5;
      for (let i = 0; i < n; i++) {
        const y = y1 + ((y0 - y1) * i) / (n - 1);
        if (s.buttons === 'single') {
          zip.blob(0.0075, 0.0075, 0.004, place(0, y, false, 0.006), 6, 4);
        } else {
          for (const sd of SIDES) kit.paint('accent', skins.torso).blob(0.0085, 0.0085, 0.0045, place(sd * 0.048 * k, y, false, 0.006), 7, 5);
        }
      }
    }
    if (s.epaulettes) {
      for (const sd of SIDES) {
        armRing(b, b.shoulderY, sd, t1);
        const r = t1.rx + off + 0.006 + s.puff * 0.8;
        const a = 0.42;
        const cxp = sd * b.shoulderX - sd * Math.sin(a) * (r + 0.006);
        const cyp = b.shoulderY - 0.006 + Math.cos(a) * (r + 0.006);
        kit.paint(s.trim ? 'accent' : 'jacket', sideBone('uArm', sd)).box(0.05 * k, 0.012, 0.1 * k, { x: cxp, y: cyp, rz: sd * a });
      }
    }
    if (s.cross) {
      const cr = (x: number, y: number, back: boolean, size: number): void => {
        const xf = place(x, y, back, 0.004);
        const p = kit.paint('accent', skins.torso);
        p.box(size, size * 0.34, 0.008, xf);
        p.box(size * 0.34, size, 0.008, xf);
      };
      cr(fem ? 0.06 : 0.07, chestY + 0.004, false, 0.048 * k);
      cr(0, chestY + 0.02, true, 0.12 * k);
      for (const sd of SIDES) {
        armRing(b, b.shoulderY - 0.1, sd, t1);
        const xf: Xf = { x: sd * (b.shoulderX + t1.rx + off + 0.004), y: b.shoulderY - 0.1, ry: sd * (Math.PI / 2) };
        const p = kit.paint('accent', sideBone('uArm', sd));
        p.box(0.042 * k, 0.014, 0.006, xf);
        p.box(0.014, 0.042 * k, 0.006, xf);
      }
    }
    if (s.bands) {
      const reflective = (y0: number, y1: number): void => band('accent', skins.torso, y0, y1, off + 0.004 + s.puff * 0.7, (y, out) => jacketRow(y, out), 22);
      reflective(b.waistJ + 0.0, b.waistJ + 0.045);
      reflective(b.chestJ + 0.04, b.chestJ + 0.085);
      for (const sd of SIDES) {
        const rowFn = sleeveRow(sd);
        band('accent', skins.arm(sd), b.elbowY + 0.09, b.elbowY + 0.135, 0.004, rowFn, 12, 2);
        band('accent', skins.arm(sd), b.wristY + 0.09, b.wristY + 0.125, 0.004, rowFn, 12, 2);
        band('accent', skins.leg(sd), s.bootHeight + 0.04, s.bootHeight + 0.08, 0.014 + s.pantsBag, legRowFn(sd, 0), 14, 2);
        band('accent', skins.leg(sd), b.kneeY + 0.15, b.kneeY + 0.19, 0.014 + s.pantsBag, legRowFn(sd, 0), 14, 2);
      }
    }
    if (s.trim && (s.collar === 'stand' || s.collar === 'high') && s.hood === false && s.zipper === false) {
      // Costuras laterales luminosas/ribetes (carmesí no usa esta rama).
    }
  };

  // Rayas de manga (chándal/urbano, sigilo luminoso).
  const stripes = (): void => {
    if (!s.trim || s.collar === 'mandarin' || s.collar === 'high' || s.collar === 'vneck') return;
    for (const sd of SIDES) {
      const pts = [];
      const y0 = b.shoulderY - 0.05;
      const y1 = sleeveEnd() + 0.03;
      for (let i = 0; i <= 9; i++) {
        const y = y0 + ((y1 - y0) * i) / 9;
        sleeveRow(sd)(y, t1);
        pts.push({ x: (t1.cx ?? 0) + sd * (t1.rx + 0.0015), y, z: 0, ra: 0.004, rb: 0.0035 });
      }
      kit.paint('accent', skins.arm(sd)).tube(pts.reverse(), { seg: 5, ref: [1, 0, 0] });
    }
    if (s.glow) {
      // Costura luminosa a cada lado del torso.
      for (const sd of SIDES) {
        const pts: RibbonPoint[] = [];
        for (let i = 0; i <= 8; i++) {
          const y = hemY + 0.03 + ((b.chestJ + 0.1 - hemY - 0.03) * i) / 8;
          jacketRow(y, t1);
          pts.push({ x: sd * (t1.rx + 0.002), y, z: t1.cz, nx: sd, ny: 0, nz: 0 });
        }
        kit.paint('accent', skins.torso).ribbon(pts, 0.008, 0.0);
      }
    }
  };

  // ── Cinturón, correas y arnés ──────────────────────────────────────────────
  const beltY = b.hipY + 0.09;
  const belt = (): void => {
    if (s.belt === 'none') return;
    const wide = s.belt === 'sash' ? 0.07 : s.belt === 'tool' ? 0.05 : 0.038;
    const role: Role = s.belt === 'sash' ? 'accent' : 'dark';
    band(role, skins.torso, beltY - wide / 2, beltY + wide / 2, off + 0.008 + s.puff * 0.5, (y, out) => jacketRow(y, out), 22);
    const face = (x: number, y: number, back: boolean, lift: number): Xf => place(x, y, back, lift);
    if (s.belt === 'web' || s.belt === 'tool' || s.belt === 'utility') {
      kit.paint('metal', skins.torso).box(0.038, 0.032, 0.012, face(0, beltY, false, off + 0.014));
    }
    const pouches: { x: number; back: boolean; w: number; h: number }[] = [];
    if (s.belt === 'tool') pouches.push({ x: 0.13, back: false, w: 0.07, h: 0.1 }, { x: -0.12, back: false, w: 0.06, h: 0.09 }, { x: 0.06, back: true, w: 0.08, h: 0.09 });
    if (s.belt === 'utility') pouches.push({ x: 0.125, back: false, w: 0.05, h: 0.06 }, { x: -0.125, back: false, w: 0.05, h: 0.06 });
    for (const q of pouches) {
      const y = beltY - 0.045;
      const xf = face(q.x * k, y, q.back, off + 0.02 + q.h * 0.08);
      kit.paint(s.belt === 'tool' ? 'glove' : 'dark', skins.torso).box(q.w * k, q.h, 0.045, xf);
      kit.paint('metal', skins.torso).box(q.w * k * 0.4, 0.012, 0.006, face(q.x * k, y + q.h * 0.3, q.back, off + 0.045));
    }
    if (s.belt === 'sash') {
      // Nudo lateral y dos colas.
      const kn = face(0.1 * k, beltY - 0.005, false, off + 0.02);
      const sp = kit.paint('accent', skins.torso);
      sp.blob(0.03, 0.03, 0.02, kn, 8, 6);
      sp.tbox(0.03, 0.008, 0.045, 0.01, 0.16, { ...face(0.115 * k, beltY - 0.1, false, off + 0.022), rz: 0.08 });
      sp.tbox(0.026, 0.008, 0.04, 0.01, 0.13, { ...face(0.085 * k, beltY - 0.09, false, off + 0.024), rz: -0.12 });
    }
  };

  const straps = (): void => {
    if (s.straps === 'none') return;
    const dark = kit.paint('dark', skins.torso);
    const lift = off * 0.6 + 0.012 + (s.vest ? 0.02 : 0) + s.puff * 0.5;
    const yTop = topY - 0.05;
    const yLow = beltY + 0.005;
    const sw = s.straps === 'harness' ? 0.034 : 0.045;
    const xs = 0.085 * k;
    const xl = 0.12 * k;
    for (const back of [false, true]) {
      dark.ribbon(path(xs, yTop, -xl, yLow, back, lift, 10), sw, 0.0);
      if (s.straps === 'harness') dark.ribbon(path(-xs, yTop, xl, yLow, back, lift, 10), sw, 0.0);
    }
    const metal = kit.paint('metal', skins.torso);
    if (s.straps === 'harness') {
      // Hebillas en las correas delanteras y anilla en la espalda.
      metal.box(0.034, 0.04, 0.012, place(0, (yTop + yLow) / 2, false, lift + 0.006));
      metal.box(0.028, 0.03, 0.01, place(0, (yTop + yLow) / 2 + 0.03, true, lift + 0.006));
    } else if (s.glow) {
      const acc = kit.paint('accent', skins.torso);
      acc.ribbon(path(xs, yTop, -xl, yLow, false, lift + 0.002, 10), 0.012, 0.0);
      acc.ribbon(path(xs, yTop, -xl, yLow, true, lift + 0.002, 10), 0.012, 0.0);
    } else {
      // Cartucheras en el pecho.
      const acc = kit.paint('accent', skins.torso);
      for (let i = 1; i <= 4; i++) {
        const t = i / 5;
        const x = xs + (-xl - xs) * t;
        const y = yTop + (yLow - yTop) * t;
        acc.box(0.03 * k, 0.05, 0.03, place(x, y, false, lift + 0.014));
      }
    }
  };

  // ── Chaleco y mochila (militar) ───────────────────────────────────────────
  let packBack = 0;
  let packTop = 0;
  let packBottom = 0;
  const vestAndPack = (): void => {
    const vy0 = b.waistJ + 0.01;
    const vy1 = b.chestJ + (fem ? 0.2 : 0.21);
    const vest = kit.paint('pants', skins.torso);
    const st: Station[] = [];
    for (let y = vy0; y < vy1 + 1e-6; y += 0.05) {
      jacketRow(y, t1);
      st.push({ y, rx: t1.rx + 0.014, rz: t1.rz + 0.016, cz: t1.cz });
    }
    if (s.vest) {
      vest.loftY(st, {
        seg: 22, p: 2.4,
        yMax: (th) => vy1 - 0.055 * Math.max(0, 1 - Math.abs(Math.atan2(Math.sin(th), Math.cos(th))) / 0.7),
        rowAt: (y, out) => { jacketRow(y, t1); out.rx = t1.rx + 0.014; out.rz = t1.rz + 0.016; out.cz = t1.cz; out.cx = 0; },
      });
      // Cargadores delanteros con solapa y bolsa lateral.
      const pw = 0.078 * k;
      for (let i = -1; i <= 1; i++) {
        const y = b.chestJ - 0.045;
        const xf = place(i * (pw + 0.008), y, false, 0.045);
        const pp = kit.paint('accent', skins.torso);
        pp.box(pw, 0.1, 0.03, xf);
        pp.box(pw + 0.004, 0.03, 0.034, place(i * (pw + 0.008), y + 0.04, false, 0.048));
        kit.paint('dark', skins.torso).box(pw * 0.34, 0.016, 0.008, place(i * (pw + 0.008), y + 0.04, false, 0.068));
      }
      const side = place(0.16 * k, b.chestJ - 0.09, false, 0.035);
      kit.paint('accent', skins.torso).box(0.06, 0.09, 0.05, { ...side, ry: (side.ry ?? 0) });
    }
    if (s.pack) {
      const zb = ringZ(jacketRow(b.chestJ, t2), 0, false, 2.4) - (s.vest ? 0.016 : 0);
      const ph = 0.36 * k;
      const py = b.chestJ + (fem ? 0.01 : 0.02);
      const pd = 0.15 * k;
      const pz = zb - pd / 2 - 0.006;
      const pack = kit.paint('pants', 'chest');
      pack.tbox(0.25 * k, pd * 0.85, 0.29 * k, pd, ph, { y: py, z: pz });
      pack.box(0.27 * k, 0.05, pd * 1.05, { y: py + ph / 2 - 0.01, z: pz + 0.004 });
      for (const sd of SIDES) pack.box(0.05, 0.18 * k, 0.09 * k, { x: sd * 0.15 * k, y: py - 0.06, z: pz + 0.02 });
      const roll = kit.paint('accent', 'chest');
      const rr = 0.052 * k;
      roll.cyl(rr, rr, 0.32 * k, 10, { rz: Math.PI / 2, y: py + ph / 2 + rr * 0.9, z: pz + 0.005 });
      roll.cyl(rr, rr, 0.3 * k, 10, { rz: Math.PI / 2, y: py - ph / 2 - rr * 0.55, z: pz + 0.005 });
      const strap = kit.paint('dark', 'chest');
      for (const sx of [-0.09, 0.09]) {
        strap.box(0.014, rr * 2.1, rr * 2.2, { x: sx * k, y: py + ph / 2 + rr * 0.9, z: pz + 0.005 });
        strap.box(0.014, rr * 2.1, rr * 2.2, { x: sx * k, y: py - ph / 2 - rr * 0.55, z: pz + 0.005 });
      }
      // Correas de hombro visibles al frente.
      const lift = 0.03 + (s.vest ? 0.016 : 0);
      for (const sd of SIDES) {
        strap.ribbon(path(sd * 0.085 * k, topY - 0.035, sd * 0.148 * k, b.chestJ + 0.02, false, lift, 6), 0.03, 0.0);
        strap.ribbon(path(sd * 0.148 * k, b.chestJ + 0.02, sd * 0.152 * k, b.waistJ + 0.08, false, lift, 4), 0.03, 0.0);
      }
      packBack = pz - pd / 2 - 0.03;
      packTop = py + ph / 2 + rr * 1.9;
      packBottom = py - ph / 2 - rr * 1.6;
    }
  };

  jacket();
  sleeves();
  pants();
  boots();
  gloves();
  collar();
  details();
  stripes();
  belt();
  straps();
  vestAndPack();

  const hoodBack = -(b.neckR + 0.05 + 0.11);
  return {
    collarR,
    collarTopY,
    frontZ: (x, y) => (y > topY ? b.neckR * 0.95 + 0.004 : zSurf(x, y, false)),
    backZ(y: number): number {
      let z: number;
      if (y > topY) z = -(b.neckR * 0.95 + 0.004) - (y < collarTopY ? collarR - b.neckR : 0);
      else z = ringZ(jacketRow(y, t2), 0, false, 2.4) - (s.vest && y < b.chestJ + 0.2 ? 0.016 : 0);
      if (s.pack && y > packBottom && y < packTop) z = Math.min(z, packBack);
      if (s.hood && y > nb - 0.2 && y < nb + 0.08) z = Math.min(z, hoodBack);
      return z;
    },
  };
}
