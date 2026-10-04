import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAKE_TILE, TOWER_TILE } from './textures';

// お菓子の部品の形。小さな部品は「頂点の色」で塗り分けた 1 つの形にまとめる（描画 1 回で何百個も出せる）
const TAU = Math.PI * 2;
const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export interface Part {
  geo: THREE.BufferGeometry;
  color?: THREE.ColorRepresentation;
  at?: THREE.Matrix4;
}

// 位置・回転・大きさから行列を作る
export function mat4(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}

export function mergeParts(parts: Part[], withColor = true): THREE.BufferGeometry {
  const list = parts.map(({ geo, color = '#ffffff', at }) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (at) g.applyMatrix4(at);
    if (!withColor) g.deleteAttribute('color');
    else if (!g.attributes.color) {
      _c.set(color);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        arr[i * 3] = _c.r;
        arr[i * 3 + 1] = _c.g;
        arr[i * 3 + 2] = _c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    return g;
  });
  return mergeGeometries(list)!;
}

export function scaleUV(g: THREE.BufferGeometry, su: number, sv: number, ov = 0): THREE.BufferGeometry {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv + ov);
  return g;
}

// 位置から平面の uv を作る（円盤や板に絵を貼る用）。半径 r の円が [0,1] に入る
export function planarUV(g: THREE.BufferGeometry, r: number, axisA: 'x' | 'y' | 'z' = 'x', axisB: 'x' | 'y' | 'z' = 'y'): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const get = (i: number, a: 'x' | 'y' | 'z') => (a === 'x' ? pos.getX(i) : a === 'y' ? pos.getY(i) : pos.getZ(i));
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (get(i, axisA) / r) * 0.5 + 0.5, (get(i, axisB) / r) * 0.5 + 0.5);
  return g;
}

// ---------- しぼり出しクリーム（うずまきの山）----------
export function swirlGeometry(R: number, H: number, opt: { ridges?: number; twist?: number; rings?: number; seg?: number; amp?: number; pow?: number } = {}): THREE.BufferGeometry {
  const { ridges = 7, twist = 9, rings = 14, seg = 20, amp = 0.12, pow = 0.85 } = opt;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const h = i / rings;
    // 下が太く、上へ向かって細くなり、先端は少し曲がる
    const base = R * Math.pow(1 - h, pow);
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * TAU;
      const r = base * (1 + amp * (1 - h * 0.6) * Math.sin(ridges * th + twist * h));
      const curl = h * h * R * 0.18;
      pos.push(Math.cos(th) * r + curl, H * h, Math.sin(th) * r);
      uv.push(j / seg, h);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------- ケーキの 1 段（円柱の側面）----------
const tierCache = new Map<string, THREE.BufferGeometry>();
export function tierGeometry(r: number, h: number): THREE.BufferGeometry {
  const key = `${r}_${h}`;
  const hit = tierCache.get(key);
  if (hit) return hit;
  const g = new THREE.CylinderGeometry(r, r * 1.015, h, Math.min(56, Math.max(20, Math.round(r * 1.8))), 1, true);
  g.translate(0, h / 2, 0);
  // 層の厚みが場所によらず同じになるよう、uv を実際の大きさに合わせる。上の端が必ずクリームの段になる
  const uv = g.getAttribute('uv');
  const su = Math.max(1, Math.round((TAU * r) / CAKE_TILE));
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, 1 - (1 - uv.getY(i)) * (h / CAKE_TILE));
  tierCache.set(key, g);
  return g;
}

// 段の上にのる、ふっくらしたクリームのふた
const capCache = new Map<number, THREE.BufferGeometry>();
export function capGeometry(r: number): THREE.BufferGeometry {
  const hit = capCache.get(r);
  if (hit) return hit;
  const pts = [
    [0, 0.62],
    [r * 0.55, 0.64],
    [r * 0.94, 0.58],
    [r + 0.06, 0.46],
    [r + 0.28, 0.24],
    [r + 0.34, 0.0],
    [r + 0.28, -0.26],
    [r + 0.1, -0.48],
    [r - 0.1, -0.5],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, Math.min(44, Math.max(20, Math.round(r * 1.6))));
  capCache.set(r, g);
  return g;
}

// 上から垂れるクリームのしずく（上端が y=0、下へ 2.5m）
export function dripGeometry(): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(0.42, 1.66, 2, 6).translate(0, -1.25, 0);
}

