import * as THREE from 'three';
import { mulberry32 } from '../../core/random';
import { SUN_DIR, globalUniforms } from '../../core/shaders';
import { dashPads, type Landmarks } from '../Landmarks';
import type { Track } from '../Track';
import { bearSign, caneArch, cookieBridge } from './gate';
import {
  appleGeometry,
  capGeometry,
  caneGeometry,
  cherryGeometry,
  cupcakeGeometry,
  discGeometry,
  donutGeometry,
  dripGeometry,
  gumdropGeometry,
  halfDiscGeometry,
  iceCreamGeometry,
  lollipopHeadGeometry,
  mat4,
  mergeParts,
  stickGeometry,
  strawberryGeometry,
  swirlGeometry,
  tierGeometry,
  towerBodyGeometry,
  towerCrownGeometry,
} from './geometry';
import {
  cakeMaterial,
  candyGroundMaterial,
  candyTopMaterial,
  candyRoadMaterial,
  candySkyMaterial,
  caneMaterial,
  chocolateMaterial,
  cookieMaterial,
  creamMaterial,
  glazeMaterial,
  gumdropMaterial,
  towerMaterial,
} from './materials';
import { CAKE_TILE, SPRINKLE_COLORS, candyGroundTextures, fruitSliceTexture, lollipopTexture, repeatTex, strawberryTexture } from './textures';

// スイーツパラダイスの世界。動かない物は static に入れる（あとで区画分けして、画面外は描かない）
const TAU = Math.PI * 2;
const WHITE = new THREE.Color('#ffffff');

export const CANDY_FOG = '#ffe2ea';
export const CANDY_LIGHTS = { sky: '#fff0dc', ground: '#ffb0c4', hemi: 1.25, sun: '#fff0d0', sunI: 2.9 };

export interface CandyWorld extends Landmarks {
  static: THREE.Group;
}

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
    if (maxDist) im.userData.maxDist = maxDist; // これより遠い区画は描かない（update で判定）
    return im;
  }
}

const SPONGE = ['#7d4a2e', '#7d4a2e', '#7d4a2e', '#6e3f26', '#7d4a2e', '#ffe6b0', '#ffb5c6', '#c2e49c', '#e6a862', '#fff0a2'];
const FROST = ['#fffaf4', '#ff9ec4', '#fffaf4', '#a8efd3', '#ffd0e0', '#d4b8ff', '#7b4122', '#fff1a0', '#ffc9a0', '#ff82b4'];
const ROOFS = ['#ff8fb9', '#ff6d92', '#a8efd3', '#d4b8ff', '#ffd86a', '#8fd2ff', '#ff9a78'];
const WALLS = ['#fff4ec', '#ffd3e0', '#d8f6e9', '#e6dcff', '#ffe6cc', '#fffaf4'];
const GUM = ['#ff5f8f', '#ff9a3a', '#ffd23a', '#4fd36a', '#4aa8ff', '#b07bff', '#ff7ac8', '#35d4c4'];

