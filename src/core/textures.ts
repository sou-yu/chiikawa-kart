import * as THREE from 'three';
import { PAL } from '../config/palette';
import { mulberry32 } from './random';

export const FONT = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Hiragino Sans", sans-serif';

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

// 描画コードは w×h のまま、実際のピクセルは scale 倍（高解像度化）
export function makeCanvasHi(w: number, h: number, scale = 2): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const [c, g] = makeCanvas(w * scale, h * scale);
  g.scale(scale, scale);
  return [c, g];
}

export function toTexture(c: HTMLCanvasElement, repeat?: [number, number]): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

// 端をまたぐ模様を反対側にも描いて、つなぎ目なく繰り返せるようにする
function tiled(size: number, x: number, y: number, r: number, draw: (x: number, y: number) => void) {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      const px = x + ox, py = y + oy;
      if (px + r < 0 || px - r > size || py + r < 0 || py - r > size) continue;
      draw(px, py);
    }
  }
}

function blotches(g: CanvasRenderingContext2D, size: number, rand: () => number, n: number, colors: string[], rMin: number, rMax: number) {
  for (let i = 0; i < n; i++) {
    const x = rand() * size, y = rand() * size, r = rMin + rand() * (rMax - rMin);
    const col = colors[Math.floor(rand() * colors.length)];
    tiled(size, x, y, r, (px, py) => {
      const grd = g.createRadialGradient(px, py, 0, px, py, r);
      grd.addColorStop(0, col);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
}

// 明るさ＝高さとみなして法線マップ（凹凸）を作る
export function heightToNormal(src: HTMLCanvasElement, strength = 2): THREE.CanvasTexture {
  const w = src.width, h = src.height;
  const data = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const hgt = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hgt[i] = (data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11) / 255;
  const [c, g] = makeCanvas(w, h);
  const out = g.createImageData(w, h);
  const at = (x: number, y: number) => hgt[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = (1 / len) * 255;
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// ぬいぐるみの布の毛羽立ち（細かい凹凸）
let fabricCache: THREE.CanvasTexture | null = null;
export function fabricNormal(): THREE.CanvasTexture {
  if (fabricCache) return fabricCache;
  const S = 256;
  const [c, g] = makeCanvas(S, S);
  const rand = mulberry32(17);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const x = rand() * S, y = rand() * S;
    const v = Math.floor(90 + rand() * 90);
    g.strokeStyle = `rgba(${v},${v},${v},0.5)`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y);
    const a = rand() * Math.PI * 2;
    g.lineTo(x + Math.cos(a) * 3, y + Math.sin(a) * 3);
    g.stroke();
  }
  fabricCache = heightToNormal(c, 3);
  return fabricCache;
}

// 土の道（u = 道の横方向, v = 進行方向）。色と凹凸をセットで作ってキャッシュ
let dirtCache: { map: THREE.CanvasTexture; normal: THREE.CanvasTexture } | null = null;
export function dirtTextures(): { map: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
  if (dirtCache) return dirtCache;
  const S = 1024;
  const [c, g] = makeCanvas(S, S);
  const rand = mulberry32(11);
  g.fillStyle = PAL.dirt;
  g.fillRect(0, 0, S, S);
  // 水彩のにじみ
  blotches(g, S, rand, 90, ['rgba(214,178,138,0.35)', 'rgba(250,232,205,0.45)', 'rgba(230,196,160,0.3)', 'rgba(240,210,200,0.25)'], 60, 200);
  // わだち（淡いにじみ）
  for (const x of [0.3, 0.7]) {
    const grd = g.createLinearGradient(S * x - 90, 0, S * x + 90, 0);
    grd.addColorStop(0, 'rgba(190,150,110,0)');
    grd.addColorStop(0.5, 'rgba(190,150,110,0.2)');
    grd.addColorStop(1, 'rgba(190,150,110,0)');
    g.fillStyle = grd;
    g.fillRect(S * x - 90, 0, 180, S);
  }
  // 筆でなでたストローク
  g.lineCap = 'round';
  for (let i = 0; i < 420; i++) {
    const x = rand() * S, y = rand() * S, len = 30 + rand() * 90;
    g.strokeStyle = rand() < 0.5 ? `rgba(200,160,118,${0.1 + rand() * 0.12})` : `rgba(255,244,226,${0.12 + rand() * 0.14})`;
    g.lineWidth = 4 + rand() * 10;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + (rand() - 0.5) * 20, y + len / 2, x + (rand() - 0.5) * 16, y + len);
    g.stroke();
  }
  // ころんとした小石（細い茶色の輪郭＝手描き風）
  for (let i = 0; i < 520; i++) {
    const x = rand() * S, y = rand() * S, r = 3 + rand() * 7;
    const rot = rand() * 3, sq = 0.65 + rand() * 0.3;
    g.fillStyle = ['#f6e6cc', '#e2c7a0', '#efd9bb', '#dcd2c8'][Math.floor(rand() * 4)];
    g.strokeStyle = 'rgba(130,95,70,0.55)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.ellipse(x, y, r, r * sq, rot, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.beginPath();
    g.ellipse(x - r * 0.3, y - r * 0.3, r * 0.3, r * 0.2, rot, 0, Math.PI * 2);
    g.fill();
  }
  // 小さな点々
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(180,140,100,0.25)' : 'rgba(255,248,235,0.35)';
    g.beginPath();
    g.arc(rand() * S, rand() * S, 1 + rand() * 1.5, 0, Math.PI * 2);
    g.fill();
  }
  const map = toTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  dirtCache = { map, normal: heightToNormal(c, 2) };
  return dirtCache;
}

// 道のふちにかぶさる草（x = 進行方向で繰り返し、y = 下が草地側・上が道側で透明）
export function roadEdgeTexture(): THREE.CanvasTexture {
  const W = 512, H = 128;
  const [c, g] = makeCanvas(W, H);
  const rand = mulberry32(31);
  const grd = g.createLinearGradient(0, H, 0, H * 0.35);
  grd.addColorStop(0, PAL.grass);
  grd.addColorStop(1, PAL.grassLight);
  // 葉先が道に向かって伸びるギザギザの草
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < 90; i++) {
      const x = (i / 90) * W + rand() * 6;
      const h = H * (0.35 + rand() * 0.55);
      const w = 6 + rand() * 8;
      const lean = (rand() - 0.5) * 14;
      for (const ox of [-W, 0, W]) {
        g.fillStyle = pass ? grd : '#8fc46a';
        g.beginPath();
        g.moveTo(ox + x - w, H);
        g.quadraticCurveTo(ox + x - w * 0.3 + lean * 0.5, H - h * 0.6, ox + x + lean, H - h);
        g.quadraticCurveTo(ox + x + w * 0.3 + lean * 0.5, H - h * 0.6, ox + x + w, H);
        g.fill();
      }
    }
  }
  g.fillStyle = PAL.grass;
  g.fillRect(0, H * 0.8, W, H * 0.2);
  // ところどころに小さな花
  for (let i = 0; i < 14; i++) {
    const x = rand() * W, y = H * (0.45 + rand() * 0.35);
    g.fillStyle = ['#ffffff', '#fff3a0', '#ffd0dd'][i % 3];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      g.beginPath();
      g.arc(x + Math.cos(a) * 3.5, y + Math.sin(a) * 3.5, 2.6, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#f5b73b';
    g.beginPath();
    g.arc(x, y, 2, 0, Math.PI * 2);
    g.fill();
  }
  const t = toTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// 手描きの木目（柵・橋・看板・屋台）
let woodCache: THREE.CanvasTexture | null = null;
export function woodTexture(): THREE.CanvasTexture {
  if (woodCache) return woodCache;
  const S = 256;
  const [c, g] = makeCanvasHi(S, S);
  const rand = mulberry32(44);
  g.fillStyle = PAL.wood;
  g.fillRect(0, 0, S, S);
  blotches(g, S, rand, 20, ['rgba(220,180,135,0.4)', 'rgba(160,120,85,0.25)'], 20, 60);
  g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = rand() * S;
    g.strokeStyle = `rgba(120,85,58,${0.25 + rand() * 0.25})`;
    g.lineWidth = 1 + rand() * 1.5;
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x + (rand() - 0.5) * 14, S * 0.33, x + (rand() - 0.5) * 14, S * 0.66, x + (rand() - 0.5) * 8, S);
    g.stroke();
  }
  for (let i = 0; i < 4; i++) {
    const x = rand() * S, y = rand() * S;
    g.strokeStyle = 'rgba(110,78,52,0.5)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.ellipse(x, y, 5, 9, 0, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.ellipse(x, y, 2, 4, 0, 0, Math.PI * 2);
    g.stroke();
  }
  woodCache = toTexture(c);
  woodCache.wrapS = woodCache.wrapT = THREE.RepeatWrapping;
  return woodCache;
}

