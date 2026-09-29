import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { CHARACTER } from '../src/config';
import { buildCharacterModel } from '../src/character/model';
import { applyPreset, defaultProfile, resolveLook } from '../src/rules/character';

it('scratch', () => {
  const out: string[] = [];
  for (const g of ['male', 'female'] as const) {
    CHARACTER.presets[g].forEach((_, i) => {
      const look = resolveLook(applyPreset(defaultProfile(g), i));
      const m = buildCharacterModel(look);
      out.push([g, i, look.outfit, look.hairStyle, look.accessory, JSON.stringify(m.stats), m.bounds.min.y.toFixed(3), m.bounds.max.y.toFixed(3), (m.bounds.max.x - m.bounds.min.x).toFixed(3)].join(' '));
      m.dispose();
    });
  }
  writeFileSync('/tmp/claude-0/-home-user-LAST-DAWN/ee8ff890-59ea-5995-92df-6b230812b1c6/scratchpad/stats.txt', out.join('\n'));
});
