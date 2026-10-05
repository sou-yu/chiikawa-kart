import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../core/random';
import { applyWind, globalUniforms } from '../../core/shaders';
import { dashPads, type Landmarks } from '../Landmarks';
import type { Track, TrackProjection } from '../Track';
import { scallopFanGeometry, shellGate, starfishGeometry } from './gate';
import { SEA_Y, oceanMaterial, sandGroundMaterial, shellMaterial, sunsetSkyMaterial } from './materials';
import {
  beachBallGeometry,
  birdGeometry,
  boatGeometry,
  brainCoralGeometry,
  bushGeometry,
  daisyGeometry,
  fanCoralGeometry,
  fernGeometry,
  floatRingGeometry,
  grassTuftGeometry,
  hibiscusGeometry,
  staghornGeometry,
  surfboardGeometry,
  tableCoralGeometry,
} from './props';
import { chevronTexture, driftwoodTexture, foliageTexture, frondTexture, umbrellaTexture } from './textures';

// 夕焼け海岸の世界。動かない物は static に入れる（あとで区画分けして、画面外は描かない）
const TAU = Math.PI * 2;
const WHITE = new THREE.Color('#ffffff');

export const SUNSET_FOG = '#e6a088';
export const SUNSET_LIGHTS = { sky: '#ffdcc4', ground: '#8070a4', hemi: 1.1, sun: '#ffcf9e', sunI: 2.5 };

export interface SunsetWorld extends Landmarks {
  static: THREE.Group;
}

// ---------- 海岸線：z の位置で、水ぎわの x（これより西 = -x 側が海）----------
// 道の 0.17〜0.35 あたりでは、岸が東へ入りこんでいて、道が浅瀬の水の上を通る
const SHORE: [number, number][] = [
  [-900, -42],
  [-150, -36],
  [-60, -34],
  [0, -32],
  [35, -30],
  [52, -16],
  [62, -8],
  [160, -9],
  [172, -18],
  [186, -50],
  [200, -105],
  [230, -132],
  [275, -130],
  [310, -92],
  [360, -46],
  [900, -42],
];
export function shoreX(z: number): number {
  if (z <= SHORE[0][0]) return SHORE[0][1];
  for (let i = 1; i < SHORE.length; i++) {
    const [z1, x1] = SHORE[i];
    if (z <= z1) {
      const [z0, x0] = SHORE[i - 1];
      const f = (z - z0) / (z1 - z0);
      const s = f * f * (3 - 2 * f); // 角をまるく
      return x0 + (x1 - x0) * s;
    }
  }
  return SHORE[SHORE.length - 1][1];
}
// カートが水の上にいるか（浅瀬の演出用）
export const isWater = (x: number, z: number) => x < shoreX(z) - 0.6;

// 同じ形をたくさん置くための入れ物（まとめて 1 回の描画になる）
class Bag {
  private ms: THREE.Matrix4[] = [];
  private cs: (THREE.Color | null)[] = [];
  add(m: THREE.Matrix4, color?: THREE.ColorRepresentation) {
    this.ms.push(m);
    this.cs.push(color === undefined ? null : new THREE.Color(color));
  }
  get size() {
    return this.ms.length;
  }
  build(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], cast = true, receive = false, maxDist = 0): THREE.InstancedMesh | null {
    if (!this.ms.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, this.ms.length);
    this.ms.forEach((m, i) => im.setMatrixAt(i, m));
    if (this.cs.some(Boolean)) this.cs.forEach((c, i) => im.setColorAt(i, c ?? WHITE));
    im.castShadow = cast;
    im.receiveShadow = receive;
    if (maxDist) im.userData.maxDist = maxDist;
    return im;
  }
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const mat4 = (x: number, y: number, z: number, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));

