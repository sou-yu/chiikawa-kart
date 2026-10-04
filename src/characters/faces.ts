import { mulberry32 } from '../core/random';
import * as THREE from 'three';
import type { CharacterSpec } from '../config/characters';
import { makeCanvas, makeCanvasHi, toTexture } from '../core/textures';

const INK = '#2a1f1f';

// 顔パーツ。u = 頭の半径に相当するピクセル数。
// 参考画像の顔：短い眉、こげ茶の大きな瞳（白いハイライト2つ＋ピンクの照り返し）、4本線のほっぺ、猫口の「ω」
export function drawPlushFace(g: CanvasRenderingContext2D, cx: number, cy: number, u0: number, happy = false) {
  const u = u0 * 1.3;
  cy += 0.05 * u0; // 参考画像は顔が少し下寄り
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const BROWN = '#2b1c17';
  // ほっぺ（ふんわりにじんだピンク＋4本の斜線）
  for (const s of [-1, 1]) {
    const bx = cx + s * 0.56 * u, by = cy + 0.15 * u;
    const grd = g.createRadialGradient(bx, by, 0, bx, by, 0.19 * u);
    grd.addColorStop(0, 'rgba(255,150,165,0.95)');
    grd.addColorStop(0.7, 'rgba(255,160,175,0.8)');
    grd.addColorStop(1, 'rgba(255,170,185,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(bx, by, 0.19 * u, 0.12 * u, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#4a2622';
    g.lineWidth = 0.02 * u;
    for (let k = 0; k < 4; k++) {
      const x = bx + (k - 1.5) * 0.055 * u;
      g.beginPath();
      g.moveTo(x - 0.018 * u, by + 0.045 * u);
      g.lineTo(x + 0.018 * u, by - 0.045 * u);
      g.stroke();
    }
  }
  // 目と眉
  for (const s of [-1, 1]) {
    const ex = cx + s * 0.3 * u, ey = cy + 0.0 * u;
    // 眉：外側が少し下がった短い弧
    g.strokeStyle = BROWN;
    g.lineWidth = 0.028 * u;
    g.beginPath();
    g.moveTo(ex - s * 0.07 * u, ey - 0.235 * u);
    g.quadraticCurveTo(ex + s * 0.01 * u, ey - 0.265 * u, ex + s * 0.08 * u, ey - 0.225 * u);
    g.stroke();
    if (happy) {
      g.lineWidth = 0.06 * u;
      g.beginPath();
      g.arc(ex, ey + 0.06 * u, 0.1 * u, Math.PI * 1.15, Math.PI * 1.85);
      g.stroke();
      continue;
    }
    // 瞳（上が黒、下に向かってこげ茶）
    const rx = 0.105 * u, ry = 0.125 * u;
    const ig = g.createLinearGradient(ex, ey - ry, ex, ey + ry);
    ig.addColorStop(0, '#1d120e');
    ig.addColorStop(0.6, '#2e1b14');
    ig.addColorStop(1, '#5b3324');
    g.fillStyle = ig;
    g.beginPath();
    g.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
    // 下のピンクの照り返し
    g.save();
    g.clip();
    g.fillStyle = 'rgba(255,140,165,0.55)';
    g.beginPath();
    g.ellipse(ex, ey + ry * 0.85, rx * 0.7, ry * 0.35, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // ハイライト（大きい白＋小さい白）
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(ex + s * 0.025 * u, ey - 0.04 * u, 0.045 * u, 0.05 * u, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(ex - s * 0.035 * u, ey + 0.055 * u, 0.02 * u, 0, Math.PI * 2);
    g.fill();
  }
  // 口
  const my = cy + 0.13 * u;
  g.strokeStyle = BROWN;
  if (happy) {
    g.fillStyle = '#6e2a2e';
    g.beginPath();
    g.moveTo(cx - 0.11 * u, my);
    g.quadraticCurveTo(cx, my + 0.24 * u, cx + 0.11 * u, my);
    g.closePath();
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = '#ff8fa3';
    g.beginPath();
    g.ellipse(cx, my + 0.15 * u, 0.07 * u, 0.06 * u, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  } else {
    // 猫口：まん中が少しとがった「ω」
    g.lineWidth = 0.03 * u;
    g.beginPath();
    g.moveTo(cx - 0.12 * u, my - 0.01 * u);
    g.quadraticCurveTo(cx - 0.065 * u, my + 0.085 * u, cx - 0.012 * u, my + 0.005 * u);
    g.lineTo(cx, my - 0.02 * u);
    g.lineTo(cx + 0.012 * u, my + 0.005 * u);
    g.quadraticCurveTo(cx + 0.065 * u, my + 0.085 * u, cx + 0.12 * u, my - 0.01 * u);
    g.stroke();
  }
  g.restore();
}

export function drawFace(g: CanvasRenderingContext2D, cx: number, cy: number, u: number, mouth: 'omega' | 'open', happy = false, style?: 'deluxe') {
  if (style === 'deluxe') return drawPlushFace(g, cx, cy, u, happy);
  if (happy) mouth = 'open'; // 笑顔は口を大きく開ける
  g.save();
  g.lineCap = 'round';
  // ほっぺ（斜線つき）
  for (const s of [-1, 1]) {
    const bx = cx + s * 0.6 * u, by = cy + 0.19 * u;
    g.fillStyle = 'rgba(255,158,180,0.8)';
    g.beginPath();
    g.ellipse(bx, by, 0.17 * u, 0.1 * u, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ea6f8f';
    g.lineWidth = 0.022 * u;
    for (let k = -1; k <= 1; k++) {
      g.beginPath();
      g.moveTo(bx + k * 0.07 * u - 0.025 * u, by + 0.05 * u);
      g.lineTo(bx + k * 0.07 * u + 0.025 * u, by - 0.05 * u);
      g.stroke();
    }
  }
  // 目
  for (const s of [-1, 1]) {
    const ex = cx + s * 0.34 * u;
    if (happy) {
      // にっこり「^ ^」
      g.strokeStyle = INK;
      g.lineWidth = 0.065 * u;
      g.lineCap = 'round';
      g.beginPath();
      g.arc(ex, cy + 0.06 * u, 0.11 * u, Math.PI * 1.15, Math.PI * 1.85);
      g.stroke();
      continue;
    }
    g.fillStyle = INK;
    g.beginPath();
    g.ellipse(ex, cy, 0.095 * u, 0.125 * u, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(ex - 0.028 * u, cy - 0.048 * u, 0.042 * u, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(ex + 0.035 * u, cy + 0.05 * u, 0.017 * u, 0, Math.PI * 2);
    g.fill();
  }
  // 口
  const my = cy + 0.16 * u;
  if (mouth === 'omega') {
    g.strokeStyle = INK;
    g.lineWidth = 0.028 * u;
    g.beginPath();
    g.arc(cx - 0.05 * u, my, 0.05 * u, 0, Math.PI);
    g.moveTo(cx + 0.1 * u, my);
    g.arc(cx + 0.05 * u, my, 0.05 * u, 0, Math.PI);
    g.stroke();
  } else {
    g.fillStyle = '#6e2a2e';
    g.beginPath();
    g.moveTo(cx - 0.12 * u, my - 0.02 * u);
    g.quadraticCurveTo(cx, my + 0.26 * u, cx + 0.12 * u, my - 0.02 * u);
    g.closePath();
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = '#ff8fa3';
    g.beginPath();
    g.ellipse(cx, my + 0.13 * u, 0.08 * u, 0.06 * u, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.strokeStyle = INK;
    g.lineWidth = 0.02 * u;
    g.stroke();
  }
  g.restore();
}

// アイコン用：額に向かって白い山型
function drawHachiwareNotch(g: CanvasRenderingContext2D, cx: number, cy: number, u: number, base: string) {
  g.fillStyle = base;
  g.beginPath();
  g.moveTo(cx - 0.62 * u, cy - 0.1 * u);
  g.quadraticCurveTo(cx - 0.18 * u, cy - 0.2 * u, cx, cy - 0.62 * u);
  g.quadraticCurveTo(cx + 0.18 * u, cy - 0.2 * u, cx + 0.62 * u, cy - 0.1 * u);
  g.closePath();
  g.fill();
}

// 球の UV に貼る頭テクスチャ（顔は u=0.25 = +Z 方向）
export function headTexture(spec: CharacterSpec, happy = false): THREE.CanvasTexture {
  const W = 1024, H = 512;
  const [c, g] = makeCanvasHi(W, H); // 実寸 2048×1024
  g.fillStyle = spec.base;
  g.fillRect(0, 0, W, H);
  const cx = 256, cy = 262, u = 163;
  if (spec.species === 'cat' && spec.pattern) {
    // 頭の上〜後ろを柄の色に。顔の前は白く、額に向かって白い山型
    g.fillStyle = spec.pattern;
    g.fillRect(0, 0, W, cy - 0.3 * u);
    g.fillRect(cx + 1.25 * u, 0, W - (cx + 1.25 * u), cy + 0.1 * u);
    g.fillRect(0, 0, cx - 1.25 * u, cy + 0.1 * u);
    g.fillStyle = spec.base;
    g.beginPath();
    g.moveTo(cx - 1.25 * u, cy - 0.3 * u);
    g.quadraticCurveTo(cx - 0.3 * u, cy - 0.32 * u, cx, cy - 0.95 * u);
    g.quadraticCurveTo(cx + 0.3 * u, cy - 0.32 * u, cx + 1.25 * u, cy - 0.3 * u);
    g.closePath();
    g.fill();
  }
  if (spec.style === 'deluxe') {
    // 起毛のふわふわ感：ごく細かい明暗の粒
    const rand = mulberry32(5);
    for (let i = 0; i < 26000; i++) {
      g.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(215,190,190,0.1)';
      g.fillRect(rand() * W, rand() * H, 1, 1);
    }
  }
  // デラックス（プレイヤー）は顔を別パーツ（refFace.ts）で貼るので、頭には描かない
  if (spec.style !== 'deluxe') drawFace(g, cx, cy, u, spec.mouth, happy, spec.style);
  return toTexture(c);
}

// ミニマップ・エンブレム用の顔アイコン
export function iconCanvas(spec: CharacterSpec, size: number, outline = true): HTMLCanvasElement {
  const [c, g] = makeCanvas(size, size);
  const r = size * 0.36, cx = size / 2, cy = size * 0.57;
  const lw = size * 0.035;
  g.lineWidth = lw;
  g.strokeStyle = INK;
  const earCol = spec.species === 'cat' && spec.pattern ? spec.pattern : spec.base;

  const fillStroke = () => {
    g.fill();
    if (outline) g.stroke();
  };
  if (spec.species === 'bear') {
    for (const s of [-1, 1]) {
      g.fillStyle = earCol;
      g.beginPath();
      g.arc(cx + s * 0.72 * r, cy - 0.72 * r, 0.3 * r, 0, Math.PI * 2);
      fillStroke();
    }
  } else if (spec.species === 'cat') {
    for (const s of [-1, 1]) {
      g.fillStyle = earCol;
      g.beginPath();
      g.moveTo(cx + s * 0.95 * r, cy - 0.3 * r);
      g.lineTo(cx + s * 0.8 * r, cy - 1.15 * r);
      g.lineTo(cx + s * 0.25 * r, cy - 0.8 * r);
      g.closePath();
      fillStroke();
    }
  } else {
    for (const s of [-1, 1]) {
      g.fillStyle = earCol;
      g.beginPath();
      g.ellipse(cx + s * 0.32 * r, cy - 1.2 * r, 0.2 * r, 0.6 * r, s * 0.15, 0, Math.PI * 2);
      fillStroke();
      g.fillStyle = '#ffb8c8';
      g.beginPath();
      g.ellipse(cx + s * 0.32 * r, cy - 1.15 * r, 0.09 * r, 0.42 * r, s * 0.15, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.fillStyle = spec.base;
  g.beginPath();
  g.ellipse(cx, cy, r * 1.08, r * 0.95, 0, 0, Math.PI * 2);
  g.fill();
  if (spec.species === 'cat' && spec.pattern) {
    g.save();
    g.clip();
    g.fillStyle = spec.pattern;
    g.fillRect(0, 0, size, cy - 0.12 * r);
    drawHachiwareNotch(g, cx, cy, r, spec.base);
    g.restore();
  }
  g.beginPath();
  g.ellipse(cx, cy, r * 1.08, r * 0.95, 0, 0, Math.PI * 2);
  if (outline) g.stroke();
  if (spec.leaf) {
    g.fillStyle = '#6cc24a';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + s * 0.17 * r, cy - 1.02 * r, 0.2 * r, 0.09 * r, s * -0.5, 0, Math.PI * 2);
      g.fill();
      if (outline) g.stroke();
    }
  }
  drawFace(g, cx, cy + 0.05 * r, r, spec.mouth, false, spec.style);
  return c;
}