// ---------- お城（円柱の塔と、しぼったクリームの屋根）----------
const towerCache = new Map<string, THREE.BufferGeometry>();
export function towerBodyGeometry(r: number, h: number): THREE.BufferGeometry {
  const key = `${r}_${h}`;
  const hit = towerCache.get(key);
  if (hit) return hit;
  const g = new THREE.CylinderGeometry(r * 0.94, r, h, 20, 1, true);
  g.translate(0, h / 2, 0);
  const uv = g.getAttribute('uv');
  const su = Math.max(1, Math.round((TAU * r) / TOWER_TILE));
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * (h / TOWER_TILE));
  towerCache.set(key, g);
  return g;
}

// 塔のてっぺんの張り出し（ぐるっとクリームの飾り）
export function towerCrownGeometry(r: number): THREE.BufferGeometry {
  const pts = [
    [r * 0.9, 0],
    [r * 1.12, 0.1],
    [r * 1.2, 0.5],
    [r * 1.14, 1.0],
    [r * 0.96, 1.15],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 20);
}

// ---------- ペロペロキャンディ ----------
export function lollipopHeadGeometry(): THREE.BufferGeometry {
  const t = 0.14;
  const pts = [
    [0, -t],
    [0.9, -t],
    [0.97, -0.075],
    [1.0, 0],
    [0.97, 0.075],
    [0.9, t],
    [0, t],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 32);
  g.rotateX(Math.PI / 2); // 円盤の面が ±Z を向く
  return planarUV(g, 1, 'x', 'y');
}

export function stickGeometry(): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(0.09, 0.11, 1, 8).translate(0, 0.5, 0);
}

// ---------- キャンディケーン ----------
function caneCurve(h: number, hook: number): THREE.Curve<THREE.Vector3> {
  const pts: THREE.Vector3[] = [];
  const straight = h - hook;
  for (let i = 0; i <= 8; i++) pts.push(new THREE.Vector3(0, (straight * i) / 8, 0));
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    pts.push(new THREE.Vector3(hook - hook * Math.cos(a), straight + hook * Math.sin(a), 0));
  }
  return new THREE.CatmullRomCurve3(pts);
}

// 1 本の杖の形（高さ h、先のカーブの半径 hook、太さ rad）。しま模様の繰り返しは uv に入れる
export function caneGeometry(h = 10, hook = 1.9, rad = 0.32): THREE.BufferGeometry {
  const curve = caneCurve(h, hook);
  const g = new THREE.TubeGeometry(curve, 30, rad, 7, false);
  const len = h - hook + Math.PI * hook;
  scaleUV(g, Math.max(2, Math.round(len / (rad * 4.4))), 1);
  return g;
}

// 道をまたぐ半円のアーチ（半径 R の半円）
export function caneArchGeometry(R: number, rad = 0.9): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI;
    pts.push(new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0));
  }
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, rad, 14, false);
  scaleUV(g, Math.round((Math.PI * R) / (rad * 4.4)), 1);
  return g;
}

// ---------- ガムドロップ ----------
export function gumdropGeometry(): THREE.BufferGeometry {
  const pts = [
    [0, 0],
    [1.0, 0],
    [1.03, 0.14],
    [0.93, 0.55],
    [0.62, 0.88],
    [0.26, 1.03],
    [0, 1.06],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 14);
}

// ---------- いちご（つぶつぶ模様の絵つき。ヘタも同じ絵の緑の部分を使う）----------
export function strawberryGeometry(): THREE.BufferGeometry {
  const prof = new THREE.SplineCurve(
    [
      [0, 0],
      [0.2, 0.05],
      [0.5, 0.26],
      [0.8, 0.68],
      [0.97, 1.17],
      [0.98, 1.52],
      [0.86, 1.86],
      [0.55, 2.06],
      [0.2, 2.13],
      [0, 2.14],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
  ).getPoints(11);
  const parts: Part[] = [{ geo: new THREE.LatheGeometry(prof, 12) }];
  // ヘタの葉（細長くて平ら）
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const leaf = new THREE.SphereGeometry(1, 5, 3);
    const uv = leaf.getAttribute('uv');
    for (let k = 0; k < uv.count; k++) uv.setXY(k, 0.5, 0.985); // 絵の緑の所を使う
    parts.push({ geo: leaf, at: mat4(Math.cos(a) * 0.46, 2.12, Math.sin(a) * 0.46, 0, -a, 0.5, 0.5, 0.07, 0.26) });
  }
  // とがった先を上にして、ヘタを下（クリームの中）にする
  return mergeParts(parts, false).rotateX(Math.PI).translate(0, 2.14, 0);
}