export function buildSunsetWorld(track: Track): SunsetWorld {
  const group = new THREE.Group();
  const stat = new THREE.Group();
  group.add(stat);
  const rand = mulberry32(2718);
  const R = (a: number, b: number) => a + rand() * (b - a);
  const hw = track.def.halfWidth;
  const wall = hw + track.def.wallOffset;
  const add = (o: THREE.Object3D | null) => {
    if (o) stat.add(o);
  };
  // カートが水の上にいるかを、コースに教える
  track.waterAt = isWater;

  // ---------- 空 ----------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), sunsetSkyMaterial());
  sky.renderOrder = -1;
  group.add(sky);

  // ---------- 地形（砂浜・砂丘・岬）と海 ----------
  const proj: TrackProjection = { t: 0, index: 0, lateral: 0, point: new THREE.Vector3(), tangent: new THREE.Vector3(), normal: new THREE.Vector3() };
  const box = new THREE.Box3().setFromPoints(track.pts).expandByScalar(30);
  const cape = new THREE.Vector2(-100, 252);
  const dunes = (x: number, z: number) =>
    (Math.sin(x * 0.031 + Math.sin(z * 0.017) * 2) * 0.5 + 0.5) * 1.1 + (Math.sin(z * 0.045 + x * 0.012) * 0.5 + 0.5) * 0.6;
  const heightAt = (x: number, z: number): { h: number; wet: number; road: number } => {
    const d = x - shoreX(z);
    let h: number;
    if (d >= 0) {
      h = 0.16 + 0.012 * Math.min(d, 25) + dunes(x, z) * THREE.MathUtils.smoothstep(d, 25, 70);
    } else {
      h = Math.max(-6, 0.16 + 0.05 * d);
    }
    // 岬は小高い丘
    const dc = Math.hypot(x - cape.x, z - cape.y);
    h += 5.5 * THREE.MathUtils.smoothstep(46, 18, dc) * THREE.MathUtils.smoothstep(d, -2, 6);
    // 道のまわりは平らに（道より少し低く）。浅瀬では、道の下が砂の州になる
    let road = 999;
    if (box.containsPoint(_v.set(x, 0, z))) {
      track.project(_v, proj);
      road = Math.abs(proj.lateral);
      // 陸では道まで下げ、海では道の下を砂の州として持ち上げる（州のふちは、なだらかに深くなる）
      const s = THREE.MathUtils.smoothstep(road, hw + 0.8, h < 0 ? hw + 16 : hw + 7);
      h = THREE.MathUtils.lerp(-0.02, h, s);
    }
    const wet = d < 0 ? 1 : 1 - Math.min(1, d / 7);
    return { h, wet, road };
  };
  const _v = new THREE.Vector3();

  // ---------- コースぞいを歩くための道具 ----------
  const _a = new THREE.Vector3();
  const walk = (lat: number, step: number, cb: (p: THREE.Vector3, yaw: number, t: number) => void) => {
    const N = track.pts.length;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) pts.push(track.place((i + 0.5) / N, lat, new THREE.Vector3()));
    let s = 0;
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[(i + 1) % N];
      const seg = a.distanceTo(b);
      while (s < seg) {
        _a.lerpVectors(a, b, s / seg);
        cb(_a, Math.atan2(b.x - a.x, b.z - a.z), (i + s / seg) / N);
        s += step;
      }
      s -= seg;
    }
  };
  // その場所が、道からどれだけ離れているか
  const roadDist = (x: number, z: number) => {
    track.project(_v.set(x, 0, z), proj);
    return Math.abs(proj.lateral);
  };
  const groundH = (x: number, z: number) => heightAt(x, z).h;

  // ---------- ヤシの位置（地面の草の濃さにも使うので、地形より先に決める）----------
  interface Palm { x: number; y: number; z: number; yaw: number; lean: number; s: number; sy: number }
  const palms: Palm[] = [];
  {
    const spots: [number, number][] = [];
    const tryPalm = (x: number, z: number, s: number) => {
      if (isWater(x, z - 0) || x < shoreX(z) + 3) return;
      if (roadDist(x, z) < wall + 2.5) return;
      for (const [px, pz] of spots) if ((px - x) ** 2 + (pz - z) ** 2 < 16) return;
      spots.push([x, z]);
      palms.push({ x, y: groundH(x, z) - 0.1, z, yaw: R(0, TAU), lean: R(0.05, 0.22), s, sy: R(0.9, 1.15) });
    };
    // 浜辺の道の東がわ（海と反対）に並ぶヤシ
    walk(-(wall + 6), 9, (p) => tryPalm(p.x + R(-2, 2), p.z + R(-3, 3), R(0.85, 1.2)));
    walk(-(wall + 15), 13, (p) => tryPalm(p.x + R(-4, 4), p.z + R(-4, 4), R(0.9, 1.3)));
    walk(wall + 7, 16, (p) => {
      if (!isWater(p.x - 20, p.z)) tryPalm(p.x + R(-3, 3), p.z + R(-3, 3), R(0.85, 1.2));
    });
    // 内側のヤシ林
    for (let i = 0; i < 160; i++) tryPalm(R(-5, 130), R(-150, 210), R(0.8, 1.3));
    // 岬のまわり
    for (let i = 0; i < 30; i++) tryPalm(cape.x + R(-40, 40), cape.y + R(-40, 30), R(0.8, 1.15));
  }

  // 地形の格子の間隔：道のまわり（d0〜d1）は 5m、外へいくほど粗く（最大 40m）。
  // 格子は縦横の線で区切るだけなので、ひびわれのない 1 枚の地形のまま、三角形をおよそ 7 割減らせる
  const stretched = (lo: number, hi: number, d0: number, d1: number, step = 5, grow = 1.2, maxStep = 40): number[] => {
    const n = Math.ceil((d1 - d0) / step);
    const s = (d1 - d0) / n;
    const a: number[] = [];
    for (let i = 0; i <= n; i++) a.push(d0 + i * s);
    for (let x = d1, h = s; ; ) {
      h = Math.min(maxStep, h * grow);
      if (x + h >= hi - h * 0.5) {
        a.push(hi);
        break;
      }
      x += h;
      a.push(x);
    }
    const low: number[] = [];
    for (let x = d0, h = s; ; ) {
      h = Math.min(maxStep, h * grow);
      if (x - h <= lo + h * 0.5) {
        low.push(lo);
        break;
      }
      x -= h;
      low.push(x);
    }
    return [...low.reverse(), ...a];
  };
  // arr[i] <= v < arr[i+1] となる i
  const findIdx = (arr: number[], v: number) => {
    let lo = 0, hi = arr.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid] <= v) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const X0 = -520, X1 = 620, Z0 = -620, Z1 = 660;
  const xs = stretched(X0, X1, -190, 210), zs = stretched(Z0, Z1, -230, 330);
  const NX = xs.length - 1, NZ = zs.length - 1;
  const NV = (NX + 1) * (NZ + 1);
  const tpos: number[] = [], tuv: number[] = [], twet: number[] = [];
  const hs = new Float32Array(NV);
  const ds = new Float32Array(NV);
  const grassA = new Float32Array(NV); // 草の濃さ 0..1（ヤシの林・内陸・岬の上）
  const roadA = new Float32Array(NV); // 道の中心からの距離（道ばたの砂のために）
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const x = xs[i], z = zs[j];
      const { h, wet, road } = heightAt(x, z);
      const k = j * (NX + 1) + i;
      hs[k] = h;
      ds[k] = x - shoreX(z);
      roadA[k] = Math.min(80, road);
      tpos.push(x, h, z);
      tuv.push(x / 7, z / 7);
      twet.push(wet);
      // 内陸（水ぎわから遠いところ）と、岬の上は緑
      const d = ds[k];
      const dc = Math.hypot(x - cape.x, z - cape.y);
      grassA[k] = Math.max(
        THREE.MathUtils.smoothstep(d, 22, 60) * (0.82 + 0.18 * Math.sin(x * 0.02 + z * 0.013)),
        0.95 * THREE.MathUtils.smoothstep(dc, 44, 20) * THREE.MathUtils.smoothstep(d, 2, 12),
      );
    }
  }
  // ヤシの林の下は緑（ヤシの位置から半径 約 12m をぼかして足す）
  for (const p of palms) {
    const i0 = findIdx(xs, p.x - 12), i1 = Math.min(NX, findIdx(xs, p.x + 12) + 1);
    const j0 = findIdx(zs, p.z - 12), j1 = Math.min(NZ, findIdx(zs, p.z + 12) + 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * (NX + 1) + i;
        const dd = Math.hypot(xs[i] - p.x, zs[j] - p.z);
        const g = 1 - THREE.MathUtils.smoothstep(dd, 3.5, 12);
        if (g > grassA[k] && ds[k] > 5) grassA[k] = g;
      }
    }
  }
  // 草の濃さをあとから引けるように（草むら・花を置く場所の判定）。道ばたの砂のぶんは別に引く
  const grassAt = (x: number, z: number) => {
    const i = findIdx(xs, x), j = findIdx(zs, z);
    const u = THREE.MathUtils.clamp((x - xs[i]) / (xs[i + 1] - xs[i]), 0, 1), v = THREE.MathUtils.clamp((z - zs[j]) / (zs[j + 1] - zs[j]), 0, 1);
    const k = j * (NX + 1) + i;
    return (grassA[k] * (1 - u) + grassA[k + 1] * u) * (1 - v) + (grassA[k + NX + 1] * (1 - u) + grassA[k + NX + 2] * u) * v;
  };
  const ROAD_IN = wall + 0.5, ROAD_OUT = wall + 3.2;

  const tidx: number[] = [];
  const sidx: number[] = [];
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i, b = a + 1, cc = a + NX + 1, dd = cc + 1;
      tidx.push(a, cc, b, b, cc, dd);
      // 海：水ぎわの近く・海の中だけ
      if (Math.min(ds[a], ds[b], ds[cc], ds[dd]) < 2) sidx.push(a, cc, b, b, cc, dd);
    }
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(tpos, 3));
  tg.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2));
  tg.setAttribute('aWet', new THREE.Float32BufferAttribute(twet, 1));
  tg.setAttribute('aGrass', new THREE.BufferAttribute(grassA, 1));
  tg.setAttribute('aRoad', new THREE.BufferAttribute(roadA, 1));
  tg.setIndex(tidx);
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, sandGroundMaterial(ROAD_IN, ROAD_OUT));
  terrain.receiveShadow = true;
  group.add(terrain);

  // 海面（水深を頂点に持たせる）
  const spos: number[] = [], sdep: number[] = [], sshore: number[] = [];
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const k = j * (NX + 1) + i;
      spos.push(xs[i], SEA_Y, zs[j]);
      sdep.push(SEA_Y - hs[k]);
      sshore.push(Math.max(-40, Math.min(5, ds[k])));
    }
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(spos, 3));
  sg.setAttribute('aDepth', new THREE.Float32BufferAttribute(sdep, 1));
  sg.setAttribute('aShore', new THREE.Float32BufferAttribute(sshore, 1));
  sg.setIndex(sidx);
  const ocean = oceanMaterial();
  const sea = new THREE.Mesh(sg, ocean);
  sea.renderOrder = 2;
  sea.frustumCulled = false;
  group.add(sea);
  // 地形の外の、遠くの海（地形のまわりをかこむ 4 枚）
  {
    const F = 6000;
    const rects = [
      [-F, Z0, X0, Z1],
      [X1, Z0, F, Z1],
      [-F, -F, F, Z0],
      [-F, Z1, F, F],
    ];
    const fp: number[] = [], fd: number[] = [], fi: number[] = [];
    for (const [ax, az, bx, bz] of rects) {
      const b = fp.length / 3;
      fp.push(ax, SEA_Y, az, bx, SEA_Y, az, ax, SEA_Y, bz, bx, SEA_Y, bz);
      fd.push(30, 30, 30, 30);
      fi.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    fg.setAttribute('aDepth', new THREE.Float32BufferAttribute(fd, 1));
    fg.setAttribute('aShore', new THREE.Float32BufferAttribute(fd.map(() => -40), 1));
    fg.setIndex(fi);
    const far = new THREE.Mesh(fg, ocean);
    far.renderOrder = 2;
    far.frustumCulled = false;
    group.add(far);
  }

  // 遠くの島のシルエット（夕もやで紫がかる）
  {
    const isl = new Bag();
    for (const [x, z, s, h] of [
      [-1050, 320, 160, 60],
      [-1250, -80, 220, 85],
      [-950, -420, 120, 40],
      [-1400, 600, 260, 110],
    ]) {
      isl.add(mat4(x, -2, z, R(0, TAU), s, h, s * 0.7));
    }
    const g = new THREE.SphereGeometry(1, 20, 10, 0, TAU, 0, Math.PI / 2);
    add(isl.build(g, new THREE.MeshBasicMaterial({ color: '#7c5f8a', fog: true }), false, false));
  }

  // ---------- ロープと木の杭の柵（道のふち。浅瀬では水の中から立つ）----------
  {
    const posts = new Bag();
    const ropes = new Bag();
    const up = new THREE.Vector3(0, 1, 0);
    for (const side of [-1, 1]) {
      let prev: THREE.Vector3 | null = null;
      const first: THREE.Vector3[] = [];
      walk(side * (wall + 0.15), 3.6, (p, yaw) => {
        const y = Math.min(0, groundH(p.x, p.z));
        posts.add(mat4(p.x, y, p.z, yaw + R(-0.2, 0.2), 1, R(0.9, 1.1), 1, R(-0.05, 0.05), R(-0.05, 0.05)));
        const top = new THREE.Vector3(p.x, 0.86, p.z);
        if (prev) {
          const mid = prev.clone().lerp(top, 0.5).setY(0.78);
          const len = prev.distanceTo(top);
          const q = new THREE.Quaternion().setFromUnitVectors(up, top.clone().sub(prev).normalize());
          ropes.add(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, len, 1)));
        } else first.push(top);
        prev = top;
      });
    }
    const wood = driftwoodTexture();
    add(posts.build(new THREE.CylinderGeometry(0.11, 0.14, 1.15, 7).translate(0, 0.57, 0), new THREE.MeshStandardMaterial({ map: wood, color: '#cfae86', roughness: 0.9 }), true, false, 240));
    add(ropes.build(new THREE.CylinderGeometry(0.045, 0.045, 1, 5), new THREE.MeshStandardMaterial({ color: '#e6d3ae', roughness: 0.95 }), false, false, 200));
  }

  // ---------- ヤシの木 ----------
  {
    const trunks = new Bag();
    const crowns = new Bag();
    // 1 本ごとに、幹と葉の色あいを少しずつ変える（インスタンスの色。描画の重さは変わらない）
    const trunkTints = ['#ffffff', '#f2e4d6', '#e8d2bc', '#ffeedd', '#f6dccb'];
    const leafTints = ['#ffffff', '#e6f5ce', '#f6ffe0', '#d6eab8', '#f0f8d8'];
    for (const p of palms) {
      trunks.add(mat4(p.x, p.y, p.z, p.yaw, p.s, p.s * p.sy, p.s, 0, p.lean), trunkTints[Math.floor(rand() * trunkTints.length)]);
      // 葉の冠は幹のてっぺんに（幹のかたむきに合わせて）
      crowns.add(trunkTopMatrix(p.x, p.y, p.z, p.yaw, p.s, p.sy, p.lean), leafTints[Math.floor(rand() * leafTints.length)]);
    }
    const trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    add(trunks.build(palmTrunkGeometry(), trunkMat, true, false, 520));
    const frondMat = applyWind(new THREE.MeshLambertMaterial({ map: frondTexture(), alphaTest: 0.35, side: THREE.DoubleSide, color: '#f4ffe0', emissive: '#22381a' }), 0.18, 3, 'y');
    add(crowns.build(palmCrownGeometry(), frondMat, true, false, 520));
  }

  // ---------- 草むら・野の花・シダ（草の地面の上）----------
  // 茂み（道ばた・岬の上）の形と、葉っぱ模様の材質
  const bushGeo = bushGeometry();
  const bushMat = new THREE.MeshLambertMaterial({ map: foliageTexture(), vertexColors: true, color: '#ffffff' });
  {
    const tufts = new Bag();
    const dune = new Bag();
    const daisies = new Bag();
    const ferns = new Bag();
    const greens = ['#86b248', '#92bc50', '#73a240', '#a2c660', '#659639', '#b0cb6c', '#558a40'];
    const golds = ['#c9bb62', '#bfae58', '#d6c874', '#a9b95a'];
    const pastels = ['#ffffff', '#fff3a6', '#ffc0d4', '#ffffff', '#fff0f5'];
    const fernCols = ['#4c9a3c', '#3f8a38', '#5aa844', '#2f7a38'];
    const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
    const _p = new THREE.Vector3();
    // 草の濃いところで、道ばたの砂（柵の外 3m）より外がわ
    const ok = (x: number, z: number, lo: number, hi: number) => {
      const g = grassAt(x, z);
      return g >= lo && g <= hi && !isWater(x, z) && x > shoreX(z) + 6 && roadDist(x, z) > ROAD_OUT + 0.2;
    };
    for (let tries = 0; tufts.size < 3200 && tries < 90000; tries++) {
      let x: number, z: number;
      if (rand() < 0.4 && palms.length) {
        // ヤシの根もと
        const pl = palms[Math.floor(rand() * palms.length)];
        const a = R(0, TAU), r = R(0.8, 9);
        x = pl.x + Math.cos(a) * r;
        z = pl.z + Math.sin(a) * r;
      } else {
        // 道ばたの外がわ（道に近いほど多く）
        track.place(rand(), (rand() < 0.5 ? -1 : 1) * (wall + 2.6 + 28 * Math.pow(rand(), 1.8)), _p);
        x = _p.x;
        z = _p.z;
      }
      if (!ok(x, z, 0.72, 2)) continue;
      const s = R(0.8, 1.4);
      const y = groundH(x, z) - 0.03;
      tufts.add(mat4(x, y, z, R(0, TAU), s, s * R(0.8, 1.3), s), pick(greens));
      if (rand() < 0.16) daisies.add(mat4(x + R(-0.6, 0.6), y + R(0.14, 0.3), z + R(-0.6, 0.6), R(0, TAU), 1.4), pick(pastels));
    }
    // 草のふち（砂との境）には、金色がかった浜辺の草
    for (let tries = 0; dune.size < 300 && tries < 20000; tries++) {
      track.place(rand(), (rand() < 0.5 ? -1 : 1) * R(wall + 3, wall + 22), _p);
      if (!ok(_p.x, _p.z, 0.12, 0.72)) continue;
      const s = R(0.9, 1.5);
      dune.add(mat4(_p.x, groundH(_p.x, _p.z) - 0.03, _p.z, R(0, TAU), s, s * R(1.1, 1.9), s), pick(golds));
    }
    // ヤシの足もとのシダ
    for (let tries = 0; ferns.size < 160 && tries < 4000 && palms.length; tries++) {
      const pl = palms[Math.floor(rand() * palms.length)];
      const a = R(0, TAU), r = R(1.4, 5.5);
      const x = pl.x + Math.cos(a) * r, z = pl.z + Math.sin(a) * r;
      if (!ok(x, z, 0.6, 2)) continue;
      const s = R(0.9, 1.5);
      ferns.add(mat4(x, groundH(x, z) - 0.02, z, R(0, TAU), s, s * R(0.85, 1.2), s), pick(fernCols));
    }
    // 草むらは、画質の設定（'grassField' の本数）でも減らせる
    const tuftGeo = grassTuftGeometry();
    const tuftMat = applyWind(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 0.22, 0.7, 'y');
    for (const bag of [tufts, dune]) {
      const m = bag.build(tuftGeo, tuftMat, false, false, 52);
      if (m) {
        m.name = 'grassField';
        m.userData.fullCount = m.count;
        m.userData.divisions = 3;
        add(m);
      }
    }
    add(daisies.build(daisyGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), false, false, 70));
    add(ferns.build(fernGeometry(), applyWind(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 0.12, 1.2, 'y'), false, false, 110));
  }

  // ---------- ビーチパラソルとタオル（浜辺の、道と海のあいだ）----------
  {
    const poles = new Bag();
    const pink = new Bag();
    const teal = new Bag();
    const towels = new Bag();
    let k = 0;
    walk(wall + 6, 15, (p, yaw, t) => {
      if (!(t < 0.16 || t > 0.93)) return;
      const x = p.x + R(-2, 2), z = p.z + R(-3, 3);
      if (isWater(x, z) || x < shoreX(z) + 2.5) return;
      const y = groundH(x, z);
      const tilt = R(-0.12, 0.12);
      poles.add(mat4(x, y, z, 0, 1, 1, 1, tilt, 0));
      (k++ % 2 ? pink : teal).add(mat4(x, y + 2.6, z, R(0, TAU), 1, 1, 1, tilt, 0));
      towels.add(mat4(x + R(1, 2), y + 0.03, z + R(-1, 1), yaw + R(-0.4, 0.4), 1), ['#ff8fb0', '#7fd3e6', '#ffd36b', '#ffffff'][k % 4]);
    });
    add(poles.build(new THREE.CylinderGeometry(0.05, 0.05, 2.8, 6).translate(0, 1.4, 0), new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.5 }), true, false, 300));
    const canopy = umbrellaCanopyGeometry();
    add(pink.build(canopy, new THREE.MeshStandardMaterial({ map: umbrellaTexture('#ff8fb4', '#fff6f0'), roughness: 0.6, side: THREE.DoubleSide }), true, false, 360));
    add(teal.build(canopy, new THREE.MeshStandardMaterial({ map: umbrellaTexture('#7fd8d0', '#fff6f0'), roughness: 0.6, side: THREE.DoubleSide }), true, false, 360));
    add(towels.build(new THREE.BoxGeometry(1.0, 0.04, 1.9), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }), false, true, 200));
  }

  // ---------- ハイビスカスの茂み（道ばた）----------
  {
    // 茂みの色は、葉っぱ模様（もともと緑）に掛ける、ほぼ白の色ちがい。花は、直径 約 1m の大きなハイビスカス（上向き〜外向き）
    const bushes = new Bag();
    const flowers = new Bag();
    const leafy = ['#ffffff', '#dcffc8', '#f2ffd2', '#c8f0d8', '#e8ffe0'];
    const petals = ['#ff3b4f', '#ff4f7e', '#ff8a3d', '#ff6fa6', '#ffd23f', '#ff2d6f', '#ff5a3c'];
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();
    const qd = new THREE.Quaternion();
    const qs = new THREE.Quaternion();
    const one = new THREE.Vector3();
    walk(0, 6.5, (p, yaw) => {
      for (const side of [-1, 1]) {
        if (rand() < 0.45) continue;
        const lat = side * (wall + R(1.6, 5));
        const x = p.x + Math.cos(yaw) * lat, z = p.z - Math.sin(yaw) * lat;
        if (isWater(x, z) || x < shoreX(z) + 1) continue;
        const y = groundH(x, z);
        const s = R(1.3, 2.1);
        bushes.add(mat4(x, y + s * 0.45, z, R(0, TAU), s * 1.15, s * 0.85, s), leafy[Math.floor(rand() * leafy.length)]);
        const n = 3 + Math.floor(rand() * 4);
        for (let i = 0; i < n; i++) {
          const a = R(0, TAU), el = R(0.35, 1.2);
          dir.set(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
          qd.setFromUnitVectors(up, dir);
          qs.setFromAxisAngle(up, R(0, TAU));
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3(x + dir.x * s * 1.35, y + s * 0.45 + dir.y * s * 0.95, z + dir.z * s * 1.2),
            qd.clone().multiply(qs),
            one.setScalar(R(0.85, 1.2)),
          );
          flowers.add(m, petals[Math.floor(rand() * petals.length)]);
        }
      }
    });
    // 小さな飾りは、区画の分けかたを粗くして（3×3）、描画の回数を抑える
    for (const m of [
      bushes.build(bushGeo, bushMat, false, false, 200),
      flowers.build(hibiscusGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, side: THREE.DoubleSide }), false, false, 170),
    ]) {
      if (m) m.userData.divisions = 3;
      add(m);
    }
  }

  // ---------- 貝殻とヒトデ（砂の上）----------
  {
    const shells = new Bag();
    const stars = new Bag();
    for (let i = 0; i < 420; i++) {
      const t = rand();
      const p = track.place(t, (rand() < 0.5 ? -1 : 1) * R(wall + 0.8, wall + 12));
      if (isWater(p.x, p.z)) continue;
      const y = groundH(p.x, p.z) + 0.02;
      if (rand() < 0.75) shells.add(mat4(p.x, y, p.z, R(0, TAU), R(0.18, 0.32), R(0.18, 0.32), R(0.18, 0.32), -Math.PI / 2 + R(-0.2, 0.2)), ['#fff1e6', '#ffd6d6', '#ffe9c9', '#f6d8ff'][Math.floor(rand() * 4)]);
      else stars.add(mat4(p.x, y + 0.04, p.z, R(0, TAU), R(0.22, 0.38), R(0.22, 0.38), R(0.22, 0.38), -Math.PI / 2), ['#ff8a70', '#ff6f8a', '#ffb36a'][Math.floor(rand() * 3)]);
    }
    // 小さな貝殻は軽い形で十分（大きなゲートは細かいまま）
    for (const m of [
      shells.build(scallopFanGeometry(0.05, 1, 9, 0.12, 0.04, [2, 2]), shellMaterial(false), false, false, 110),
      stars.build(starfishGeometry(1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }), false, false, 110),
    ]) {
      if (m) m.userData.divisions = 3;
      add(m);
    }
  }

  // ---------- サンゴ礁（浅瀬と浜ぎわ）：水の上に頭を出す岩の小山に、4 種類のサンゴを寄せて置く ----------
  {
    const mounds = new Bag();
    const stag = new Bag();
    const table = new Bag();
    const brain = new Bag();
    const fan = new Bag();
    const palette = ['#ff6f91', '#ff9a5c', '#c58bff', '#ffd35c', '#7fe0d0', '#ff7a8a', '#f7a6ff'];
    const rockC = ['#bfa08e', '#a98c7e', '#c7a994'];
    const pick = (a: string[]) => a[Math.floor(rand() * a.length)];
    const reef = (x: number, z: number, s: number) => {
      const top = SEA_Y + 0.25; // 水面から 0.25m 頭を出す
      mounds.add(mat4(x, top - 0.9 * s, z, R(0, TAU), s * R(1.0, 1.3), 0.9 * s, s * R(1.0, 1.3)), pick(rockC));
      const n = 3 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) {
        const a = R(0, TAU), r = R(0, 0.7) * s;
        const base = top - 0.12 - 0.3 * (r / (0.7 * s)); // ふちほど低い
        const sc = R(0.9, 1.45), yaw = R(0, TAU), col = pick(palette);
        const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
        const k = rand();
        if (k < 0.34) stag.add(mat4(cx, base, cz, yaw, sc * 1.1, sc * R(1, 1.25), sc * 1.1), col);
        else if (k < 0.58) table.add(mat4(cx, base, cz, yaw, sc * 0.95, sc * 0.9, sc * 0.95), col);
        else if (k < 0.8) brain.add(mat4(cx, base + 0.05, cz, yaw, sc, sc, sc), col);
        else fan.add(mat4(cx, base, cz, yaw, sc * 1.1, sc * 1.1, sc * 1.1), col);
      }
    };
    // 浅瀬の、道の両がわ（柵の外 3〜16m。道から見えるように近めに）
    for (let i = 0; i < 80 && mounds.size < 22; i++) {
      const p = track.place(R(0.16, 0.36), (rand() < 0.5 ? -1 : 1) * R(wall + 3, wall + 16));
      if (!isWater(p.x, p.z)) continue;
      reef(p.x, p.z, R(1.1, 1.9));
    }
    // 浜ぎわにも、数か所
    for (let i = 0; i < 30 && mounds.size < 30; i++) {
      const z = R(-300, 420);
      const x = shoreX(z) - R(2, 14);
      if (roadDist(x, z) < wall + 4) continue;
      reef(x, z, R(1.0, 1.6));
    }
    // 水の中で暗くならないよう、わずかに自分で光らせる
    const coralMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: '#4a1a2a', emissiveIntensity: 0.35, side: THREE.DoubleSide });
    add(mounds.build(rockGeometry(), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }), true, true, 260));
    add(stag.build(staghornGeometry(), coralMat, false, false, 260));
    add(table.build(tableCoralGeometry(), coralMat, false, false, 260));
    add(brain.build(brainCoralGeometry(), coralMat, false, false, 260));
    add(fan.build(fanCoralGeometry(), coralMat, false, false, 260));
  }

  // ---------- 浜のこもの：サーフボード・ビーチボール・浮き輪（スタート・ゴール付近が多め）----------
  {
    const boards = new Bag();
    const balls = new Bag();
    const rings = new Bag();
    const boardCols = ['#ff7aa8', '#4fd0d8', '#ffd04a', '#ff9a4a', '#8e7bff'];
    for (let i = 0; i < 500 && (boards.size < 16 || balls.size < 10 || rings.size < 8); i++) {
      const near = rand() < 0.8;
      const t = near ? (rand() < 0.5 ? R(0, 0.15) : R(0.92, 1)) : rand();
      const p = track.place(t, (rand() < 0.5 ? -1 : 1) * R(wall + 3.5, wall + 13));
      if (isWater(p.x, p.z) || p.x < shoreX(p.z) + 3) continue;
      const y = groundH(p.x, p.z);
      const k = rand();
      if (k < 0.45 && boards.size < 16) boards.add(mat4(p.x, y + 0.85, p.z, R(0, TAU), 1, 1, 1, R(-0.22, 0.22), R(-0.22, 0.22)), boardCols[Math.floor(rand() * boardCols.length)]);
      else if (k < 0.75 && balls.size < 10) balls.add(mat4(p.x, y + 0.34, p.z, R(0, TAU), 1));
      else if (rings.size < 8) rings.add(mat4(p.x, y + 0.14, p.z, R(0, TAU), 1));
    }
    add(boards.build(surfboardGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }), true, false, 220));
    add(balls.build(beachBallGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 }), true, false, 220));
    add(rings.build(floatRingGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), true, false, 220));
  }

  // ---------- 岩（岬の崖・水ぎわ）と灯台 ----------
  {
    const rocks = new Bag();
    const rockCols = ['#b48e7a', '#a37f72', '#c49d84', '#8f7268'];
    // 岬のふちの岩の崖
    for (let i = 0; i < 70; i++) {
      const a = R(0, TAU);
      const r = R(26, 44);
      const x = cape.x + Math.cos(a) * r, z = cape.y + Math.sin(a) * r * 0.9;
      if (roadDist(x, z) < wall + 4) continue;
      const s = R(3, 7.5);
      rocks.add(mat4(x, groundH(x, z) - s * 0.3, z, R(0, TAU), s * R(0.8, 1.3), s * R(0.6, 1.2), s), rockCols[Math.floor(rand() * 4)]);
    }
    // 水ぎわの岩
    for (let i = 0; i < 40; i++) {
      const z = R(-300, 420);
      const x = shoreX(z) - R(-2, 18);
      if (roadDist(x, z) < wall + 5) continue;
      const s = R(0.8, 3.2);
      rocks.add(mat4(x, Math.min(SEA_Y, groundH(x, z)) - s * 0.35, z, R(0, TAU), s * R(0.8, 1.4), s * R(0.5, 1), s), rockCols[Math.floor(rand() * 4)]);
    }
    add(rocks.build(rockGeometry(), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }), true, true, 700));
    // 岬の上の緑と花
    const tops = new Bag();
    for (let i = 0; i < 26; i++) {
      const x = cape.x + R(-24, 24), z = cape.y + R(-22, 18);
      if (roadDist(x, z) < wall + 3) continue;
      const s = R(2, 4);
      tops.add(mat4(x, groundH(x, z) + s * 0.25, z, R(0, TAU), s * 1.1, s * 0.7, s * 0.95), ['#ffffff', '#dcffc8', '#e8ffe0'][Math.floor(rand() * 3)]);
    }
    add(tops.build(bushGeo, bushMat, false, false, 700));
    group.add(lighthouse(cape.x - 14, groundH(cape.x - 14, cape.y + 4), cape.y + 4));
  }

  // ---------- 木の桟橋（浜から海へ）----------
  {
    const deck = new Bag();
    const piles = new Bag();
    const z0 = -78;
    const xStart = shoreX(z0) + 4;
    for (let x = xStart; x > xStart - 90; x -= 1.0) {
      deck.add(mat4(x, 1.15, z0, 0, 1, 1, 1), rand() < 0.2 ? '#b98e66' : '#cfa27a');
    }
    for (let x = xStart; x > xStart - 90; x -= 4.5) {
      for (const s of [-1, 1]) piles.add(mat4(x, -2, z0 + s * 1.6, 0, 1, 1, 1));
    }
    const wood = driftwoodTexture();
    add(deck.build(new THREE.BoxGeometry(0.9, 0.12, 3.6), new THREE.MeshStandardMaterial({ map: wood, color: '#ffffff', roughness: 0.85 }), true, true, 700));
    add(piles.build(new THREE.CylinderGeometry(0.18, 0.2, 4.3, 7).translate(0, 1.3, 0), new THREE.MeshStandardMaterial({ map: wood, color: '#8f6c50', roughness: 0.9 }), true, false, 700));
  }

  // ---------- 赤白の矢印看板（カーブの外がわ）----------
  {
    const boards = new Bag();
    const legs = new Bag();
    const N = 200;
    for (let i = 0; i < N; i++) {
      const t = i / N;
      const ta = track.tangentAt(t - 0.01), tb = track.tangentAt(t + 0.01);
      const turn = ta.x * tb.z - ta.z * tb.x; // + = 右へ曲がる
      if (Math.abs(turn) < 0.18 || i % 4) continue;
      const side = turn > 0 ? 1 : -1; // カーブの外がわ（lateral は + が左）
      const p = track.place(t, side * (wall + 1.6));
      if (isWater(p.x, p.z)) continue;
      const tan = track.tangentAt(t);
      const yaw = Math.atan2(-tan.x, -tan.z) + side * 0.25;
      const y = groundH(p.x, p.z);
      // 矢印は右向き。左カーブでは看板を上下さかさまにして、左向きにする
      boards.add(mat4(p.x, y + 1.25, p.z, yaw, 1, 1, 1, 0, turn > 0 ? 0 : Math.PI));
      legs.add(mat4(p.x, y, p.z, yaw, 1, 1, 1));
    }
    const geo = new THREE.BoxGeometry(2.4, 0.9, 0.12);
    const tex = chevronTexture();
    add(boards.build(geo, [new THREE.MeshStandardMaterial({ color: '#f2ece2' }), new THREE.MeshStandardMaterial({ color: '#f2ece2' }), new THREE.MeshStandardMaterial({ color: '#f2ece2' }), new THREE.MeshStandardMaterial({ color: '#f2ece2' }), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })], true, false, 300));
    const leg = mergeGeometries([new THREE.CylinderGeometry(0.06, 0.06, 1.3, 6).translate(-0.8, 0.65, 0), new THREE.CylinderGeometry(0.06, 0.06, 1.3, 6).translate(0.8, 0.65, 0)]);
    add(legs.build(leg, new THREE.MeshStandardMaterial({ color: '#8c6a50' }), true, false, 300));
  }

  // ---------- 貝殻のゲート（浅瀬の入り口）----------
  {
    const t = 0.175;
    const gate = shellGate(hw);
    const tan = track.tangentAt(t);
    track.place(t, 0, gate.position);
    gate.position.y = -0.05;
    gate.rotation.y = Math.atan2(tan.x, tan.z);
    group.add(gate);
  }

  // ---------- 遠くの帆かけ舟（動かない。夕もやにかすむ）----------
  {
    const boats = new Bag();
    for (const [x, z, s] of [
      [-210, -120, 2.4],
      [-330, 160, 3.0],
      [-260, 330, 2.2],
      [-430, -260, 3.4],
      [-380, 40, 2.6],
    ]) {
      boats.add(mat4(x, SEA_Y, z, R(0, TAU), s));
    }
    add(boats.build(boatGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true }), false, false, 1400));
  }

  // ダッシュ板
  const pads = dashPads(track);
  group.add(pads.obj);

  // ---------- カモメ（海の上をまわって、羽ばたく。10 羽ぶんの行列を毎フレーム更新するだけ）----------
  const BIRDS = 10;
  const birdMat = new THREE.MeshBasicMaterial({ color: '#4b3447', side: THREE.DoubleSide });
  birdMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += sin(uTime * 11.0 + float(gl_InstanceID) * 1.7) * abs(position.x) * 0.45;');
  };
  birdMat.customProgramCacheKey = () => 'sunsetGull';
  const birds = new THREE.InstancedMesh(birdGeometry(), birdMat, BIRDS);
  birds.frustumCulled = false;
  group.add(birds);
  const flock = Array.from({ length: BIRDS }, () => ({
    cx: R(-140, -30),
    cz: R(-260, 380),
    r: R(18, 55),
    h: R(14, 34),
    w: R(0.12, 0.25) * (rand() < 0.5 ? -1 : 1),
    ph: R(0, TAU),
    sc: R(1.4, 2.2),
  }));
  const _bp = new THREE.Vector3();
  const _bs = new THREE.Vector3();
  const _bq = new THREE.Quaternion();
  const _bm = new THREE.Matrix4();
  let flockClock = 0;
  const flyBirds = (dt: number) => {
    flockClock += dt;
    flock.forEach((b, i) => {
      const a = b.ph + flockClock * b.w;
      const sg = Math.sign(b.w);
      _bp.set(b.cx + Math.cos(a) * b.r, b.h + Math.sin(flockClock * 0.7 + i) * 1.5, b.cz + Math.sin(a) * b.r);
      // 進む向き（円の接線）に体を向けて、まわる側へ少しかたむける
      _bq.setFromEuler(_e.set(0, Math.atan2(-Math.sin(a) * sg, Math.cos(a) * sg), 0.25 * sg, 'YXZ'));
      birds.setMatrixAt(i, _bm.compose(_bp, _bq, _bs.setScalar(b.sc)));
    });
    birds.instanceMatrix.needsUpdate = true;
  };
  flyBirds(0);

  // ---------- 動かすもの ----------
  const updaters: ((dt: number) => void)[] = [pads.update, flyBirds];
  let lod: { m: THREE.Object3D; c: THREE.Vector3; r: number; d: number }[] | null = null;
  return {
    group,
    static: stat,
    update(dt, camera) {
      for (const u of updaters) u(dt);
      if (!lod) {
        lod = [];
        stat.updateMatrixWorld(true);
        stat.traverse((o) => {
          const im = o as THREE.InstancedMesh;
          if (!im.isInstancedMesh || !im.userData.maxDist) return;
          im.computeBoundingSphere();
          const bs = im.boundingSphere!;
          lod!.push({ m: im, c: bs.center.clone().applyMatrix4(im.matrixWorld), r: bs.radius, d: im.userData.maxDist });
        });
      }
      const cp = camera.position;
      for (const e of lod) e.m.visible = e.c.distanceTo(cp) - e.r < e.d;
    },
  };
}

