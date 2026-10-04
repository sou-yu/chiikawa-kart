import * as THREE from 'three';

// 参考画像（正面）の顔を、画像から測った寸法どおりに描いて頭の球面へ投影する。
// 単位は参考画像のピクセル。頭の中心が原点（x=625, y=520 の点）。
// 測った値：頭の半幅 = 384、半高 = 341。上端 y=179。最も広いのは y=520。

export const HEAD_HALF_W = 384;
export const HEAD_HALF_H = 341;
// 顔パーツ用の球の一部（前面だけ）。経度・緯度の範囲（ラジアン）
export const PATCH_PHI = 2.4;
export const PATCH_THETA = 2.0;

const INK = '#1f0d09';

// 端が丸い筆のような線を、中心線の点列に沿って描く
function brush(g: CanvasRenderingContext2D, pts: [number, number][], w: number, color = INK) {
  g.strokeStyle = color;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  g.lineTo(last[0], last[1]);
  g.stroke();
}

// 原点 = 頭の中心 (625,520)。参考画像の座標 (X,Y) は (X-625, Y-520)
function drawFlat(g: CanvasRenderingContext2D, happy: boolean) {
  // ---- ほっぺ ---- 測定：左 x346–477 / y505–612、中心(411,559)、右 x785–911、中心(847,558)
  for (const s of [-1, 1]) {
    const bx = s * 214 + (s > 0 ? 0 : 0), by = 39;
    const rx = 65.5, ry = 53.5;
    // 均一な単色のサーモンピンク（参考画像は照明で左右の色が少し違う：左 (235,131,146) / 右 (250,160,162)）
    g.fillStyle = s < 0 ? '#ee8894' : '#f79ba0';
    g.beginPath();
    g.ellipse(bx, by, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
    // 4本の斜線（測定）：太さ約14、長さ約50、本ごとに傾きが違う。外側ほど傾きが反対向きになる
    // 行ごとに追った中心線（絶対座標）。4本とも同じ向きの「/」で、下へ行くほど左へ約16°ずれる
    // 左ほっぺ：[上の x, 下の x, 上の y, 下の y]
    const L = [
      [382, 367, 531, 574],
      [411, 393, 532, 576],
      [439, 422, 535, 576],
      [462, 449, 545, 576],
    ];
    const R = [
      [818, 803, 534, 576],
      [849, 832, 534, 576],
      [877, 862, 536, 576],
      [897, 887, 546, 576],
    ];
    (s < 0 ? L : R).forEach(([xt, xb, yt, yb]) => {
      // 太さ約14の丸い端の線。中心線の両端は、丸い先の分だけ内側
      brush(g, [[xt - 625, yt - 520], [(xt + xb) / 2 - 625, (yt + yb) / 2 - 520], [xb - 625, yb - 520]], 12.5);
    });
  }

  for (const s of [-1, 1]) {
    // ---- 眉 ---- 測定：左 x494–536、y 401→391（内側が高い）、右は対称。太さ約9、幅約48
    const ex = s * 114;
    // 八の字：内側（鼻側）が高く、外側が大きく下がる
    // ex = s*114 なので、鼻側（内側）は ex - s*、耳側（外側）は ex + s* の向き
    const inner = [ex - s * 21, -137], mid = [ex - s * 1, -128], outer = [ex + s * 22, -112];
    brush(g, [outer as [number, number], mid as [number, number], inner as [number, number]], 8);
    // ---- 目 ---- 中心 (511,484) → (-114,-36)、幅89 × 高さ95
    const ey = -36;
    if (happy) {
      brush(g, [[ex - 38, ey + 14], [ex - 20, ey - 22], [ex, ey - 30], [ex + 20, ey - 22], [ex + 38, ey + 14]], 14);
      continue;
    }
    // 瞳：幅89 × 高さ95、ほぼ純黒（26,4,0）。質感のグラデーションは付けない
    const rx = 44.5, ry = 47.5;
    g.fillStyle = '#1a0400';
    g.beginPath();
    g.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.beginPath();
    g.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2);
    g.clip();
    // 大きな丸いハイライト（単色）：瞳の中心から (+2, -17)、幅38 × 高さ34、色 (226,211,222)
    g.fillStyle = '#e2d3de';
    g.beginPath();
    g.ellipse(ex + 2, ey - 17, 19, 17, 0, 0, Math.PI * 2);
    g.fill();
    // 右上の小さな光の点：(+27, -18)、5×6、少しぼけた白
    const sp = g.createRadialGradient(ex + 27, ey - 18, 0.5, ex + 27, ey - 18, 4.5);
    sp.addColorStop(0, 'rgba(255,255,255,1)');
    sp.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sp;
    g.beginPath();
    g.arc(ex + 27, ey - 18, 4.5, 0, Math.PI * 2);
    g.fill();
    // 左下の小さな丸：(-15, +12)、幅10、色 (235,213,215)
    g.fillStyle = '#ebd5d7';
    g.beginPath();
    g.arc(ex - 15, ey + 12, 5, 0, Math.PI * 2);
    g.fill();
    // 下の細長い三日月：(+2, +24)、幅33 × 高さ17、色 (240,200,201)。ゆるく下に反った棒状
    g.fillStyle = '#f0c8c9';
    g.beginPath();
    g.moveTo(ex - 14, ey + 18);
    g.quadraticCurveTo(ex - 15, ey + 14, ex - 9, ey + 16);
    g.quadraticCurveTo(ex + 2, ey + 22, ex + 14, ey + 15);
    g.quadraticCurveTo(ex + 19, ey + 14, ex + 18, ey + 19);
    g.quadraticCurveTo(ex + 14, ey + 32, ex, ey + 33);
    g.quadraticCurveTo(ex - 12, ey + 32, ex - 14, ey + 18);
    g.closePath();
    g.fill();
    g.restore();
  }

  // ---- 鼻と口 ---- 実測（絶対座標）：鼻 x612–644 / y533–551（下ほど細い）、縦線 幅12 / y552–566、
  // 口は縦線の下で左右へ分かれ、底は y≈582、両端は x=566 と 688、端の丸の中心は y≈566
  const cx = 628 - 625; // 鼻の中心 x=628
  const Y0 = 520;
  if (happy) {
    // （笑顔は今は使わない。互換のために残している）
    noseShape(g, cx, 533 - Y0);
    return;
  }
  noseShape(g, cx, 533 - Y0);
  // 鼻から下の太い縦線
  brush(g, [[cx, 548 - Y0], [cx, 570 - Y0]], 13);
  // 口：縦線の下から大きな弧で左右へ広がり、両端が丸く上へ跳ねる。線の太さ約15
  for (const s of [-1, 1]) {
    brush(
      g,
      [
        [cx + s * 2, 566 - Y0],
        [cx + s * 11, 577 - Y0],
        [cx + s * 25, 583 - Y0],
        [cx + s * 40, 582 - Y0],
        [cx + s * 51, 575 - Y0],
        [cx + s * 57, 565 - Y0],
      ],
      14,
    );
  }
}

