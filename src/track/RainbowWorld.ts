import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/random';
import { globalUniforms } from '../core/shaders';
import { makeCanvas, toTexture } from '../core/textures';
import { dashPads, type Landmarks } from './Landmarks';
import { crystalMaterial, goldMaterial, lampMaterial } from './rainbowMaterials';
import type { Track } from './Track';

// レインボーロードの世界：夜空とオーロラ、雲の海、水晶の浮島と滝、水晶のお城、金の手すり、星の飾り
// 動かない物は static に入れ、あとで区画分け（画面外は描かない）にかける

type Rand = () => number;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export const RAINBOW_FOG = '#c3a8ec';
export const RAINBOW_LIGHTS = { sky: '#e6dcff', ground: '#8a6cc8', hemi: 1.35, sun: '#fff0fa', sunI: 1.7 };

export interface RainbowWorld extends Landmarks {
  static: THREE.Group; // 動かない景色（区画分けしてよい）
}

export function buildRainbowWorld(track: Track): RainbowWorld {
  const group = new THREE.Group();
  const stat = new THREE.Group();
  group.add(stat);
  const rand = mulberry32(2024);
  const box = new THREE.Box3().setFromPoints(track.pts);
  const center = box.getCenter(new THREE.Vector3());
  const updaters: ((dt: number, cam: THREE.Camera, time: number) => void)[] = [];
  const add = (r: { obj: THREE.Object3D; update?: (dt: number, cam: THREE.Camera, time: number) => void }, isStatic = false) => {
    (isStatic ? stat : group).add(r.obj);
    if (r.update) updaters.push(r.update);
  };

  group.add(new THREE.Mesh(new THREE.SphereGeometry(1400, 48, 24), rainbowSkyMaterial()));
  add(cloudSea(center));
  add({ obj: roadSkirt(track) }, true);
  add({ obj: rails(track) }, true);
  add({ obj: cloudBanks(rand, center, track) }, true);
  add(islands(rand, center, track));
  add({ obj: castle(new THREE.Vector3(center.x - 40, -20, center.z + 360), 1) }, true);
  add({ obj: castle(new THREE.Vector3(center.x + 300, -10, center.z - 250), 0.55) }, true);
  add(roadStars(rand, track));
  add(hangingStars(rand, track));
  add(snowflakes(rand, center, track));
  add(skySparkles(rand, center));
  add(roadGlitter(rand, track));
  add(dashPads(track));

  let time = 0;
  return {
    group,
    static: stat,
    update(dt, camera) {
      time += dt;
      for (const u of updaters) u(dt, camera, time);
    },
  };
}

// ---------- 空 ----------

