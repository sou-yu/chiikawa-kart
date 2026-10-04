import * as THREE from 'three';
import { FONT, heightToNormal, makeCanvas, toTexture } from '../../core/textures';
import { mulberry32 } from '../../core/random';

// スイーツパラダイス用の絵柄（全部、起動時にキャンバスへ描く。画像ファイルは使わない）
type G = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

export const SPRINKLE_COLORS = ['#ffd23a', '#4fd36a', '#ff6fa8', '#4aa8ff', '#ff9a3a', '#ffffff', '#a77bff', '#ff5a5a'];

export function repeatTex<T extends THREE.Texture>(t: T, x: number, y: number): T {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(x, y);
  return t;
}

// 端をまたぐ絵を反対側にも描いて、つなぎ目なくくり返せるようにする
function wrap(W: number, H: number, x: number, y: number, rx: number, ry: number, fn: (x: number, y: number) => void) {
  for (const ox of [-W, 0, W]) {
    for (const oy of [-H, 0, H]) {
      const px = x + ox, py = y + oy;
      if (px + rx < 0 || px - rx > W || py + ry < 0 || py - ry > H) continue;
      fn(px, py);
    }
  }
}

function capsulePath(g: G, len: number, wid: number) {
  const r = wid / 2;
  g.beginPath();
  g.moveTo(-len / 2 + r, -r);
  g.lineTo(len / 2 - r, -r);
  g.arc(len / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2);
  g.lineTo(-len / 2 + r, r);
  g.arc(-len / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5);
  g.closePath();
}

// ---------- ビスケットの道 ----------

const RW = 1024; // 道の幅（19m）
const RH = 2048; // 道の長さ（36m でくり返す）
export const ROAD_TILE_LEN = 36;

interface Blob { x: number; y: number; rx: number; ry: number; p1: number; p2: number; kind: 'glaze' | 'choc' }
interface RoadPlan {
  toast: { x: number; y: number; r: number; col: string }[];
  mottle: { x: number; y: number; r: number; dark: boolean; a: number }[];
  streaks: { x0: number; A: number; m: number; ph: number; w: number; light: boolean }[];
  specks: { x: number; y: number; r: number; dark: boolean }[];
  blobs: Blob[];
  sprinkles: { x: number; y: number; len: number; wid: number; ang: number; col: string }[];
  edgePhase: number[];
}

function roadPlan(): RoadPlan {
  const rand = mulberry32(2718);
  const toast = Array.from({ length: 110 }, () => ({
    x: rand() * RW,
    y: rand() * RH,
    r: 80 + rand() * 220,
    col: ['rgba(238,152,58,0.20)', 'rgba(255,218,140,0.32)', 'rgba(222,134,40,0.12)', 'rgba(255,232,172,0.28)'][Math.floor(rand() * 4)],
  }));
  const streaks = Array.from({ length: 0 }, () => ({ x0: 0, A: 0, m: 1, ph: 0, w: 1, light: true }));
  const specks = Array.from({ length: 5200 }, () => ({ x: rand() * RW, y: rand() * RH, r: 0.8 + rand() * 1.8, dark: rand() < 0.55 }));
  // 焼きむら：小さな丸をたくさん重ねた、方向のないまだら
  const mottle = Array.from({ length: 2600 }, () => ({ x: rand() * RW, y: rand() * RH, r: 4 + rand() * 12, dark: rand() < 0.5, a: 0.05 + rand() * 0.07 }));
  const blobs: Blob[] = [];
  for (let i = 0; i < 4; i++) {
    blobs.push({ x: 200 + rand() * 620, y: ((i + rand() * 0.8) / 4) * RH, rx: 60 + rand() * 70, ry: 80 + rand() * 120, p1: rand() * TAU, p2: rand() * TAU, kind: 'glaze' });
  }
  for (let i = 0; i < 2; i++) {
    blobs.push({ x: 250 + rand() * 520, y: ((i + 0.3 + rand() * 0.4) / 2) * RH, rx: 55 + rand() * 40, ry: 70 + rand() * 60, p1: rand() * TAU, p2: rand() * TAU, kind: 'choc' });
  }
  const sprinkles = Array.from({ length: 190 }, () => {
    const big = rand() < 0.18;
    return {
      x: rand() * RW,
      y: rand() * RH,
      len: (big ? 92 : 54) + rand() * 30,
      wid: (big ? 27 : 18) + rand() * 6,
      ang: rand() * Math.PI,
      col: SPRINKLE_COLORS[Math.floor(rand() * SPRINKLE_COLORS.length)],
    };
  });
  return { toast, mottle, streaks, specks, blobs, sprinkles, edgePhase: [rand() * TAU, rand() * TAU, rand() * TAU, rand() * TAU] };
}

// アイシングのふちのうねり（上下でぴったりつながる）
function edgeX(y: number, side: 0 | 1, p: number[]): number {
  const k = (2 * Math.PI * y) / RH;
  const w = 24 * Math.sin(3 * k + p[side * 2]) + 14 * Math.sin(7 * k + p[side * 2 + 1]) + 8 * Math.sin(13 * k + side);
  return side === 1 ? RW * 0.9 + w * 0.8 : RW * 0.1 - w * 0.8;
}

