/**
 * Post-proceso propio (sin EffectComposer: menos render targets y un único pase final):
 *
 *   mundo → RT HDR (MSAA opcional) → viewmodel (depth limpio) → bloom «dual filter»
 *   → pase final: aberración cromática leve + bloom + ACES + sRGB + desaturación + viñeta/tintes + grano.
 *
 * Modo 'direct' (calidad baja): render directo al canvas + un quad de superposición barato
 * (viñeta y tintes de daño/contaminación) sin render targets.
 */
import * as THREE from 'three';
import { RENDER } from '../config';
import type { ScreenFxState } from './screenFx';
import {
  BLOOM_DOWN_FRAG, BLOOM_PREFILTER_FRAG, BLOOM_UP_FRAG, FINAL_FRAG, FULLSCREEN_VERT, OVERLAY_FRAG,
} from './glsl';

export type PostMode = 'direct' | 'hdr';

export interface PostSettings {
  mode: PostMode;
  msaa: number;
  bloom: boolean;
  /** Niveles de la cadena de bloom (1/2, 1/4, … de la resolución); menos = más barato. */
  bloomLevels: number;
  /** Pase final ligero (móvil): sin aberración cromática (1 muestra en lugar de 3). */
  lite: boolean;
}

type Uniforms = Record<string, THREE.IUniform>;

function fullscreenTriangle(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}

function quadMaterial(frag: string, uniforms: Uniforms, opts: Partial<THREE.ShaderMaterialParameters> = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: frag,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    ...opts,
  });
}

export class PostStack {
  /** Llamadas de dibujo y triángulos de escena + viewmodel (sin los pases de post) del último frame. */
  sceneCalls = 0;
  sceneTriangles = 0;
  /** Llamadas de los pases de post del último frame. */
  postCalls = 0;

  private settings: PostSettings = { mode: 'direct', msaa: 0, bloom: false, bloomLevels: 5, lite: false };
  private width = 1;
  private height = 1;
  private readonly rtType: THREE.TextureDataType;
  private sceneRT: THREE.WebGLRenderTarget | null = null;
  private bloomRTs: THREE.WebGLRenderTarget[] = [];

  private readonly tri = new THREE.Mesh(fullscreenTriangle());
  private readonly cam = new THREE.Camera();

  private readonly screenUniforms: Uniforms = {
    uVig: { value: RENDER.post.vignette },
    uHurt: { value: 0 },
    uLowHp: { value: 0 },
    uPulse: { value: 0 },
    uToxic: { value: 0 },
    uDeath: { value: 0 },
    uDesat: { value: 0 },
    uTime: { value: 0 },
  };
  private readonly finalMat: THREE.ShaderMaterial;
  private readonly overlayMat: THREE.ShaderMaterial;
  private readonly prefilterMat: THREE.ShaderMaterial;
  private readonly downMat: THREE.ShaderMaterial;
  private readonly upMat: THREE.ShaderMaterial;