// 紺 → 紫 → 地平線のピンク。星のまたたきとオーロラのカーテン
export function rainbowSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: globalUniforms.uTime,
      uTop: { value: new THREE.Color('#1c1556') },
      uMid: { value: new THREE.Color('#5b3fa6') },
      uHorizon: { value: new THREE.Color('#f4a9dc') },
      uBelow: { value: new THREE.Color(RAINBOW_FOG) },
      uAurA: { value: new THREE.Color('#4dff9e') },
      uAurB: { value: new THREE.Color('#ff5fd8') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uTop, uMid, uHorizon, uBelow, uAurA, uAurB;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      // 星：粒の中心に十字の光（きらめき）が出る。大きい星ほど長く伸びる
      vec3 stars(vec2 sp, float density, float size, float flare) {
        vec2 cell = floor(sp);
        float h = hash(cell);
        vec2 f = fract(sp) - 0.5 - (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.5;
        float r = length(f);
        float core = smoothstep(size, 0.0, r);
        vec2 a = abs(f);
        float cross = (exp(-a.x * 70.0 - a.y * 6.0) + exp(-a.y * 70.0 - a.x * 6.0)) * flare;
        float tw = 0.5 + 0.5 * sin(uTime * (1.2 + h * 3.0) + h * 60.0);
        tw = tw * tw;
        // 星ごとに白・水色・ピンク・金へ色づく
        vec3 tint = mix(mix(vec3(1.0), vec3(0.7, 0.9, 1.0), step(0.33, fract(h * 7.0))), mix(vec3(1.0, 0.75, 0.9), vec3(1.0, 0.9, 0.6), step(0.5, fract(h * 13.0))), step(0.66, fract(h * 3.0)));
        return tint * (core * (0.5 + 0.8 * tw) + cross * tw) * step(density, h);
      }
      // オーロラ：下のふちが明るく、上へ向かって消えていく光のカーテン。縦のすじがゆれ動く
      vec3 aurora(vec3 d, float seed, float base, float width, float amount) {
        float az = atan(d.z, d.x);
        float wave = base + 0.07 * sin(az * 2.0 + seed + uTime * 0.07) + 0.05 * sin(az * 5.0 - seed * 2.0 + uTime * 0.11) + 0.02 * sin(az * 11.0 + uTime * 0.2 + seed);
        float t = (d.y - wave) / width;
        float body = t < 0.0 ? exp(-t * t * 7.0) : exp(-t * 0.85);
        float rays = pow(0.5 + 0.5 * sin(az * 95.0 + sin(az * 13.0 + seed + uTime * 0.3) * 4.0), 1.6);
        float soft = 0.55 + 0.45 * sin(az * 31.0 - uTime * 0.25 + seed);
        float fall = 0.35 + 0.65 * rays * soft;
        float hueK = 0.5 + 0.5 * sin(az * 1.3 + seed * 2.0 + uTime * 0.05);
        vec3 low = mix(uAurA, vec3(0.3, 0.9, 1.0), hueK);
        vec3 high = mix(uAurB, vec3(0.65, 0.45, 1.0), hueK);
        vec3 col = mix(low, high, smoothstep(0.0, 0.8, t));
        return col * body * fall * amount * smoothstep(-0.05, 0.25, d.y);
      }
      void main() {
        vec3 d = normalize(vDir);
        float y = d.y;
        float az = atan(d.z, d.x);
        vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.28, y));
        col = mix(col, uTop, smoothstep(0.28, 0.85, y));
        col = mix(col, uBelow, smoothstep(0.0, -0.12, y));
        // 星：小さいのをたくさん＋大きく光るのを少し
        float up = smoothstep(0.02, 0.3, y);
        vec2 sp = vec2(az * 3.0, y * 3.0);
        vec3 st = stars(sp * 70.0, 0.955, 0.2, 0.0) * 0.9 + stars(sp * 26.0, 0.965, 0.16, 0.9) * 1.6 + stars(sp * 9.0, 0.9, 0.12, 2.4) * 2.2;
        col += st * up;
        // オーロラは3枚重ねて、空いっぱいに
        col += aurora(d, 0.0, 0.30, 0.16, 0.5);
        col += aurora(d, 2.1, 0.46, 0.2, 0.42);
        col += aurora(d, 4.3, 0.62, 0.22, 0.3);
        // 地平線の上のほんのりした光の帯
        col += vec3(1.0, 0.55, 0.85) * exp(-pow(y / 0.07, 2.0)) * 0.35;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ---------- 雲の海 ----------

function cloudSea(center: THREE.Vector3) {
  const mat = new THREE.ShaderMaterial({
    fog: false,
    uniforms: {
      uTime: globalUniforms.uTime,
      uA: { value: new THREE.Color('#a98be0') },
      uB: { value: new THREE.Color('#f2c4ea') },
      uC: { value: new THREE.Color('#ffffff') },
      uFar: { value: new THREE.Color(RAINBOW_FOG) },
      uCenter: { value: new THREE.Vector2(center.x, center.z) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uA, uB, uC, uFar;
      uniform vec2 uCenter;
      varying vec3 vW;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
        return v;
      }
      void main() {
        vec2 p = vW.xz * 0.012 + vec2(uTime * 0.01, uTime * 0.004);
        float n = fbm(p);
        float n2 = fbm(p * 2.7 - uTime * 0.012);
        vec3 col = mix(uA, uB, smoothstep(0.35, 0.65, n));
        col = mix(col, uC, smoothstep(0.55, 0.85, n * 0.7 + n2 * 0.45));
        // 遠くは地平線の色へ溶かす
        float dist = length(vW.xz - uCenter);
        col = mix(col, uFar, smoothstep(250.0, 1300.0, dist));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.CircleGeometry(1500, 64).rotateX(-Math.PI / 2), mat);
  m.position.set(center.x, -46, center.z);
  return { obj: m };
}

// 雲のもくもく（道の下や遠くの雲の山）
function cloudBanks(rand: Rand, center: THREE.Vector3, track: Track) {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const mat = new THREE.MeshLambertMaterial({ color: '#f6eeff', emissive: '#b493e8', emissiveIntensity: 0.38 });
  const list: THREE.Matrix4[] = [];
  const cols: THREE.Color[] = [];
  const tints = ['#ffffff', '#f7e6ff', '#ffe3f3', '#e7e4ff'];
  const cluster = (x: number, y: number, z: number, size: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, r = rand() * size * 1.4;
      const s = size * (0.45 + rand() * 0.6);
      _p.set(x + Math.cos(a) * r, y + rand() * size * 0.35, z + Math.sin(a) * r);
      list.push(new THREE.Matrix4().compose(_p, _q.identity(), _s.set(s * 1.3, s * 0.75, s * 1.2)));
      cols.push(new THREE.Color(tints[Math.floor(rand() * tints.length)]));
    }
  };
  // 遠くの雲の山（地平線ぐるり）
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + rand() * 0.1;
    const r = 520 + rand() * 380;
    cluster(center.x + Math.cos(a) * r, -40 + rand() * 25, center.z + Math.sin(a) * r, 26 + rand() * 30, 4);
  }
  // 道のすぐ下を流れる雲
  for (let i = 0; i < 60; i++) {
    const t = rand();
    const side = rand() < 0.5 ? -1 : 1;
    track.place(t, side * (track.def.halfWidth + 12 + rand() * 50), _p);
    cluster(_p.x, -16 - rand() * 18, _p.z, 6 + rand() * 9, 3);
  }
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  list.forEach((m, i) => {
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, cols[i]);
  });
  return mesh;
}

// ---------- 道の下まわり・手すり ----------

// 道の両ふちの、厚みのある水晶の縁と裏側（グライダーで上から見ても浮いて見えないように）
function roadSkirt(track: Track) {
  const hw = track.def.halfWidth;
  const N = 600;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const top = new THREE.Color('#d7c4ff'), mid = new THREE.Color('#8e6fe0'), bot = new THREE.Color('#4a3393');
  // 横断面（外側から見た形）: [横位置, 高さ, 色]
  const prof: [number, number, THREE.Color][] = [
    [hw, 0.025, top],
    [hw + 1.6, 0.025, top],
    [hw + 1.6, -0.5, mid],
    [hw + 1.1, -1.6, bot],
    [0, -2.2, bot],
  ];
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const t = (i % N) / N;
      for (const [lat, y, c] of prof) {
        track.place(t, lat * side, _p);
        pos.push(_p.x, y, _p.z);
        col.push(c.r, c.g, c.b);
      }
    }
    const P = prof.length;
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < P - 1; k++) {
        const a = base + i * P + k, b = a + P;
        if (side > 0) idx.push(a, a + 1, b, b, a + 1, b + 1);
        else idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.2, emissive: '#5b3fb0', emissiveIntensity: 0.35, side: THREE.DoubleSide });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