export function buildCandyWorld(track: Track): CandyWorld {
  const group = new THREE.Group();
  const stat = new THREE.Group();
  group.add(stat);
  const rand = mulberry32(31415);
  const R = (a: number, b: number) => a + rand() * (b - a);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)];
  const hw = track.def.halfWidth;
  const wall = hw + track.def.wallOffset;
  const L = track.length;
  const box = new THREE.Box3().setFromPoints(track.pts);
  const center = box.getCenter(new THREE.Vector3());
  const addStatic = (o: THREE.Object3D | null) => {
    if (o) stat.add(o);
  };

  // ---------- 空・地面・雲 ----------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 48, 24), candySkyMaterial(SUN_DIR));
  sky.renderOrder = -1;
  group.add(sky);

  const gt = candyGroundTextures();
  const reps = 3200 / 48;
  gt.map.repeat.set(reps, reps);
  gt.normal.repeat.set(reps, reps);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200).rotateX(-Math.PI / 2), candyGroundMaterial());
  ground.position.set(center.x, 0, center.z);
  ground.receiveShadow = true;
  group.add(ground);

  group.add(clouds());

  // ---------- コースぞいを歩くための道具 ----------
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  // コースにそって横ずれ lat の線上を、step ごとに呼ぶ（外側のカーブでも間があかない）
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
  // ケーキの階段状の崖（テラス）が立つ場所。ほかの物はここを避ける
  const zones: { x: number; z: number; r: number }[] = [];
  const blocked = (p: THREE.Vector3, margin = 2) => {
    for (const z of zones) if ((z.x - p.x) ** 2 + (z.z - p.z) ** 2 < (z.r + margin) ** 2) return true;
    return false;
  };
  // 道のまわりのランダムな場所（道のふちから minE〜maxE m）。ほかの区間の道に近い所は避ける
  const nearSpot = (minE: number, maxE: number, tries = 40): { p: THREE.Vector3; t: number; side: number; e: number } | null => {
    for (let k = 0; k < tries; k++) {
      const t = rand(), side = rand() < 0.5 ? -1 : 1, e = R(minE, maxE);
      const p = track.place(t, side * (wall + e), new THREE.Vector3());
      if (Math.abs(track.project(p).lateral) > wall + e - 1.2 && !blocked(p, 1.5)) return { p, t, side, e };
    }
    return null;
  };

  // ---------- チョコレートの縄（柵）とクリーム ----------
  const beadBag = new Bag();
  walk(wall + 0.82, 2.3, (p, yaw) => beadBag.add(mat4(p.x, 0.86 + R(-0.03, 0.05), p.z, R(-0.05, 0.05), yaw + R(-0.05, 0.05), R(-0.12, 0.12), 1, R(0.94, 1.1), 1)));
  walk(-(wall + 0.82), 2.3, (p, yaw) => beadBag.add(mat4(p.x, 0.86 + R(-0.03, 0.05), p.z, R(-0.05, 0.05), yaw + R(-0.05, 0.05), R(-0.12, 0.12), 1, R(0.94, 1.1), 1)));
  const beads = beadBag.build(new THREE.CapsuleGeometry(0.85, 1.3, 3, 10).rotateX(Math.PI / 2), chocolateMaterial(), true, false, 230);
  addStatic(beads);

  // 縄の根もとにたまった白いクリームと、柵の上にのったクリーム
  const creamBag = new Bag();
  for (const side of [-1, 1]) {
    walk(side * (wall - 0.05), 1, (p, yaw) => {
      if (rand() > 0.17) return;
      const k = R(0.6, 1.5);
      creamBag.add(mat4(p.x, R(0.12, 0.3), p.z, 0, yaw, 0, k * R(0.7, 1.1), R(0.35, 0.6), k * R(1.1, 2.2)));
    });
    walk(side * (wall + 0.82), 1, (p, yaw) => {
      if (rand() > 0.045) return;
      const k = R(0.5, 0.95);
      creamBag.add(mat4(p.x, 1.5, p.z, 0, yaw, 0, k, k * 0.62, k * R(1.2, 1.8)));
    });
  }
  addStatic(creamBag.build(new THREE.SphereGeometry(1, 10, 6), creamMaterial(), true, false, 150));

  // 道のふちにたまった、とけたチョコ
  const puddleBag = new Bag();
  for (let i = 0; i < 70; i++) {
    const t = rand(), side = rand() < 0.5 ? -1 : 1;
    const p = track.place(t, side * (hw - R(0.2, 3.5)), new THREE.Vector3());
    const tan = track.tangentAt(t);
    const k = R(0.8, 2.4);
    puddleBag.add(mat4(p.x, 0.045, p.z, 0, Math.atan2(tan.x, tan.z), 0, k, 1, k * R(1.2, 2.6)));
  }
  addStatic(puddleBag.build(new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#4d230f', roughness: 0.3, envMapIntensity: 0.4 }), false, true, 130));

  // ---------- 道のまわりのお菓子 ----------
  const lolly = { pink: new Bag(), teal: new Bag(), rainbow: new Bag() };
  const stickBag = new Bag();
  const caneBag = new Bag();
  const gumBag = new Bag();
  const berryBag = new Bag();
  const mountBag = new Bag(); // いちごの下のホイップ
  const cherryBag = new Bag();
  const appleBag = new Bag();
  const cupBags = new Map<string, Bag>();
  const donutBags = new Map<string, Bag>();
  const iceBags = new Map<string, Bag>();
  const cookieBag = new Bag();
  const sliceBags: Record<string, Bag> = { orange: new Bag(), lemon: new Bag(), kiwi: new Bag(), grapefruit: new Bag(), melon: new Bag() };
  const sprinkleBag = new Bag();
  const dollopBag = new Bag();
  const bag = (m: Map<string, Bag>, k: string) => {
    let b = m.get(k);
    if (!b) m.set(k, (b = new Bag()));
    return b;
  };
  // 道の方を向く角度（看板や飾りの顔が道を向くように）
  const faceRoad = (p: THREE.Vector3) => {
    const pr = track.project(p);
    return Math.atan2(pr.point.x - p.x, pr.point.z - p.z);
  };

  const cupSets: [string, string, string][] = [
    ['#ff9ec4', '#ffffff', '#ff7fb2'],
    ['#a8efd3', '#ffffff', '#6fd8b0'],
    ['#fffaf4', '#ffd0e0', '#ffffff'],
    ['#7b4122', '#fff1a0', '#ffffff'],
    ['#d4b8ff', '#ffffff', '#b494ff'],
    ['#ffd86a', '#ff9ec4', '#ffffff'],
  ];
  const donutSets: [string, string][] = [
    ['#ff9ec4', '#e6b06a'],
    ['#7b4122', '#e6b06a'],
    ['#a8efd3', '#e6b06a'],
    ['#fffaf4', '#e6b06a'],
    ['#ffd86a', '#e6b06a'],
  ];
  const iceSets: [string, string][] = [
    ['#ffb3cf', '#a8efd3'],
    ['#fff1a0', '#ffb3cf'],
    ['#8a5236', '#fffaf4'],
    ['#b8a0ff', '#ffd0a8'],
  ];

  // 置く場所ごとの「その場の飾り」を、種類をふって置く（p.y は置く面の高さ）
  const decorate = (p: THREE.Vector3, face: number, kind: number, scale = 1) => {
    const y0 = p.y;
    switch (kind) {
      case 0: {
        // ペロペロキャンディ
        const k = pick(['pink', 'teal', 'rainbow'] as const);
        const rho = R(1.8, 3.4) * scale;
        const stickH = rho * R(1.8, 2.8) + 2;
        stickBag.add(mat4(p.x, y0, p.z, 0, 0, 0, rho * 0.8, stickH, rho * 0.8));
        lolly[k].add(mat4(p.x, y0 + stickH + rho * 0.85, p.z, R(-0.25, 0.25), face + R(-0.5, 0.5), R(-0.25, 0.25), rho));
        break;
      }
      case 1:
        // キャンディケーン
        caneBag.add(mat4(p.x, y0, p.z, R(-0.06, 0.06), R(0, TAU), R(-0.06, 0.06), R(0.5, 1.1) * scale));
        break;
      case 2: {
        // ガムドロップ
        const gs = R(1, 2.5) * scale;
        gumBag.add(mat4(p.x, y0, p.z, 0, R(0, TAU), 0, gs, gs * R(0.85, 1.25), gs), pick(GUM));
        break;
      }
      case 3: {
        // いちごとホイップ
        const s2 = R(1.3, 2.6) * scale;
        mountBag.add(mat4(p.x, y0 - 0.05, p.z, 0, R(0, TAU), 0, s2 * 1.15, s2 * 0.95, s2 * 1.15));
        berryBag.add(mat4(p.x, y0 + s2 * 0.7, p.z, R(-0.2, 0.2), R(0, TAU), R(-0.2, 0.2), s2));
        break;
      }
      case 4: {
        // さくらんぼ・りんご
        const s2 = R(1.2, 2.3) * scale;
        mountBag.add(mat4(p.x, y0 - 0.05, p.z, 0, R(0, TAU), 0, s2 * 0.95, s2 * 0.75, s2 * 0.95));
        if (rand() < 0.6) cherryBag.add(mat4(p.x, y0 + s2 * 0.55, p.z, 0, R(0, TAU), 0, s2));
        else appleBag.add(mat4(p.x, y0 + s2 * 0.5, p.z, 0, R(0, TAU), 0, s2 * 1.1));
        break;
      }
      case 5: {
        // カップケーキ
        const k = pick(cupSets);
        bag(cupBags, k.join()).add(mat4(p.x, y0, p.z, 0, R(0, TAU), 0, R(1.4, 2.8) * scale));
        break;
      }
      case 6: {
        // ドーナツ（半分うまっている）
        const k = pick(donutSets);
        const s2 = R(2, 3.6) * scale;
        bag(donutBags, k.join()).add(mat4(p.x, y0 + s2 * 0.8, p.z, Math.PI / 2 + R(-0.25, 0.25), R(0, TAU), 0, s2));
        break;
      }
      case 7: {
        // クッキー（立てかけてある）
        const r = R(1.8, 3.6) * scale;
        cookieBag.add(mat4(p.x, y0 + r * 0.88, p.z, R(-0.3, 0.1), face + R(-0.9, 0.9), 0, r));
        break;
      }
      case 8: {
        // フルーツの輪切り
        const k = pick(['orange', 'lemon', 'kiwi', 'grapefruit', 'melon']);
        const r = R(1.8, 3.8) * scale;
        const y = k === 'melon' ? y0 : y0 + r * 0.86;
        sliceBags[k].add(mat4(p.x, y, p.z, R(-0.25, 0.1), face + R(-0.8, 0.8), 0, r));
        break;
      }
      case 9: {
        // アイスクリーム
        const k = pick(iceSets);
        bag(iceBags, k.join()).add(mat4(p.x, y0, p.z, R(-0.12, 0.12), R(0, TAU), R(-0.12, 0.12), R(1.4, 2.5) * scale));
        break;
      }
      default: {
        // ホイップのしぼり
        const s2 = R(1.2, 3.2) * scale;
        dollopBag.add(mat4(p.x, y0 - 0.05, p.z, 0, R(0, TAU), 0, s2));
      }
    }
  };
  // 種類ごとの出る割合（0=ペロペロ 1=ケーン 2=ガム 3=いちご 4=さくらんぼ/りんご 5=カップケーキ 6=ドーナツ 7=クッキー 8=果物 9=アイス 10=ホイップ）
  const kinds = [0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 8, 9, 10, 10];
  // 目玉の飾りの足もとには、ほかの物を置かない（橋の両はしにはケーキの柱をたてる）
  const keepOut: { x: number; z: number; r: number }[] = [];
  const bridgeT = 0.255;
  const bridgePillars: { x: number; z: number }[] = [];
  {
    const tan = track.tangentAt(bridgeT), nrm = track.normalAt(bridgeT), c0 = track.pointAt(bridgeT);
    for (const s of [-1, 1]) {
      const p = c0.clone().addScaledVector(nrm, s * (hw + 25.5));
      bridgePillars.push({ x: p.x, z: p.z });
    }
    for (let d = -32; d <= 32; d += 8) {
      const p = c0.clone().addScaledVector(nrm, d);
      keepOut.push({ x: p.x, z: p.z, r: 7 });
    }
    void tan;
    for (const t of [0.19, 0.325, 0.565, 0.865, 0.0]) {
      for (const s of [-1, 1]) {
        const p = track.place(t, s * (hw + 8), new THREE.Vector3());
        keepOut.push({ x: p.x, z: p.z, r: t === 0 ? 14 : 6 });
      }
    }
  }
  // ---- ケーキの階段状の崖（テラス）の場所 ----
  type Terrace = { side: number; offs: number[]; hs: number[]; ts: number[]; tints: string[]; tops: string[] };
  const terraces: Terrace[] = [];
  const stepT = 2.4 / L; // 2.4m ごとに切る
  const planTerrace = (which: 'out' | 'in', t0: number, t1: number, preset: 'tall' | 'low') => {
    const offs = (preset === 'tall' ? [11, 25, 41, 59] : [10, 22, 38]).map((o) => wall + o);
    const hs = preset === 'tall' ? [5, 11, 18] : [4.5, 9.5];
    const ts: number[] = [];
    for (let t = t0; t <= t1; t += stepT) ts.push(((t % 1) + 1) % 1);
    const sideAt = (t: number) => {
      const p = track.pointAt(t), n = track.normalAt(t);
      const inside = (center.x - p.x) * n.x + (center.z - p.z) * n.z > 0 ? 1 : -1;
      return which === 'out' ? -inside : inside;
    };
    const side = sideAt((t0 + t1) / 2);
    const okAt = (t: number) => {
      if (sideAt(t) !== side) return false;
      for (const o of [offs[0], offs[offs.length - 1]]) {
        const p = track.place(t, side * o, new THREE.Vector3());
        if (Math.abs(track.project(p).lateral) < o - 2.5) return false;
        for (const k of keepOut) if ((k.x - p.x) ** 2 + (k.z - p.z) ** 2 < (k.r + 4) ** 2) return false;
      }
      return true;
    };
    let run: number[] = [];
    const flush = () => {
      if (run.length >= 10) {
        terraces.push({ side, offs, hs, ts: run, tints: hs.map(() => pick(SPONGE)), tops: hs.map(() => pick(['#fffaf4', '#ffd0e0', '#fffaf4', '#fff1d8', '#ffc4d8'])) });
        for (let i = 0; i < run.length; i += 3) {
          const p = track.place(run[i], side * ((offs[0] + offs[offs.length - 1]) / 2), new THREE.Vector3());
          zones.push({ x: p.x, z: p.z, r: (offs[offs.length - 1] - offs[0]) / 2 + 3 });
        }
      }
      run = [];
    };
    for (const t of ts) {
      if (okAt(t)) run.push(t);
      else flush();
    }
    flush();
  };
  for (const [which, t0, t1, preset] of [
    ['out', 0.925, 1.08, 'tall'],
    ['in', 0.94, 1.03, 'low'],
    ['out', 0.14, 0.235, 'low'],
    ['in', 0.285, 0.36, 'low'],
    ['out', 0.28, 0.37, 'tall'],
    ['out', 0.385, 0.44, 'low'],
    ['out', 0.5, 0.64, 'tall'],
    ['in', 0.52, 0.6, 'low'],
    ['out', 0.66, 0.79, 'tall'],
    ['in', 0.7, 0.8, 'low'],
    ['out', 0.84, 0.92, 'low'],
  ] as const) {
    planTerrace(which, t0, t1, preset);
  }
  // 崖の上のお菓子
  for (const T of terraces) {
    const n = T.ts.length;
    for (let k = 0; k < T.hs.length; k++) {
      const w = T.offs[k + 1] - T.offs[k] - 5;
      if (w < 3) continue;
      const count = Math.round((n * stepT * L * w) / 95);
      for (let c = 0; c < count; c++) {
        const t = T.ts[Math.floor(rand() * n)];
        const p = track.place(t, T.side * R(T.offs[k] + 2.5, T.offs[k + 1] - 2.5), new THREE.Vector3());
        p.y = T.hs[k] + 0.55;
        decorate(p, faceRoad(p), pick(kinds), 1.15);
      }
    }
  }

  for (let i = 0; i < 440; i++) {
    const near = i < 270;
    const s = near ? nearSpot(2.5, 24) : nearSpot(24, 120);
    if (!s) continue;
    // 道ぞいにはあまり大きな物を置かない（視界をふさがないよう）
    decorate(s.p, faceRoad(s.p), pick(kinds), near ? 0.95 : 1.5);
  }
  // 大きなスプリンクル（地面にころがっている）
  for (let i = 0; i < 1000; i++) {
    const s = nearSpot(1.2, 48);
    if (!s) continue;
    const k = R(0.8, 1.9);
    sprinkleBag.add(mat4(s.p.x, 0.22 * k, s.p.z, R(-0.2, 0.2), R(0, TAU), R(-0.15, 0.15), k), pick(SPRINKLE_COLORS));
  }

  // 道の上にもころがっている、立体のカラースプリンクル（つやと影で、絵よりくっきり見える）
  const roadSprinkleBag = new Bag();
  for (let i = 0; i < 480; i++) {
    const t = rand();
    const p = track.place(t, R(-(hw - 1), hw - 1), new THREE.Vector3());
    const k = R(0.8, 1.5);
    roadSprinkleBag.add(mat4(p.x, 0.24 * k, p.z, R(-0.08, 0.08), R(0, TAU), R(-0.08, 0.08), k), pick(SPRINKLE_COLORS));
  }

  // ---------- 実際に作って追加 ----------
  const lollyHead = lollipopHeadGeometry();
  for (const k of ['pink', 'teal', 'rainbow'] as const) {
    addStatic(
      lolly[k].build(
        lollyHead,
        new THREE.MeshPhysicalMaterial({ map: lollipopTexture(k), roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.4 }),
        true,
        false,
        300,
      ),
    );
  }
  addStatic(stickBag.build(stickGeometry(), new THREE.MeshStandardMaterial({ color: '#fff7ee', roughness: 0.4 }), true, false, 300));
  addStatic(caneBag.build(caneGeometry(10, 1.9, 0.32), caneMaterial(), true, false, 260));
  addStatic(gumBag.build(gumdropGeometry(), gumdropMaterial(), true, false, 210));
  const berryMat = new THREE.MeshPhysicalMaterial({ map: strawberryTexture(), roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 1.1 });
  addStatic(berryBag.build(strawberryGeometry(), berryMat, true, false, 230));
  const swirl = mound();
  addStatic(mountBag.build(swirl, creamMaterial(), true, false, 230));
  addStatic(dollopBag.build(swirl, creamMaterial(), true, false, 180));
  addStatic(cherryBag.build(cherryGeometry(), glazeMaterial(true), true, false, 230));
  addStatic(appleBag.build(appleGeometry(), glazeMaterial(true), true, false, 230));
  for (const [k, b] of cupBags) {
    const [f, a, c] = k.split(',');
    addStatic(b.build(cupcakeGeometry(f, a, c), glazeMaterial(true), true, false, 240));
  }
  for (const [k, b] of donutBags) {
    const [icing, dough] = k.split(',');
    addStatic(b.build(donutGeometry(dough, icing), glazeMaterial(true), true, false, 260));
  }
  for (const [k, b] of iceBags) {
    const [a, c] = k.split(',');
    addStatic(b.build(iceCreamGeometry(a, c), glazeMaterial(true), true, false, 260));
  }
  addStatic(cookieBag.build(discGeometry(0.2), cookieMaterial(), true, false, 260));
  for (const k of Object.keys(sliceBags)) {
    const mat = new THREE.MeshStandardMaterial({ map: fruitSliceTexture(k as 'orange'), roughness: 0.38, envMapIntensity: 0.9 });
    addStatic(sliceBags[k].build(k === 'melon' ? halfDiscGeometry(0.3) : discGeometry(0.22), mat, true, false, 260));
  }
  addStatic(roadSprinkleBag.build(new THREE.CapsuleGeometry(0.2, 1.3, 2, 6).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.25, envMapIntensity: 1.2 }), true, true, 100));
  addStatic(sprinkleBag.build(new THREE.CapsuleGeometry(0.2, 1.3, 2, 6).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.28, envMapIntensity: 1.1 }), true, false, 110));

  // ---------- ケーキの段々・お城・滝 ----------
  const cakes = buildCakeLands();
  for (const o of cakes.statics) addStatic(o);
  group.add(cakes.falls);

  // ---------- 目玉の飾り ----------
  const place = (obj: THREE.Object3D, t: number, lat = 0) => {
    track.place(t, lat, obj.position);
    const tan = track.tangentAt(t);
    obj.rotation.y = Math.atan2(tan.x, tan.z);
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow ||= true;
    });
    return obj;
  };
  // キャンディケーンのアーチ
  for (const t of [0.19, 0.325, 0.565, 0.865]) group.add(place(caneArch(hw), t));
  // ハートの窓のクッキーの橋
  const bridge = place(cookieBridge(hw), bridgeT);
  group.add(bridge);
  // くまの顔の看板（スタートの近くと、ところどころ）
  for (const [t, side] of [[0.935, 1], [0.985, -1], [0.14, -1], [0.4, 1], [0.58, -1], [0.78, 1]] as const) {
    const sign = bearSign();
    const tan = track.tangentAt(t);
    track.place(t, side * (wall + 5.5), sign.position);
    sign.rotation.y = Math.atan2(-tan.x - side * 0.0, -tan.z) + side * 0.35;
    sign.scale.setScalar(1.05);
    group.add(sign);
  }
  // ダッシュ板
  const pads = dashPads(track);
  group.add(pads.obj);

  // ---------- 動かすもの ----------
  const updaters: ((dt: number) => void)[] = [pads.update];
  void globalUniforms;
  // 遠くの小さなお菓子は描かない（霧のかなたで見えないので、描画をぐっと減らせる）
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

  // ================= ここから下は、上で使う作り方 =================

  function clouds(): THREE.InstancedMesh {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const pos = geo.getAttribute('position');
    const col: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      // 下はももいろ、上は白
      const f = THREE.MathUtils.clamp((pos.getY(i) + 1) / 2, 0, 1);
      col.push(1, 0.88 + 0.12 * f, 0.92 + 0.08 * f);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mat = new THREE.MeshLambertMaterial({ color: '#fffaf6', emissive: '#ffdbe6', emissiveIntensity: 0.5, vertexColors: true, fog: false });
    const list: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * TAU + R(0, 0.3);
      const d = R(480, 950);
      const cx = center.x + Math.cos(a) * d, cz = center.z + Math.sin(a) * d, cy = R(70, 230);
      const puffs = 6 + Math.floor(rand() * 6);
      for (let j = 0; j < puffs; j++) {
        const r = R(12, 30) - Math.abs(j - puffs / 2) * 1.3;
        list.push(new THREE.Matrix4().compose(new THREE.Vector3(cx + (j - puffs / 2) * 15 + R(-6, 6), cy + R(0, 8) + Math.max(0, 10 - Math.abs(j - puffs / 2) * 3), cz + R(-14, 14)), q, new THREE.Vector3(r * 1.3, r * 0.8, r)));
      }
    }
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.frustumCulled = false;
    return mesh;
  }

  // ケーキの段々（スポンジ・クリーム・ジャムの層、上にクリームのふた、垂れるクリーム）と、
  // その上のお城・いちご、ピンクの滝、てっぺんを走る道
  function buildCakeLands() {
    const tierBags = new Map<string, { r: number; h: number; bag: Bag }>();
    const capBags = new Map<number, Bag>();
    const dripBag = new Bag();
    const towerBodies = new Map<string, { r: number; h: number; bag: Bag }>();
    const crownBags = new Map<number, Bag>();
    const roofBags = new Map<number, Bag>();
    const roofTipBag = new Bag();
    const flagBag = new Bag();
    const ringRoads: THREE.BufferGeometry[] = [];
    const ringBeads = new Bag();
    const fallPos: number[] = [], fallUv: number[] = [], fallIdx: number[] = [];
    const poolBag = new Bag();
    const foamBag = new Bag();
    const topBerries = new Bag();
    const topMounds = new Bag();
    const topCherries = new Bag();
    const topCups = new Map<string, Bag>();
    const topLolly = { pink: new Bag(), teal: new Bag(), rainbow: new Bag() };
    const topSticks = new Bag();
    const hills = new Bag();

    const spots: { x: number; z: number; r: number }[] = [...keepOut, ...zones];
    const free = (x: number, z: number, r: number, gap = 6) => {
      for (const s of spots) if ((s.x - x) ** 2 + (s.z - z) ** 2 < (s.r + r + gap) ** 2) return false;
      return true;
    };

    const addTier = (x: number, y: number, z: number, r: number, h: number, tint: string, frost: string, withDrips = true) => {
      const key = `${r}_${h}`;
      let e = tierBags.get(key);
      if (!e) tierBags.set(key, (e = { r, h, bag: new Bag() }));
      const rot = R(0, TAU);
      e.bag.add(mat4(x, y, z, 0, rot, 0, 1), tint);
      let c = capBags.get(r);
      if (!c) capBags.set(r, (c = new Bag()));
      c.add(mat4(x, y + h, z, 0, rot, 0, 1), frost);
      if (withDrips) {
        const n = Math.round((TAU * r) / 4.2);
        const a0 = R(0, TAU);
        for (let k = 0; k < n; k++) {
          if (rand() < 0.2) continue;
          const th = a0 + ((k + R(0, 0.8)) / n) * TAU;
          const len = Math.min(R(0.9, 3.6), h * 0.85);
          const w = R(0.8, 1.35);
          dripBag.add(mat4(x + Math.cos(th) * (r + 0.26), y + h + 0.05, z + Math.sin(th) * (r + 0.26), 0, -th, 0, w, len / 2.5, w), frost);
        }
      }
    };

    // 塔（円柱 + 張り出し + しぼりクリームの屋根 + 旗）
    const addTower = (x: number, y: number, z: number, r: number, h: number) => {
      const key = `${r}_${h}`;
      let e = towerBodies.get(key);
      if (!e) towerBodies.set(key, (e = { r, h, bag: new Bag() }));
      e.bag.add(mat4(x, y, z, 0, R(0, TAU), 0, 1), pick(WALLS));
      let c = crownBags.get(r);
      if (!c) crownBags.set(r, (c = new Bag()));
      const wall0 = pick(WALLS);
      c.add(mat4(x, y + h, z, 0, 0, 0, 1), wall0);
      let rb = roofBags.get(r);
      if (!rb) roofBags.set(r, (rb = new Bag()));
      const roof = pick(ROOFS);
      const roofH = r * R(2.4, 3.2);
      rb.add(mat4(x, y + h + 1.1, z, 0, R(0, TAU), 0, 1, roofH / (r * 2.6), 1), roof);
      roofTipBag.add(mat4(x + r * 0.18, y + h + 1.1 + roofH + 0.1, z, 0, 0, 0, Math.max(0.7, r * 0.22)), pick(['#ff4f6f', '#ffd23a', '#ffffff']));
      if (rand() < 0.7) flagBag.add(mat4(x + r * 0.18, y + h + 1.1 + roofH + r * 0.1, z, 0, R(0, TAU), 0, Math.max(1, r * 0.3)), pick(ROOFS));
    };

    const addCastle = (x: number, y: number, z: number, rLimit: number) => {
      const big = rLimit >= 12;
      addTower(x, y, z, big ? 7 : 5, big ? 34 : 26);
      const d = Math.min(big ? 13 : 10, rLimit - 4.5);
      if (d < 7) return;
      const n = big ? 5 : 4;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + R(0, 0.5);
        addTower(x + Math.cos(a) * d, y, z + Math.sin(a) * d, big && rand() < 0.5 ? 5 : 3.5, pick(big ? [14, 20, 26] : [14, 20]));
      }
    };

    // 段の上に、いちご・さくらんぼ・カップケーキ・ペロペロキャンディをちらす
    const toppings = (x: number, y: number, z: number, rOut: number, rIn: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const a = R(0, TAU), d = R(rIn, rOut);
        const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
        const k = rand();
        if (k < 0.34) {
          const s = R(1.4, 2.3);
          topMounds.add(mat4(px, y - 0.05, pz, 0, R(0, TAU), 0, s * 1.15, s * 0.9, s * 1.15));
          topBerries.add(mat4(px, y + s * 0.65, pz, R(-0.2, 0.2), R(0, TAU), R(-0.2, 0.2), s));
        } else if (k < 0.55) {
          const s = R(1.2, 2.0);
          topMounds.add(mat4(px, y - 0.05, pz, 0, R(0, TAU), 0, s * 0.9, s * 0.7, s * 0.9));
          topCherries.add(mat4(px, y + s * 0.5, pz, 0, R(0, TAU), 0, s));
        } else if (k < 0.8) {
          const c = pick(cupSets);
          let b = topCups.get(c.join());
          if (!b) topCups.set(c.join(), (b = new Bag()));
          b.add(mat4(px, y, pz, 0, R(0, TAU), 0, R(1.5, 2.6)));
        } else {
          const kk = pick(['pink', 'teal', 'rainbow'] as const);
          const rho = R(1.6, 2.8);
          const sh = rho * 2.2 + 2;
          topSticks.add(mat4(px, y, pz, 0, 0, 0, rho * 0.8, sh, rho * 0.8));
          topLolly[kk].add(mat4(px, y + sh + rho * 0.85, pz, R(-0.2, 0.2), R(0, TAU), R(-0.2, 0.2), rho));
        }
      }
    };

    // 滝（円柱の側面にそう帯。上から下へピンクが流れる）
    const addFall = (x: number, z: number, r: number, y0: number, y1: number, angle: number, width: number) => {
      const da = width / r / 2;
      const K = 8;
      const base = fallPos.length / 3;
      for (let k = 0; k <= K; k++) {
        const a = angle - da + (2 * da * k) / K;
        const rr = r + 0.55;
        for (const [y, bulge] of [[y1 + 0.2, 0], [y0 + 0.05, 0.7]] as const) {
          fallPos.push(x + Math.cos(a) * (rr + bulge), y, z + Math.sin(a) * (rr + bulge));
          fallUv.push(k / K, y === y0 + 0.05 ? 0 : 1);
        }
      }
      for (let k = 0; k < K; k++) {
        const a = base + k * 2;
        fallIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      // 滝つぼ（ピンクのたまりと泡）
      const px = x + Math.cos(angle) * (r + 3.2), pz = z + Math.sin(angle) * (r + 3.2);
      const pr = width * 0.85;
      poolBag.add(mat4(px, y0 + 0.07, pz, 0, 0, 0, pr, 1, pr));
      for (let i = 0; i < 5; i++) {
        const fa = R(0, TAU), fd = R(0, pr * 0.8), fs = R(0.35, 0.95);
        foamBag.add(mat4(px + Math.cos(fa) * fd, y0 + 0.2, pz + Math.sin(fa) * fd, 0, 0, 0, fs, fs * 0.7, fs));
      }
    };

    // てっぺんを走る道（リング状。ふちはチョコの縄）
    const addRingRoad = (x: number, y: number, z: number, rIn: number, rOut: number) => {
      const seg = 72;
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      const w = rOut - rIn, rm = (rIn + rOut) / 2;
      const ui = 0.5 - w / 2 / 19, uo = 0.5 + w / 2 / 19;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU;
        for (const [r, u] of [[rIn, ui], [rOut, uo]] as const) {
          pos.push(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
          uv.push(u, (a * rm) / 36);
        }
        if (i < seg) {
          const o = i * 2;
          idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      ringRoads.push(g);
      const nb = Math.round((TAU * (rOut + 0.6)) / 2.3);
      for (let i = 0; i < nb; i++) {
        const a = (i / nb) * TAU;
        ringBeads.add(mat4(x + Math.cos(a) * (rOut + 0.5), y + 0.8, z + Math.sin(a) * (rOut + 0.5), 0, -a, 0, 1, 1, 0.82));
      }
    };

    type Recipe = { tiers: [number, number][]; fall: boolean; ring: boolean; castle: 'top' | 'none' | 'next'; berries: boolean };
    const recipes: Record<string, Recipe> = {
      small: { tiers: [[8, 5], [5, 5]], fall: false, ring: false, castle: 'none', berries: true },
      medium: { tiers: [[12, 8], [8, 8], [5, 5]], fall: true, ring: false, castle: 'none', berries: true },
      castle: { tiers: [[17, 8], [12, 8]], fall: true, ring: false, castle: 'top', berries: false },
      large: { tiers: [[24, 12], [17, 8], [12, 8], [8, 5]], fall: true, ring: false, castle: 'top', berries: true },
      huge: { tiers: [[34, 12], [24, 12], [17, 8], [12, 8], [8, 5]], fall: true, ring: true, castle: 'top', berries: true },
    };

    const stack = (x: number, z: number, name: keyof typeof recipes) => {
      const rc = recipes[name];
      let y = 0, cx = x, cz = z;
      const tint = pick(SPONGE);
      const frostA = pick(FROST);
      rc.tiers.forEach(([r, h], i) => {
        const frost = i % 2 ? pick(FROST) : frostA;
        addTier(cx, y, cz, r, h, i % 2 ? pick(SPONGE) : tint, frost);
        const next = rc.tiers[i + 1];
        const top = y + h + 0.62;
        const room = next ? r - next[0] : r;
        if (rc.berries && room > 3.4) toppings(cx, top, cz, r - 1.8, next ? next[0] + 1.5 : 2, Math.round(room * 0.55 + 1));
        if (name === 'huge' && i === 0) addRingRoad(cx, top + 0.02, cz, next![0] + 1.4, r - 1.6);
        if (next) {
          const a = R(0, TAU), off = R(0, Math.max(0, r - next[0] - 2.5));
          cx += Math.cos(a) * off;
          cz += Math.sin(a) * off;
        }
        y += h;
      });
      const top = y + 0.62;
      const rTop = rc.tiers[rc.tiers.length - 1][0];
      if (rc.castle === 'top') addCastle(cx, top, cz, rTop);
      else {
        // 小さな段のてっぺんには、大きなさくらんぼを 1 つ
        const s = R(1.6, 2.6);
        topMounds.add(mat4(cx, top - 0.05, cz, 0, 0, 0, s, s * 0.8, s));
        topCherries.add(mat4(cx, top + s * 0.5, cz, 0, R(0, TAU), 0, s * 1.2));
      }
      // 道の方を向いた側に滝をかける
      if (rc.fall) {
        const pr = track.project(new THREE.Vector3(x, 0, z));
        const toward = Math.atan2(pr.point.z - z, pr.point.x - x);
        const n = rand() < 0.5 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const a = toward + (k - (n - 1) / 2) * 0.9 + R(-0.25, 0.25);
          addFall(x, z, rc.tiers[0][0], 0, rc.tiers[0][1] + 0.4, a, Math.min(7, rc.tiers[0][0] * 0.45));
        }
      }
      spots.push({ x, z, r: rc.tiers[0][0] });
    };

    // ---- 崖（テラス）：スポンジの層の壁・クリームの床・ふちのクリーム・垂れるしずく・お城・滝 ----
    type V3 = THREE.Vector3;
    const edgeBag = new Bag();
    const cakeG = { pos: [] as number[], uv: [] as number[], col: [] as number[] };
    const topG = { pos: [] as number[], uv: [] as number[], col: [] as number[] };
    const pushTri = (g: typeof cakeG, a: V3, b: V3, c: V3, ua: number[], ub: number[], uc: number[], color: THREE.Color) => {
      for (const [v, u] of [[a, ua], [b, ub], [c, uc]] as [V3, number[]][]) {
        g.pos.push(v.x, v.y, v.z);
        g.uv.push(u[0], u[1]);
        g.col.push(color.r, color.g, color.b);
      }
    };
    const pushQuad = (g: typeof cakeG, a: V3, b: V3, c: V3, d: V3, ua: number[], ub: number[], uc: number[], ud: number[], color: THREE.Color) => {
      pushTri(g, a, c, b, ua, uc, ub, color);
      pushTri(g, b, c, d, ub, uc, ud, color);
    };
    const addStrip = (a: V3, b: V3, c: V3, d: V3) => {
      const base = fallPos.length / 3;
      for (const [v, u, w] of [[a, 0, 1], [b, 1, 1], [c, 0, 0], [d, 1, 0]] as [V3, number, number][]) {
        fallPos.push(v.x, v.y, v.z);
        fallUv.push(u, w);
      }
      fallIdx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    };
    const seg = L * stepT;
    for (const T of terraces) {
      const n = T.ts.length, K = T.hs.length;
      const P = T.ts.map((t) => T.offs.map((o) => track.place(t, T.side * o, new THREE.Vector3())));
      const at = (v: V3, y: number) => new THREE.Vector3(v.x, y, v.z);
      for (let i = 0; i < n - 1; i++) {
        const u0 = (i * seg) / CAKE_TILE, u1 = ((i + 1) * seg) / CAKE_TILE;
        for (let k = 0; k < K; k++) {
          const yLo = k === 0 ? 0 : T.hs[k - 1], yHi = T.hs[k];
          const vLo = 1 - (yHi - yLo) / CAKE_TILE;
          pushQuad(cakeG, at(P[i][k], yHi), at(P[i + 1][k], yHi), at(P[i][k], yLo), at(P[i + 1][k], yLo), [u0, 1], [u1, 1], [u0, vLo], [u1, vLo], new THREE.Color(T.tints[k]));
          const a = at(P[i][k], yHi), b = at(P[i + 1][k], yHi), c = at(P[i][k + 1], yHi), d = at(P[i + 1][k + 1], yHi);
          pushQuad(topG, a, b, c, d, [a.x / 48, a.z / 48], [b.x / 48, b.z / 48], [c.x / 48, c.z / 48], [d.x / 48, d.z / 48], new THREE.Color(T.tops[k]));
        }
        // いちばん外側の背面
        const yTop = T.hs[K - 1];
        pushQuad(cakeG, at(P[i][K], yTop), at(P[i + 1][K], yTop), at(P[i][K], 0), at(P[i + 1][K], 0), [u0, 1], [u1, 1], [u0, 1 - yTop / CAKE_TILE], [u1, 1 - yTop / CAKE_TILE], new THREE.Color(T.tints[K - 1]));
        // 各段のふちのクリームと、垂れるしずく
        for (let k = 0; k < K; k++) {
          const yLo = k === 0 ? 0 : T.hs[k - 1], yHi = T.hs[k];
          const a = P[i][k], b = P[i + 1][k];
          const q = track.place((T.ts[i] + T.ts[i + 1]) / 2 + (T.ts[i + 1] < T.ts[i] ? 0.5 : 0), T.side * (T.offs[k] - 0.25), new THREE.Vector3());
          edgeBag.add(mat4(q.x, yHi + 0.28, q.z, 0, Math.atan2(b.x - a.x, b.z - a.z), 0, 1, 1, 1), pick(['#fffaf4', '#ffd0e0', '#fffaf4']));
          if (rand() < 0.45) {
            const d = track.place(T.ts[i], T.side * (T.offs[k] - 0.38), new THREE.Vector3());
            const len = Math.min(R(1, 3.4), (yHi - yLo) * 0.8);
            const w = R(0.8, 1.3);
            dripBag.add(mat4(d.x, yHi + 0.05, d.z, 0, 0, 0, w, len / 2.5, w), pick(FROST));
          }
        }
      }
      // 両はしのふた（断面）
      const poly = [new THREE.Vector2(T.offs[0], 0)];
      for (let k = 0; k < K; k++) {
        poly.push(new THREE.Vector2(T.offs[k], T.hs[k]), new THREE.Vector2(T.offs[k + 1], T.hs[k]));
      }
      poly.push(new THREE.Vector2(T.offs[K], 0));
      const tris = THREE.ShapeUtils.triangulateShape(poly, []);
      for (const end of [0, n - 1]) {
        const pts = poly.map((v) => {
          const q = track.place(T.ts[end], T.side * v.x, new THREE.Vector3());
          q.y = v.y;
          return q;
        });
        for (const [x, y, z] of tris) {
          pushTri(cakeG, pts[x], pts[y], pts[z], [poly[x].x / CAKE_TILE, poly[x].y / CAKE_TILE], [poly[y].x / CAKE_TILE, poly[y].y / CAKE_TILE], [poly[z].x / CAKE_TILE, poly[z].y / CAKE_TILE], new THREE.Color(T.tints[0]));
        }
      }
      // いちばん上の段に、お城を点々と
      const midTop = (T.offs[K - 1] + T.offs[K]) / 2;
      for (let i = 6; i < n - 4; i += 18 + Math.floor(rand() * 8)) {
        const q = track.place(T.ts[i], T.side * midTop, new THREE.Vector3());
        addTower(q.x, T.hs[K - 1] + 0.55, q.z, 5, pick([20, 26]));
      }
      // 滝（いちばん上から地面まで、ピンクが流れ落ちる）
      const picks: number[] = [];
      const want = Math.max(1, Math.floor(n / 26));
      for (let tries = 0; picks.length < want && tries < 30; tries++) {
        const i = 3 + Math.floor(rand() * Math.max(1, n - 8));
        if (i < n - 3 && picks.every((q) => Math.abs(q - i) > 11)) picks.push(i);
      }
      for (const i of picks) {
        const tA = T.ts[i - 2], tB = T.ts[i + 2];
        const fl = (lat: number, t: number, y: number) => {
          const q = track.place(t, T.side * lat, new THREE.Vector3());
          q.y = y;
          return q;
        };
        for (let k = K - 1; k >= 0; k--) {
          const yLo = k === 0 ? 0 : T.hs[k - 1], yHi = T.hs[k];
          addStrip(fl(T.offs[k + 1] - 0.6, tA, yHi + 0.06), fl(T.offs[k + 1] - 0.6, tB, yHi + 0.06), fl(T.offs[k] - 0.4, tA, yHi + 0.06), fl(T.offs[k] - 0.4, tB, yHi + 0.06));
          addStrip(fl(T.offs[k] - 0.42, tA, yHi + 0.06), fl(T.offs[k] - 0.42, tB, yHi + 0.06), fl(T.offs[k] - 0.42, tA, yLo), fl(T.offs[k] - 0.42, tB, yLo));
        }
        const pc = track.place(T.ts[i], T.side * (T.offs[0] - 3.8), new THREE.Vector3());
        poolBag.add(mat4(pc.x, 0.07, pc.z, 0, 0, 0, 4.2, 1, 4.2));
        for (let f = 0; f < 5; f++) {
          const fa = R(0, TAU), fd = R(0, 3.4), fs = R(0.35, 0.95);
          foamBag.add(mat4(pc.x + Math.cos(fa) * fd, 0.2, pc.z + Math.sin(fa) * fd, 0, 0, 0, fs, fs * 0.7, fs));
        }
      }
    }
    const terraceMeshes: THREE.Object3D[] = [];
    const terraceGeo = (g: typeof cakeG) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
      geo.computeVertexNormals();
      return geo;
    };
    if (cakeG.pos.length) {
      const wallMesh = new THREE.Mesh(terraceGeo(cakeG), cakeMaterial(true));
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      const topMesh = new THREE.Mesh(terraceGeo(topG), candyTopMaterial());
      topMesh.receiveShadow = true;
      topMesh.castShadow = true;
      terraceMeshes.push(wallMesh, topMesh);
    }
    const edgeBeads = edgeBag.build(new THREE.CapsuleGeometry(0.55, 1.3, 2, 8).rotateX(Math.PI / 2), glazeMaterial(), false, false, 240);
    if (edgeBeads) terraceMeshes.push(edgeBeads);

    // 橋の両はしを支えるケーキの柱
    for (const pl of bridgePillars) {
      addTier(pl.x, 0, pl.z, 12, 12, '#7d4a2e', '#fffaf4');
      toppings(pl.x, 12.62, pl.z, 9, 3, 5);
    }

    // ---- 置く場所を決める ----
    // 1) 道のそば（中くらいまでの大きさ）
    let want = 30, tries = 0;
    while (want > 0 && tries++ < 3000) {
      const name = pick(['small', 'small', 'medium', 'medium', 'castle'] as const);
      const r0 = recipes[name].tiers[0][0];
      const s = nearSpot(r0 + 9, r0 + 60, 3);
      if (!s) continue;
      if (!free(s.p.x, s.p.z, r0)) continue;
      stack(s.p.x, s.p.z, name);
      want--;
    }
    // 2) 少し遠く（大きなケーキ）
    want = 16;
    tries = 0;
    const span = new THREE.Vector3().subVectors(box.max, box.min);
    while (want > 0 && tries++ < 4000) {
      const name = pick(['large', 'large', 'huge', 'castle'] as const);
      const r0 = recipes[name].tiers[0][0];
      const x = center.x + R(-0.5, 0.5) * (span.x + 360), z = center.z + R(-0.5, 0.5) * (span.z + 360);
      const d = Math.abs(track.project(new THREE.Vector3(x, 0, z)).lateral);
      if (d < wall + r0 + 18 || d > wall + r0 + 240) continue;
      if (!free(x, z, r0)) continue;
      stack(x, z, name);
      want--;
    }
    // 3) 地平線のかなた（巨大なケーキと、なだらかなクリームの山）
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU + R(-0.12, 0.12);
      const d = R(520, 760);
      const x = center.x + Math.cos(a) * d, z = center.z + Math.sin(a) * d;
      if (!free(x, z, 34, 2)) continue;
      stack(x, z, i % 3 === 0 ? 'castle' : 'huge');
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU + R(-0.15, 0.15);
      const d = R(820, 1050);
      const s = R(90, 160);
      hills.add(mat4(center.x + Math.cos(a) * d, -4, center.z + Math.sin(a) * d, 0, R(0, TAU), 0, s, s * R(0.28, 0.5), s), pick(['#fff2f2', '#ffe3ee', '#fff6e8', '#ffeaf3']));
    }

    // ---- 作る ----
    const out: THREE.Object3D[] = [...terraceMeshes];
    const cake = cakeMaterial();
    for (const e of tierBags.values()) {
      const m = e.bag.build(tierGeometry(e.r, e.h), cake, true, true);
      if (m) out.push(m);
    }
    for (const [r, b] of capBags) {
      const m = b.build(capGeometry(r), glazeMaterial(), true, true);
      if (m) out.push(m);
    }
    const drips = dripBag.build(dripGeometry(), glazeMaterial(), false, false, 170);
    if (drips) out.push(drips);
    const tw = towerMaterial();
    for (const e of towerBodies.values()) {
      const m = e.bag.build(towerBodyGeometry(e.r, e.h), tw, true, false);
      if (m) out.push(m);
    }
    for (const [r, b] of crownBags) {
      const m = b.build(towerCrownGeometry(r), creamMaterial(), true, false);
      if (m) out.push(m);
    }
    const roofMat = glazeMaterial();
    for (const [r, b] of roofBags) {
      const m = b.build(swirlGeometry(r * 1.28, r * 2.6, { ridges: 9, twist: 7, amp: 0.07, rings: 12, seg: 20 }), roofMat, true, false);
      if (m) out.push(m);
    }
    const tip = roofTipBag.build(new THREE.SphereGeometry(1, 12, 9), glazeMaterial(), false, false);
    if (tip) out.push(tip);
    const pole = new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5).translate(0, 1.3, 0);
    const flagGeo = mergeParts([
      { geo: pole, color: '#fffaf4' },
      { geo: new THREE.ConeGeometry(0.55, 1.5, 3).rotateZ(-Math.PI / 2).translate(0.75, 2.1, 0), color: '#ffffff' },
    ]);
    const flags = flagBag.build(flagGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, side: THREE.DoubleSide }), false, false);
    if (flags) out.push(flags);

    // てっぺんを走るリングの道
    if (ringRoads.length) {
      const merged = mergeRing(ringRoads);
      const road = new THREE.Mesh(merged, candyRoadMaterial());
      road.receiveShadow = true;
      out.push(road);
      const rb = ringBeads.build(new THREE.CapsuleGeometry(0.85, 1.3, 2, 8).rotateX(Math.PI / 2), chocolateMaterial(), false, false, 420);
      if (rb) out.push(rb);
    }

    const berry = new THREE.MeshPhysicalMaterial({ map: strawberryTexture(), roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 1.1 });
    const tb = topBerries.build(strawberryGeometry(), berry, true, false, 260);
    if (tb) out.push(tb);
    const topSwirl = mound();
    const tm = topMounds.build(topSwirl, creamMaterial(), true, false, 260);
    if (tm) out.push(tm);
    const tc = topCherries.build(cherryGeometry(), glazeMaterial(true), true, false, 260);
    if (tc) out.push(tc);
    for (const [k, b] of topCups) {
      const [f, a, c] = k.split(',');
      const m = b.build(cupcakeGeometry(f, a, c), glazeMaterial(true), true, false, 260);
      if (m) out.push(m);
    }
    const lollyHead2 = lollipopHeadGeometry();
    for (const k of ['pink', 'teal', 'rainbow'] as const) {
      const m = topLolly[k].build(lollyHead2, new THREE.MeshPhysicalMaterial({ map: lollipopTexture(k), roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.4 }), true, false, 320);
      if (m) out.push(m);
    }
    const ts = topSticks.build(stickGeometry(), new THREE.MeshStandardMaterial({ color: '#fff7ee', roughness: 0.4 }), true, false, 320);
    if (ts) out.push(ts);

    // 遠くのなだらかなクリームの山
    const hillMesh = hills.build(swirlGeometry(1, 1, { ridges: 5, twist: 3, amp: 0.05, pow: 0.55, rings: 10, seg: 24 }), glazeMaterial(), false, false);
    if (hillMesh) out.push(hillMesh);

    // 滝つぼ（ピンクのたまりと白い泡）
    const pools = poolBag.build(
      new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ color: '#ff9cc2', roughness: 0.12, clearcoat: 1, envMapIntensity: 1.4 }),
      false,
      false,
      260,
    );
    if (pools) out.push(pools);
    const foam = foamBag.build(new THREE.SphereGeometry(1, 8, 6), creamMaterial(), false, false, 200);
    if (foam) out.push(foam);

    // 滝：流れるピンクの帯
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fallPos, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(fallUv, 2));
    fg.setIndex(fallIdx);
    const falls = new THREE.Mesh(fg, waterfallMaterial());
    falls.renderOrder = 2;
    falls.frustumCulled = false;

    return { statics: out, falls };
  }

  function mergeRing(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let base = 0;
    for (const g of list) {
      const p = g.getAttribute('position'), u = g.getAttribute('uv');
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        uv.push(u.getX(i), u.getY(i));
      }
      const ix = g.index!;
      for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
      base += p.count;
    }
    const m = new THREE.BufferGeometry();
    m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    m.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    m.setIndex(idx);
    m.computeVertexNormals();
    return m;
  }
}