// ================= 形の作り方 =================

// ヤシの幹：根元が太く、上へ細くなりながら少し反る。節（輪）の凹凸と、てっぺんのヤシの実
const PALM_H = 8.5;
function trunkTopMatrix(x: number, y: number, z: number, yaw: number, s: number, sy: number, lean: number): THREE.Matrix4 {
  // 幹のてっぺん（そりの分 x へずれる）を、置いたときと同じ順（大きさ → z 回りの傾き → 向き）で動かす
  const top = new THREE.Vector3(PALM_H * 0.08 * s, PALM_H * s * sy, 0)
    .applyAxisAngle(new THREE.Vector3(0, 0, 1), lean)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return new THREE.Matrix4().compose(new THREE.Vector3(x + top.x, y + top.y, z + top.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(s, s, s));
}

function palmTrunkGeometry(): THREE.BufferGeometry {
  const RS = 7, HS = 12;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  for (let j = 0; j <= HS; j++) {
    const f = j / HS;
    const y = f * PALM_H;
    const bend = f * f * PALM_H * 0.08; // 上へいくほど反る
    const ring = 1 + 0.07 * Math.max(0, Math.sin(f * 60)); // 節のでこぼこ
    const flare = 1 + 0.55 * Math.exp(-f * 16); // 根もとは、地面に向かって少し広がる
    const r = (0.34 - 0.14 * f) * ring * flare;
    for (let i = 0; i <= RS; i++) {
      const a = (i / RS) * TAU;
      pos.push(Math.cos(a) * r + bend, y, Math.sin(a) * r);
      c.set(f < 0.08 ? '#8a6a52' : '#a88262').lerp(new THREE.Color('#c9a27c'), (Math.sin(f * 60) * 0.5 + 0.5) * 0.35);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < HS; j++) {
    for (let i = 0; i < RS; i++) {
      const a = j * (RS + 1) + i, b = a + RS + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // 幹の傾きは、置くときの z 回りの回転で（mat4 の rz）
  // ヤシの実（てっぺんのすぐ下）
  const nuts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + 0.3;
    const sph = new THREE.SphereGeometry(0.3, 5, 3).translate(Math.cos(a) * 0.34 + PALM_H * 0.08, PALM_H - 0.25 - (k % 2) * 0.18, Math.sin(a) * 0.34);
    const n = sph.getAttribute('position').count;
    const cc: number[] = [];
    for (let i = 0; i < n; i++) cc.push(0.42, 0.32, 0.2);
    sph.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    sph.deleteAttribute('uv');
    nuts.push(sph.toNonIndexed());
  }
  return mergeGeometries([g.toNonIndexed(), ...nuts]);
}

// ヤシの葉の冠：外へ弓なりにたれる葉が 10 枚
function palmCrownGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const NF = 13, SEG = 5, LEN = 4.8, W = 2.0;
  for (let k = 0; k < NF; k++) {
    const yaw = (k / NF) * TAU + (k % 2) * 0.2;
    const up = k % 3 === 0 ? 0.55 : 0.25; // 上向きの葉も少し
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const f = i / SEG;
      const d = f * LEN;
      const h = Math.sin(f * Math.PI * 0.55) * up * LEN * 0.5 - f * f * LEN * 0.55; // 上がってから、たれる
      const w = W * (0.35 + 0.65 * Math.sin(Math.min(1, f * 1.15) * Math.PI)) * 0.5;
      for (const s of [-1, 1]) {
        pos.push(d, h + s * 0 - Math.abs(s) * w * 0.15, s * w); // 葉は少しV字に
        uv.push(s < 0 ? 0 : 1, f);
      }
    }
    for (let i = 0; i < SEG; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.rotateY(yaw);
    g.computeVertexNormals();
    parts.push(g);
  }
  return mergeGeometries(parts);
}

// パラソルの布（ゆるい円すい。ふちが少したれる）
function umbrellaCanopyGeometry(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(2.1, 0.75, 16, 2, true);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const a = Math.atan2(p.getZ(i), p.getX(i));
    if (y < 0) p.setY(i, y - 0.08 * Math.abs(Math.sin(a * 4))); // ふちのフリル
  }
  g.computeVertexNormals();
  return g;
}

// 岩（でこぼこの多面体）
function rockGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.getAttribute('position');
  const rr = mulberry32(9);
  for (let i = 0; i < p.count; i++) {
    const k = 0.8 + rr() * 0.35;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

// 白い灯台（赤い帯と、明かりの灯った頭）
function lighthouse(x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const H = 17;
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const f = i / 10;
    prof.push(new THREE.Vector2(2.2 - 0.9 * f, f * H));
  }
  const body = new THREE.LatheGeometry(prof, 24);
  const p = body.getAttribute('position');
  const col: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const f = p.getY(i) / H;
    const red = (f > 0.3 && f < 0.42) || (f > 0.66 && f < 0.78);
    col.push(...(red ? [0.86, 0.3, 0.32] : [0.98, 0.96, 0.93]));
  }
  body.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
  m.castShadow = true;
  g.add(m);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.3, 20), new THREE.MeshStandardMaterial({ color: '#d9474a', roughness: 0.6 }));
  deck.position.y = H + 0.15;
  g.add(deck);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.6, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2b0').multiplyScalar(2.2) }));
  lamp.position.y = H + 1.1;
  g.add(lamp);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.5, 16), new THREE.MeshStandardMaterial({ color: '#d9474a', roughness: 0.5 }));
  cap.position.y = H + 2.65;
  g.add(cap);
  // 明かりのにじみ
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const cg = c.getContext('2d')!;
  const grd = cg.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,240,190,1)');
  grd.addColorStop(1, 'rgba(255,200,120,0)');
  cg.fillStyle = grd;
  cg.fillRect(0, 0, 64, 64);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.setScalar(9);
  glow.position.y = H + 1.1;
  g.add(glow);
  return g;
}
