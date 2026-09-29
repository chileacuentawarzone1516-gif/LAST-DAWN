import { describe, expect, it } from 'vitest';
import { classifyGpu, pickQuality } from '../src/core/device';
import type { DeviceProfile } from '../src/core/device';

const dev = (o: Partial<DeviceProfile>): DeviceProfile => ({ touch: false, cores: 8, memoryGb: 8, saveData: false, gpu: '', ...o });

describe('classifyGpu', () => {
  it('reconoce familias', () => {
    expect(classifyGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)')).toBe('software');
    expect(classifyGpu('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('software');
    expect(classifyGpu('Apple GPU')).toBe('apple');
    expect(classifyGpu('Adreno (TM) 740')).toBe('mobile');
    expect(classifyGpu('Mali-G710')).toBe('mobile');
    expect(classifyGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU Direct3D11)')).toBe('discrete');
    expect(classifyGpu('ANGLE (AMD, AMD Radeon RX 7600 Direct3D11)')).toBe('discrete');
    expect(classifyGpu('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)')).toBe('integrated');
    expect(classifyGpu('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11)')).toBe('integrated');
    expect(classifyGpu('')).toBe('unknown');
    expect(classifyGpu('Algo Raro 9000')).toBe('unknown');
  });
});

describe('pickQuality', () => {
  it('PC con GPU dedicada: la del motor (alta)', () => {
    expect(pickQuality(dev({ gpu: 'NVIDIA GeForce RTX 4060' }))).toBeUndefined();
    expect(pickQuality(dev({ gpu: 'NVIDIA GeForce GTX 1050', cores: 4, memoryGb: 4 }))).toBeUndefined();
  });
  it('gráfica integrada o equipo justo: media', () => {
    expect(pickQuality(dev({ gpu: 'Intel(R) UHD Graphics' }))).toBe('medium');
    expect(pickQuality(dev({ gpu: 'Algo desconocido', cores: 4 }))).toBe('medium');
    expect(pickQuality(dev({ gpu: 'Algo desconocido', memoryGb: 4 }))).toBe('medium');
  });
  it('GPU desconocida en equipo potente: alta', () => {
    expect(pickQuality(dev({ gpu: '', cores: 12, memoryGb: 16 }))).toBeUndefined();
  });
  it('sin aceleración por hardware o ahorro de datos: baja', () => {
    expect(pickQuality(dev({ gpu: 'SwiftShader' }))).toBe('low');
    expect(pickQuality(dev({ gpu: 'NVIDIA RTX', saveData: true }))).toBe('low');
  });
  it('móviles: baja por defecto; media en Apple o con mucha RAM y núcleos', () => {
    expect(pickQuality(dev({ touch: true, gpu: 'Adreno (TM) 619', cores: 8, memoryGb: 4 }))).toBe('low');
    expect(pickQuality(dev({ touch: true, gpu: 'Mali-G57', cores: 8, memoryGb: 4 }))).toBe('low');
    expect(pickQuality(dev({ touch: true, gpu: 'Apple GPU', cores: 6, memoryGb: null }))).toBe('medium');
    expect(pickQuality(dev({ touch: true, gpu: 'Adreno (TM) 750', cores: 8, memoryGb: 8 }))).toBe('medium');
  });
});
