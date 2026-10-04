import { facePatchGeometry, refFaceTexture } from './refFace';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CharacterSpec } from '../config/characters';
import { applyRim } from '../core/shaders';
import { FONT, fabricNormal, heightToNormal, makeCanvas, makeCanvasHi, toTexture } from '../core/textures';
import { headTexture, iconCanvas } from './faces';

export interface CharacterModel {
  root: THREE.Group; // カート＋ドライバー。+Z が前
  head: THREE.Group;
  driver: THREE.Group;
  spinWheels: THREE.Object3D[]; // 回転させるタイヤ
  steerWheels: THREE.Object3D[]; // 前輪（左右に向ける）
  rearWheelPos: THREE.Vector3[]; // 火花・砂ぼこりの出る位置（ローカル）
  materials: THREE.MeshStandardMaterial[]; // 無敵時の発光に使う
  setPose(amount: number): void; // トリック中のバンザイ＋笑顔（0..1）
  glider: THREE.Group; // グライダーの翼（滑空中だけ開く）
}

const sphere = new THREE.SphereGeometry(1, 48, 32);
const headSphere = new THREE.SphereGeometry(1, 96, 64);

// タイヤの溝（法線マップ）。全キャラで共有
let treadNormal: THREE.CanvasTexture | null = null;
function getTreadNormal(): THREE.CanvasTexture {
  if (treadNormal) return treadNormal;
  const [c, g] = makeCanvas(256, 64);
  g.fillStyle = '#9a9a9a';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#333333';
  for (let i = 0; i < 16; i++) {
    const x = i * 16;
    g.beginPath();
    g.moveTo(x, 18);
    g.lineTo(x + 6, 32);
    g.lineTo(x, 46);
    g.lineTo(x + 5, 46);
    g.lineTo(x + 11, 32);
    g.lineTo(x + 5, 18);
    g.fill();
  }
  treadNormal = heightToNormal(c, 6);
  return treadNormal;
}

// タイヤの周りをぐるっと回る縦の溝（法線マップ）
let grooveCache: THREE.CanvasTexture | null = null;
function grooveNormal(): THREE.CanvasTexture {
  if (grooveCache) return grooveCache;
  const [c, g] = makeCanvas(64, 256);
  g.fillStyle = '#a0a0a0';
  g.fillRect(0, 0, 64, 256);
  g.fillStyle = '#303030';
  for (const y of [0.3, 0.5, 0.7]) g.fillRect(0, 256 * y - 3, 64, 6);
  grooveCache = heightToNormal(c, 5);
  return grooveCache;
}

// 丸みのあるタイヤ（回転体）。Y 軸まわりに作るので呼び出し側で倒す
function tireGeometry(r: number, w: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const rr = Math.min(0.1, w * 0.3);
  const hw = w / 2;
  pts.push(new THREE.Vector2(r * 0.55, -hw));
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - rr + Math.cos(a) * rr, -hw + rr + Math.sin(a) * rr));
  }
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - rr + Math.cos(a) * rr, hw - rr + Math.sin(a) * rr));
  }
  pts.push(new THREE.Vector2(r * 0.55, hw));
  return new THREE.LatheGeometry(pts, 40);
}

// 5本スポークのホイール
function rimGeometry(r: number, w: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(new THREE.CylinderGeometry(r, r, w * 0.5, 32, 1, true));
  parts.push(new THREE.TorusGeometry(r * 0.96, r * 0.07, 8, 32).rotateX(Math.PI / 2).translate(0, w * 0.26, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(new THREE.BoxGeometry(r * 0.22, w * 0.18, r * 0.95).translate(0, w * 0.22, r * 0.5).rotateY(a));
  }
  parts.push(new THREE.CylinderGeometry(r * 0.3, r * 0.34, w * 0.4, 20).translate(0, w * 0.18, 0));
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)).map(stripExtra))!;
}

function stripExtra(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  return g;
}