// 鼻：横に広い丸みのある台形。上が広く、下へゆるやかにすぼまる（幅32 × 高さ約19）
function noseShape(g: CanvasRenderingContext2D, cx: number, top: number) {
  g.fillStyle = INK;
  g.beginPath();
  g.moveTo(cx - 12, top);
  g.lineTo(cx + 12, top);
  g.quadraticCurveTo(cx + 18, top + 1, cx + 16, top + 6);
  g.quadraticCurveTo(cx + 13, top + 10, cx + 8, top + 15);
  g.lineTo(cx + 6, top + 19);
  g.lineTo(cx - 6, top + 19);
  g.lineTo(cx - 8, top + 15);
  g.quadraticCurveTo(cx - 13, top + 10, cx - 16, top + 6);
  g.quadraticCurveTo(cx - 18, top + 1, cx - 12, top);
  g.closePath();
  g.fill();
  // 鼻の右上にごく小さなつや
  g.fillStyle = 'rgba(255,215,205,0.45)';
  g.beginPath();
  g.ellipse(cx + 9, top + 3, 4.5, 1.8, -0.2, 0, Math.PI * 2);
  g.fill();
}

// 確認用：正面の絵そのものを、参考画像と同じ縮尺（1px=参考画像の1px）で書き出す
export function refFaceFlat(happy = false): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 680;
  c.height = 310;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fdf1f0';
  g.fillRect(0, 0, 680, 310);
  g.translate(340, 190);
  drawFlat(g, happy);
  return c;
}

// 顔パーツのテクスチャー（前面の球の一部に貼る。顔以外は透明）
export function refFaceTexture(happy: boolean, size = 2048): THREE.CanvasTexture {
  // 1) 正面の絵を高解像度で描く
  const FS = 3;
  const FW = 800 * FS, FH = 700 * FS;
  const flat = document.createElement('canvas');
  flat.width = FW;
  flat.height = FH;
  const fg = flat.getContext('2d')!;
  fg.translate(FW / 2, FH / 2);
  fg.scale(FS, FS);
  drawFlat(fg, happy);
  const fd = fg.getImageData(0, 0, FW, FH).data;

  // 2) 球面の各点が正面のどこに見えるかを計算して、絵を写す
  const W = size, H = Math.round((size * PATCH_THETA) / PATCH_PHI);
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const og = out.getContext('2d')!;
  const img = og.createImageData(W, H);
  const d = img.data;
  const sample = (x: number, y: number, o: number) => {
    // 双一次補間
    const x0 = Math.floor(x), y0 = Math.floor(y);
    if (x0 < 0 || y0 < 0 || x0 >= FW - 1 || y0 >= FH - 1) return;
    const fx = x - x0, fy = y - y0;
    const i00 = (y0 * FW + x0) * 4, i10 = i00 + 4, i01 = i00 + FW * 4, i11 = i01 + 4;
    for (let c = 0; c < 4; c++) {
      d[o + c] = (fd[i00 + c] * (1 - fx) + fd[i10 + c] * fx) * (1 - fy) + (fd[i01 + c] * (1 - fx) + fd[i11 + c] * fx) * fy;
    }
  };
  for (let j = 0; j < H; j++) {
    const lat = (j / (H - 1) - 0.5) * PATCH_THETA; // 下向きが正
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < W; i++) {
      const phi = (i / (W - 1) - 0.5) * PATCH_PHI; // 右向きが正
      const dx = HEAD_HALF_W * Math.sin(phi) * cl;
      const dy = HEAD_HALF_H * sl;
      sample(FW / 2 + dx * FS, FH / 2 + dy * FS, (j * W + i) * 4);
    }
  }
  og.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// 顔パーツ用の球の一部（頭と同じ比率でスケールして使う）
export function facePatchGeometry(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1.004, 96, 80, Math.PI / 2 - PATCH_PHI / 2, PATCH_PHI, Math.PI / 2 - PATCH_THETA / 2, PATCH_THETA);
}
