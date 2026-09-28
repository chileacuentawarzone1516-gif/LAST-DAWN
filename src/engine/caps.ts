/**
 * Sondeo de capacidades del dispositivo (sólo WebGL2 estándar): se comprueba de verdad que se puede
 * renderizar a RGBA16F (con y sin MSAA) en lugar de fiarse únicamente de las extensiones.
 */
export interface RenderCaps {
  /** Se puede renderizar a un target RGBA16F (HDR). Si no, se usa el render directo. */
  hdr: boolean;
  /** Se puede renderizar a un target RGBA16F multimuestreado. */
  msaaHdr: boolean;
  maxTextureSize: number;
}

function clearErrors(gl: WebGL2RenderingContext): void {
  for (let i = 0; i < 8 && gl.getError() !== gl.NO_ERROR; i++) { /* vaciar la cola de errores */ }
}

function probeTexture(gl: WebGL2RenderingContext): boolean {
  const tex = gl.createTexture();
  const fb = gl.createFramebuffer();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 4, 4, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.deleteFramebuffer(fb);
  gl.deleteTexture(tex);
  return ok;
}

function probeMultisample(gl: WebGL2RenderingContext, samples: number): boolean {
  const rb = gl.createRenderbuffer();
  const fb = gl.createFramebuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA16F, 4, 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  gl.deleteFramebuffer(fb);
  gl.deleteRenderbuffer(rb);
  return ok;
}

/** Debe llamarse justo tras crear el contexto (antes de dibujar): deja el estado de GL limpio. */
export function probeRenderCaps(gl: WebGL2RenderingContext): RenderCaps {
  // Ambas extensiones son opcionales: se piden por si el navegador sólo expone la de half-float.
  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('EXT_color_buffer_half_float');
  clearErrors(gl);
  let hdr = false;
  let msaaHdr = false;
  try {
    hdr = probeTexture(gl);
    msaaHdr = hdr && probeMultisample(gl, 4);
  } catch {
    hdr = false;
    msaaHdr = false;
  }
  clearErrors(gl);
  return { hdr, msaaHdr, maxTextureSize: (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) || 2048 };
}