// ふんわり丸いホイップの山（先がまるく、すこし渦をまく）
function mound(): THREE.BufferGeometry {
  return swirlGeometry(1, 1.0, { ridges: 5, twist: 6, rings: 8, seg: 14, amp: 0.1, pow: 0.42 });
}

// ピンクの滝：上から下へ流れる筋と、ところどころに光る泡
function waterfallMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTime: globalUniforms.uTime },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float x = vUv.x;
        // ゆったりした流れ（ゆるい筋が、ゆっくり波うって落ちる）
        float s1 = 0.5 + 0.5 * sin(x * 13.0 + sin(vUv.y * 3.0 + uTime * 0.4) * 1.6);
        float s2 = 0.5 + 0.5 * sin(x * 31.0 - vUv.y * 4.0);
        float flow = 0.5 + 0.5 * sin(vUv.y * 12.0 + uTime * 2.6 + s1 * 3.0);
        vec3 deep = vec3(1.0, 0.5, 0.7);
        vec3 light = vec3(1.0, 0.84, 0.92);
        vec3 col = mix(deep, light, s1 * 0.35 + flow * 0.32 + s2 * 0.1);
        // 左右のふちと、下の泡は白っぽく
        col = mix(col, vec3(1.0), (1.0 - smoothstep(0.0, 0.1, x)) * 0.55 + smoothstep(0.9, 1.0, x) * 0.55);
        col = mix(col, vec3(1.0), smoothstep(0.24, 0.0, vUv.y) * 0.85);
        // 上のふちは、盛り上がってこぼれるところ（少し濃く）
        col = mix(col, deep * 0.95, smoothstep(0.9, 1.0, vUv.y) * 0.5);
        float edge = smoothstep(0.0, 0.06, x) * smoothstep(1.0, 0.94, x);
        float a = (0.86 + 0.1 * flow) * edge * smoothstep(1.0, 0.97, vUv.y);
        gl_FragColor = vec4(pow(col, vec3(2.2)), a);
      }`,
  });
}