function blobPath(g: G, b: Blob, px: number, py: number) {
  g.beginPath();
  for (let a = 0; a <= TAU + 0.01; a += 0.12) {
    const r = 1 + 0.14 * Math.sin(3 * a + b.p1) + 0.09 * Math.sin(5 * a + b.p2);
    const x = px + Math.cos(a) * b.rx * r, y = py + Math.sin(a) * b.ry * r;
    if (a === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

function paintRoad(g: G, p: RoadPlan, mode: 'color' | 'height' | 'rough') {
  g.fillStyle = mode === 'color' ? '#f4be68' : mode === 'height' ? '#808080' : '#8c8c8c';
  g.fillRect(0, 0, RW, RH);
  if (mode === 'color') {
    for (const b of p.toast) {
      wrap(RW, RH, b.x, b.y, b.r, b.r, (x, y) => {
        const grd = g.createRadialGradient(x, y, 0, x, y, b.r);
        grd.addColorStop(0, b.col);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.fillRect(x - b.r, y - b.r, b.r * 2, b.r * 2);
      });
    }
  }
  if (mode === 'color') {
    for (const m of p.mottle) {
      g.fillStyle = m.dark ? `rgba(214,128,36,${m.a})` : `rgba(255,236,176,${m.a * 1.3})`;
      g.beginPath();
      g.arc(m.x, m.y, m.r, 0, TAU);
      g.fill();
    }
  }
  if (mode !== 'rough') {
    // （筋は使わない）
    g.lineCap = 'round';
    for (const s of p.streaks) {
      g.lineWidth = s.w;
      g.strokeStyle =
        mode === 'color'
          ? s.light ? 'rgba(255,238,186,0.2)' : 'rgba(226,132,36,0.07)'
          : s.light ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)';
      for (const ox of [-RW, 0, RW]) {
        g.beginPath();
        for (let y = -16; y <= RH + 16; y += 16) {
          const x = s.x0 + ox + s.A * Math.sin((TAU * s.m * y) / RH + s.ph);
          if (y === -16) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
    }
    // 焼き色の点々と砂糖つぶ（凹凸の絵には入れない：ざらざらして砂のように見えるため）
    for (const s of mode === 'color' ? p.specks : []) {
      g.fillStyle = s.dark ? 'rgba(196,122,46,0.36)' : 'rgba(255,246,222,0.62)';
      g.beginPath();
      g.arc(s.x, s.y, s.r, 0, TAU);
      g.fill();
    }
  }

  // ---- ピンクのアイシング（両はしと、道のまんなかのしずく）----
  const glazeFill = (path: () => void, gx0: number, gx1: number) => {
    path();
    if (mode === 'color') {
      const grd = g.createLinearGradient(gx0, 0, gx1, 0);
      grd.addColorStop(0, '#ff7fb1');
      grd.addColorStop(0.5, '#ffa3c6');
      grd.addColorStop(1, '#ff8fb9');
      g.fillStyle = grd;
    } else g.fillStyle = mode === 'height' ? '#8e8e8e' : '#2c2c2c';
    g.fill();
  };
  const glazeEdge = (path: () => void) => {
    path();
    g.lineJoin = 'round';
    if (mode === 'color') {
      g.strokeStyle = '#ea5f98';
      g.lineWidth = 5;
      g.stroke();
    } else if (mode === 'height') {
      g.strokeStyle = 'rgb(176,176,176)';
      g.lineWidth = 9;
      g.stroke();
    }
  };
  for (const side of [0, 1] as const) {
    const path = () => {
      g.beginPath();
      g.moveTo(side ? RW : 0, -20);
      for (let y = -20; y <= RH + 20; y += 8) g.lineTo(edgeX(y, side, p.edgePhase), y);
      g.lineTo(side ? RW : 0, RH + 20);
      g.closePath();
    };
    glazeFill(path, side ? RW * 0.8 : RW * 0.2, side ? RW : 0);
    glazeEdge(path);
    if (mode === 'color') {
      // ふちの内側にそった、つやのハイライト
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = 3;
      g.beginPath();
      for (let y = -20; y <= RH + 20; y += 8) {
        const x = edgeX(y, side, p.edgePhase) + (side ? 10 : -10);
        if (y === -20) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  for (const b of p.blobs) {
    wrap(RW, RH, b.x, b.y, b.rx * 1.3, b.ry * 1.3, (x, y) => {
      if (b.kind === 'glaze') {
        glazeFill(() => blobPath(g, b, x, y), x - b.rx, x + b.rx);
        glazeEdge(() => blobPath(g, b, x, y));
        if (mode === 'color') {
          g.fillStyle = 'rgba(255,255,255,0.45)';
          g.beginPath();
          g.ellipse(x - b.rx * 0.35, y - b.ry * 0.4, b.rx * 0.28, b.ry * 0.1, -0.5, 0, TAU);
          g.fill();
        }
      } else {
        blobPath(g, b, x, y);
        if (mode === 'color') {
          const grd = g.createRadialGradient(x - b.rx * 0.3, y - b.ry * 0.3, 5, x, y, b.rx * 1.1);
          grd.addColorStop(0, '#7a4222');
          grd.addColorStop(1, '#4f2410');
          g.fillStyle = grd;
        } else g.fillStyle = mode === 'height' ? '#767676' : '#202020';
        g.fill();
        if (mode === 'color') {
          g.strokeStyle = '#34170a';
          g.lineWidth = 4;
          g.stroke();
          g.fillStyle = 'rgba(255,230,200,0.5)';
          g.beginPath();
          g.ellipse(x - b.rx * 0.35, y - b.ry * 0.42, b.rx * 0.3, b.ry * 0.09, -0.5, 0, TAU);
          g.fill();
        }
      }
    });
  }

  // ---- カラースプリンクル ----
  for (const s of p.sprinkles) {
    wrap(RW, RH, s.x, s.y, s.len, s.len, (x, y) => {
      g.save();
      g.translate(x, y);
      g.rotate(s.ang);
      if (mode === 'color') {
        g.fillStyle = 'rgba(90,40,10,0.28)';
        g.save();
        g.translate(s.wid * 0.18, s.wid * 0.4);
        capsulePath(g, s.len, s.wid);
        g.fill();
        g.restore();
        capsulePath(g, s.len, s.wid);
        g.fillStyle = s.col;
        g.fill();
        g.fillStyle = 'rgba(0,0,0,0.16)';
        g.beginPath();
        g.save();
        g.translate(0, s.wid * 0.22);
        capsulePath(g, s.len - s.wid * 0.3, s.wid * 0.45);
        g.fill();
        g.restore();
        g.fillStyle = 'rgba(255,255,255,0.6)';
        g.save();
        g.translate(-s.len * 0.08, -s.wid * 0.22);
        capsulePath(g, s.len * 0.55, s.wid * 0.2);
        g.fill();
        g.restore();
      } else {
        capsulePath(g, s.len, s.wid);
        g.fillStyle = mode === 'height' ? 'rgb(224,224,224)' : 'rgb(64,64,64)';
        g.shadowColor = mode === 'height' ? 'rgb(224,224,224)' : 'rgb(64,64,64)';
        g.shadowBlur = 4;
        g.fill();
      }
      g.restore();
    });
  }
}

let roadCache: { map: THREE.CanvasTexture; normal: THREE.CanvasTexture; rough: THREE.CanvasTexture } | null = null;
export function candyRoadTextures() {
  if (roadCache) return roadCache;
  const plan = roadPlan();
  const [c1, g1] = makeCanvas(RW, RH);
  paintRoad(g1, plan, 'color');
  const [c2, g2] = makeCanvas(RW / 2, RH / 2);
  g2.scale(0.5, 0.5);
  paintRoad(g2, plan, 'height');
  const [c3, g3] = makeCanvas(RW / 2, RH / 2);
  g3.scale(0.5, 0.5);
  paintRoad(g3, plan, 'rough');
  const map = repeatTex(toTexture(c1), 1, 1);
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.anisotropy = 16;
  const normal = heightToNormal(c2, 3.5);
  normal.wrapS = THREE.ClampToEdgeWrapping;
  const rough = new THREE.CanvasTexture(c3);
  rough.wrapT = THREE.RepeatWrapping;
  rough.wrapS = THREE.ClampToEdgeWrapping;
  rough.anisotropy = 8;
  roadCache = { map, normal, rough };
  return roadCache;
}

// ---------- ビスケット（橋・リングロードなど）----------
let biscuitCache: THREE.CanvasTexture | null = null;
export function biscuitTexture(): THREE.CanvasTexture {
  if (biscuitCache) return biscuitCache;
  const S = 256;
  const [c, g] = makeCanvas(S, S);
  const rand = mulberry32(5);
  g.fillStyle = '#f3c07a';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 40; i++) {
    const r = 30 + rand() * 60;
    wrap(S, S, rand() * S, rand() * S, r, r, (x, y) => {
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, rand() < 0.5 ? 'rgba(232,150,58,0.2)' : 'rgba(255,230,176,0.3)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
  for (let i = 0; i < 520; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(206,134,52,0.16)' : 'rgba(255,246,222,0.32)';
    g.beginPath();
    g.arc(rand() * S, rand() * S, 0.6 + rand() * 0.9, 0, TAU);
    g.fill();
  }
  biscuitCache = repeatTex(toTexture(c), 1, 1);
  return biscuitCache;
}

// ---------- 地面（ホイップクリーム）----------
let groundCache: { map: THREE.CanvasTexture; normal: THREE.CanvasTexture } | null = null;
export function candyGroundTextures() {
  if (groundCache) return groundCache;
  const S = 512;
  const [c, g] = makeCanvas(S, S);
  const [hc, hg] = makeCanvas(S, S);
  const rand = mulberry32(31);
  g.fillStyle = '#fff3f2';
  g.fillRect(0, 0, S, S);
  hg.fillStyle = '#808080';
  hg.fillRect(0, 0, S, S);
  // ほんのりピンクのにじみ
  for (let i = 0; i < 26; i++) {
    const r = 50 + rand() * 120;
    wrap(S, S, rand() * S, rand() * S, r, r, (x, y) => {
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, rand() < 0.7 ? 'rgba(255,196,214,0.36)' : 'rgba(255,236,196,0.4)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
  // しぼり出したクリームの渦（うねった山）
  for (let i = 0; i < 38; i++) {
    const cx = rand() * S, cy = rand() * S, R = 22 + rand() * 34, turns = 2 + rand() * 1.5;
    wrap(S, S, cx, cy, R, R, (x, y) => {
      for (const [gg, light, dark, lw] of [
        [g, 'rgba(255,255,255,0.8)', 'rgba(232,170,190,0.28)', 5],
        [hg, 'rgba(255,255,255,0.35)', 'rgba(0,0,0,0.3)', 7],
      ] as [G, string, string, number][]) {
        gg.lineCap = 'round';
        gg.lineWidth = lw;
        gg.strokeStyle = dark;
        gg.beginPath();
        for (let a = 0; a < TAU * turns; a += 0.15) {
          const r = (R * a) / (TAU * turns);
          const px = x + Math.cos(a) * r + 1.5, py = y + Math.sin(a) * r + 2;
          if (a === 0) gg.moveTo(px, py);
          else gg.lineTo(px, py);
        }
        gg.stroke();
        gg.strokeStyle = light;
        gg.beginPath();
        for (let a = 0; a < TAU * turns; a += 0.15) {
          const r = (R * a) / (TAU * turns);
          const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
          if (a === 0) gg.moveTo(px, py);
          else gg.lineTo(px, py);
        }
        gg.stroke();
      }
    });
  }
  // 小さなカラースプリンクル
  for (let i = 0; i < 70; i++) {
    const x = rand() * S, y = rand() * S, len = 16 + rand() * 8, wid = 5.5 + rand() * 2, ang = rand() * Math.PI;
    const col = SPRINKLE_COLORS[Math.floor(rand() * SPRINKLE_COLORS.length)];
    wrap(S, S, x, y, len, len, (px, py) => {
      for (const [gg, fill] of [[g, col], [hg, 'rgb(200,200,200)']] as [G, string][]) {
        gg.save();
        gg.translate(px, py);
        gg.rotate(ang);
        if (gg === g) {
          gg.fillStyle = 'rgba(120,60,70,0.22)';
          gg.save();
          gg.translate(1, 2);
          capsulePath(gg, len, wid);
          gg.fill();
          gg.restore();
        }
        capsulePath(gg, len, wid);
        gg.fillStyle = fill;
        gg.fill();
        if (gg === g) {
          gg.fillStyle = 'rgba(255,255,255,0.55)';
          gg.save();
          gg.translate(-len * 0.08, -wid * 0.2);
          capsulePath(gg, len * 0.5, wid * 0.25);
          gg.fill();
          gg.restore();
        }
        gg.restore();
      }
    });
  }
  groundCache = { map: repeatTex(toTexture(c), 1, 1), normal: heightToNormal(hc, 2.2) };
  groundCache.map.anisotropy = 8;
  return groundCache;
}

// ---------- ケーキの断面 ----------
// 色は 2 枚で持つ：1 枚目は「スポンジの模様」（白〜灰色。ケーキごとに色を掛ける）、
// 2 枚目は「掛けない部分（クリームやジャム）」の白黒マスク
let cakeCache: { map: THREE.CanvasTexture; mask: THREE.CanvasTexture } | null = null;
export const CAKE_TILE = 8; // 1 枚が 8m 四方
export function cakeSideTextures() {
  if (cakeCache) return cakeCache;
  const S = 512;
  const [c, g] = makeCanvas(S, S);
  const [mc, mg] = makeCanvas(S, S);
  const rand = mulberry32(77);
  // 下から：スポンジ / クリーム / スポンジ / ジャム / クリーム（canvas は上が 0）
  const bands: { y0: number; y1: number; kind: 'sponge' | 'cream' | 'jam' }[] = [
    { y0: 0, y1: 0.12, kind: 'cream' },
    { y0: 0.12, y1: 0.12 + 0.34, kind: 'sponge' },
    { y0: 0.46, y1: 0.54, kind: 'jam' },
    { y0: 0.54, y1: 0.66, kind: 'cream' },
    { y0: 0.66, y1: 1, kind: 'sponge' },
  ];
  mg.fillStyle = '#000';
  mg.fillRect(0, 0, S, S);
  for (const b of bands) {
    const y0 = b.y0 * S, y1 = b.y1 * S;
    if (b.kind === 'sponge') {
      g.fillStyle = '#e4e4e4';
      g.fillRect(0, y0, S, y1 - y0);
      // スポンジの気泡とぽろぽろ
      for (let i = 0; i < 700; i++) {
        const x = rand() * S, y = y0 + rand() * (y1 - y0), r = 1 + rand() * 3.2;
        g.fillStyle = rand() < 0.62 ? 'rgba(130,130,130,0.55)' : 'rgba(255,255,255,0.65)';
        g.beginPath();
        g.ellipse(x, y, r, r * 0.7, rand() * 3, 0, TAU);
        g.fill();
      }
    } else {
      g.fillStyle = b.kind === 'cream' ? '#fff6ea' : '#e5385a';
      g.fillRect(0, y0, S, y1 - y0);
      mg.fillStyle = '#fff';
      mg.fillRect(0, y0, S, y1 - y0);
      if (b.kind === 'jam') {
        for (let i = 0; i < 60; i++) {
          g.fillStyle = rand() < 0.5 ? 'rgba(255,120,140,0.55)' : 'rgba(150,10,40,0.45)';
          g.beginPath();
          g.arc(rand() * S, y0 + rand() * (y1 - y0), 1 + rand() * 2.4, 0, TAU);
          g.fill();
        }
      } else {
        // クリームのつや
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.fillRect(0, y0 + (y1 - y0) * 0.2, S, (y1 - y0) * 0.14);
      }
    }
  }
  // 層の境目の影
  g.fillStyle = 'rgba(60,30,20,0.28)';
  for (const b of bands.slice(0, -1)) g.fillRect(0, b.y1 * S - 2, S, 4);
  cakeCache = { map: repeatTex(toTexture(c), 1, 1), mask: repeatTex(new THREE.CanvasTexture(mc), 1, 1) };
  cakeCache.mask.anisotropy = 4;
  return cakeCache;
}

// ---------- お城の壁（アーチ窓）----------
let towerCache: THREE.CanvasTexture | null = null;
export const TOWER_TILE = 8;
export function towerWallTexture(): THREE.CanvasTexture {
  if (towerCache) return towerCache;
  const S = 512;
  const [c, g] = makeCanvas(S, S);
  const rand = mulberry32(12);
  g.fillStyle = '#f4f0ee';
  g.fillRect(0, 0, S, S);
  // 粉砂糖のようなざらざら
  for (let i = 0; i < 1500; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(190,170,170,0.28)' : 'rgba(255,255,255,0.6)';
    g.beginPath();
    g.arc(rand() * S, rand() * S, 0.8 + rand() * 1.6, 0, TAU);
    g.fill();
  }
  // うす いレンガの段
  g.strokeStyle = 'rgba(190,160,160,0.35)';
  g.lineWidth = 2;
  for (let y = 0; y < S; y += 32) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(S, y);
    g.stroke();
    for (let x = ((y / 32) % 2) * 32; x < S; x += 64) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y + 32);
      g.stroke();
    }
  }
  // アーチの窓が 2 つ（ガラスは空色〜ピンク、わくは白）
  for (const cx of [S * 0.25, S * 0.75]) {
    const w = 78, top = 120, bottom = 360;
    const path = (grow: number) => {
      g.beginPath();
      g.moveTo(cx - w / 2 - grow, bottom);
      g.lineTo(cx - w / 2 - grow, top + w / 2);
      g.arc(cx, top + w / 2, w / 2 + grow, Math.PI, 0);
      g.lineTo(cx + w / 2 + grow, bottom);
      g.closePath();
    };
    path(10);
    g.fillStyle = '#fffaf5';
    g.fill();
    path(0);
    const grd = g.createLinearGradient(0, top, 0, bottom);
    grd.addColorStop(0, '#8ccaf5');
    grd.addColorStop(1, '#f6b6d6');
    g.fillStyle = grd;
    g.fill();
    g.strokeStyle = '#fffaf5';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(cx, top);
    g.lineTo(cx, bottom);
    g.moveTo(cx - w / 2, (top + bottom) / 2);
    g.lineTo(cx + w / 2, (top + bottom) / 2);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(cx - w / 2 + 6, top + w / 2, 10, 140);
  }
  towerCache = repeatTex(toTexture(c), 1, 1);
  return towerCache;
}

// ---------- ペロペロキャンディ（うずまき）----------
const lollyCache = new Map<string, THREE.CanvasTexture>();
export function lollipopTexture(kind: 'pink' | 'teal' | 'rainbow'): THREE.CanvasTexture {
  const hit = lollyCache.get(kind);
  if (hit) return hit;
  const S = 512;
  const [c, g] = makeCanvas(S, S);
  const cols: number[][] =
    kind === 'pink' ? [[255, 108, 160], [255, 250, 250]] : kind === 'teal' ? [[54, 196, 204], [255, 255, 255]] : [[255, 90, 130], [255, 196, 60], [255, 255, 255], [96, 214, 120], [70, 170, 255], [255, 255, 255]];
  const arms = kind === 'rainbow' ? 1 : 3; // 色の組が、ぐるっと一周する間に何回くり返すか
  const twist = kind === 'rainbow' ? 1.1 : 1.4;
  const img = g.createImageData(S, S);
  const n = cols.length;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = (x + 0.5 - S / 2) / (S / 2), ny = (y + 0.5 - S / 2) / (S / 2);
      const r = Math.hypot(nx, ny);
      const o = (y * S + x) * 4;
      let col: number[];
      if (r > 0.97) col = [255, 252, 250];
      else {
        const a = Math.atan2(ny, nx) / TAU + 0.5;
        const q = (((a * arms + r * twist) % 1) + 1) % 1;
        const f = q * n;
        const i0 = Math.floor(f), t = f - i0;
        const c0 = cols[i0 % n], c1 = cols[(i0 + 1) % n];
        const k = Math.min(1, Math.max(0, (t - 0.9) / 0.1)); // 境目だけ少しぼかす
        col = [0, 1, 2].map((j) => c0[j] + (c1[j] - c0[j]) * k);
        const k0 = Math.min(1, Math.max(0, (0.04 - t) / 0.04));
        const cp = cols[(i0 - 1 + n) % n];
        col = col.map((v, j) => v + (cp[j] - v) * k0 * 0.5);
        const shade = 1 - 0.1 * r * r;
        col = col.map((v) => v * shade);
        if (r < 0.05) col = [255, 255, 255];
      }
      img.data[o] = col[0];
      img.data[o + 1] = col[1];
      img.data[o + 2] = col[2];
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = toTexture(c);
  lollyCache.set(kind, t);
  return t;
}

// ---------- キャンディケーンのしま ----------
let caneCache: THREE.CanvasTexture | null = null;
export function candyCaneTexture(): THREE.CanvasTexture {
  if (caneCache) return caneCache;
  const S = 256;
  const [c, g] = makeCanvas(S, S);
  g.fillStyle = '#fffafa';
  g.fillRect(0, 0, S, S);
  // 1 周期ぶんの赤いしまをななめに（上下・左右でつながる）
  g.fillStyle = '#ea2840';
  for (const o of [-S, 0, S]) {
    g.beginPath();
    g.moveTo(o, 0);
    g.lineTo(o + S * 0.5, 0);
    g.lineTo(o + S * 0.5 + S, S);
    g.lineTo(o + S, S);
    g.closePath();
    g.fill();
  }
  caneCache = repeatTex(toTexture(c), 1, 1);
  return caneCache;
}

// ---------- いちご ----------
let berryCache: THREE.CanvasTexture | null = null;
export function strawberryTexture(): THREE.CanvasTexture {
  if (berryCache) return berryCache;
  const W = 256, H = 256;
  const [c, g] = makeCanvas(W, H);
  const grd = g.createLinearGradient(0, H, 0, 0);
  grd.addColorStop(0, '#ff4a5e');
  grd.addColorStop(0.6, '#ec1f3c');
  grd.addColorStop(0.9, '#c8142e');
  grd.addColorStop(0.93, '#4fae3c');
  grd.addColorStop(1, '#3e9a30');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  // 種（ずらして並べる）。v が 0.08〜0.9 のあいだ
  const rows = 11;
  for (let r = 0; r < rows; r++) {
    const y = H * (0.1 + (0.8 * (r + 0.5)) / rows);
    const n = 13;
    for (let i = 0; i < n; i++) {
      const x = ((i + (r % 2) * 0.5) / n) * W;
      for (const ox of [-W, 0, W]) {
        g.fillStyle = 'rgba(150,10,30,0.55)';
        g.beginPath();
        g.ellipse(ox + x, y + 1.5, 4.4, 6.4, 0, 0, TAU);
        g.fill();
        g.fillStyle = '#ffe48a';
        g.beginPath();
        g.ellipse(ox + x, y, 3, 5, 0, 0, TAU);
        g.fill();
      }
    }
  }
  berryCache = toTexture(c);
  berryCache.wrapS = THREE.RepeatWrapping;
  return berryCache;
}

// ---------- フルーツの輪切り ----------
const fruitCache = new Map<string, THREE.CanvasTexture>();
export function fruitSliceTexture(kind: 'orange' | 'lemon' | 'kiwi' | 'melon' | 'grapefruit'): THREE.CanvasTexture {
  const hit = fruitCache.get(kind);
  if (hit) return hit;
  const S = 512;
  const [c, g] = makeCanvas(S, S);
  const rand = mulberry32(kind.length * 13 + 5);
  g.translate(S / 2, S / 2);
  const R = S / 2 - 6;
  const circle = (r: number, fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.fill();
  };
  if (kind === 'melon') {
    // 半月のスイカ：上が円の中心（planar uv で半円に使う）
    g.translate(0, 0);
    circle(R, '#2f9a3c');
    circle(R * 0.95, '#a8e07a');
    circle(R * 0.9, '#fff3e0');
    circle(R * 0.84, '#ff4a62');
    for (let i = 0; i < 26; i++) {
      const a = rand() * TAU, r = R * (0.2 + rand() * 0.55);
      g.save();
      g.translate(Math.cos(a) * r, Math.sin(a) * r);
      g.rotate(a + Math.PI / 2);
      g.fillStyle = '#2b1a1a';
      g.beginPath();
      g.ellipse(0, 0, 6, 12, 0, 0, TAU);
      g.fill();
      g.restore();
    }
    for (let i = 0; i < 60; i++) {
      g.fillStyle = 'rgba(255,170,190,0.4)';
      g.beginPath();
      g.arc((rand() - 0.5) * R * 1.6, (rand() - 0.5) * R * 1.6, 3 + rand() * 6, 0, TAU);
      g.fill();
    }
  } else if (kind === 'kiwi') {
    circle(R, '#8a6a3c');
    circle(R * 0.94, '#7fcf4a');
    const grd = g.createRadialGradient(0, 0, R * 0.1, 0, 0, R * 0.9);
    grd.addColorStop(0, '#f6f3c8');
    grd.addColorStop(0.3, '#d6ec8a');
    grd.addColorStop(1, '#79c940');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, R * 0.9, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(255,255,230,0.55)';
    g.lineWidth = 3;
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU;
      g.beginPath();
      g.moveTo(Math.cos(a) * R * 0.28, Math.sin(a) * R * 0.28);
      g.lineTo(Math.cos(a) * R * 0.86, Math.sin(a) * R * 0.86);
      g.stroke();
    }
    circle(R * 0.22, '#fffbe0');
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * TAU + rand() * 0.05, r = R * (0.34 + (i % 2) * 0.04);
      g.save();
      g.translate(Math.cos(a) * r, Math.sin(a) * r);
      g.rotate(a);
      g.fillStyle = '#2a1c14';
      g.beginPath();
      g.ellipse(0, 0, 10, 4.4, 0, 0, TAU);
      g.fill();
      g.restore();
    }
  } else {
    // オレンジ・レモン・グレープフルーツ
    const rind = kind === 'orange' ? '#ff9a1a' : kind === 'lemon' ? '#ffe03a' : '#ff8a86';
    const pulp = kind === 'orange' ? '#ffb43a' : kind === 'lemon' ? '#fff07a' : '#ff9d96';
    const pulpL = kind === 'orange' ? '#ffd27a' : kind === 'lemon' ? '#fffbc0' : '#ffc4be';
    circle(R, rind);
    circle(R * 0.93, '#fff6e8');
    const segs = kind === 'lemon' ? 9 : 10;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * TAU + 0.06, a1 = ((i + 1) / segs) * TAU - 0.06;
      const grd = g.createRadialGradient(0, 0, R * 0.1, 0, 0, R * 0.85);
      grd.addColorStop(0, pulpL);
      grd.addColorStop(1, pulp);
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(Math.cos((a0 + a1) / 2) * R * 0.09, Math.sin((a0 + a1) / 2) * R * 0.09);
      g.arc(0, 0, R * 0.85, a0, a1);
      g.closePath();
      g.fill();
      // つぶつぶの果肉
      for (let k = 0; k < 26; k++) {
        const a = a0 + (a1 - a0) * rand(), r = R * (0.12 + rand() * 0.7);
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.beginPath();
        g.ellipse(Math.cos(a) * r, Math.sin(a) * r, 2.5, 6, a, 0, TAU);
        g.fill();
      }
    }
    circle(R * 0.06, '#fff6e8');
  }
  const t = toTexture(c);
  fruitCache.set(kind, t);
  return t;
}

// ---------- クッキー（チョコチップ）----------
let cookieCache: THREE.CanvasTexture | null = null;
export function cookieTexture(): THREE.CanvasTexture {
  if (cookieCache) return cookieCache;
  const S = 512;
  const [c, g] = makeCanvas(S, S);
  const rand = mulberry32(44);
  g.fillStyle = '#f4efe6';
  g.fillRect(0, 0, S, S);
  const R = S / 2;
  const grd = g.createRadialGradient(S / 2, S / 2, 30, S / 2, S / 2, R * 0.98);
  grd.addColorStop(0, '#f1c27a');
  grd.addColorStop(0.75, '#e1a152');
  grd.addColorStop(1, '#b9742e');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(S / 2, S / 2, R * 0.97, 0, TAU);
  g.fill();
  for (let i = 0; i < 1200; i++) {
    const a = rand() * TAU, r = Math.sqrt(rand()) * R * 0.94;
    g.fillStyle = rand() < 0.5 ? 'rgba(160,96,36,0.45)' : 'rgba(255,230,180,0.5)';
    g.beginPath();
    g.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 1 + rand() * 2.4, 0, TAU);
    g.fill();
  }
  // チョコチップ
  for (let i = 0; i < 26; i++) {
    const a = rand() * TAU, r = Math.sqrt(rand()) * R * 0.8;
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
    g.save();
    g.translate(x, y);
    g.rotate(rand() * 3);
    g.fillStyle = '#4a2412';
    g.beginPath();
    g.moveTo(-17, 0);
    g.lineTo(-4, -15);
    g.lineTo(15, -9);
    g.lineTo(17, 9);
    g.lineTo(2, 15);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,220,190,0.45)';
    g.fillRect(-9, -9, 9, 4);
    g.restore();
  }
  cookieCache = toTexture(c);
  return cookieCache;
}

// ---------- ワッフル（ジャンプ台）----------
let waffleCache: { map: THREE.CanvasTexture; normal: THREE.CanvasTexture } | null = null;
export function waffleTextures() {
  if (waffleCache) return waffleCache;
  const S = 256;
  const [c, g] = makeCanvas(S, S);
  const [hc, hg] = makeCanvas(S, S);
  g.fillStyle = '#e8b45e';
  g.fillRect(0, 0, S, S);
  hg.fillStyle = '#e0e0e0';
  hg.fillRect(0, 0, S, S);
  // へこんだ四角
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const x = i * 128 + 18, y = j * 128 + 18, w = 92;
      const grd = g.createLinearGradient(x, y, x + w, y + w);
      grd.addColorStop(0, '#b97c30');
      grd.addColorStop(0.5, '#d29a48');
      grd.addColorStop(1, '#efc47c');
      g.fillStyle = grd;
      g.fillRect(x, y, w, w);
      hg.fillStyle = '#303030';
      hg.fillRect(x, y, w, w);
    }
  }
  // 焼き色のムラ
  const rand = mulberry32(8);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(150,90,30,0.25)' : 'rgba(255,230,170,0.3)';
    g.beginPath();
    g.arc(rand() * S, rand() * S, 1 + rand() * 2, 0, TAU);
    g.fill();
  }
  waffleCache = { map: repeatTex(toTexture(c), 1, 1), normal: repeatTex(heightToNormal(hc, 5), 1, 1) };
  return waffleCache;
}

// ---------- ガムドロップのざらざら（砂糖つぶ）----------
let sugarCache: THREE.CanvasTexture | null = null;
export function sugarNormal(): THREE.CanvasTexture {
  if (sugarCache) return sugarCache;
  const S = 256;
  const [c, g] = makeCanvas(S, S);
  const rand = mulberry32(61);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const v = 90 + Math.floor(rand() * 120);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath();
    g.arc(rand() * S, rand() * S, 0.9 + rand() * 1.3, 0, TAU);
    g.fill();
  }
  sugarCache = heightToNormal(c, 4);
  return sugarCache;
}

