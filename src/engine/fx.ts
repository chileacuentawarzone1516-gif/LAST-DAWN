import type { FxApi } from '../core/context';

/** BASE PROVISIONAL: efectos nulos. El agente de motor/render lo implementa. */
export function createFx(): FxApi {
  return { burst() {}, tracer() {}, decal() {}, flash() {}, update() {} };
}
