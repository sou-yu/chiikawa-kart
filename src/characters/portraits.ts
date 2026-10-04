import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CHARACTERS } from '../config/characters';
import { createGltfCharacter, hasCharacterModel } from './GltfCharacter';
import { setModelIcon } from './icons';

const INK = '#5a4234';
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// キャラ選択画面の一覧に並べる小さな絵（thumb）。ゲームで使う 3D モデルそのものを、
// 別の小さな描画器で撮る（画像ファイルは使わない）。撮り終えたら描画器は捨てる。
// ついでに、同じモデルの顔アップから、ミニマップ・けっか・観客に使う顔アイコンも作る（icons.ts）。
// 1 体ごとに一息ついて、画面の操作（キャラを選ぶなど）を止めないようにする
export interface CharArt {
  thumb: string; // 正面から見た、キャラとカート（一覧のシール用）
}

export async function renderPortraits(ids: string[]): Promise<Record<string, CharArt>> {
  const out: Record<string, CharArt> = {};
  const W = 720, H = 540;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.85;
  scene.add(new THREE.HemisphereLight('#ffffff', '#ffd9e4', 1.1));
  const sun = new THREE.DirectionalLight('#fff4e4', 2.3);
  sun.position.set(3.5, 6, 5);
  scene.add(sun);

  // 足もとのやわらかい影
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(90,50,70,0.35)');
  grd.addColorStop(1, 'rgba(90,50,70,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(4.4, 4.4).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  );
  shadow.position.y = 0.01;
  scene.add(shadow);

  // 一覧のシール用：正面から、顔とカートの前がちょうど収まる（1:1）
  const THUMB = 360;
  const thumb = new THREE.PerspectiveCamera(16, 1, 0.1, 60);
  thumb.position.set(0.3, 1.95, 10);
  thumb.lookAt(0, 1.2, 0);
  const shot = (cam: THREE.PerspectiveCamera, w: number, h: number) => {
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    renderer.render(scene, cam);
    return canvas.toDataURL('image/png');
  };
  shadow.visible = false; // 足もとの影は、画面の台がつくるので撮らない

  // 顔アイコン用：正面から、まっすぐ（遠近をつけない）。耳やたてがみまで入る広めの枠で撮り、あとで顔の大きさに合わせて切り出す
  const FRAME = 2.7; // 枠の高さ（m）。中心の高さは 1.95m
  const FRAME_CY = 1.95;
  const NECK_Y = 0.92; // これより下（体）は使わない
  const NECK_PX = H / 2 - ((NECK_Y - FRAME_CY) * H) / FRAME; // その高さの、絵の上からの位置（px）
  const fw = (FRAME * W) / H;
  const ortho = new THREE.OrthographicCamera(-fw / 2, fw / 2, FRAME / 2, -FRAME / 2, 0.1, 40);
  ortho.position.set(0, FRAME_CY, 10);
  ortho.lookAt(0, FRAME_CY, 0);

  for (const id of ids) {
    const spec = CHARACTERS.find((s) => s.id === id);
    if (!spec || !hasCharacterModel(id)) continue;
    const m = createGltfCharacter(spec);
    scene.add(m.root);
    out[id] = { thumb: shot(thumb, THUMB, THUMB) };
    renderer.setSize(W, H, false);

    // 顔アイコン：キャラ（と、しっぽ）だけを残し、耳の先までが入る高さで撮る
    for (const ch of m.root.children) ch.visible = ch === m.driver;
    m.head.traverse((o) => {
      if (o.name.endsWith('_ArmRig')) o.visible = false;
    });
    if (m.head.children.some((o) => o.name.endsWith('_Driver'))) {
      renderer.render(scene, ortho);
      setModelIcon(id, makeIcon(canvas, W, H, NECK_PX));
    }
    scene.remove(m.root);
    await tick();
  }
  pmrem.dispose();
  scene.environment?.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}

// 撮った絵から、首より上の「絵のある範囲」を見つけ、顔がちょうど収まる正方形に切り出して、ふちどりつきの絵にする。
// 首の下は丸く切り落とし、耳は上にはみ出してよい（上半分は四角く切り抜く）。ふちは、切り抜いた形にそって引く
function makeIcon(src: HTMLCanvasElement, W: number, H: number, neckPx: number, S = 256): HTMLCanvasElement {
  // 描画器の絵は次の撮影で消えるので、写し取ってから調べる
  const tmp = document.createElement('canvas');
  tmp.width = W;
  tmp.height = H;
  const t = tmp.getContext('2d', { willReadFrequently: true })!;
  t.drawImage(src, 0, 0);
  const rows = Math.floor(neckPx);
  const px = t.getImageData(0, 0, W, rows).data;
  let x0 = W, x1 = 0, y0 = rows, y1 = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < W; x++) {
      if (px[(y * W + x) * 4 + 3] > 40) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 <= x0 || y1 <= y0) return tmp;
  const side = Math.max(x1 - x0, y1 - y0) * 1.06;
  const sx = (x0 + x1) / 2 - side / 2;
  const sy = neckPx - side; // 切り出す正方形の下を、首の高さにそろえる（首より下は使わない）

  const pad = 14; // ふちどりの分
  const inner = S - pad * 2;
  const fig = document.createElement('canvas');
  fig.width = fig.height = S;
  const g = fig.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.save();
  g.beginPath();
  const cx = S / 2, cy = S / 2, R = inner * 0.5;
  g.rect(0, 0, S, cy);
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.clip();
  g.drawImage(tmp, sx, sy, side, side, pad, pad, inner, inner);
  g.restore();

  // ふち：切り抜いた形を、まわり 16 方向にずらして重ね、ふちの色で塗る
  const ol = document.createElement('canvas');
  ol.width = ol.height = S;
  const o = ol.getContext('2d')!;
  const r = 6;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    o.drawImage(fig, Math.cos(a) * r, Math.sin(a) * r);
  }
  o.globalCompositeOperation = 'source-in';
  o.fillStyle = INK;
  o.fillRect(0, 0, S, S);
  o.globalCompositeOperation = 'source-over';
  o.drawImage(fig, 0, 0);
  return ol;
}