export function createCharacter(spec: CharacterSpec): CharacterModel {
  const all: THREE.MeshStandardMaterial[] = [];
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  const M = (color: string, rough = 0.6, metal = 0): THREE.MeshStandardMaterial => {
    const key = `${color}_${rough}_${metal}`;
    let m = mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
      mats.set(key, m);
      all.push(m);
    }
    return m;
  };
  // ツヤのある塗装（おもちゃのカートっぽいクリアコート）
  const paint = (color: string): THREE.MeshPhysicalMaterial => {
    const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12 });
    all.push(m);
    return m;
  };
  // ぬいぐるみの布（起毛感＋ふち光）
  const fabric = new Map<string, THREE.MeshPhysicalMaterial>();
  const plush = (color: string, map?: THREE.Texture): THREE.MeshPhysicalMaterial => {
    const key = color + (map ? '_map' : '');
    let m = fabric.get(key);
    if (!m) {
      const nm = fabricNormal();
      nm.repeat.set(5, 5);
      m = new THREE.MeshPhysicalMaterial({
        color: map ? '#ffffff' : color,
        map: map ?? null,
        roughness: 0.92,
        sheen: 1,
        sheenColor: new THREE.Color('#ffffff'),
        sheenRoughness: 0.45,
        normalMap: nm,
        normalScale: new THREE.Vector2(0.28, 0.28),
      });
      m.emissive.set(map ? '#ffffff' : color);
      if (map) m.emissiveMap = map; // 目や口は黒いまま
      m.emissiveIntensity = 0.05;
      applyRim(m, '#fff4ea', 0.22, 2.6);
      fabric.set(key, m);
      all.push(m);
    }
    return m;
  };
  const add = (
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number],
    opts: { scale?: [number, number, number]; rot?: [number, number, number]; shadow?: boolean } = {},
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    if (opts.scale) m.scale.set(...opts.scale);
    if (opts.rot) m.rotation.set(...opts.rot);
    m.castShadow = !!opts.shadow;
    parent.add(m);
    return m;
  };

  const root = new THREE.Group();

  const spinWheels: THREE.Object3D[] = [];
  const steerWheels: THREE.Object3D[] = [];
  let rearWheelPos: THREE.Vector3[];
  const deluxe = spec.style === 'deluxe';
  if (deluxe) {
    // ========== 参考画像のピンクのカート ==========
    const pink = paint(spec.kart);
    const cream = paint(spec.kartTrim);
    const gold = M('#e3b04a', 0.22, 1);
    const black = M('#242428', 0.42);
    const dark = M('#38383e', 0.55, 0.3);
    const stripeMat = (draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) => {
      const [c, g] = makeCanvasHi(256, 256);
      g.fillStyle = spec.kart;
      g.fillRect(0, 0, 256, 256);
      draw(g, 256, 256);
      const m = new THREE.MeshPhysicalMaterial({ map: toTexture(c), roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.1 });
      all.push(m);
      return m;
    };
    // 上面：まん中にクリーム色の太いストライプ
    const topMat = stripeMat((g, w, h) => {
      g.fillStyle = spec.kartTrim;
      g.fillRect(w * 0.33, 0, w * 0.34, h);
    });
    // 前面：ストライプの続き＋顔マーク
    const frontMat = stripeMat((g, w, h) => {
      g.fillStyle = spec.kartTrim;
      g.fillRect(w * 0.33, 0, w * 0.34, h * 0.3);
      g.fillStyle = '#fbf3ea';
      g.strokeStyle = '#6a4a40';
      g.lineWidth = 5;
      g.beginPath();
      g.ellipse(w / 2, h * 0.6, w * 0.3, h * 0.26, 0, 0, Math.PI * 2);
      g.fill();
      g.drawImage(iconCanvas(spec, 360), w / 2 - 78, h * 0.6 - 88, 156, 156);
    });
    // 横：後ろ寄りにクリーム色のパネル
    const sideMat = stripeMat((g, w, h) => {
      g.fillStyle = spec.kartTrim;
      g.beginPath();
      g.roundRect(w * 0.08, h * 0.25, w * 0.5, h * 0.6, 40);
      g.fill();
    });
    const multi = (arr: THREE.Material[]) => arr as unknown as THREE.Material;

    add(root, new RoundedBoxGeometry(1.25, 0.14, 2.3, 3, 0.06), dark, [0, 0.26, 0]);
    add(root, new RoundedBoxGeometry(1.15, 0.58, 1.0, 6, 0.27), multi([pink, pink, topMat, pink, frontMat, pink]), [0, 0.66, 0.62], { shadow: true });
    add(root, new RoundedBoxGeometry(1.0, 0.5, 0.6, 6, 0.23), multi([pink, pink, topMat, pink, pink, topMat]), [0, 0.62, -0.98], { shadow: true });
    for (const s of [-1, 1]) {
      add(root, new RoundedBoxGeometry(0.36, 0.4, 1.25, 5, 0.16), multi([sideMat, sideMat, pink, pink, pink, pink]), [s * 0.72, 0.5, -0.12], { shadow: true });
    }
    // シート（クリーム）と黒いパイプのフレーム
    add(root, new RoundedBoxGeometry(0.86, 0.7, 0.16, 4, 0.07), cream, [0, 0.95, -0.6], { rot: [-0.12, 0, 0], shadow: true });
    add(root, new RoundedBoxGeometry(0.8, 0.14, 0.52, 4, 0.06), cream, [0, 0.66, -0.34]);
    add(root, new THREE.TorusGeometry(0.46, 0.05, 10, 28, Math.PI), black, [0, 0.9, -0.72]);
    // 前のバンパー（クリーム）：横棒2本＋縦棒3本
    add(root, new THREE.CylinderGeometry(0.065, 0.065, 1.25, 16), cream, [0, 0.44, 1.3], { rot: [0, 0, Math.PI / 2] });
    add(root, new THREE.CylinderGeometry(0.05, 0.05, 1.0, 12), cream, [0, 0.22, 1.28], { rot: [0, 0, Math.PI / 2] });
    for (const x of [-0.3, 0, 0.3]) add(root, new THREE.CylinderGeometry(0.05, 0.05, 0.24, 12), cream, [x, 0.33, 1.3]);
    for (const s of [-1, 1]) {
      add(root, new THREE.SphereGeometry(0.075, 12, 8), cream, [s * 0.625, 0.44, 1.3]);
      add(root, new THREE.CylinderGeometry(0.065, 0.065, 0.26, 12), cream, [s * 0.625, 0.44, 1.17], { rot: [Math.PI / 2, 0, 0] });
      // 金色の吸気口
      add(root, new THREE.TorusGeometry(0.13, 0.05, 12, 24), gold, [s * 0.46, 0.48, 1.13]);
      add(root, new THREE.CylinderGeometry(0.13, 0.13, 0.22, 20, 1, true), gold, [s * 0.46, 0.48, 1.03], { rot: [Math.PI / 2, 0, 0] });
      add(root, new THREE.CircleGeometry(0.1, 16), black, [s * 0.46, 0.48, 1.06]);
      // 後ろの金色マフラー
      add(root, new THREE.CylinderGeometry(0.14, 0.14, 0.42, 20, 1, true), gold, [s * 0.36, 0.46, -1.33], { rot: [Math.PI / 2, 0, 0] });
      add(root, new THREE.TorusGeometry(0.14, 0.05, 12, 24), gold, [s * 0.36, 0.46, -1.54]);
      add(root, new THREE.CircleGeometry(0.11, 16), black, [s * 0.36, 0.46, -1.45], { rot: [0, Math.PI, 0] });
      // 横に伸びる長い排気管（黒＋ピンクの帯＋金の口）
      add(root, new THREE.CylinderGeometry(0.1, 0.1, 0.8, 16), black, [s * 0.6, 1.12, -1.05], { rot: [Math.PI / 2, 0, 0] });
      add(root, new THREE.CylinderGeometry(0.106, 0.106, 0.13, 16), pink, [s * 0.6, 1.12, -1.33], { rot: [Math.PI / 2, 0, 0] });
      add(root, new THREE.CylinderGeometry(0.1, 0.1, 0.14, 16, 1, true), gold, [s * 0.6, 1.12, -1.47], { rot: [Math.PI / 2, 0, 0] });
      add(root, new THREE.CircleGeometry(0.085, 16), black, [s * 0.6, 1.12, -1.5], { rot: [0, Math.PI, 0] });
      add(root, new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8), dark, [s * 0.6, 0.85, -0.9]);
    }
    // 金色の車軸
    add(root, new THREE.CylinderGeometry(0.05, 0.05, 1.7, 12), gold, [0, 0.36, 0.8], { rot: [0, 0, Math.PI / 2] });
    add(root, new THREE.CylinderGeometry(0.05, 0.05, 1.8, 12), gold, [0, 0.42, -0.72], { rot: [0, 0, Math.PI / 2] });
    // 後ろの黒いグリル
    add(root, new RoundedBoxGeometry(0.5, 0.32, 0.12, 3, 0.04), dark, [0, 0.44, -1.3]);
    for (let i = 0; i < 3; i++) add(root, new THREE.BoxGeometry(0.34, 0.03, 0.02), black, [0, 0.36 + i * 0.07, -1.365]);
    // ハンドル
    add(root, new THREE.CylinderGeometry(0.03, 0.03, 0.4, 10), black, [0, 0.9, 0.46], { rot: [0.9, 0, 0] });
    add(root, new THREE.TorusGeometry(0.2, 0.045, 12, 32), black, [0, 1.03, 0.36], { rot: [-0.95, 0, 0] });
    // タイヤ（縦の溝）と金のホイール
    const groove = grooveNormal();
    groove.repeat.set(1, 1);
    const tire = new THREE.MeshStandardMaterial({ color: '#232326', roughness: 0.62, normalMap: groove, normalScale: new THREE.Vector2(1.4, 1.4) });
    all.push(tire);
    for (const [x, r, z, w, front] of [
      [-0.88, 0.4, 0.8, 0.4, true],
      [0.88, 0.4, 0.8, 0.4, true],
      [-0.93, 0.46, -0.72, 0.5, false],
      [0.93, 0.46, -0.72, 0.5, false],
    ] as [number, number, number, number, boolean][]) {
      const steer = new THREE.Group();
      steer.position.set(x, r, z);
      root.add(steer);
      const spin = new THREE.Group();
      steer.add(spin);
      const side = Math.sign(x);
      add(spin, tireGeometry(r, w), tire, [0, 0, 0], { rot: [0, 0, Math.PI / 2], shadow: true });
      add(spin, rimGeometry(r * 0.58, w), gold, [0, 0, 0], { rot: [0, 0, -side * (Math.PI / 2)] });
      add(spin, new THREE.SphereGeometry(r * 0.17, 16, 10), gold, [side * w * 0.3, 0, 0], { scale: [0.6, 1, 1] });
      spinWheels.push(spin);
      if (front) steerWheels.push(steer);
    }
    rearWheelPos = [new THREE.Vector3(-0.93, 0.08, -0.95), new THREE.Vector3(0.93, 0.08, -0.95)];
  } else {
  // ---------- カート ----------
  const body = paint(spec.kart);
  const trim = paint(spec.kartTrim);
  const dark = M('#34343c', 0.75);
  const metal = M('#c3c8cf', 0.22, 0.9);
  const glass = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, transmission: 0, transparent: true, opacity: 0.35, clearcoat: 1 });

  add(root, new RoundedBoxGeometry(1.3, 0.14, 2.3, 3, 0.06), dark, [0, 0.26, 0]);
  add(root, new RoundedBoxGeometry(1.5, 0.34, 2.0, 5, 0.14), body, [0, 0.45, -0.05], { shadow: true });
  add(root, new RoundedBoxGeometry(1.16, 0.44, 0.8, 5, 0.18), trim, [0, 0.62, 0.62], { shadow: true });
  for (const s of [-1, 1]) {
    add(root, new RoundedBoxGeometry(0.34, 0.38, 1.3, 5, 0.15), body, [s * 0.74, 0.52, -0.1], { shadow: true });
    add(root, new RoundedBoxGeometry(0.06, 0.12, 1.05, 3, 0.03), trim, [s * 0.91, 0.56, -0.1]);
  }
  // フェンダー（タイヤの上の泥よけ）
  for (const [x, z, r, w] of [
    [0.88, 0.8, 0.37, 0.4],
    [0.92, -0.72, 0.44, 0.5],
  ] as const) {
    // タイヤの上をぐるっと覆う丸い帯（ドーナツの一部を横に平たくつぶした形）
    const geo = new THREE.TorusGeometry(r + 0.07, 0.045, 10, 28, Math.PI * 0.6)
      .rotateZ(Math.PI * 0.2)
      .rotateY(Math.PI / 2)
      .scale((w * 0.85) / 0.09, 1, 1);
    for (const s of [-1, 1]) add(root, geo, trim, [s * x, r, z], { shadow: true });
  }
  // ヘッドライト
  const lightMat = new THREE.MeshStandardMaterial({ color: '#fffbe8', emissive: '#fff2c0', emissiveIntensity: 1.2 });
  for (const s of [-1, 1]) {
    add(root, new THREE.CylinderGeometry(0.1, 0.11, 0.06, 20), metal, [s * 0.45, 0.74, 1.02], { rot: [Math.PI / 2, 0, 0] });
    add(root, new THREE.CircleGeometry(0.085, 20), lightMat, [s * 0.45, 0.74, 1.052]);
    add(root, new THREE.SphereGeometry(0.09, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass, [s * 0.45, 0.74, 1.05], { rot: [Math.PI / 2, 0, 0] });
  }

  // エンブレム（顔マーク）
  const [ec, eg] = makeCanvasHi(256, 200);
  eg.fillStyle = '#ffffff';
  roundRect(eg, 8, 8, 240, 184, 40);
  eg.fill();
  eg.strokeStyle = spec.kart;
  eg.lineWidth = 8;
  roundRect(eg, 14, 14, 228, 172, 34);
  eg.stroke();
  eg.drawImage(iconCanvas(spec, 400), 28, -4, 200, 200);
  const emblemMat = new THREE.MeshPhysicalMaterial({ map: toTexture(ec), roughness: 0.3, clearcoat: 1 });
  const emblem = add(root, new THREE.PlaneGeometry(0.66, 0.52), emblemMat, [0, 0.64, 1.025]);
  emblem.rotation.x = -0.12;

  // 横のステッカー（名前）
  const [nc, ng] = makeCanvasHi(512, 128);
  ng.fillStyle = spec.kartTrim;
  roundRect(ng, 4, 14, 504, 100, 50);
  ng.fill();
  ng.drawImage(iconCanvas(spec, 200), 6, 6, 116, 116);
  ng.font = `900 64px ${FONT}`;
  ng.textBaseline = 'middle';
  ng.lineWidth = 10;
  ng.strokeStyle = '#ffffff';
  ng.strokeText(spec.name, 130, 68);
  ng.fillStyle = '#3b2f2f';
  ng.fillText(spec.name, 130, 68);
  const stickerMat = new THREE.MeshStandardMaterial({ map: toTexture(nc), transparent: true, roughness: 0.4 });
  for (const s of [-1, 1]) {
    const st = add(root, new THREE.PlaneGeometry(1.0, 0.25), stickerMat, [s * 0.915, 0.5, -0.12]);
    st.rotation.y = (s * Math.PI) / 2;
  }
  // 後ろのナンバープレート
  const [pc, pg] = makeCanvasHi(256, 128);
  pg.fillStyle = '#fffdf5';
  roundRect(pg, 4, 4, 248, 120, 18);
  pg.fill();
  pg.strokeStyle = '#3b2f2f';
  pg.lineWidth = 6;
  roundRect(pg, 8, 8, 240, 112, 14);
  pg.stroke();
  pg.drawImage(iconCanvas(spec, 200), 10, 10, 108, 108);
  pg.font = `900 70px ${FONT}`;
  pg.fillStyle = '#3b2f2f';
  pg.textBaseline = 'middle';
  pg.fillText(String(spec.id.length % 9 + 1).padStart(2, '0'), 128, 68);
  const plate = add(root, new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshStandardMaterial({ map: toTexture(pc), roughness: 0.5 }), [0, 0.46, -1.215]);
  plate.rotation.y = Math.PI;

  // バンパー
  add(root, new THREE.CylinderGeometry(0.055, 0.055, 1.72, 16), metal, [0, 0.3, 1.26], { rot: [0, 0, Math.PI / 2] });
  for (const s of [-1, 1]) {
    add(root, new THREE.CylinderGeometry(0.045, 0.045, 0.36, 12), metal, [s * 0.55, 0.3, 1.1], { rot: [Math.PI / 2, 0, 0] });
    add(root, new THREE.SphereGeometry(0.07, 12, 8), metal, [s * 0.86, 0.3, 1.26]);
  }
  add(root, new THREE.CylinderGeometry(0.05, 0.05, 1.5, 16), metal, [0, 0.36, -1.18], { rot: [0, 0, Math.PI / 2] });

  // シート（クッション＋ヘッドレスト）・エンジン・マフラー
  add(root, new RoundedBoxGeometry(1.0, 0.7, 0.2, 4, 0.09), body, [0, 0.92, -0.66], { rot: [-0.15, 0, 0], shadow: true });
  add(root, new RoundedBoxGeometry(0.78, 0.5, 0.12, 4, 0.06), M(spec.kartTrim, 0.85), [0, 0.95, -0.56], { rot: [-0.15, 0, 0] });
  add(root, new RoundedBoxGeometry(0.8, 0.14, 0.5, 4, 0.06), M(spec.kartTrim, 0.85), [0, 0.66, -0.35]);
  add(root, new RoundedBoxGeometry(0.8, 0.34, 0.36, 4, 0.08), trim, [0, 0.58, -1.02]);
  for (let i = 0; i < 4; i++) {
    add(root, new THREE.BoxGeometry(0.62, 0.03, 0.06), dark, [0, 0.48 + i * 0.06, -1.205]);
  }
  const lamp = new THREE.MeshStandardMaterial({ color: '#ff5a6e', emissive: '#ff2a40', emissiveIntensity: 0.9 });
  for (const s of [-1, 1]) {
    add(root, new RoundedBoxGeometry(0.22, 0.1, 0.05, 2, 0.02), lamp, [s * 0.55, 0.5, -1.06]);
    add(root, new THREE.CylinderGeometry(0.08, 0.065, 0.36, 16, 1, true), metal, [s * 0.26, 0.64, -1.29], { rot: [Math.PI / 2, 0, 0] });
    add(root, new THREE.CircleGeometry(0.06, 16), dark, [s * 0.26, 0.64, -1.465], { rot: [0, Math.PI, 0] });
  }
  // ハンドル
  add(root, new THREE.CylinderGeometry(0.03, 0.03, 0.4, 10), dark, [0, 0.9, 0.46], { rot: [0.9, 0, 0] });
  add(root, new THREE.TorusGeometry(0.19, 0.04, 12, 32), dark, [0, 1.02, 0.36], { rot: [-0.95, 0, 0] });
  add(root, new THREE.CylinderGeometry(0.06, 0.06, 0.03, 16), trim, [0, 1.02, 0.36], { rot: [-0.95 + Math.PI / 2, 0, 0] });

  // タイヤ
  const tread = getTreadNormal();
  tread.repeat.set(3, 1);
  const tire = new THREE.MeshStandardMaterial({ color: '#2a2a2e', roughness: 0.85, normalMap: tread, normalScale: new THREE.Vector2(1.2, 1.2) });
  all.push(tire);
  const rim = M('#eceff3', 0.22, 0.75);
  const hub = paint(spec.kart);
  const wheelDefs: [number, number, number, number, boolean][] = [
    [-0.88, 0.37, 0.8, 0.34, true],
    [0.88, 0.37, 0.8, 0.34, true],
    [-0.92, 0.44, -0.72, 0.44, false],
    [0.92, 0.44, -0.72, 0.44, false],
  ];
  for (const [x, r, z, w, front] of wheelDefs) {
    const steer = new THREE.Group();
    steer.position.set(x, r, z);
    root.add(steer);
    const spin = new THREE.Group();
    steer.add(spin);
    const side = Math.sign(x);
    add(spin, tireGeometry(r, w), tire, [0, 0, 0], { rot: [0, 0, Math.PI / 2], shadow: true });
    // ホイールは外側を向ける
    add(spin, rimGeometry(r * 0.56, w), rim, [0, 0, 0], { rot: [0, 0, -side * (Math.PI / 2)] });
    add(spin, new THREE.SphereGeometry(r * 0.16, 16, 10), hub, [side * w * 0.3, 0, 0], { scale: [0.6, 1, 1] });
    spinWheels.push(spin);
    if (front) steerWheels.push(steer);
  }
  rearWheelPos = [new THREE.Vector3(-0.92, 0.08, -0.95), new THREE.Vector3(0.92, 0.08, -0.95)];
  }

  // ---------- ドライバー ----------
  const driver = new THREE.Group();
  driver.position.set(0, 0, -0.15);
  root.add(driver);
  const skin = plush(spec.base);
  add(driver, sphere, skin, [0, 1.05, -0.05], { scale: [0.5, 0.44, 0.44], shadow: true });
  // 腕と手（ハンドルを握る）。肩を支点に回せるよう、腕ごとのグループにする
  const arms: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Vector3(s * 0.36, 1.18, 0.05);
    const hand = new THREE.Vector3(s * 0.26, 1.06, 0.44).sub(shoulder);
    const armGroup = new THREE.Group();
    armGroup.position.copy(shoulder);
    driver.add(armGroup);
    const arm = add(armGroup, new THREE.CapsuleGeometry(0.1, hand.length(), 8, 16), skin, [0, 0, 0], { shadow: true });
    arm.position.copy(hand).multiplyScalar(0.5);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hand.clone().normalize());
    add(armGroup, sphere, skin, [hand.x, hand.y, hand.z], { scale: [0.14, 0.13, 0.14] });
    arms.push(armGroup);
  }

  const head = new THREE.Group();
  head.position.set(0, 1.8, -0.05);
  driver.add(head);
  const faceNormal = headTexture(spec);
  const faceHappy = headTexture(spec, true);
  const headMat = plush(spec.base, faceNormal);
  // 参考画像の頭は横に広い大きなおまんじゅう形
  // 参考画像の頭は横:縦 ≒ 1.44:1 の横に広いおまんじゅう形
  // 測定：参考画像の頭は半幅384 : 半高341（≒1.13:1）で、思ったよりずっと丸い
  const headScale: [number, number, number] = deluxe ? [0.92, 0.82, 0.86] : [0.8, 0.7, 0.74];
  add(head, headSphere, headMat, [0, 0, 0], { scale: headScale, shadow: true });
  // 顔パーツ（参考画像の寸法から作った高解像度の顔を、頭の前面にうすく重ねる）
  let faceMat: THREE.MeshPhysicalMaterial | null = null;
  if (deluxe) {
    // 黒目・鼻・口が、参考画像のようにつやつやして見えるよう、光沢を強めにする
    faceMat = new THREE.MeshPhysicalMaterial({ map: refFaceTexture(false), transparent: true, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.12, depthWrite: false });
    all.push(faceMat);
    const face = add(head, facePatchGeometry(), faceMat, [0, 0, 0], { scale: headScale });
    face.renderOrder = 2;
  }
  if (deluxe) {
    // 起毛をより強く、光をやわらかく
    for (const m of [headMat, skin]) {
      m.normalScale.set(0.5, 0.5);
      m.sheenRoughness = 0.3;
      m.roughness = 1;
    }
    // 丸いしっぽ
    add(driver, sphere, skin, [0, 0.98, -0.5], { scale: [0.17, 0.16, 0.14] });
  }

  const earMat = spec.species === 'cat' && spec.pattern ? plush(spec.pattern) : skin;
  const pink = plush('#ffb6c6');
  if (spec.species === 'bear') {
    for (const s of [-1, 1]) {
      const ear = deluxe
        ? add(head, sphere, earMat, [s * 0.52, 0.58, -0.04], { scale: [0.25, 0.25, 0.17], shadow: true })
        : add(head, sphere, earMat, [s * 0.5, 0.5, -0.06], { scale: [0.2, 0.2, 0.15], shadow: true });
      add(ear, sphere, pink, [0, -0.06, deluxe ? 0.62 : 0.55], { scale: deluxe ? [0.66, 0.66, 0.45] : [0.55, 0.55, 0.45] });
    }
  } else if (spec.species === 'cat') {
    const cone = new THREE.ConeGeometry(0.24, 0.42, 24);
    for (const s of [-1, 1]) {
      const ear = add(head, cone, earMat, [s * 0.46, 0.58, -0.04], { rot: [0, 0, -s * 0.38], shadow: true });
      add(ear, cone, pink, [0, -0.03, 0.09], { scale: [0.6, 0.75, 0.4] });
    }
  } else {
    const cap = new THREE.CapsuleGeometry(0.14, 0.62, 10, 20);
    for (const s of [-1, 1]) {
      const ear = add(head, cap, earMat, [s * 0.22, 0.98, -0.08], { rot: [0, 0, -s * 0.12], shadow: true });
      add(ear, cap, pink, [0, 0.02, 0.08], { scale: [0.55, 0.85, 0.35] });
    }
  }
  if (spec.leaf) {
    const leafMat = new THREE.MeshPhysicalMaterial({ color: '#62bb45', roughness: 0.45, clearcoat: 0.6, side: THREE.DoubleSide });
    all.push(leafMat);
    add(head, new THREE.CylinderGeometry(0.03, 0.035, 0.22, 10), leafMat, [0, 0.74, 0]);
    for (const s of [-1, 1]) {
      add(head, sphere, leafMat, [s * 0.16, 0.86, 0], { scale: [0.2, 0.045, 0.11], rot: [0, 0, s * 0.45] });
    }
  }

  // 動かない部品は材質ごとに1つのメッシュへまとめる（描画回数を減らす）
  // 回る・動く部品（運転手・頭・腕・タイヤ）の中は、それぞれ別にまとめる
  if (!(import.meta.env.DEV && location.search.includes('nomerge'))) {
    mergeStatic(root, new Set<THREE.Object3D>([driver, ...steerWheels, ...spinWheels]));
    for (const s of steerWheels) mergeStatic(s, new Set(spinWheels));
    for (const s of spinWheels) mergeStatic(s);
    mergeStatic(driver, new Set<THREE.Object3D>([head, ...arms]));
    mergeStatic(head);
    for (const a of arms) mergeStatic(a);
  }

  // ---------- グライダー（普段はたたんで隠す）----------
  const glider = new THREE.Group();
  glider.position.set(0, 3.05, -0.25);
  glider.scale.setScalar(0.001);
  glider.visible = false;
  root.add(glider);
  {
    // 縞模様の布
    const [wc, wg] = makeCanvasHi(512, 128);
    const cols = [spec.kart, '#ffffff', spec.kartTrim, '#ffffff'];
    for (let i = 0; i < 8; i++) {
      wg.fillStyle = cols[i % cols.length];
      wg.fillRect(i * 64, 0, 64, 128);
    }
    wg.drawImage(iconCanvas(spec, 200), 206, 14, 100, 100);
    const wingMat = new THREE.MeshPhysicalMaterial({ map: toTexture(wc), side: THREE.DoubleSide, roughness: 0.6, sheen: 0.6 });
    all.push(wingMat);
    // 左右にのびる、ゆるく弓なりの三角の翼
    const shape = new THREE.Shape();
    shape.moveTo(-2.3, 0);
    shape.quadraticCurveTo(-1.2, 0.35, 0, 1.2);
    shape.quadraticCurveTo(1.2, 0.35, 2.3, 0);
    shape.quadraticCurveTo(0, -0.5, -2.3, 0);
    const geo = new THREE.ShapeGeometry(shape, 16);
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      uv.setXY(i, (x + 2.3) / 4.6, (y + 0.5) / 1.7);
      pos.setZ(i, x * x * 0.08); // 翼の端が少し下がる（寝かせた後に下向き）
    }
    geo.rotateX(Math.PI / 2); // 水平に寝かせる（三角の先が前 = +Z）
    geo.computeVertexNormals();
    const wing = new THREE.Mesh(geo, wingMat);
    wing.castShadow = true;
    glider.add(wing);
    const barMat = M('#8f6a48', 0.6);
    // 翼の骨と、カートまでの支柱
    add(glider, new THREE.CylinderGeometry(0.04, 0.04, 4.4, 8), barMat, [0, 0.02, 0.05], { rot: [0, 0, Math.PI / 2] });
    add(glider, new THREE.CylinderGeometry(0.04, 0.04, 1.6, 8), barMat, [0, 0.02, -0.25], { rot: [Math.PI / 2, 0, 0] });
    for (const s of [-1, 1]) {
      const top = new THREE.Vector3(s * 0.5, 0, 0);
      const bottom = new THREE.Vector3(s * 0.45, -2.05, -0.35);
      const strut = add(glider, new THREE.CylinderGeometry(0.035, 0.035, top.distanceTo(bottom), 8), barMat, [0, 0, 0]);
      strut.position.copy(top).lerp(bottom, 0.5);
      strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bottom.clone().sub(top).normalize());
    }
  }

  // 無敵の虹色発光から戻すための元の発光色（グライダーの翼も含め、全部の素材を作り終えてから記録する）
  for (const m of all) m.userData.baseEmissive = m.emissive.clone();

  // にっこり顔とバンザイのポーズ（amount 0..1 で通常⇔ポーズを補間）
  // 腕は「ハンドルを握る向き」から「頭の横で真上に伸ばす向き」へ回し、少し長く伸ばす
  let happy = false;
  const rest = new THREE.Quaternion();
  const armDirs = arms.map((_, i) => {
    const s = i === 0 ? -1 : 1;
    const from = new THREE.Vector3(s * 0.26, 1.06, 0.44).sub(new THREE.Vector3(s * 0.36, 1.18, 0.05)).normalize();
    const to = new THREE.Vector3(s * 0.8, 0.6, 0.12).normalize();
    return new THREE.Quaternion().setFromUnitVectors(from, to);
  });
  const setPose = (amount: number) => {
    const want = amount > 0.3;
    if (want !== happy) {
      happy = want;
      // 添付画像の顔（deluxe）は、ジャンプ中もゴール後も表情を変えず、常に同じ顔のまま
      if (!faceMat) headMat.map = headMat.emissiveMap = want ? faceHappy : faceNormal;
    }
    arms.forEach((a, i) => {
      a.quaternion.slerpQuaternions(rest, armDirs[i], amount);
      a.scale.setScalar(1 + 0.7 * amount);
    });
  };

  return { root, head, driver, spinWheels, steerWheels, rearWheelPos, materials: all, setPose, glider };
}

