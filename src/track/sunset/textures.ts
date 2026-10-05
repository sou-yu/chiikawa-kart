import * as THREE from 'three';
import { mulberry32 } from '../../core/random';
import { heightToNormal, makeCanvas, toTexture } from '../../core/textures';

// 夕焼け海岸の絵（画像ファイルは使わず、キャンバスに描く）
const TAU = Math.PI * 2;

// 端をまたぐ絵を反対側にも描いて、つなぎ目なくくり返せるようにする
function wrap(W: number, H: number, x: number, y: number, r: number, fn: (x: number, y: number) => void) {
  for (const ox of [-W, 0, W]) {
    for (const oy of [-H, 0, H]) {
      const px = x + ox, py = y + oy;
      if (px + r < 0 || px - r > W || py + r < 0 || py - r > H) continue;
      fn(px, py);
    }
  }
}

export function repeatTex<T extends THREE.Texture>(t: T, x: number, y: number): T {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(x, y);
  return t;
}

// ---------- 砂（地面）：細かい粒・やわらかい色むら・風のさざ波もよう ----------
export const SAND_BASE = '#e9caa6';
let sandCache: { map: THREE.CanvasTexture; normal: THREE.CanvasTexture } | null = null;
export function sandTextures() {
  if (sandCache) return sandCache;
  const S = 512;
  const [c, g] = makeCanvas(S, S);
  const [hc, hg] = makeCanvas(S, S);
  const rand = mulberry32(77);
  g.fillStyle = SAND_BASE;
  g.fillRect(0, 0, S, S);
  hg.fillStyle = '#808080';
  hg.fillRect(0, 0, S, S);
  // 大きな色むら（少し赤み・少し白っぽい）
  for (let i = 0; i < 46; i++) {
    const r = 40 + rand() * 110;
    const col = rand() < 0.5 ? 'rgba(214,166,120,0.18)' : 'rgba(248,226,196,0.22)';
    wrap(S, S, rand() * S, rand() * S, r, (x, y) => {
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, col);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
  // 風のさざ波（ゆるく波うつ筋）。明るい面と暗い面を少しずらして描く
  for (let row = 0; row < 26; row++) {
    const y0 = (row / 26) * S + rand() * 6;
    const ph = rand() * TAU;
    for (const [dy, col, hcol] of [
      [0, 'rgba(250,232,206,0.22)', 'rgba(255,255,255,0.35)'],
      [3, 'rgba(196,150,108,0.16)', 'rgba(0,0,0,0.3)'],
    ] as const) {
      g.strokeStyle = col;
      hg.strokeStyle = hcol;
      g.lineWidth = hg.lineWidth = 2.2;
      for (const ctx of [g, hg]) {
        ctx.beginPath();
        for (let x = -8; x <= S + 8; x += 8) {
          const y = y0 + dy + Math.sin((x / S) * TAU * 2 + ph) * 5 + Math.sin((x / S) * TAU * 5 + ph * 2) * 1.6;
          if (x === -8) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  }
  // 細かい粒：石英の白い粒・濃い粒・貝のかけらのピンク
  for (let i = 0; i < 26000; i++) {
    const x = rand() * S, y = rand() * S;
    const k = rand();
    g.fillStyle = k < 0.45 ? 'rgba(255,246,230,0.55)' : k < 0.8 ? 'rgba(170,120,82,0.32)' : k < 0.93 ? 'rgba(120,88,70,0.35)' : 'rgba(255,190,190,0.5)';
    const s = 0.6 + rand() * 1.2;
    g.fillRect(x, y, s, s);
    hg.fillStyle = k < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)';
    hg.fillRect(x, y, s, s);
  }
  const map = repeatTex(toTexture(c), 1, 1);
  map.anisotropy = 16;
  const normal = repeatTex(heightToNormal(hc, 2.2), 1, 1);
  sandCache = { map, normal };
  return sandCache;
}

// ---------- 草の地面（ヤシの林の下）：深い緑と黄緑の色むら・草の葉の筋・クローバー・小さな野の花・ところどころ枯れ草 ----------
let grassCache: { map: THREE.CanvasTexture } | null = null;
export function grassTextures() {
  if (grassCache) return grassCache;
  const S = 512;
  const [c, g] = makeCanvas(S, S);
  const rand = mulberry32(31);
  g.fillStyle = '#5c9a36';
  g.fillRect(0, 0, S, S);
  // 大きな色むら：濃い緑・明るい黄緑・ところどころ枯れ草
  for (let i = 0; i < 70; i++) {
    const r = 30 + rand() * 90;
    const k = rand();
    const col = k < 0.4 ? 'rgba(36,98,38,0.34)' : k < 0.8 ? 'rgba(150,196,72,0.3)' : 'rgba(196,178,92,0.22)';
    wrap(S, S, rand() * S, rand() * S, r, (x, y) => {
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, col);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
  // 草の葉の筋（短い線を、たくさん）。根もとは暗く、先は明るく
  const greens = ['rgba(30,86,32,0.55)', 'rgba(62,128,44,0.5)', 'rgba(104,162,56,0.5)', 'rgba(150,198,78,0.5)', 'rgba(188,214,104,0.4)'];
  g.lineCap = 'round';
  for (let i = 0; i < 11000; i++) {
    const x = rand() * S, y = rand() * S;
    const len = 5 + rand() * 9;
    const a = -Math.PI / 2 + (rand() - 0.5) * 1.3;
    const col = greens[Math.floor(rand() * greens.length)];
    const lw = 1 + rand() * 1.2;
    wrap(S, S, x, y, len, (px, py) => {
      const ex = px + Math.cos(a) * len, ey = py + Math.sin(a) * len;
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(px, py);
      g.quadraticCurveTo(px + Math.cos(a + 0.5) * len * 0.5, py + Math.sin(a + 0.5) * len * 0.5, ex, ey);
      g.stroke();
    });
  }
  // クローバー（3 つの丸）
  for (let i = 0; i < 90; i++) {
    const x = rand() * S, y = rand() * S, r = 2.6 + rand() * 2;
    wrap(S, S, x, y, r * 2, (px, py) => {
      g.fillStyle = rand() < 0.5 ? 'rgba(112,178,72,0.85)' : 'rgba(70,140,58,0.85)';
      for (let k = 0; k < 3; k++) {
        const t = (k / 3) * TAU + rand() * 0.3;
        g.beginPath();
        g.arc(px + Math.cos(t) * r * 0.8, py + Math.sin(t) * r * 0.8, r * 0.75, 0, TAU);
        g.fill();
      }
    });
  }
  // 小さな野の花（白・黄・ピンク）
  for (let i = 0; i < 46; i++) {
    const x = rand() * S, y = rand() * S;
    const col = ['#fffaf0', '#ffe46a', '#ffb3c8', '#ffffff'][Math.floor(rand() * 4)];
    wrap(S, S, x, y, 6, (px, py) => {
      g.fillStyle = col;
      for (let k = 0; k < 5; k++) {
        const t = (k / 5) * TAU;
        g.beginPath();
        g.arc(px + Math.cos(t) * 2.2, py + Math.sin(t) * 2.2, 1.7, 0, TAU);
        g.fill();
      }
      g.fillStyle = '#f2a620';
      g.beginPath();
      g.arc(px, py, 1.3, 0, TAU);
      g.fill();
    });
  }
  const map = repeatTex(toTexture(c), 1, 1);
  map.anisotropy = 8;
  grassCache = { map };
  return grassCache;
}

// ---------- 茂みの葉（つやのある葉っぱが重なった模様）----------
let foliageCache: THREE.CanvasTexture | null = null;
export function foliageTexture(): THREE.CanvasTexture {
  if (foliageCache) return foliageCache;
  const S = 256;
  const [c, g] = makeCanvas(S, S);
  const rand = mulberry32(53);
  g.fillStyle = '#2f6e3a';
  g.fillRect(0, 0, S, S);
  const cols = ['#2a6234', '#3a8040', '#4a9448', '#5ba452', '#76b85c'];
  for (let i = 0; i < 380; i++) {
    const x = rand() * S, y = rand() * S;
    const len = 12 + rand() * 16, wd = len * (0.34 + rand() * 0.12);
    const a = rand() * TAU;
    const col = cols[Math.floor(rand() * cols.length)];
    wrap(S, S, x, y, len, (px, py) => {
      g.save();
      g.translate(px, py);
      g.rotate(a);
      g.fillStyle = col;
      g.beginPath();
      g.ellipse(0, 0, len, wd, 0, 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(20,60,28,0.45)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-len, 0);
      g.lineTo(len, 0);
      g.stroke();
      g.fillStyle = 'rgba(214,240,150,0.22)';
      g.beginPath();
      g.ellipse(-len * 0.1, -wd * 0.35, len * 0.7, wd * 0.28, 0, 0, TAU);
      g.fill();
      g.restore();
    });
  }
  foliageCache = repeatTex(toTexture(c), 3, 2);
  return foliageCache;
}

// ---------- 砂の道：わだち・タイヤの跡・小さな貝殻とヒトデ ----------
// 横（u）は道はば全体、縦（v）は ROAD_TILE メートルで 1 回くり返す
export const ROAD_TILE = 14;
let roadCache: { map: THREE.CanvasTexture; normal: THREE.CanvasTexture } | null = null;
export function sandRoadTextures() {
  if (roadCache) return roadCache;
  const W = 512, H = 1024;
  const [c, g] = makeCanvas(W, H);
  const [hc, hg] = makeCanvas(W, H);
  const rand = mulberry32(91);
  g.fillStyle = '#e4c4a0';
  g.fillRect(0, 0, W, H);
  hg.fillStyle = '#808080';
  hg.fillRect(0, 0, W, H);
  // 色むら（縦にはくり返す）
  for (let i = 0; i < 60; i++) {
    const r = 40 + rand() * 120;
    const x = rand() * W, y = rand() * H;
    const col = rand() < 0.5 ? 'rgba(206,158,112,0.2)' : 'rgba(246,224,192,0.24)';
    for (const oy of [-H, 0, H]) {
      const grd = g.createRadialGradient(x, y + oy, 0, x, y + oy, r);
      grd.addColorStop(0, col);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y + oy - r, r * 2, r * 2);
    }
  }
  // わだち：カートが何度も通って、少しへこんで濃くなった帯（4 本）
  for (const u of [0.22, 0.4, 0.6, 0.78]) {
    const cx = u * W;
    const w = 26 + rand() * 8;
    for (let y = 0; y < H; y += 2) {
      const x = cx + Math.sin((y / H) * TAU * 2 + u * 9) * 6;
      const grd = g.createLinearGradient(x - w, 0, x + w, 0);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(0.5, 'rgba(176,128,88,0.1)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - w, y, w * 2, 2);
      const hgr = hg.createLinearGradient(x - w, 0, x + w, 0);
      hgr.addColorStop(0, 'rgba(255,255,255,0.12)');
      hgr.addColorStop(0.5, 'rgba(0,0,0,0.25)');
      hgr.addColorStop(1, 'rgba(255,255,255,0.12)');
      hg.fillStyle = hgr;
      hg.fillRect(x - w, y, w * 2, 2);
      // タイヤのみぞの跡（細かい横じま）
      if (y % 10 === 0) {
        g.fillStyle = 'rgba(150,104,70,0.12)';
        g.fillRect(x - 9, y, 18, 3);
        hg.fillStyle = 'rgba(0,0,0,0.3)';
        hg.fillRect(x - 9, y, 18, 3);
      }
    }
  }
  // 風のさざ波
  for (let row = 0; row < 60; row++) {
    const y0 = (row / 60) * H + rand() * 8;
    const ph = rand() * TAU;
    g.strokeStyle = 'rgba(248,230,204,0.16)';
    hg.strokeStyle = 'rgba(255,255,255,0.22)';
    g.lineWidth = hg.lineWidth = 2;
    for (const ctx of [g, hg]) {
      ctx.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const y = y0 + Math.sin((x / W) * TAU * 3 + ph) * 4;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  // 細かい粒
  for (let i = 0; i < 52000; i++) {
    const x = rand() * W, y = rand() * H;
    const k = rand();
    g.fillStyle = k < 0.45 ? 'rgba(255,244,226,0.5)' : k < 0.82 ? 'rgba(166,116,80,0.3)' : k < 0.94 ? 'rgba(110,80,64,0.3)' : 'rgba(255,186,186,0.45)';
    const s = 0.6 + rand() * 1.1;
    g.fillRect(x, y, s, s);
    hg.fillStyle = k < 0.5 ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.26)';
    hg.fillRect(x, y, s, s);
  }
  // 小さな貝殻とヒトデ（ところどころ）
  for (let i = 0; i < 26; i++) {
    const x = 20 + rand() * (W - 40), y = rand() * H;
    const big = rand() < 0.15;
    if (big && rand() < 0.6) drawStar(g, hg, x, y, 9 + rand() * 4, rand() * TAU);
    else drawShell(g, hg, x, y, 5 + rand() * 4, rand() * TAU, rand() < 0.5 ? '#ffd9d9' : '#fff2e2');
  }
  // 道のふちは、まわりの砂の色へなじませる
  for (const [x0, x1] of [
    [0, 40],
    [W, W - 40],
  ] as const) {
    const grd = g.createLinearGradient(x0, 0, x1, 0);
    grd.addColorStop(0, 'rgba(233,202,166,0.95)');
    grd.addColorStop(1, 'rgba(233,202,166,0)');
    g.fillStyle = grd;
    g.fillRect(Math.min(x0, x1), 0, 40, H);
  }
  const map = toTexture(c);
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 16;
  const normal = heightToNormal(hc, 2.4);
  normal.wrapT = THREE.RepeatWrapping;
  roadCache = { map, normal };
  return roadCache;
}

function drawShell(g: CanvasRenderingContext2D, hg: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, col: string) {
  for (const [ctx, fill, line] of [
    [g, col, 'rgba(190,120,110,0.55)'],
    [hg, 'rgba(255,255,255,0.7)', 'rgba(0,0,0,0.3)'],
  ] as const) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, r * 0.5);
    ctx.arc(0, r * 0.5, r, Math.PI * 1.1, Math.PI * 1.9);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = line;
    ctx.lineWidth = 0.8;
    for (let k = 0; k <= 6; k++) {
      const t = Math.PI * 1.15 + (k / 6) * Math.PI * 0.7;
      ctx.beginPath();
      ctx.moveTo(0, r * 0.5);
      ctx.lineTo(Math.cos(t) * r, r * 0.5 + Math.sin(t) * r);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawStar(g: CanvasRenderingContext2D, hg: CanvasRenderingContext2D, x: number, y: number, r: number, a: number) {
  for (const [ctx, fill] of [
    [g, '#f58a6f'],
    [hg, 'rgba(255,255,255,0.75)'],
  ] as const) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const rr = k % 2 === 0 ? r : r * 0.42;
      const t = (k / 10) * TAU - Math.PI / 2;
      ctx.lineTo(Math.cos(t) * rr, Math.sin(t) * rr);
    }
    ctx.closePath();
    ctx.fill();
    if (ctx === g) {
      ctx.fillStyle = 'rgba(255,230,200,0.8)';
      for (let k = 0; k < 5; k++) {
        const t = (k / 5) * TAU - Math.PI / 2;
        for (let j = 1; j < 4; j++) {
          ctx.beginPath();
          ctx.arc(Math.cos(t) * r * j * 0.22, Math.sin(t) * r * j * 0.22, 0.7, 0, TAU);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }
}

// ---------- ヤシの葉（1 枚の葉：中心の軸から細い小葉が並ぶ。透明の切り抜き）----------
let frondCache: THREE.CanvasTexture | null = null;
export function frondTexture(): THREE.CanvasTexture {
  if (frondCache) return frondCache;
  const W = 128, H = 512;
  const [c, g] = makeCanvas(W, H);
  const rand = mulberry32(5);
  g.clearRect(0, 0, W, H);
  // 小葉（葉先に向かって短く）。u = 横、v = 付け根(0) → 先(1)
  for (let i = 0; i < 46; i++) {
    const v = 0.04 + (i / 46) * 0.92;
    const y = H * (1 - v);
    const len = (W / 2 - 4) * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, v * 1.15)));
    for (const s of [-1, 1]) {
      const tilt = 0.55 + rand() * 0.25;
      const green = 120 + rand() * 50;
      g.strokeStyle = `rgb(${50 + rand() * 30},${green},${40 + rand() * 25})`;
      g.lineWidth = 6;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(W / 2, y);
      g.quadraticCurveTo(W / 2 + s * len * 0.5, y - len * tilt * 0.3, W / 2 + s * len, y - len * tilt * 0.65);
      g.stroke();
      g.strokeStyle = 'rgba(210,240,140,0.35)';
      g.lineWidth = 1;
      g.stroke();
    }
  }
  // 中心の軸
  g.strokeStyle = '#8a9a4a';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(W / 2, H);
  g.lineTo(W / 2, 4);
  g.stroke();
  frondCache = toTexture(c);
  return frondCache;
}

// ---------- ビーチパラソル（放射状のしま）----------
export function umbrellaTexture(a: string, b: string): THREE.CanvasTexture {
  const W = 256, H = 64;
  const [c, g] = makeCanvas(W, H);
  const n = 8;
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 ? a : b;
    g.fillRect((i / n) * W, 0, W / n + 1, H);
  }
  // ふちのフリル（少し濃い帯）
  g.fillStyle = 'rgba(0,0,0,0.08)';
  g.fillRect(0, H - 6, W, 6);
  return toTexture(c);
}

// ---------- 矢印の看板（赤と白のシェブロン）----------
let chevronCache: THREE.CanvasTexture | null = null;
export function chevronTexture(): THREE.CanvasTexture {
  if (chevronCache) return chevronCache;
  const W = 256, H = 96;
  const [c, g] = makeCanvas(W, H);
  g.fillStyle = '#fff8f0';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#e8463c';
  for (let i = 0; i < 3; i++) {
    const x = 24 + i * 76;
    g.beginPath();
    g.moveTo(x, 12);
    g.lineTo(x + 34, 12);
    g.lineTo(x + 66, H / 2);
    g.lineTo(x + 34, H - 12);
    g.lineTo(x, H - 12);
    g.lineTo(x + 32, H / 2);
    g.closePath();
    g.fill();
  }
  g.strokeStyle = '#c23a30';
  g.lineWidth = 8;
  g.strokeRect(4, 4, W - 8, H - 8);
  chevronCache = toTexture(c);
  return chevronCache;
}

// ---------- 木（桟橋・柵の杭・流木）----------
let woodCache: THREE.CanvasTexture | null = null;
export function driftwoodTexture(): THREE.CanvasTexture {
  if (woodCache) return woodCache;
  const W = 128, H = 256;
  const [c, g] = makeCanvas(W, H);
  const rand = mulberry32(13);
  g.fillStyle = '#b48a62';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 70; i++) {
    const x = rand() * W;
    g.strokeStyle = rand() < 0.5 ? 'rgba(120,84,56,0.35)' : 'rgba(226,196,160,0.35)';
    g.lineWidth = 1 + rand() * 2;
    g.beginPath();
    g.moveTo(x, 0);
    for (let y = 0; y <= H; y += 16) g.lineTo(x + Math.sin(y * 0.05 + i) * 3, y);
    g.stroke();
  }
  woodCache = repeatTex(toTexture(c), 1, 1);
  return woodCache;
}