  constructor(private readonly renderer: THREE.WebGLRenderer, hdr: boolean) {
    this.rtType = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.tri.frustumCulled = false;

    this.finalMat = quadMaterial(FINAL_FRAG, {
      ...this.screenUniforms,
      tScene: { value: null },
      tBloom: { value: null },
      uBloom: { value: RENDER.bloom.strength },
      uChroma: { value: RENDER.post.chroma },
      uGrain: { value: RENDER.post.grain },
    }, { toneMapped: true });

    this.overlayMat = quadMaterial(OVERLAY_FRAG, { ...this.screenUniforms }, {
      defines: { OVERLAY_DESAT: '' },
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });

    const tap = (): Uniforms => ({ tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.prefilterMat = quadMaterial(BLOOM_PREFILTER_FRAG, {
      ...tap(), uThreshold: { value: RENDER.bloom.threshold }, uKnee: { value: RENDER.bloom.knee },
    });
    this.downMat = quadMaterial(BLOOM_DOWN_FRAG, tap());
    this.upMat = quadMaterial(BLOOM_UP_FRAG, tap(), {
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    });
  }

  get mode(): PostMode {
    return this.settings.mode;
  }

  /** Cambia modo/MSAA/bloom (recrea sólo los render targets afectados). */
  configure(next: PostSettings): void {
    const prev = this.settings;
    this.settings = { ...next };
    if (next.mode === 'direct') {
      this.disposeTargets();
      return;
    }
    if (!this.sceneRT || prev.msaa !== next.msaa || prev.mode !== next.mode) this.buildSceneTarget();
    if (next.bloom) {
      if (this.bloomRTs.length !== next.bloomLevels) this.buildBloomTargets();
    } else {
      this.disposeBloom();
    }
    if (next.bloom !== prev.bloom || next.lite !== prev.lite || prev.mode !== next.mode) {
      if (next.bloom) this.finalMat.defines.USE_BLOOM = '';
      else delete this.finalMat.defines.USE_BLOOM;
      if (next.lite) this.finalMat.defines.POST_LITE = '';
      else delete this.finalMat.defines.POST_LITE;
      this.finalMat.needsUpdate = true;
    }
  }

  /** Tamaño del framebuffer en píxeles de dispositivo. */
  resize(pxWidth: number, pxHeight: number): void {
    this.width = Math.max(1, Math.floor(pxWidth));
    this.height = Math.max(1, Math.floor(pxHeight));
    if (this.sceneRT) this.sceneRT.setSize(this.width, this.height);
    this.resizeBloom();
  }

  render(
    scene: THREE.Scene, camera: THREE.Camera, viewScene: THREE.Scene, viewCamera: THREE.Camera,
    fx: ScreenFxState, time: number,
  ): void {
    const r = this.renderer;
    const info = r.info.render;
    this.syncUniforms(fx, time);

    if (this.settings.mode === 'direct' || !this.sceneRT) {
      r.setRenderTarget(null);
      r.clear(true, true, false);
      r.render(scene, camera);
      r.clearDepth();
      r.render(viewScene, viewCamera);
      this.sceneCalls = info.calls;
      this.sceneTriangles = info.triangles;
      this.drawQuad(this.overlayMat);
      this.postCalls = info.calls - this.sceneCalls;
      return;
    }

    r.setRenderTarget(this.sceneRT);
    r.clear(true, true, false);
    r.render(scene, camera);
    r.clearDepth();
    r.render(viewScene, viewCamera);
    this.sceneCalls = info.calls;
    this.sceneTriangles = info.triangles;

    const bloomTex = this.settings.bloom ? this.renderBloom(this.sceneRT.texture) : null;
    const u = this.finalMat.uniforms;
    (u.tScene as THREE.IUniform).value = this.sceneRT.texture;
    (u.tBloom as THREE.IUniform).value = bloomTex;
    r.setRenderTarget(null);
    this.drawQuad(this.finalMat);
    this.postCalls = info.calls - this.sceneCalls;
  }

  dispose(): void {
    this.disposeTargets();
    this.tri.geometry.dispose();
    for (const m of [this.finalMat, this.overlayMat, this.prefilterMat, this.downMat, this.upMat]) m.dispose();
  }

  // ── Interno ────────────────────────────────────────────────────────────────
  private syncUniforms(fx: ScreenFxState, time: number): void {
    const u = this.screenUniforms;
    (u.uHurt as THREE.IUniform).value = fx.hurt;
    (u.uLowHp as THREE.IUniform).value = fx.lowHp;
    (u.uPulse as THREE.IUniform).value = fx.pulse;
    (u.uToxic as THREE.IUniform).value = fx.toxic;
    (u.uDeath as THREE.IUniform).value = fx.death;
    (u.uDesat as THREE.IUniform).value = fx.desat;
    (u.uTime as THREE.IUniform).value = time;
  }

  private drawQuad(mat: THREE.ShaderMaterial): void {
    this.tri.material = mat;
    this.renderer.render(this.tri, this.cam);
  }

  private makeTarget(w: number, h: number, samples: number, depth: boolean): THREE.WebGLRenderTarget {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: this.rtType,
      // Sin HDR el respaldo de 8 bits guarda en sRGB para no perder las sombras oscuras.
      colorSpace: this.rtType === THREE.UnsignedByteType ? THREE.SRGBColorSpace : THREE.NoColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: depth,
      stencilBuffer: false,
      resolveDepthBuffer: false,
      samples,
    });
    return rt;
  }

  private buildSceneTarget(): void {
    this.sceneRT?.dispose();
    this.sceneRT = this.makeTarget(this.width, this.height, this.settings.msaa, true);
    this.sceneRT.texture.name = 'post.scene';
  }

  private bloomSize(level: number): [number, number] {
    const k = 2 ** (level + 1);
    return [Math.max(1, Math.floor(this.width / k)), Math.max(1, Math.floor(this.height / k))];
  }

  private buildBloomTargets(): void {
    this.disposeBloom();
    for (let i = 0; i < this.settings.bloomLevels; i++) {
      const [w, h] = this.bloomSize(i);
      const rt = this.makeTarget(w, h, 0, false);
      rt.texture.name = `post.bloom${i}`;
      this.bloomRTs.push(rt);
    }
  }

  private resizeBloom(): void {
    this.bloomRTs.forEach((rt, i) => {
      const [w, h] = this.bloomSize(i);
      rt.setSize(w, h);
    });
  }

  private renderBloom(src: THREE.Texture): THREE.Texture {
    const r = this.renderer;
    const rts = this.bloomRTs;
    const setTexel = (m: THREE.ShaderMaterial, tex: THREE.Texture, w: number, h: number) => {
      (m.uniforms.tSrc as THREE.IUniform).value = tex;
      ((m.uniforms.uTexel as THREE.IUniform).value as THREE.Vector2).set(1 / w, 1 / h);
    };
    const first = rts[0] as THREE.WebGLRenderTarget;
    setTexel(this.prefilterMat, src, this.width, this.height);
    r.setRenderTarget(first);
    this.drawQuad(this.prefilterMat);
    for (let i = 1; i < rts.length; i++) {
      const prev = rts[i - 1] as THREE.WebGLRenderTarget;
      setTexel(this.downMat, prev.texture, prev.width, prev.height);
      r.setRenderTarget(rts[i] as THREE.WebGLRenderTarget);
      this.drawQuad(this.downMat);
    }
    for (let i = rts.length - 1; i > 0; i--) {
      const low = rts[i] as THREE.WebGLRenderTarget;
      setTexel(this.upMat, low.texture, low.width, low.height);
      r.setRenderTarget(rts[i - 1] as THREE.WebGLRenderTarget);
      this.drawQuad(this.upMat);
    }
    return first.texture;
  }

  private disposeBloom(): void {
    for (const rt of this.bloomRTs) rt.dispose();
    this.bloomRTs = [];
  }

  private disposeTargets(): void {
    this.sceneRT?.dispose();
    this.sceneRT = null;
    this.disposeBloom();
  }
}