// 水彩紙のざらざら（後処理で画面に掛ける。白っぽいほど影響なし）
export function paperTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = makeCanvas(S, S);
  const rand = mulberry32(77);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  blotches(g, S, rand, 60, ['rgba(200,200,200,0.35)', 'rgba(225,225,225,0.4)'], 30, 110);
  for (let i = 0; i < 14000; i++) {
    const v = 150 + Math.floor(rand() * 90);
    g.fillStyle = `rgba(${v},${v},${v},${0.15 + rand() * 0.25})`;
    g.fillRect(rand() * S, rand() * S, 1 + rand() * 1.5, 1 + rand() * 1.5);
  }
  // 紙の繊維
  for (let i = 0; i < 500; i++) {
    const x = rand() * S, y = rand() * S, a = rand() * Math.PI;
    g.strokeStyle = 'rgba(170,170,170,0.2)';
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function dirtTexture(): THREE.CanvasTexture {
  return dirtTextures().map;
}

export function grassTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = makeCanvas(S, S);
  const rand = mulberry32(5);
  g.fillStyle = PAL.grass;
  g.fillRect(0, 0, S, S);
  // 水彩のにじみ（明暗の差は小さく）
  blotches(g, S, rand, 60, ['rgba(160,208,122,0.4)', 'rgba(210,236,170,0.4)', 'rgba(170,215,140,0.3)', 'rgba(225,240,190,0.3)'], 50, 150);
  const cols = ['rgba(150,200,112,0.45)', 'rgba(200,232,160,0.5)', 'rgba(140,195,105,0.35)'];
  g.lineCap = 'round';
  for (let i = 0; i < 2600; i++) {
    const x = rand() * S, y = rand() * S;
    g.strokeStyle = cols[Math.floor(rand() * cols.length)];
    g.lineWidth = 1.6 + rand() * 1.4;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + (rand() - 0.5) * 4, y - 4, x + (rand() - 0.5) * 5, y - 6 - rand() * 6);
    g.stroke();
  }
  // クローバーと小さな白い花
  for (let i = 0; i < 40; i++) {
    const x = rand() * S, y = rand() * S;
    g.fillStyle = 'rgba(135,190,100,0.7)';
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.3;
      g.beginPath();
      g.arc(x + Math.cos(a) * 3, y + Math.sin(a) * 3, 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = 'rgba(255,255,250,0.85)';
    g.beginPath();
    g.arc(rand() * S, rand() * S, 1.4, 0, Math.PI * 2);
    g.fill();
  }
  return toTexture(c);
}

