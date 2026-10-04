import * as THREE from 'three';

const VS = /* glsl */ `
attribute float psize;
attribute float palpha;
attribute vec3 pcolor;
varying vec3 vColor;
varying float vAlpha;
uniform float uScale;
void main() {
  vColor = pcolor;
  vAlpha = palpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = psize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FS = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
uniform float uHard;
uniform float uGlow;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = mix(smoothstep(0.5, 0.0, d), smoothstep(0.5, 0.35, d), uHard) * vAlpha;
  // 中心ほど白く光る（uGlow）
  vec3 c = mix(vColor, vec3(1.0), uGlow * smoothstep(0.25, 0.0, d));
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;

export interface EmitOptions {
  size: number;
  life: number;
  grow?: number; // 寿命の間にサイズが何倍になるか
  gravity?: number;
  drag?: number;
}

// 点スプライトのパーティクル。演出をいくら増やしても描画は1回。
export class Particles {
  readonly points: THREE.Points;
  private readonly max: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size0: Float32Array;
  private grow: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private cursor = 0;
  private colorDirty = false;
  private material: THREE.ShaderMaterial;
  private geo: THREE.BufferGeometry;

  constructor(max: number, additive: boolean, hard = false, glow = 0) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('palpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      uniforms: { uScale: { value: 500 }, uHard: { value: hard ? 1 : 0 }, uGlow: { value: glow } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setViewport(heightPx: number, fovDeg: number) {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, o: EmitOptions) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    this.col[i * 3] = color.r;
    this.col[i * 3 + 1] = color.g;
    this.col[i * 3 + 2] = color.b;
    this.colorDirty = true;
    this.life[i] = this.maxLife[i] = o.life;
    this.size0[i] = o.size;
    this.grow[i] = o.grow ?? 1;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
  }

  update(dt: number) {
    // 1粒も動いていない・消えた粒もないフレームは、GPUへの送り直しを省く
    let changed = this.colorDirty;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          this.size[i] = 0;
          changed = true;
        }
        continue;
      }
      changed = true;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]); // 1 → 0
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.size0[i] * (1 + (this.grow[i] - 1) * (1 - k));
      this.alpha[i] = Math.min(1, k * 1.6);
    }
    if (!changed) return;
    this.geo.getAttribute('position').needsUpdate = true;
    this.geo.getAttribute('psize').needsUpdate = true;
    this.geo.getAttribute('palpha').needsUpdate = true;
    // 色は出したときにしか変わらない
    if (this.colorDirty) this.geo.getAttribute('pcolor').needsUpdate = true;
    this.colorDirty = false;
  }
}

export interface FXSystems {
  sparks: Particles; // 加算合成（火花・キラキラ）
  dust: Particles; // 通常合成（砂ぼこり・草）
}
