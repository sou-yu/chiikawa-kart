import * as THREE from 'three';
import { KartFX } from './KartFX';
import type { FXSystems } from './Particles';

// ばくだんの爆発の演出。派手に見える部品を重ねる（どれも、使いまわす入れ物で、爆発のたびに作り直さない）：
//   閃光（まぶしい白）／火の玉（白 → 黄 → 橙 → 赤）／黒い煙（もくもく上へ）／地面を走る衝撃波のわっかと、半球の衝撃波／
//   火の粉・火花／地面を走る砂ぼこり／飛び散る破片（跳ねる）／道に残る焦げあと
// 3 か所ぶんまで、同時に出せる。光源（PointLight）は足さない（足すと全部の材質が作り直されて、カクつくため）。
export const BLAST_RADIUS = 24;

const TAU = Math.PI * 2;
const R = Math.random;
const ease = (u: number) => 1 - (1 - u) * (1 - u) * (1 - u); // 速く出て、ゆっくり止まる

// ---------- 絵（キャンバスで描く）----------
function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// ふちがふわっとした丸い塊を、ふぞろいに重ねる（炎・煙の形）
function blobs(g: CanvasRenderingContext2D, s: number, n: number, rMin: number, rMax: number, spread: number, stops: [number, string][]) {
  for (let i = 0; i < n; i++) {
    const a = R() * TAU, d = Math.sqrt(R()) * spread * s;
    const x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d;
    const r = (rMin + R() * (rMax - rMin)) * s;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    for (const [o, col] of stops) grd.addColorStop(o, col);
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

// もこもこの塊：光があたる側（左上）が明るい丸を、いくつも重ね、最後にふちを丸くぼかす
function puffs(g: CanvasRenderingContext2D, s: number, n: number, stops: [number, string][]) {
  for (let i = 0; i < n; i++) {
    const a = R() * TAU, d = Math.sqrt(R()) * 0.3 * s;
    const x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d;
    const r = (0.1 + R() * 0.15) * s;
    const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.08, x, y, r);
    for (const [o, col] of stops) grd.addColorStop(o, col);
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.globalCompositeOperation = 'destination-in';
  const mask = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.6, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = mask;
  g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = 'source-over';
}

let cache: { flash: THREE.CanvasTexture; fire: THREE.CanvasTexture; smoke: THREE.CanvasTexture; ring: THREE.CanvasTexture; scorch: THREE.CanvasTexture } | null = null;
function textures() {
  if (cache) return cache;
  cache = {
    // 閃光：まぶしい芯と、広いにじみ、十字のひかり
    flash: canvasTex(128, (g, s) => {
      const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.18, 'rgba(255,248,220,0.95)');
      grd.addColorStop(0.5, 'rgba(255,190,100,0.35)');
      grd.addColorStop(1, 'rgba(255,120,30,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, s, s);
      g.globalCompositeOperation = 'lighter';
      for (const [w, h] of [[1, 0.035], [0.035, 1]]) {
        const lg = g.createLinearGradient(0, 0, w > h ? s : 0, w > h ? 0 : s);
        lg.addColorStop(0, 'rgba(255,230,180,0)');
        lg.addColorStop(0.5, 'rgba(255,240,200,0.32)');
        lg.addColorStop(1, 'rgba(255,230,180,0)');
        g.fillStyle = lg;
        g.fillRect(w > h ? 0 : s / 2 - s * 0.0175, w > h ? s / 2 - s * 0.0175 : 0, w * s, h * s);
      }
    }),
    // 炎：中心が白く熱く、まわりが橙〜赤の、もこもこと渦をまく塊（つぶつぶの丸を、かげをつけて重ねる）
    fire: canvasTex(192, (g, s) =>
      puffs(g, s, 34, [
        [0, 'rgba(255,238,170,0.95)'],
        [0.33, 'rgba(255,168,56,0.92)'],
        [0.68, 'rgba(232,78,16,0.75)'],
        [1, 'rgba(140,28,8,0)'],
      ]),
    ),
    // 煙：芯が黒く、ふちが灰色の、もこもこ（カリフラワーのような）塊
    smoke: canvasTex(192, (g, s) =>
      puffs(g, s, 40, [
        [0, 'rgba(176,166,156,0.95)'],
        [0.4, 'rgba(96,88,82,0.95)'],
        [0.8, 'rgba(46,42,39,0.8)'],
        [1, 'rgba(30,27,25,0)'],
      ]),
    ),
    // 衝撃波のわっか：外がわに明るいふち
    ring: canvasTex(256, (g, s) => {
      const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grd.addColorStop(0, 'rgba(255,200,120,0)');
      grd.addColorStop(0.6, 'rgba(255,190,110,0.05)');
      grd.addColorStop(0.84, 'rgba(255,225,170,0.55)');
      grd.addColorStop(0.93, 'rgba(255,250,235,1)');
      grd.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, s, s);
    }),
    // 焦げあと：まんなかが黒く、まわりへ煤が飛ぶ
    scorch: canvasTex(256, (g, s) => {
      const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grd.addColorStop(0, 'rgba(8,6,5,0.88)');
      grd.addColorStop(0.5, 'rgba(14,10,8,0.6)');
      grd.addColorStop(1, 'rgba(20,14,10,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 60; i++) {
        const a = R() * TAU, d = (0.25 + R() * 0.65) * (s / 2);
        const r = (0.02 + R() * 0.07) * s;
        const x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d;
        const p = g.createRadialGradient(x, y, 0, x, y, r);
        p.addColorStop(0, 'rgba(12,9,7,0.5)');
        p.addColorStop(1, 'rgba(12,9,7,0)');
        g.fillStyle = p;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }),
  };
  return cache;
}

// 導火線の火花など、ほかの演出でも使う、まぶしい光の絵
export const flashTexture = () => textures().flash;

// 炎の色の変わりかた（u：0 → 1）。1 より大きい値は、ブルーム（光のにじみ）でまぶしく光る
const FIRE_RAMP: [number, THREE.Color][] = [
  [0, new THREE.Color(1.9, 1.75, 1.4)],
  [0.25, new THREE.Color(1.5, 1.15, 0.8)],
  [0.6, new THREE.Color(1.0, 0.6, 0.4)],
  [1, new THREE.Color(0.3, 0.14, 0.1)],
];
function fireColor(u: number, out: THREE.Color) {
  for (let i = 1; i < FIRE_RAMP.length; i++) {
    if (u <= FIRE_RAMP[i][0]) {
      const [u0, c0] = FIRE_RAMP[i - 1], [u1, c1] = FIRE_RAMP[i];
      return out.copy(c0).lerp(c1, (u - u0) / (u1 - u0));
    }
  }
  return out.copy(FIRE_RAMP[FIRE_RAMP.length - 1][1]);
}

interface Puff {
  s: THREE.Sprite;
  vel: THREE.Vector3;
  delay: number;
  life: number;
  size0: number;
  size1: number;
  t: number;
}
interface Chunk {
  p: THREE.Vector3;
  v: THREE.Vector3;
  w: THREE.Vector3; // 回転の速さ
  r: THREE.Euler;
  s: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _sv = new THREE.Vector3();
const _c = new THREE.Color();
const _v = new THREE.Vector3();

const FIRE_N = 14;
const SMOKE_N = 16;
const CHUNK_N = 22;
const SLOT_LIFE = 12.5; // 焦げあとが消えるまで

class Slot {
  readonly group = new THREE.Group();
  t = -1; // -1 = 使っていない
  private origin = new THREE.Vector3();
  private radius = BLAST_RADIUS;
  private k = 1;
  private flash: THREE.Sprite;
  private fire: Puff[] = [];
  private smoke: Puff[] = [];
  private ring: THREE.Mesh;
  private dome: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;
  private scorch: THREE.Mesh;
  private debris: THREE.InstancedMesh;
  private chunks: Chunk[] = [];

  constructor() {
    const tx = textures();
    this.group.visible = false;
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx.flash, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    this.flash.renderOrder = 8;
    this.group.add(this.flash);
    for (let i = 0; i < FIRE_N; i++) {
      const m = new THREE.SpriteMaterial({ map: tx.fire, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
      const s = new THREE.Sprite(m);
      s.renderOrder = 7;
      this.group.add(s);
      this.fire.push({ s, vel: new THREE.Vector3(), delay: 0, life: 1, size0: 1, size1: 1, t: 0 });
    }
    for (let i = 0; i < SMOKE_N; i++) {
      const m = new THREE.SpriteMaterial({ map: tx.smoke, depthWrite: false, transparent: true });
      const s = new THREE.Sprite(m);
      s.renderOrder = 6;
      this.group.add(s);
      this.smoke.push({ s, vel: new THREE.Vector3(), delay: 0, life: 1, size0: 1, size1: 1, t: 0 });
    }
    // 地面を走る衝撃波のわっか
    this.ring = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: tx.ring, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, fog: false }),
    );
    this.ring.renderOrder = 5;
    this.group.add(this.ring);
    // 半球の衝撃波（ふちが光る、すき通った泡）
    this.domeMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: `varying vec3 vN; varying vec3 vV;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vN; varying vec3 vV; uniform float uOpacity;
        void main() { float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4); gl_FragColor = vec4(vec3(1.6, 1.15, 0.7) * f * uOpacity, f * uOpacity); }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 12, 0, TAU, 0, Math.PI / 2), this.domeMat);
    this.dome.renderOrder = 5;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);
    // 焦げあと
    this.scorch = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: tx.scorch, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    );
    this.scorch.renderOrder = 2;
    this.group.add(this.scorch);
    // 飛び散る破片
    this.debris = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }), CHUNK_N);
    const cols = ['#3a322c', '#554a40', '#26211e', '#6b5a48', '#463b33'];
    for (let i = 0; i < CHUNK_N; i++) this.debris.setColorAt(i, _c.set(cols[i % cols.length]));
    this.debris.frustumCulled = false;
    this.group.add(this.debris);
    for (let i = 0; i < CHUNK_N; i++) this.chunks.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), w: new THREE.Vector3(), r: new THREE.Euler(), s: 0.3 });
  }

  // k：爆発の大きさ（1 = ばくだん。ミサイルは小さめ）。大きさは k 倍、速さ・数は √k 倍ほど
  start(pos: THREE.Vector3, radius: number, fx: FXSystems, k = 1) {
    const kv = Math.sqrt(k);
    this.k = k;
    this.t = 0;
    this.origin.copy(pos);
    this.radius = radius;
    this.group.position.copy(pos);
    this.group.visible = true;

    this.flash.visible = true;
    this.ring.visible = this.dome.visible = this.scorch.visible = this.debris.visible = true;
    this.scorch.position.set(0, 0.06, 0);
    this.scorch.scale.setScalar(radius * 0.5);
    (this.scorch.material as THREE.MeshBasicMaterial).opacity = 1;
    this.ring.position.set(0, 0.2, 0);

    // 火の玉：中心から、いきおいよく広がりながら、少し上へ（大小の塊が重なって、もこもこの炎になる）
    for (const f of this.fire) {
      const a = R() * TAU, up = 0.15 + R() * 0.85;
      const sp = (5 + R() * 9) * kv;
      f.vel.set(Math.cos(a) * sp * (1 - up * 0.5), 3 + up * sp * 0.9, Math.sin(a) * sp * (1 - up * 0.5));
      f.delay = R() * 0.12;
      f.life = 0.55 + R() * 0.55;
      f.size0 = (3 + R() * 2.4) * k;
      f.size1 = (8 + R() * 6) * k;
      f.t = 0;
      f.s.position.set((R() - 0.5) * 2 * k, (0.9 + R() * 1.2) * kv, (R() - 0.5) * 2 * k);
      f.s.material.rotation = R() * TAU;
      f.s.visible = false;
    }
    // 煙：すぐに黒く立ちのぼり、いくつもの塊が、時間差で太い柱になる
    for (const s of this.smoke) {
      const a = R() * TAU, out = (0.8 + R() * 3.2) * kv;
      s.vel.set(Math.cos(a) * out, (4 + R() * 7) * kv, Math.sin(a) * out);
      s.delay = R() * 0.45;
      s.life = 2.3 + R() * 1.2;
      s.size0 = (3 + R() * 2.5) * k;
      s.size1 = (10 + R() * 7) * k;
      s.t = 0;
      s.s.position.set(Math.cos(a) * 2.6 * k, (1 + R() * 1.8) * kv, Math.sin(a) * 2.6 * k);
      s.s.material.rotation = R() * TAU;
      s.s.visible = false;
    }
    // 破片
    this.chunks.forEach((c, i) => {
      const a = R() * TAU, elev = 0.7 + R() * 0.8; // 上へ 40〜80 度
      const sp = (9 + R() * 17) * kv;
      c.p.set(0, 0.8, 0);
      c.v.set(Math.cos(a) * Math.cos(elev) * sp, Math.sin(elev) * sp, Math.sin(a) * Math.cos(elev) * sp);
      c.w.set((R() - 0.5) * 18, (R() - 0.5) * 18, (R() - 0.5) * 18);
      c.r.set(R() * TAU, R() * TAU, R() * TAU);
      c.s = (0.22 + R() * 0.45 + (i % 5 === 0 ? 0.25 : 0)) * kv;
    });

    // 火の粉・火花・砂ぼこり・黒い煙のつぶ（共有のパーティクル）
    const top = _v.copy(pos).setY(pos.y + 0.8);
    const nSpark = Math.round(110 * k);
    for (let i = 0; i < nSpark; i++) {
      const a = R() * TAU, elev = R() * 1.25;
      const sp = (14 + R() * 32) * kv;
      const v = new THREE.Vector3(Math.cos(a) * Math.cos(elev) * sp, Math.sin(elev) * sp + 4, Math.sin(a) * Math.cos(elev) * sp);
      fx.sparks.emit(top, v, _c.set(['#ffcf5a', '#ff9a2a', '#ff6a1a', '#fff2b8'][i % 4]), { size: 0.5 + R() * 0.3, life: 0.9 + R() * 1.1, gravity: 14, drag: 0.55 });
    }
    KartFX.burst(fx, top, ['#ffffff', '#fff2b8'], Math.round(36 * k), 30 * kv);
    const nDust = Math.round(40 * k);
    for (let i = 0; i < nDust; i++) {
      const a = (i / nDust) * TAU + R() * 0.2;
      const sp = (20 + R() * 12) * kv;
      fx.dust.emit(_v.set(pos.x, pos.y + 0.6, pos.z), new THREE.Vector3(Math.cos(a) * sp, 1.5 + R() * 2, Math.sin(a) * sp), _c.set(i % 3 ? '#b79a75' : '#8a7662'), { size: (3.4 + R() * 1.6) * kv, life: 1.3 + R() * 0.6, grow: 3.5, drag: 2.3, gravity: -0.8 });
    }
    const nSmoke = Math.round(18 * k);
    for (let i = 0; i < nSmoke; i++) {
      const a = R() * TAU;
      fx.dust.emit(_v.set(pos.x, pos.y + 1.2, pos.z), new THREE.Vector3(Math.cos(a) * 4 * kv, (7 + R() * 5) * kv, Math.sin(a) * 4 * kv), _c.set('#2b2724'), { size: (4.5 + R() * 2) * kv, life: 2 + R() * 0.8, grow: 3.2, drag: 0.8, gravity: -1 });
    }
  }

  update(dt: number) {
    if (this.t < 0) return;
    this.t += dt;
    const t = this.t;
    const R_ = this.radius;

    // 閃光
    {
      const u = t / 0.34;
      if (u >= 1) this.flash.visible = false;
      else {
        const m = this.flash.material as THREE.SpriteMaterial;
        m.color.setScalar(3.4 * Math.pow(1 - u, 1.4));
        m.opacity = 1;
        this.flash.scale.setScalar((6 + ease(u) * 24) * this.k);
        this.flash.position.set(0, 1.5 * Math.sqrt(this.k), 0);
      }
    }
    // 火の玉
    for (const f of this.fire) {
      const lt = t - f.delay;
      if (lt < 0) continue;
      const u = lt / f.life;
      if (u >= 1) {
        f.s.visible = false;
        continue;
      }
      f.s.visible = true;
      f.vel.multiplyScalar(Math.exp(-2.6 * dt));
      f.vel.y += 5 * dt; // 熱い空気は、上へ
      f.s.position.addScaledVector(f.vel, dt);
      f.s.scale.setScalar(f.size0 + (f.size1 - f.size0) * ease(u));
      const m = f.s.material;
      fireColor(u, m.color);
      m.opacity = Math.pow(1 - u, 1.4);
    }
    // 煙
    for (const s of this.smoke) {
      const lt = t - s.delay;
      if (lt < 0) continue;
      const u = lt / s.life;
      if (u >= 1) {
        s.s.visible = false;
        continue;
      }
      s.s.visible = true;
      s.vel.multiplyScalar(Math.exp(-0.9 * dt));
      s.s.position.addScaledVector(s.vel, dt);
      s.s.scale.setScalar(s.size0 + (s.size1 - s.size0) * ease(u));
      const m = s.s.material;
      // 絵そのものに濃淡があるので、色は明るさだけを変える（できたては黒く、ひろがるほど灰色に）
      m.color.setScalar(0.62 + 0.4 * u);
      m.opacity = (u < 0.12 ? u / 0.12 : 1 - (u - 0.12) / 0.88) * 0.9;
    }
    // 地面の衝撃波のわっか
    {
      const u = t / 0.55;
      if (u >= 1) this.ring.visible = false;
      else {
        this.ring.scale.setScalar(2 * R_ * 1.08 * ease(u) + 1);
        const m = this.ring.material as THREE.MeshBasicMaterial;
        m.color.setScalar(1.9);
        m.opacity = Math.pow(1 - u, 1.1);
      }
    }
    // 半球の衝撃波
    {
      const u = t / 0.42;
      if (u >= 1) this.dome.visible = false;
      else {
        this.dome.scale.setScalar(R_ * 0.95 * ease(u) + 0.5);
        this.domeMat.uniforms.uOpacity.value = 1.4 * Math.pow(1 - u, 1.6);
      }
    }
    // 破片
    {
      const alive = t < 3;
      this.debris.visible = alive;
      if (alive) {
        this.chunks.forEach((c, i) => {
          c.v.y -= 24 * dt;
          c.p.addScaledVector(c.v, dt);
          if (c.p.y < 0.2) {
            c.p.y = 0.2;
            if (c.v.y < 0) c.v.y *= -0.32;
            c.v.x *= 0.6;
            c.v.z *= 0.6;
            c.w.multiplyScalar(0.6);
          }
          c.r.x += c.w.x * dt;
          c.r.y += c.w.y * dt;
          c.r.z += c.w.z * dt;
          const fade = t > 2.5 ? Math.max(0, (3 - t) / 0.5) : 1;
          _m.compose(c.p, _q.setFromEuler(c.r), _sv.set(c.s * 1.15, c.s * 0.8, c.s).multiplyScalar(fade));
          this.debris.setMatrixAt(i, _m);
        });
        this.debris.instanceMatrix.needsUpdate = true;
      }
    }
    // 焦げあとは、しばらく残って、すっと消える
    {
      const fade = t < 3 ? 1 : Math.max(0, 1 - (t - 3) / 8.5);
      (this.scorch.material as THREE.MeshBasicMaterial).opacity = fade;
      if (fade <= 0) this.scorch.visible = false;
    }
    if (t > SLOT_LIFE) {
      this.t = -1;
      this.group.visible = false;
    }
  }
}

export class ExplosionFX {
  private slots = [new Slot(), new Slot(), new Slot()];

  constructor(parent: THREE.Object3D, private fx: FXSystems) {
    for (const s of this.slots) parent.add(s.group);
  }

  // radius：衝撃波・焦げあとの広さ（m）。scale：炎・煙・破片の大きさ（1 = ばくだん）
  spawn(pos: THREE.Vector3, radius = BLAST_RADIUS, scale = 1) {
    // 空いている入れ物、なければ、いちばん古いもの
    const slot = this.slots.find((s) => s.t < 0) ?? this.slots.reduce((a, b) => (a.t > b.t ? a : b));
    slot.start(pos, radius, this.fx, scale);
  }

  update(dt: number) {
    for (const s of this.slots) s.update(dt);
  }
}