// ---------- くまの顔（バッジ・看板）----------
function bearFace(g: G, cx: number, cy: number, s: number, opts: { face: string; line: string; cheek: string }) {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // 耳
  for (const k of [-1, 1]) {
    g.beginPath();
    g.arc(cx + k * s * 0.62, cy - s * 0.66, s * 0.28, 0, TAU);
    g.fillStyle = opts.face;
    g.fill();
    g.lineWidth = s * 0.06;
    g.strokeStyle = opts.line;
    g.stroke();
    g.beginPath();
    g.arc(cx + k * s * 0.62, cy - s * 0.66, s * 0.13, 0, TAU);
    g.fillStyle = 'rgba(255,170,170,0.65)';
    g.fill();
  }
  // 顔（横に広い丸）
  g.beginPath();
  g.ellipse(cx, cy, s * 0.94, s * 0.8, 0, 0, TAU);
  g.fillStyle = opts.face;
  g.fill();
  g.lineWidth = s * 0.06;
  g.strokeStyle = opts.line;
  g.stroke();
  // 目
  for (const k of [-1, 1]) {
    g.beginPath();
    g.ellipse(cx + k * s * 0.42, cy - s * 0.06, s * 0.085, s * 0.12, 0, 0, TAU);
    g.fillStyle = '#2a1812';
    g.fill();
    g.beginPath();
    g.arc(cx + k * s * 0.42 + s * 0.025, cy - s * 0.1, s * 0.03, 0, TAU);
    g.fillStyle = '#fff';
    g.fill();
  }
  // ほっぺ
  for (const k of [-1, 1]) {
    g.beginPath();
    g.ellipse(cx + k * s * 0.64, cy + s * 0.2, s * 0.14, s * 0.1, 0, 0, TAU);
    g.fillStyle = opts.cheek;
    g.fill();
  }
  // 鼻と口（ω）
  g.beginPath();
  g.ellipse(cx, cy + s * 0.08, s * 0.07, s * 0.05, 0, 0, TAU);
  g.fillStyle = '#2a1812';
  g.fill();
  g.lineWidth = s * 0.045;
  g.strokeStyle = '#2a1812';
  g.beginPath();
  g.arc(cx - s * 0.1, cy + s * 0.2, s * 0.1, Math.PI * 1.05, Math.PI * 0.05, true);
  g.stroke();
  g.beginPath();
  g.arc(cx + s * 0.1, cy + s * 0.2, s * 0.1, Math.PI * 0.95, Math.PI * 1.95);
  g.stroke();
}