// ---------- さくらんぼ・りんご ----------
export function cherryGeometry(): THREE.BufferGeometry {
  const parts: Part[] = [];
  const berries: [number, number, number][] = [
    [-0.52, 0.58, 0.05],
    [0.56, 0.52, -0.08],
  ];
  for (const [x, y, z] of berries) {
    parts.push({ geo: new THREE.SphereGeometry(0.58, 12, 9), color: '#d90f2c', at: mat4(x, y, z, 0, 0, 0, 1, 0.94, 1) });
    // 軸のくぼみ
    parts.push({ geo: new THREE.SphereGeometry(0.16, 6, 4), color: '#8a0c1c', at: mat4(x, y + 0.55, z, 0, 0, 0, 1, 0.5, 1) });
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x, y + 0.55, z), new THREE.Vector3(x * 0.7, 1.7, z * 0.5), new THREE.Vector3(0, 2.15, 0));
    parts.push({ geo: new THREE.TubeGeometry(curve, 6, 0.05, 4, false), color: '#6f8a2c' });
  }
  parts.push({ geo: new THREE.SphereGeometry(0.09, 6, 5), color: '#5a7020', at: mat4(0, 2.15, 0) });
  // 葉っぱ
  parts.push({ geo: new THREE.SphereGeometry(1, 8, 5), color: '#3fae48', at: mat4(0.32, 2.2, 0.05, 0, 0.3, -0.45, 0.42, 0.05, 0.18) });
  return mergeParts(parts);
}

export function appleGeometry(): THREE.BufferGeometry {
  const prof = new THREE.SplineCurve(
    [
      [0, 0],
      [0.45, 0.03],
      [0.86, 0.32],
      [1.0, 0.82],
      [0.92, 1.28],
      [0.58, 1.5],
      [0.26, 1.42],
      [0.1, 1.24],
      [0, 1.22],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
  ).getPoints(12);
  const parts: Part[] = [
    { geo: new THREE.LatheGeometry(prof, 14), color: '#e0202c' },
    { geo: new THREE.CylinderGeometry(0.05, 0.07, 0.5, 6), color: '#6a4a22', at: mat4(0.02, 1.42, 0, 0, 0, 0.1) },
    { geo: new THREE.SphereGeometry(1, 8, 5), color: '#44b04a', at: mat4(0.42, 1.52, 0, 0, 0, 0.35, 0.42, 0.06, 0.2) },
    // つやの縞
    { geo: new THREE.SphereGeometry(1, 8, 6), color: '#ff6a70', at: mat4(-0.5, 0.9, 0.58, 0, -0.5, 0.2, 0.14, 0.34, 0.06) },
  ];
  return mergeParts(parts);
}

// ---------- カップケーキ ----------
export function cupcakeGeometry(frosting: string, wrapA: string, wrapB: string): THREE.BufferGeometry {
  // しま模様の紙カップ（縦のひだつき）。頂点ごとに色を持たせる
  const cup = new THREE.CylinderGeometry(1.08, 0.78, 1.15, 20, 1, true);
  const pos = cup.getAttribute('position');
  const colA = new THREE.Color(wrapA), colB = new THREE.Color(wrapB);
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
    const th = Math.atan2(z, x);
    const f = 1 + 0.045 * Math.sin(th * 14);
    pos.setXYZ(i, x * f, y + 0.575, z * f);
    const c = Math.sin(th * 7) > 0 ? colA : colB;
    colors.push(c.r, c.g, c.b);
  }
  cup.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  cup.computeVertexNormals();
  const parts: Part[] = [
    { geo: cup },
    { geo: new THREE.CircleGeometry(0.78, 12).rotateX(Math.PI / 2).translate(0, 0.01, 0), color: wrapB },
    { geo: new THREE.SphereGeometry(1.1, 14, 4, 0, TAU, 0, Math.PI / 2), color: '#e0a35c', at: mat4(0, 1.12, 0, 0, 0, 0, 1, 0.55, 1) },
    { geo: swirlGeometry(1.05, 1.35, { ridges: 6, twist: 8, rings: 9, seg: 14 }), color: frosting, at: mat4(0, 1.3, 0) },
    { geo: new THREE.SphereGeometry(0.3, 8, 6), color: '#d90f2c', at: mat4(0.12, 2.72, 0) },
    { geo: new THREE.SphereGeometry(0.07, 4, 3), color: '#ffffff', at: mat4(0.04, 2.84, 0.18) },
  ];
  // ふりかけ
  for (let i = 0; i < 4; i++) {
    const a = (i / 7) * TAU + 0.4;
    const r = 0.5 + (i % 3) * 0.14;
    parts.push({
      geo: new THREE.CapsuleGeometry(0.05, 0.14, 1, 4),
      color: ['#ffd23a', '#4fd36a', '#4aa8ff', '#ffffff', '#ff9a3a'][i % 5],
      at: mat4(Math.cos(a) * r, 1.55 + (1 - r) * 0.55 + (i % 2) * 0.15, Math.sin(a) * r, 1.2, a * 2, 0.4),
    });
  }
  return mergeParts(parts);
}