export function skyTexture(): THREE.CanvasTexture {
  const [c, g] = makeCanvas(4, 512);
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#4f9fe6');
  grd.addColorStop(0.35, '#86c3f0');
  grd.addColorStop(0.5, '#cfeafa');
  grd.addColorStop(0.56, '#eef8fb');
  grd.addColorStop(1, '#eef8fb');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 512);
  return toTexture(c);
}

// 丸い花びらのパステルなお花（白で描き、インスタンスの色で染める）
export function pastelFlowerTexture(): THREE.CanvasTexture {
  const [c, g] = makeCanvasHi(128, 128);
  g.translate(64, 64);
  const petals = 6;
  for (let i = 0; i < petals; i++) {
    g.save();
    g.rotate((i / petals) * Math.PI * 2);
    const grd = g.createRadialGradient(0, -30, 4, 0, -30, 30);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(1, '#f1ecf0');
    g.fillStyle = grd;
    g.strokeStyle = 'rgba(150,120,130,0.55)';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(0, -31, 19, 27, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
  }
  const cg = g.createRadialGradient(-4, -4, 2, 0, 0, 18);
  cg.addColorStop(0, '#fff3a6');
  cg.addColorStop(1, '#ffc94a');
  g.fillStyle = cg;
  g.strokeStyle = 'rgba(190,130,60,0.6)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(0, 0, 16, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  return toTexture(c);
}

// 顔つきの大きなデイジー
export function faceDaisyTexture(): THREE.CanvasTexture {
  const [c, g] = makeCanvasHi(256, 256);
  g.translate(128, 128);
  for (let i = 0; i < 12; i++) {
    g.save();
    g.rotate((i / 12) * Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.strokeStyle = 'rgba(140,120,120,0.5)';
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(0, -76, 22, 50, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
  }
  const cg = g.createRadialGradient(-10, -12, 6, 0, 0, 52);
  cg.addColorStop(0, '#fff6a8');
  cg.addColorStop(1, '#ffcf3f');
  g.fillStyle = cg;
  g.strokeStyle = 'rgba(190,130,50,0.7)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(0, 0, 50, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  // にっこり顔
  g.fillStyle = '#3a2a22';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(s * 16, -4, 4.5, 6, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,150,170,0.75)';
    g.beginPath();
    g.ellipse(s * 29, 10, 9, 5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3a2a22';
  }
  g.strokeStyle = '#3a2a22';
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(-4, 9, 4, 0, Math.PI);
  g.arc(4, 9, 4, 0, Math.PI);
  g.stroke();
  return toTexture(c);
}

export function daisyTexture(): THREE.CanvasTexture {
  const [c, g] = makeCanvasHi(128, 128);
  g.translate(64, 64);
  for (let i = 0; i < 14; i++) {
    g.save();
    g.rotate((i / 14) * Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.strokeStyle = 'rgba(180,180,200,0.6)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.ellipse(0, -34, 8, 24, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
  }
  const grd = g.createRadialGradient(-3, -3, 2, 0, 0, 15);
  grd.addColorStop(0, '#ffe36b');
  grd.addColorStop(1, '#f2a91f');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(0, 0, 14, 0, Math.PI * 2);
  g.fill();
  return toTexture(c);
}

export function checkerTexture(): THREE.CanvasTexture {
  const [c, g] = makeCanvas(128, 32);
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#2b2524' : '#ffffff';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  const t = toTexture(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

// 虹色の半透明「？」ボックス
export function itemBoxTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = makeCanvasHi(S, S);
  const grd = g.createLinearGradient(0, 0, S, S);
  ['#ff9bd2', '#ffe082', '#a6ffb8', '#86d6ff', '#c7a2ff', '#ff9bd2'].forEach((col, i, a) => grd.addColorStop(i / (a.length - 1), col));
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const shine = g.createLinearGradient(0, 0, 0, S);
  shine.addColorStop(0, 'rgba(255,255,255,0.55)');
  shine.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  shine.addColorStop(1, 'rgba(255,255,255,0.3)');
  g.fillStyle = shine;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 14;
  g.strokeRect(7, 7, S - 14, S - 14);
  g.font = `900 170px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 16;
  g.strokeStyle = '#2f6fd0';
  g.strokeText('?', S / 2, S / 2 + 8);
  g.fillStyle = '#ffffff';
  g.fillText('?', S / 2, S / 2 + 8);
  return toTexture(c);
}

// 木の看板（手書き風の文字＋くまの落書き）
export function signTexture(lines: string[]): THREE.CanvasTexture {
  const W = 512, H = 256;
  const [c, g] = makeCanvasHi(W, H);
  const rand = mulberry32(lines.join('').length * 7 + 3);
  g.fillStyle = '#e7d2ae';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) {
    const y = rand() * H;
    g.strokeStyle = `rgba(150,110,70,${0.1 + rand() * 0.15})`;
    g.lineWidth = 1 + rand() * 2;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(W * 0.3, y + (rand() - 0.5) * 12, W * 0.7, y + (rand() - 0.5) * 12, W, y + (rand() - 0.5) * 8);
    g.stroke();
  }
  g.strokeStyle = '#8a6541';
  g.lineWidth = 16;
  g.strokeRect(8, 8, W - 16, H - 16);

  g.fillStyle = '#4b3a2b';
  g.textBaseline = 'middle';
  // 右のくまの落書きにかからない幅に収める
  const maxW = W - 215;
  let fontSize = 58;
  g.font = `800 ${fontSize}px ${FONT}`;
  const widest = Math.max(...lines.map((l, i) => g.measureText(l).width + i * 24));
  if (widest > maxW) fontSize = Math.floor((fontSize * maxW) / widest);
  g.font = `800 ${fontSize}px ${FONT}`;
  const lh = fontSize * 1.3;
  const y0 = H / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => g.fillText(l, 36 + i * 24, y0 + i * lh));

  // くまの落書き
  const cx = W - 110, cy = H / 2 + 10;
  g.strokeStyle = '#4b3a2b';
  g.lineWidth = 5;
  g.lineCap = 'round';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.arc(cx + s * 40, cy - 38, 14, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = '#e7d2ae';
  g.beginPath();
  g.ellipse(cx, cy, 58, 48, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#4b3a2b';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(cx + s * 20, cy - 4, 5, 7, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.lineWidth = 3.5;
  g.beginPath();
  g.arc(cx - 6, cy + 12, 6, 0, Math.PI);
  g.arc(cx + 6, cy + 12, 6, 0, Math.PI);
  g.stroke();
  g.strokeStyle = '#e98aa0';
  for (const s of [-1, 1]) {
    for (let k = -1; k <= 1; k++) {
      g.beginPath();
      g.moveTo(cx + s * 36 + k * 6 - 2, cy + 18);
      g.lineTo(cx + s * 36 + k * 6 + 3, cy + 10);
      g.stroke();
    }
  }
  return toTexture(c);
}

export function bannerTexture(text: string): THREE.CanvasTexture {
  const [c, g] = makeCanvasHi(1024, 160);
  const grd = g.createLinearGradient(0, 0, 0, 160);
  grd.addColorStop(0, '#ff9fb8');
  grd.addColorStop(1, '#ff7d9c');
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 160);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 10;
  g.setLineDash([24, 16]);
  g.strokeRect(14, 14, 996, 132);
  g.setLineDash([]);
  g.font = `900 92px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 14;
  g.strokeStyle = '#8c3550';
  g.strokeText(text, 512, 86);
  g.fillStyle = '#ffffff';
  g.fillText(text, 512, 86);
  return toTexture(c);
}

// 遠くの丘（顔つき）
export function faceHillTexture(): THREE.CanvasTexture {
  const W = 1024, H = 512;
  const [c, g] = makeCanvasHi(W, H);
  const rand = mulberry32(21);
  g.fillStyle = '#eee0c8';
  g.fillRect(0, 0, W, H);
  blotches(g, W, rand, 50, ['rgba(215,195,165,0.4)', 'rgba(250,240,225,0.5)'], 20, 70);
  // 頭の上の緑
  g.fillStyle = '#7cbf5a';
  g.beginPath();
  g.moveTo(0, 0);
  for (let x = 0; x <= W; x += 16) g.lineTo(x, 70 + Math.sin(x * 0.05) * 8 + Math.sin(x * 0.013) * 14);
  g.lineTo(W, 0);
  g.fill();
  blotches(g, W, rand, 30, ['rgba(90,160,60,0.5)', 'rgba(150,210,100,0.5)'], 10, 30);
  g.fillStyle = '#eee0c8';
  g.fillRect(0, 95, W, 5);
  // 顔（-Z 側 = u 0.75 付近）
  const cx = 768, cy = 190;
  g.strokeStyle = '#4a3a30';
  g.lineCap = 'round';
  g.lineWidth = 9;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx + s * 70 - 16, cy);
    g.lineTo(cx + s * 70 + 16, cy);
    g.stroke();
  }
  g.lineWidth = 6;
  g.beginPath();
  g.arc(cx - 9, cy + 30, 9, 0, Math.PI);
  g.arc(cx + 9, cy + 30, 9, 0, Math.PI);
  g.stroke();
  for (const s of [-1, 1]) {
    g.fillStyle = 'rgba(245,150,170,0.75)';
    g.beginPath();
    g.ellipse(cx + s * 120, cy + 26, 30, 16, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#e0708e';
    g.lineWidth = 4;
    for (let k = -1; k <= 1; k++) {
      g.beginPath();
      g.moveTo(cx + s * 120 + k * 12 - 4, cy + 36);
      g.lineTo(cx + s * 120 + k * 12 + 6, cy + 18);
      g.stroke();
    }
  }
  return toTexture(c);
}