let badgeCache: THREE.CanvasTexture | null = null;
// ドーナツのゲートに付く、くまの顔のバッジ
export function bearBadgeTexture(): THREE.CanvasTexture {
  if (badgeCache) return badgeCache;
  const S = 512;
  const [c, g] = makeCanvas(S, S);
  g.clearRect(0, 0, S, S);
  bearFace(g, S / 2, S * 0.56, S * 0.4, { face: '#f6dcae', line: '#a8683a', cheek: 'rgba(255,128,150,0.8)' });
  badgeCache = toTexture(c);
  return badgeCache;
}

let signCache: THREE.CanvasTexture | null = null;
// くまの顔の木の看板（頭の形に切りぬいた板に、顔がほってある）
export function bearSignTexture(): THREE.CanvasTexture {
  if (signCache) return signCache;
  const S = 512;
  const [c, g] = makeCanvas(S, S);
  const rand = mulberry32(90);
  const cx = S / 2, cy = S * 0.58, s = S * 0.36;
  const silhouette = (grow: number) => {
    g.beginPath();
    g.ellipse(cx, cy, s * 0.98 + grow, s * 0.84 + grow, 0, 0, TAU);
    for (const k of [-1, 1]) {
      g.moveTo(cx + k * s * 0.62 + s * 0.3 + grow, cy - s * 0.66);
      g.arc(cx + k * s * 0.62, cy - s * 0.66, s * 0.3 + grow, 0, TAU);
    }
  };
  silhouette(14);
  g.fillStyle = '#7a4a24';
  g.fill();
  silhouette(0);
  const grd = g.createLinearGradient(0, 0, 0, S);
  grd.addColorStop(0, '#d79a5a');
  grd.addColorStop(1, '#b97a40');
  g.fillStyle = grd;
  g.fill();
  g.save();
  silhouette(0);
  g.clip();
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = `rgba(120,70,30,${0.1 + rand() * 0.14})`;
    g.lineWidth = 1 + rand() * 3;
    const y = rand() * S;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(S * 0.3, y + (rand() - 0.5) * 16, S * 0.7, y + (rand() - 0.5) * 16, S, y + (rand() - 0.5) * 10);
    g.stroke();
  }
  g.restore();
  // ほりこんだ顔
  bearFace(g, cx, cy, s * 0.86, { face: 'rgba(0,0,0,0)', line: '#5a3216', cheek: 'rgba(255,128,128,0.55)' });
  // 頭の上のホイップクリーム
  g.fillStyle = '#fffaf0';
  for (const [x, y, r] of [[cx, S * 0.18, 42], [cx - 34, S * 0.215, 30], [cx + 34, S * 0.215, 30], [cx, S * 0.11, 26]]) {
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
    g.strokeStyle = '#e9d8b8';
    g.lineWidth = 3;
    g.stroke();
  }
  g.fillStyle = '#ff5a6e';
  g.beginPath();
  g.arc(cx, S * 0.065, 17, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath();
  g.arc(cx - 5, S * 0.055, 5, 0, TAU);
  g.fill();
  signCache = toTexture(c);
  return signCache;
}