// 金の手すり（上下2本）、細い柱、ランプの柱
function rails(track: Track) {
  const g = new THREE.Group();
  const hw = track.def.halfWidth;
  const lat = hw + 1.35;
  const gold = goldMaterial();
  for (const side of [-1, 1]) {
    for (const [h, r] of [
      [1.05, 0.12],
      [0.5, 0.07],
    ] as const) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 400; i++) pts.push(track.place(i / 400, lat * side, new THREE.Vector3()).setY(h));
      const curve = new THREE.CatmullRomCurve3(pts, true);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 900, r, 6, true), gold);
      tube.castShadow = true;
      g.add(tube);
    }
  }
  // 柱（3m ごと）とランプ（15m ごと）
  const postGeo = new THREE.CylinderGeometry(0.07, 0.09, 1.1, 8).translate(0, 0.55, 0);
  const lampPost = new THREE.CylinderGeometry(0.1, 0.13, 2.6, 8).translate(0, 1.3, 0);
  const bulbGeo = new THREE.SphereGeometry(0.32, 14, 10);
  const nPost = Math.floor(track.length / 3);
  const nLamp = Math.floor(track.length / 15);
  const posts = new THREE.InstancedMesh(postGeo, gold, nPost * 2);
  const lamps = new THREE.InstancedMesh(lampPost, gold, nLamp * 2);
  const bulbMat = lampMaterial('#fff0c8');
  bulbMat.color.multiplyScalar(2.6);
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, nLamp * 2);
  let k = 0;
  for (let i = 0; i < nPost; i++) {
    for (const side of [-1, 1]) {
      track.place(i / nPost, lat * side, _p);
      posts.setMatrixAt(k++, _m.makeTranslation(_p.x, 0, _p.z));
    }
  }
  k = 0;
  for (let i = 0; i < nLamp; i++) {
    for (const side of [-1, 1]) {
      track.place((i + 0.5) / nLamp, lat * side, _p);
      lamps.setMatrixAt(k, _m.makeTranslation(_p.x, 0, _p.z));
      bulbs.setMatrixAt(k, _m.makeTranslation(_p.x, 2.75, _p.z));
      k++;
    }
  }
  posts.castShadow = lamps.castShadow = true;
  g.add(posts, lamps, bulbs);
  return g;
}