// ---------- ドーナツ（ふつうの寝かせた向き。半径 1）----------
export function donutGeometry(dough: string, icing: string): THREE.BufferGeometry {
  const R = 1.0, tube = 0.44;
  const parts: Part[] = [{ geo: new THREE.TorusGeometry(R, tube, 8, 20), color: dough, at: mat4(0, tube, 0, Math.PI / 2) }];
  // 上半分のアイシング
  const pts: THREE.Vector2[] = [];
  for (let a = 200; a >= -20; a -= 22) {
    const rad = (a * Math.PI) / 180;
    pts.push(new THREE.Vector2(R + (tube + 0.04) * Math.cos(rad), tube + (tube + 0.04) * Math.sin(rad) * 1.02));
  }
  parts.push({ geo: new THREE.LatheGeometry(pts, 20), color: icing });
  // ふりかけ
  const cols = ['#ffd23a', '#4fd36a', '#4aa8ff', '#ffffff', '#ff6fa8', '#a77bff'];
  for (let i = 0; i < 8; i++) {
    const th = (i / 8) * TAU + (i % 3) * 0.1;
    const ph = ((i * 37) % 100) / 100;
    const a = 40 + ph * 100;
    const rad = (a * Math.PI) / 180;
    const rr = R + (tube + 0.05) * Math.cos(rad);
    parts.push({
      geo: new THREE.CapsuleGeometry(0.04, 0.14, 1, 4),
      color: cols[i % cols.length],
      at: mat4(Math.cos(th) * rr, tube + (tube + 0.05) * Math.sin(rad), Math.sin(th) * rr, Math.PI / 2, th + i, 0),
    });
  }
  return mergeParts(parts);
}

// ---------- アイスクリーム ----------
export function iceCreamGeometry(a: string, b: string): THREE.BufferGeometry {
  const parts: Part[] = [
    { geo: new THREE.ConeGeometry(0.85, 2.5, 12).rotateX(Math.PI), color: '#e3ad62', at: mat4(0, 1.25, 0) },
    { geo: new THREE.SphereGeometry(0.98, 12, 8), color: a, at: mat4(0, 2.55, 0, 0, 0, 0, 1, 0.92, 1) },
    { geo: new THREE.CylinderGeometry(0.95, 0.9, 0.3, 12), color: a, at: mat4(0, 2.18, 0) },
    { geo: new THREE.SphereGeometry(0.88, 12, 8), color: b, at: mat4(0, 3.45, 0, 0, 0, 0, 1, 0.92, 1) },
    { geo: new THREE.CylinderGeometry(0.86, 0.82, 0.26, 12), color: b, at: mat4(0, 3.1, 0) },
    { geo: new THREE.SphereGeometry(0.3, 8, 6), color: '#d90f2c', at: mat4(0.05, 4.3, 0) },
  ];
  return mergeParts(parts);
}

// ---------- 円盤（クッキー・フルーツの輪切り）。面が ±Z を向く、半径 1 ----------
export function discGeometry(thick = 0.2): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, thick, 28, 1).rotateX(Math.PI / 2);
  return planarUV(g, 1, 'x', 'y');
}

// 半円（スイカ）。平らな辺が下
export function halfDiscGeometry(thick = 0.3): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.absarc(0, 0, 1, Math.PI, 0, true); // 上半分
  s.lineTo(-1, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 28 }).translate(0, 0, -thick / 2);
  // 絵は円全体だけど、上半分だけを使うので、そのまま planar
  return planarUV(g, 1, 'x', 'y');
}

// ---------- ハート（橋の窓用）----------
export function heartShape(size: number): THREE.Shape {
  const s = new THREE.Shape();
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < 48; i++) {
    const t = (i / 48) * TAU;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push(new THREE.Vector2((x / 17) * size, (y / 17) * size));
  }
  s.setFromPoints(pts);
  return s;
}