// ドーナツゲートの垂れ幕
export function candyBannerTexture(text: string): THREE.CanvasTexture {
  const [c, g] = makeCanvas(2048, 320);
  const grd = g.createLinearGradient(0, 0, 0, 320);
  grd.addColorStop(0, '#ff8fb8');
  grd.addColorStop(1, '#ff6c9c');
  g.fillStyle = grd;
  g.fillRect(0, 0, 2048, 320);
  g.strokeStyle = '#fff';
  g.lineWidth = 16;
  g.setLineDash([46, 30]);
  g.strokeRect(26, 26, 1996, 268);
  g.setLineDash([]);
  g.font = `900 190px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 26;
  g.lineJoin = 'round';
  g.strokeStyle = '#a63a62';
  g.strokeText(text, 1024, 176);
  g.fillStyle = '#fff';
  g.fillText(text, 1024, 176);
  return toTexture(c);
}

// ---------- アイテム箱（透明なガラスの立方体に、青い「？」）----------
let glassCache: THREE.CanvasTexture | null = null;
export function glassBoxTexture(): THREE.CanvasTexture {
  if (glassCache) return glassCache;
  const S = 512;
  const [c, g] = makeCanvas(S, S);
  g.clearRect(0, 0, S, S);
  // ガラスの面：ほんのり虹色にすけた、淡い色
  const grd = g.createLinearGradient(0, 0, S, S);
  grd.addColorStop(0, 'rgba(176,226,255,0.42)');
  grd.addColorStop(0.35, 'rgba(255,208,236,0.34)');
  grd.addColorStop(0.7, 'rgba(196,255,232,0.36)');
  grd.addColorStop(1, 'rgba(186,212,255,0.44)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  // ななめに走る光
  g.save();
  g.rotate(-0.6);
  for (const [x, w, a] of [[40, 40, 0.34], [150, 14, 0.4], [210, 6, 0.3]] as [number, number, number][]) {
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.fillRect(x - 160, 0, w, S * 1.5);
  }
  g.restore();
  // 面取りしたふち（白く光る）
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.96)';
  g.lineWidth = 30;
  g.strokeRect(15, 15, S - 30, S - 30);
  g.strokeStyle = 'rgba(150,206,255,0.7)';
  g.lineWidth = 8;
  g.strokeRect(42, 42, S - 84, S - 84);
  // 青い「？」（白ふち＋濃い青のふち）
  g.font = `900 360px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 62;
  g.strokeStyle = '#ffffff';
  g.strokeText('?', S / 2, S / 2 + 14);
  g.lineWidth = 30;
  g.strokeStyle = '#1b56c4';
  g.strokeText('?', S / 2, S / 2 + 14);
  const q = g.createLinearGradient(0, S * 0.25, 0, S * 0.78);
  q.addColorStop(0, '#5aa4ff');
  q.addColorStop(1, '#2c6de0');
  g.fillStyle = q;
  g.fillText('?', S / 2, S / 2 + 14);
  glassCache = toTexture(c);
  return glassCache;
}