// ---------- 水晶の浮島と滝 ----------

function islands(rand: Rand, center: THREE.Vector3, track: Track) {
  const tops: THREE.Matrix4[] = [];
  const shards: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  const spikes: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  const falls: { p: THREE.Vector3; w: number; h: number; yaw: number }[] = [];
  const tints = ['#b49cff', '#94c8ff', '#ffaee3', '#c8b4ff', '#a6e4ff'];
  const near = (x: number, z: number, d: number) => {
    for (let i = 0; i < track.pts.length; i += 8) {
      const p = track.pts[i];
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < d * d) return true;
    }
    return false;
  };
  const placed: THREE.Vector3[] = [];
  let tries = 0;
  while (placed.length < 34 && tries++ < 2000) {
    const a = rand() * Math.PI * 2;
    const r = 60 + Math.pow(rand(), 0.8) * 380;
    const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
    // 道の近くは小さめ（視界をふさがない）、遠くほど大きく
    const s = r < 160 ? 4 + rand() * 7 : 7 + rand() * 14 + (r > 250 ? 8 : 0);
    if (near(x, z, s * 1.4 + 22)) continue;
    if (placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < (s + p.y) ** 2 * 1.6)) continue;
    const y = -14 + rand() * 50 + (r > 250 ? 20 : 0);
    placed.push(new THREE.Vector3(x, s, z));
    const tint = new THREE.Color(tints[Math.floor(rand() * tints.length)]);
    const yaw = rand() * Math.PI * 2;
    // 上の平らな面（雪のように白っぽい）
    tops.push(new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromAxisAngle(UP, yaw), _s.set(s, s, s)));
    // 下にのびる大きな水晶（中心）＋まわりの小さな水晶
    shards.push({ m: new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromAxisAngle(UP, yaw), _s.set(s, s * (1.1 + rand() * 0.5), s)), c: tint.clone() });
    const nAround = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < nAround; i++) {
      const b = yaw + (i / nAround) * Math.PI * 2 + rand() * 0.4;
      const rr = s * (0.55 + rand() * 0.25);
      const ss = s * (0.3 + rand() * 0.25);
      _e.set((rand() - 0.5) * 0.5, b, (rand() < 0.5 ? -1 : 1) * (0.15 + rand() * 0.3));
      shards.push({
        m: new THREE.Matrix4().compose(_p.set(x + Math.cos(b) * rr, y - s * 0.05, z + Math.sin(b) * rr), _q.setFromEuler(_e), _s.set(ss, ss * (0.9 + rand() * 0.6), ss)),
        c: tint.clone().offsetHSL((rand() - 0.5) * 0.06, 0, (rand() - 0.5) * 0.1),
      });
    }
    // 上に立つ水晶のとげ
    const nSpike = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < nSpike; i++) {
      const b = rand() * Math.PI * 2, rr = s * rand() * 0.7;
      const hh = s * (0.25 + rand() * 0.55);
      _e.set((rand() - 0.5) * 0.4, rand() * 3, (rand() - 0.5) * 0.4);
      spikes.push({
        m: new THREE.Matrix4().compose(_p.set(x + Math.cos(b) * rr, y + s * 0.28, z + Math.sin(b) * rr), _q.setFromEuler(_e), _s.set(hh * 0.4, hh, hh * 0.4)),
        c: new THREE.Color(tints[Math.floor(rand() * tints.length)]).lerp(_c.set('#ffffff'), 0.3),
      });
    }
    if (rand() < 0.45) falls.push({ p: new THREE.Vector3(x + Math.cos(yaw) * s * 0.9, y + s * 0.2, z + Math.sin(yaw) * s * 0.9), w: s * 0.35, h: s * 3 + 30, yaw });
  }

  const obj = new THREE.Group();
  const topGeo = new THREE.CylinderGeometry(1.05, 0.95, 0.32, 9).translate(0, 0.16, 0);
  const topMesh = new THREE.InstancedMesh(topGeo, crystalMaterial('#f3ecff', '#b9a6f0', 0.3), tops.length);
  tops.forEach((m, i) => topMesh.setMatrixAt(i, m));
  const shardGeo = new THREE.ConeGeometry(1, 2.4, 7, 1).rotateX(Math.PI).translate(0, -1.2, 0);
  const shardMat = crystalMaterial('#ffffff', '#6f55d8', 0.42);
  const shardMesh = new THREE.InstancedMesh(shardGeo, shardMat, shards.length);
  shards.forEach((o, i) => {
    shardMesh.setMatrixAt(i, o.m);
    shardMesh.setColorAt(i, o.c);
  });
  const spikeGeo = new THREE.ConeGeometry(1, 2, 5, 1).translate(0, 1, 0);
  const spikeMesh = new THREE.InstancedMesh(spikeGeo, crystalMaterial('#ffffff', '#8c78ff', 0.5), spikes.length);
  spikes.forEach((o, i) => {
    spikeMesh.setMatrixAt(i, o.m);
    spikeMesh.setColorAt(i, o.c);
  });
  obj.add(topMesh, shardMesh, spikeMesh);

  // 滝：光るすじが流れ落ちる半透明の板
  const fallMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: { uTime: globalUniforms.uTime },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float x = vUv.x;
        float streak = 0.55 + 0.45 * sin(x * 48.0 + sin(x * 11.0) * 3.0);
        float flow = 0.6 + 0.4 * sin((vUv.y * 9.0 + uTime * 2.2) + sin(x * 23.0) * 2.0);
        float edge = smoothstep(0.0, 0.18, x) * smoothstep(1.0, 0.82, x);
        float fade = smoothstep(0.0, 0.55, vUv.y) * smoothstep(1.0, 0.95, vUv.y);
        float a = streak * flow * edge * fade * 0.5;
        gl_FragColor = vec4(vec3(0.8, 0.92, 1.0) * a * 1.6, 1.0);
      }`,
  });
  for (const f of falls) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(f.w, f.h).translate(0, -f.h / 2, 0), fallMat);
    m.position.copy(f.p);
    m.rotation.y = -f.yaw + Math.PI / 2;
    m.renderOrder = 3;
    obj.add(m);
  }
  return { obj };
}

// ---------- 水晶のお城 ----------

function windowTexture(): THREE.CanvasTexture {
  const [c, g] = makeCanvas(128, 256);
  g.fillStyle = '#000000';
  g.fillRect(0, 0, 128, 256);
  // アーチ形の窓（光る部分だけを描く）
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      const x = 20 + col * 56, y = 30 + row * 80, w = 32, h = 52;
      const grd = g.createLinearGradient(0, y, 0, y + h);
      grd.addColorStop(0, '#ffd9f4');
      grd.addColorStop(1, '#8fe8ff');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(x, y + h);
      g.lineTo(x, y + w / 2);
      g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
      g.lineTo(x + w, y + h);
      g.closePath();
      g.fill();
    }
  }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function castle(at: THREE.Vector3, scale: number) {
  const g = new THREE.Group();
  g.position.copy(at);
  g.scale.setScalar(scale);
  const wallGeos: THREE.BufferGeometry[] = [];
  const spireGeos: THREE.BufferGeometry[] = [];
  const goldGeos: THREE.BufferGeometry[] = [];
  const lampGeos: THREE.BufferGeometry[] = [];
  const tower = (x: number, z: number, r: number, h: number, y0 = 0) => {
    // 窓の模様が縦横にくり返すよう、円柱の UV を高さと周の長さに合わせる
    const body = new THREE.CylinderGeometry(r, r * 1.08, h, 12, 1, false);
    const uv = body.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.round((Math.PI * 2 * r) / 9), uv.getY(i) * (h / 16));
    wallGeos.push(body.translate(x, y0 + h / 2, z));
    goldGeos.push(new THREE.CylinderGeometry(r * 1.14, r * 1.14, 1.2, 12).translate(x, y0 + h, z));
    const sh = r * 3.2;
    spireGeos.push(new THREE.ConeGeometry(r * 1.2, sh, 12).translate(x, y0 + h + sh / 2 + 0.6, z));
    lampGeos.push(new THREE.SphereGeometry(Math.max(0.8, r * 0.18), 12, 8).translate(x, y0 + h + sh + 1.2, z));
  };
  tower(0, 0, 15, 95);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    tower(Math.cos(a) * 34, Math.sin(a) * 34, 6 + (i % 2) * 2.5, 50 + ((i * 37) % 30));
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    tower(Math.cos(a) * 58, Math.sin(a) * 58, 4, 28 + ((i * 23) % 16));
  }
  // 塔をつなぐ城壁
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, b = ((i + 1) / 8) * Math.PI * 2;
    const ax = Math.cos(a) * 34, az = Math.sin(a) * 34, bx = Math.cos(b) * 34, bz = Math.sin(b) * 34;
    const len = Math.hypot(bx - ax, bz - az);
    const wall = new THREE.BoxGeometry(len, 24, 4);
    wall.rotateY(-Math.atan2(bz - az, bx - ax)).translate((ax + bx) / 2, 12, (az + bz) / 2);
    wallGeos.push(wall);
  }
  const walls = new THREE.Mesh(mergeGeometries(wallGeos.map((x) => x.toNonIndexed()))!, (() => {
    const m = crystalMaterial('#efe6ff', '#ffffff', 1);
    m.flatShading = false;
    m.emissiveMap = windowTexture();
    m.emissive.set('#ffffff').multiplyScalar(1.4);
    return m;
  })());
  const spires = new THREE.Mesh(mergeGeometries(spireGeos)!, crystalMaterial('#d9b8ff', '#a070ff', 0.55));
  const golds = new THREE.Mesh(mergeGeometries(goldGeos)!, goldMaterial());
  const lampM = lampMaterial('#ffe6fa');
  lampM.color.multiplyScalar(3);
  const lamps = new THREE.Mesh(mergeGeometries(lampGeos)!, lampM);
  g.add(walls, spires, golds, lamps);
  // お城の正面の、大きな星の窓
  const star = new THREE.Mesh(new THREE.ShapeGeometry(starShape(9, 4)), (() => {
    const m = lampMaterial('#cfeaff');
    m.color.multiplyScalar(2.2);
    return m;
  })());
  star.position.set(0, 70, 15.3);
  g.add(star);
  const star2 = star.clone();
  star2.position.set(0, 70, -15.3);
  star2.rotation.y = Math.PI;
  g.add(star2);
  // 土台の大きな浮島
  const base = new THREE.Mesh(new THREE.CylinderGeometry(72, 66, 6, 14).translate(0, -3, 0), crystalMaterial('#f3ecff', '#b9a6f0', 0.3));
  const under = new THREE.Mesh(new THREE.ConeGeometry(68, 120, 9).rotateX(Math.PI).translate(0, -66, 0), crystalMaterial('#a88cff', '#6c4fd8', 0.45));
  g.add(base, under);
  return g;
}

function starShape(outer: number, inner: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

// ---------- 星の飾り ----------

// 道の上に描かれた、光る星
function roadStars(rand: Rand, track: Track) {
  const geo = new THREE.ShapeGeometry(starShape(0.9, 0.4)).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: '#fff3c0', transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
  mat.color.multiplyScalar(1.7);
  const n = 70;
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const base: number[] = [];
  for (let i = 0; i < n; i++) {
    const lat = (rand() - 0.5) * 2 * (track.def.halfWidth - 1.2);
    track.place(rand(), lat, _p).setY(0.045);
    const s = 0.6 + rand() * 0.9;
    mesh.setMatrixAt(i, _m.compose(_p, _q.setFromAxisAngle(UP, rand() * 6), _s.set(s, 1, s)));
    base.push(rand() * 10);
  }
  mesh.renderOrder = 2;
  return { obj: mesh };
}

// 道の両側の空中に浮かぶ、金の星（ゆらゆら回る）
function hangingStars(rand: Rand, track: Track) {
  const geo = new THREE.ExtrudeGeometry(starShape(1, 0.45), { depth: 0.3, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 2 });
  geo.center();
  const mat = new THREE.MeshStandardMaterial({ color: '#ffe08a', emissive: '#ffc24a', emissiveIntensity: 1.25, metalness: 0.4, roughness: 0.35 });
  const n = 64;
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const items: { p: THREE.Vector3; s: number; ph: number; sp: number }[] = [];
  for (let i = 0; i < n; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    const p = track.place(rand(), side * (track.def.halfWidth + 3 + rand() * 14), new THREE.Vector3());
    p.y = 6 + rand() * 12;
    items.push({ p, s: 0.8 + rand() * 1.1, ph: rand() * 10, sp: 0.6 + rand() * 0.8 });
  }
  // 光の輪（いつもカメラの方を向く、脈打つ光）
  const haloMat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  haloMat.color.setRGB(0.9, 0.78, 0.55);
  const halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), haloMat, n);
  const camQ = new THREE.Quaternion();
  const update = (_dt: number, cam: THREE.Camera, time: number) => {
    if (cam) cam.getWorldQuaternion(camQ);
    items.forEach((o, i) => {
      _p.copy(o.p);
      _p.y += Math.sin(time * 0.9 + o.ph) * 0.5;
      _q.setFromEuler(_e.set(0, time * o.sp + o.ph, Math.sin(time + o.ph) * 0.15));
      mesh.setMatrixAt(i, _m.compose(_p, _q, _s.setScalar(o.s)));
      const pulse = 2.8 + Math.sin(time * 2.2 + o.ph * 3) * 0.6;
      halos.setMatrixAt(i, _m.compose(_p, camQ, _s.setScalar(o.s * pulse)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    halos.instanceMatrix.needsUpdate = true;
  };
  update(0, null as unknown as THREE.Camera, 0);
  mesh.frustumCulled = false;
  halos.frustumCulled = false;
  halos.renderOrder = 3;
  const obj = new THREE.Group();
  obj.add(mesh, halos);
  return { obj, update };
}

function snowflakeTexture(): THREE.CanvasTexture {
  const [c, g] = makeCanvas(256, 256);
  g.translate(128, 128);
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, 128);
  glow.addColorStop(0, 'rgba(255,255,255,0.35)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(-128, -128, 256, 256);
  g.strokeStyle = '#ffffff';
  g.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    g.save();
    g.rotate((i / 6) * Math.PI * 2);
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -100);
    g.stroke();
    g.lineWidth = 7;
    for (const [y, l] of [
      [-42, 26],
      [-70, 20],
    ]) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(-l, y - l);
      g.moveTo(0, y);
      g.lineTo(l, y - l);
      g.stroke();
    }
    g.restore();
  }
  return toTexture(c);
}

// 大きな雪の結晶（いつもカメラの方を向いて、ゆっくり回る）
function snowflakes(rand: Rand, center: THREE.Vector3, track: Track) {
  const mat = new THREE.MeshBasicMaterial({ map: snowflakeTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  mat.color.setRGB(1.2, 1.15, 1.3);
  const n = 46;
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, n);
  const items: { p: THREE.Vector3; s: number; ph: number }[] = [];
  for (let i = 0; i < n; i++) {
    let p: THREE.Vector3;
    if (i < 26) {
      const side = rand() < 0.5 ? -1 : 1;
      p = track.place(rand(), side * (track.def.halfWidth + 10 + rand() * 40), new THREE.Vector3());
      p.y = 14 + rand() * 26;
    } else {
      const a = rand() * Math.PI * 2, r = 150 + rand() * 350;
      p = new THREE.Vector3(center.x + Math.cos(a) * r, 40 + rand() * 120, center.z + Math.sin(a) * r);
    }
    items.push({ p, s: i < 26 ? 4 + rand() * 4 : 14 + rand() * 20, ph: rand() * 10 });
  }
  const camQ = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const Z = new THREE.Vector3(0, 0, 1);
  const update = (_dt: number, cam: THREE.Camera, time: number) => {
    cam.getWorldQuaternion(camQ);
    items.forEach((o, i) => {
      spin.setFromAxisAngle(Z, time * 0.2 + o.ph);
      _q.copy(camQ).multiply(spin);
      _p.copy(o.p);
      _p.y += Math.sin(time * 0.5 + o.ph) * 1.2;
      mesh.setMatrixAt(i, _m.compose(_p, _q, _s.setScalar(o.s)));
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return { obj: mesh, update };
}

// きらめく光の粒（十字の光が出て、色とりどりにまたたく）。positions は x,y,z の並び
function sparklePoints(positions: Float32Array, sizeK: number, minPx: number, maxPx: number, rand: Rand) {
  const n = positions.length / 3;
  const ph = new Float32Array(n);
  for (let i = 0; i < n; i++) ph[i] = rand() * 100;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: globalUniforms.uTime, uScale: { value: window.innerHeight * Math.min(2, devicePixelRatio) } },
    vertexShader: /* glsl */ `
      attribute float phase;
      uniform float uTime, uScale;
      varying float vA;
      varying float vH;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float tw = 0.5 + 0.5 * sin(uTime * (1.0 + fract(phase) * 2.5) + phase);
        vA = tw * tw;
        vH = fract(phase * 0.37);
        gl_PointSize = clamp((0.5 + tw) * uScale * ${sizeK.toFixed(3)} / -mv.z, ${minPx.toFixed(1)}, ${maxPx.toFixed(1)});
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      varying float vH;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        vec2 a = abs(d);
        float r = length(d);
        float core = smoothstep(0.5, 0.0, r);
        float cross = (exp(-a.x * 55.0 - a.y * 5.0) + exp(-a.y * 55.0 - a.x * 5.0)) * smoothstep(0.5, 0.05, r);
        vec3 tint = vH < 0.25 ? vec3(1.0, 0.95, 0.9) : vH < 0.5 ? vec3(0.7, 0.92, 1.0) : vH < 0.75 ? vec3(1.0, 0.75, 0.95) : vec3(1.0, 0.9, 0.55);
        float v = (core * core * 1.2 + cross * 1.1) * (0.35 + vA);
        gl_FragColor = vec4(tint * v * 1.6, 1.0);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

