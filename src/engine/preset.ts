/**
 * Resolución del preset gráfico efectivo (lógica pura, sin three.js): el perfil móvil
 * (RENDER.mobile) sobrescribe campos del preset base y limita resolución y anisotropía.
 */
import { RENDER } from '../config';
import type { QualityLevel, QualityPreset } from '../config';

export function resolvePreset(level: QualityLevel, touch: boolean): QualityPreset {
  const base = RENDER.presets[level];
  if (!touch) return { ...base };
  const p: QualityPreset = { ...base, ...RENDER.mobile.presets[level] };
  p.pixelRatioMax = Math.min(p.pixelRatioMax, RENDER.mobile.pixelRatioMax);
  p.anisotropy = Math.min(p.anisotropy, RENDER.mobile.anisotropyMax);
  return p;
}

/** Ajusta el preset a las capacidades reales del dispositivo (degradación segura). */
export function clampToDevice(p: QualityPreset, caps: { maxTextureSize: number; msaaHdr: boolean; hdr: boolean }): QualityPreset {
  const out = { ...p };
  out.shadowMapSize = Math.min(out.shadowMapSize, caps.maxTextureSize);
  if (!caps.hdr || !caps.msaaHdr) out.msaa = 0;
  return out;
}
