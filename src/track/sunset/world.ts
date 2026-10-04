import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../core/random';
import { applyWind } from '../../core/shaders';
import { dashPads, type Landmarks } from '../Landmarks';
import type { Track, TrackProjection } from '../Track';
import { scallopFanGeometry, shellGate, starfishGeometry } from './gate';
import { SEA_Y, oceanMaterial, sandGroundMaterial, shellMaterial, sunsetSkyMaterial } from './materials';
import { chevronTexture, driftwoodTexture, frondTexture, umbrellaTexture } from './textures';

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

  const X0 = -520, X1 = 620, Z0 = -620, Z1 = 660, STEP = 5;
  const NX = Math.round((X1 - X0) / STEP), NZ = Math.round((Z1 - Z0) / STEP);
  const tpos: number[] = [], tuv: number[] = [], tcol: number[] = [], twet: number[] = [];
  const hs = new Float32Array((NX + 1) * (NZ + 1));
  const ds = new Float32Array((NX + 1) * (NZ + 1));
  const grassC = new THREE.Color('#b9c48a');
  const c = new THREE.Color();
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const x = X0 + i * STEP, z = Z0 + j * STEP;
      const { h, wet } = heightAt(x, z);
      const k = j * (NX + 1) + i;
      hs[k] = h;
      ds[k] = x - shoreX(z);
      tpos.push(x, h, z);
      tuv.push(x / 7, z / 7);
      twet.push(wet);
      // 内陸の、草の生えたところ（ヤシ林の下）
      const d = ds[k];
      const g = THREE.MathUtils.smoothstep(d, 45, 90) * (0.5 + 0.5 * Math.sin(x * 0.02 + z * 0.013));
      c.copy(WHITE).lerp(grassC, g * 0.75);
      tcol.push(c.r, c.g, c.b);
    }
  }
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
  tg.setAttribute('color', new THREE.Float32BufferAttribute(tcol, 3));
  tg.setAttribute('aWet', new THREE.Float32BufferAttribute(twet, 1));
  tg.setIndex(tidx);
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, sandGroundMaterial());
  terrain.receiveShadow = true;
  group.add(terrain);

  // 海面（水深を頂点に持たせる）
  const spos: number[] = [], sdep: number[] = [], sshore: number[] = [];
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const k = j * (NX + 1) + i;
      spos.push(X0 + i * STEP, SEA_Y, Z0 + j * STEP);
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
    const spots: [number, number][] = [];
    const tryPalm = (x: number, z: number, s: number) => {
      if (isWater(x, z - 0) || x < shoreX(z) + 3) return;
      if (roadDist(x, z) < wall + 2.5) return;
      for (const [px, pz] of spots) if ((px - x) ** 2 + (pz - z) ** 2 < 16) return;
      spots.push([x, z]);
      const y = groundH(x, z) - 0.1;
      const yaw = R(0, TAU);
      const lean = R(0.05, 0.22);
      const sy = R(0.9, 1.15);
      trunks.add(mat4(x, y, z, yaw, s, s * sy, s, 0, lean));
      // 葉の冠は幹のてっぺんに（幹のかたむきに合わせて）
      crowns.add(trunkTopMatrix(x, y, z, yaw, s, sy, lean));
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
    const trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    add(trunks.build(palmTrunkGeometry(), trunkMat, true, false, 520));
    const frondMat = applyWind(new THREE.MeshLambertMaterial({ map: frondTexture(), alphaTest: 0.35, side: THREE.DoubleSide, color: '#f4ffe0', emissive: '#22381a' }), 0.18, 3, 'y');
    add(crowns.build(palmCrownGeometry(), frondMat, true, false, 520));
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
    const bushes = new Bag();
    const flowers = new Bag();
    const leafy = ['#3f8a4a', '#4f9a50', '#367a46'];
    const petals = ['#ff3d4f', '#ff5a7a', '#ff8a3d', '#ff6f9a', '#ffd04a'];
    walk(0, 7, (p, yaw) => {
      for (const side of [-1, 1]) {
        if (rand() < 0.55) continue;
        const lat = side * (wall + R(1.4, 4));
        const x = p.x + Math.cos(yaw) * lat, z = p.z - Math.sin(yaw) * lat;
        if (isWater(x, z) || x < shoreX(z) + 1) continue;
        const y = groundH(x, z);
        const s = R(0.9, 1.6);
        bushes.add(mat4(x, y + s * 0.45, z, R(0, TAU), s * 1.2, s * 0.8, s), leafy[Math.floor(rand() * 3)]);
        const n = 4 + Math.floor(rand() * 5);
        for (let i = 0; i < n; i++) {
          const a = R(0, TAU), el = R(0.25, 1.1);
          const fx = x + Math.cos(a) * Math.cos(el) * s * 1.15, fz = z + Math.sin(a) * Math.cos(el) * s;
          const fy = y + s * 0.45 + Math.sin(el) * s * 0.78;
          flowers.add(mat4(fx, fy, fz, a, R(0.22, 0.32), R(0.22, 0.32), R(0.22, 0.32), -el, 0), petals[Math.floor(rand() * petals.length)]);
        }
      }
    });
    add(bushes.build(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: false }), true, false, 300));
    add(flowers.build(hibiscusGeometry(), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, side: THREE.DoubleSide }), false, false, 160));
  }

  // ---------- 貝殻とヒトデ（砂の上）・サンゴ（浅瀬）----------
  {
    const shells = new Bag();
    const stars = new Bag();
    const corals = new Bag();
    for (let i = 0; i < 420; i++) {
      const t = rand();
      const p = track.place(t, (rand() < 0.5 ? -1 : 1) * R(wall + 0.8, wall + 12));
      if (isWater(p.x, p.z)) continue;
      const y = groundH(p.x, p.z) + 0.02;
      if (rand() < 0.75) shells.add(mat4(p.x, y, p.z, R(0, TAU), R(0.18, 0.32), R(0.18, 0.32), R(0.18, 0.32), -Math.PI / 2 + R(-0.2, 0.2)), ['#fff1e6', '#ffd6d6', '#ffe9c9', '#f6d8ff'][Math.floor(rand() * 4)]);
      else stars.add(mat4(p.x, y + 0.04, p.z, R(0, TAU), R(0.22, 0.38), R(0.22, 0.38), R(0.22, 0.38), -Math.PI / 2), ['#ff8a70', '#ff6f8a', '#ffb36a'][Math.floor(rand() * 3)]);
    }
    // 浅瀬のサンゴ（道から少し離れた水の中）
    for (let i = 0; i < 70; i++) {
      const t = R(0.17, 0.35);
      const p = track.place(t, (rand() < 0.5 ? -1 : 1) * R(wall + 3, wall + 22));
      if (!isWater(p.x, p.z)) continue;
      const y = Math.max(-1.2, groundH(p.x, p.z));
      corals.add(mat4(p.x, y, p.z, R(0, TAU), R(0.7, 1.4)), ['#ff8fae', '#ff7a8a', '#c89bff', '#ffb38a'][Math.floor(rand() * 4)]);
    }
    add(shells.build(scallopFanGeometry(0.05, 1, 9, 0.12, 0.04), shellMaterial(false), false, false, 110));
    add(stars.build(starfishGeometry(1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }), false, false, 110));
    add(corals.build(coralGeometry(), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55 }), false, false, 260));
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
      tops.add(mat4(x, groundH(x, z) + s * 0.25, z, R(0, TAU), s * 1.3, s * 0.6, s), ['#4f9a50', '#5aa85a', '#3f8a4a'][Math.floor(rand() * 3)]);
    }
    add(tops.build(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: '#ffffff' }), true, false, 700));
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

  // ダッシュ板
  const pads = dashPads(track);
  group.add(pads.obj);

  // ---------- 動かすもの ----------
  const updaters: ((dt: number) => void)[] = [pads.update];
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
  const RS = 8, HS = 18;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  for (let j = 0; j <= HS; j++) {
    const f = j / HS;
    const y = f * PALM_H;
    const bend = f * f * PALM_H * 0.08; // 上へいくほど反る
    const ring = 1 + 0.07 * Math.max(0, Math.sin(f * 60)); // 節のでこぼこ
    const r = (0.34 - 0.14 * f) * ring;
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
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 0.3;
    const sph = new THREE.SphereGeometry(0.24, 8, 6).translate(Math.cos(a) * 0.3 + PALM_H * 0.08, PALM_H - 0.25, Math.sin(a) * 0.3);
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
  const NF = 11, SEG = 8, LEN = 4.8, W = 2.0;
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

// ハイビスカスの花（5 枚の花びらの浅いお皿）
function hibiscusGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const pet = new THREE.CircleGeometry(0.55, 8).scale(1, 0.75, 1).translate(0.5, 0, 0);
    pet.rotateX(-Math.PI / 2);
    pet.rotateZ(0.35);
    pet.rotateY((k / 5) * TAU);
    parts.push(pet);
  }
  const g = mergeGeometries(parts);
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

// サンゴ（枝分かれ）
function coralGeometry(): THREE.BufferGeometry {
  const rr = mulberry32(17);
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 8; k++) {
    const h = 0.6 + rr() * 0.9;
    const b = new THREE.CylinderGeometry(0.07, 0.12, h, 6).translate(0, h / 2, 0);
    b.rotateZ((rr() - 0.5) * 1.0);
    b.rotateX((rr() - 0.5) * 1.0);
    b.translate((rr() - 0.5) * 0.9, 0, (rr() - 0.5) * 0.9);
    parts.push(b);
    const tip = new THREE.SphereGeometry(0.12, 6, 4).translate(0, h, 0);
    parts.push(tip);
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
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