// 空に散らばる、またたく光（大きな星のきらめきも混ざる）
function skySparkles(rand: Rand, center: THREE.Vector3) {
  const n = 1800;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2, r = 40 + Math.pow(rand(), 0.7) * 600;
    pos[i * 3] = center.x + Math.cos(a) * r;
    pos[i * 3 + 1] = -20 + rand() * 160;
    pos[i * 3 + 2] = center.z + Math.sin(a) * r;
  }
  return { obj: sparklePoints(pos, 0.5, 2, 18, rand) };
}

// 道のまわりの空中を舞う、きらきらの粒（走ると目の前を光が流れていく）
function roadGlitter(rand: Rand, track: Track) {
  const n = 2600;
  const pos = new Float32Array(n * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    track.place(rand(), side * rand() * (track.def.halfWidth + 9), p);
    pos[i * 3] = p.x;
    pos[i * 3 + 1] = 0.25 + Math.pow(rand(), 1.6) * 9;
    pos[i * 3 + 2] = p.z;
  }
  return { obj: sparklePoints(pos, 0.2, 2, 14, rand) };
}

// 金の星のまわりの、光の輪
function glowTexture(): THREE.CanvasTexture {
  const [c, g] = makeCanvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,240,190,1)');
  grd.addColorStop(0.25, 'rgba(255,214,120,0.55)');
  grd.addColorStop(1, 'rgba(255,190,90,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return toTexture(c);
}