// 動かない部品を、材質（と影の設定）ごとに1つのメッシュへまとめる（描画回数を減らす）。
// parent の下を深くたどるが、stop に入っている部品（回る・動く部品）の中には入らない。
// 透明な物や描く順番を指定した物（顔など）は、重なり順が変わらないよう、まとめない。
function mergeStatic(parent: THREE.Object3D, stop: Set<THREE.Object3D> = new Set()) {
  parent.updateMatrixWorld(true);
  const inv = parent.matrixWorld.clone().invert();
  const groups = new Map<string, { mat: THREE.Material; cast: boolean; recv: boolean; meshes: THREE.Mesh[] }>();
  const visit = (o: THREE.Object3D) => {
    for (const c of o.children) {
      if (stop.has(c) || !c.visible) continue;
      const m = c as THREE.Mesh;
      if (m.isMesh && !Array.isArray(m.material) && !m.material.transparent && m.renderOrder === 0 && !(m as THREE.InstancedMesh).isInstancedMesh) {
        const key = `${m.material.uuid}|${m.castShadow}|${m.receiveShadow}|${m.layers.mask}`;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { mat: m.material, cast: m.castShadow, recv: m.receiveShadow, meshes: [] }));
        g.meshes.push(m);
      }
      visit(c);
    }
  };
  visit(parent);
  const rel = new THREE.Matrix4();
  for (const { mat, cast, recv, meshes } of groups.values()) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => {
      rel.multiplyMatrices(inv, m.matrixWorld);
      const g = stripExtra(m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(rel);
      // 左右反転（負のスケール）の部品は、三角形の向きを戻す（裏表が逆にならないように）
      if (rel.determinant() < 0) {
        for (const a of Object.values(g.attributes) as THREE.BufferAttribute[]) {
          const s = a.itemSize, arr = a.array;
          for (let t = 0; t < a.count; t += 3) {
            for (let k = 0; k < s; k++) {
              const i1 = (t + 1) * s + k, i2 = (t + 2) * s + k;
              const tmp = arr[i1];
              arr[i1] = arr[i2];
              arr[i2] = tmp;
            }
          }
        }
      }
      return g;
    });
    const merged = new THREE.Mesh(mergeGeometries(geos)!, mat);
    merged.castShadow = cast;
    merged.receiveShadow = recv;
    merged.layers.mask = meshes[0].layers.mask;
    for (const m of meshes) {
      const p = m.parent!;
      if (m.children.length > 0) {
        // 子を持つ部品は、同じ位置の空の入れ物に置き換えて、子をそのまま残す
        const holder = new THREE.Object3D();
        holder.position.copy(m.position);
        holder.quaternion.copy(m.quaternion);
        holder.scale.copy(m.scale);
        for (const k of [...m.children]) holder.add(k);
        p.add(holder);
      }
      p.remove(m);
    }
    parent.add(merged);
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
