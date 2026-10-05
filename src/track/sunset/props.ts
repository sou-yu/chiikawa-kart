import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../core/random';
import { scallopFanGeometry } from './gate';

// 夕焼け海岸の飾り（草・花・茂み・サンゴ・浜のこもの・鳥・舟）の形。
// どれも少ない三角形で、頂点カラー（根もとは暗く、先は明るく）で立体感を出す。
// インスタンスの色（setColorAt）を掛け合わせて、色ちがいを作る。
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
type RGB = [number, number, number];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// 頂点に色（位置の関数）をつける
function paint(g: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => RGB): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = fn(p.getX(i), p.getY(i), p.getZ(i));
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const solid = (g: THREE.BufferGeometry, c: RGB) => paint(g, () => c);
// 位置・法線だけの、インデックスなしの形にそろえる（merge できるように）
function flat(g: THREE.BufferGeometry, keepUv = false): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  if (!keepUv) n.deleteAttribute('uv');
  return n;
}

// 葉っぱ 1 枚：中心線の点と、各点での半幅から細い板を作る（最後の点の半幅が 0 なら、先がとがる）
function bladeStrip(rows: { x: number; y: number; z: number; hw: number }[], px: number, pz: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  let prev: number[] = [];
  for (const r of rows) {
    const cur: number[] = [];
    if (r.hw > 1e-4) {
      cur.push(pos.length / 3);
      pos.push(r.x - px * r.hw, r.y, r.z - pz * r.hw);
      cur.push(pos.length / 3);
      pos.push(r.x + px * r.hw, r.y, r.z + pz * r.hw);
    } else {
      cur.push(pos.length / 3);
      pos.push(r.x, r.y, r.z);
    }
    if (prev.length === 2 && cur.length === 2) idx.push(prev[0], prev[1], cur[0], prev[1], cur[1], cur[0]);
    else if (prev.length === 2 && cur.length === 1) idx.push(prev[0], prev[1], cur[0]);
    prev = cur;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------- 草むら：反った細い葉が 7 枚（21 三角形）----------
export function grassTuftGeometry(): THREE.BufferGeometry {
  const rr = mulberry32(3);
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * TAU + rr() * 0.8;
    const len = 0.55 + rr() * 0.4;
    const w = 0.085 + rr() * 0.035;
    const lean = 0.25 + rr() * 0.45;
    const br = 0.03 + rr() * 0.12;
    const dx = Math.cos(a), dz = Math.sin(a);
    const rows = [0, 0.55, 1].map((f, i) => ({
      x: dx * br + dx * lean * len * f * f,
      y: len * f * (1 - 0.2 * f),
      z: dz * br + dz * lean * len * f * f,
      hw: i === 2 ? 0 : w * (1 - 0.45 * f * f),
    }));
    parts.push(bladeStrip(rows, -dz, dx));
  }
  return paint(flat(mergeGeometries(parts)), (_x, y) => {
    const l = 0.52 + 0.48 * clamp01(y / 0.75);
    return [l, l, l * 0.92];
  });
}

// ---------- シダ・大きな葉の草：弓なりの太い葉が 7 枚 ----------
export function fernGeometry(): THREE.BufferGeometry {
  const rr = mulberry32(8);
  const parts: THREE.BufferGeometry[] = [];
  const N = 7, NR = 5;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * TAU + rr() * 0.3;
    const len = 1.3 + rr() * 0.5;
    const pitch0 = 0.9 + rr() * 0.35;
    const w = 0.26 + rr() * 0.08;
    const dx = Math.cos(a), dz = Math.sin(a);
    const rows = [];
    for (let i = 0; i <= NR; i++) {
      const f = i / NR;
      const r = 0.06 + len * f * Math.cos(pitch0 * (1 - 0.5 * f));
      const h = Math.max(0.03, len * (Math.sin(pitch0) * f - 0.85 * f * f) + 0.1); // 上がってから、たれる
      rows.push({ x: dx * r, y: h, z: dz * r, hw: i === NR ? 0 : w * (0.3 + 0.7 * Math.sin(Math.PI * Math.min(1, f * 1.05))) });
    }
    parts.push(bladeStrip(rows, -dz, dx));
  }
  return paint(flat(mergeGeometries(parts)), (x, _y, z) => {
    const l = 0.46 + 0.54 * clamp01(Math.hypot(x, z) / 1.4);
    return [l, l, l * 0.94];
  });
}

// ---------- 小さな野の花（上向き、7 枚の花びらと黄色い芯）----------
export function daisyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * TAU;
    const P = (ang: number, r: number, y: number): [number, number, number] => [Math.cos(ang) * r, y, Math.sin(ang) * r];
    const pts = [P(0, 0, 0.02), P(a - 0.3, 0.08, 0.025), P(a, 0.2, 0.05), P(a + 0.3, 0.08, 0.025)];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    g.computeVertexNormals();
    parts.push(flat(g));
  }
  const center = new THREE.CircleGeometry(0.06, 6).rotateX(-Math.PI / 2).translate(0, 0.06, 0);
  parts.push(flat(center));
  return paint(mergeGeometries(parts), (_x, y) => (y > 0.055 ? [1, 0.72, 0.1] : [1, 1, 1]));
}

// ---------- ハイビスカスの花：5 枚の花びらが、ふちで立ち上がるカップ形（直径 約 1.1m、上向き）----------
// 中心が濃く外が明るい（頂点カラー）。インスタンスの色（赤・ピンク・オレンジ・黄）が掛かる
export function hibiscusGeometry(): THREE.BufferGeometry {
  const R = 0.55, NU = 3, NV = 2;
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      const hw = 0.42 * Math.sqrt(Math.sin(Math.PI * Math.min(1, 0.12 + 0.86 * u))); // 根もとは細く、先はまるい
      for (let j = 0; j <= NV; j++) {
        const v = (j / NV) * 2 - 1;
        pos.push(0.02 + R * u, 0.32 * Math.pow(u, 1.5) + 0.07 * v * v * u - 0.04, v * hw);
      }
    }
    for (let i = 0; i < NU; i++) {
      for (let j = 0; j < NV; j++) {
        const a = i * (NV + 1) + j, b = a + NV + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.rotateY((k / 5) * TAU);
    g.computeVertexNormals();
    parts.push(flat(g));
  }
  const petals = paint(mergeGeometries(parts), (x, _y, z) => {
    const l = 0.34 + 0.66 * smooth(0.05, 0.65, Math.hypot(x, z) / R);
    return [l, l, l];
  });
  // おしべも同じ形にまとめる（描画の回数を増やさないため）。花の色が掛かって、同じ色あいの花粉・柱になる
  return mergeGeometries([petals, stamen()]);
}

// ハイビスカスのおしべ（長い柱、金色の花粉、先は赤）
function stamen(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(solid(flat(new THREE.CylinderGeometry(0.02, 0.03, 0.7, 4, 1, true).translate(0, 0.35, 0)), [1, 0.62, 0.45]));
  parts.push(solid(flat(new THREE.IcosahedronGeometry(0.09, 0).translate(0, 0.72, 0)), [1, 0.85, 0.2]));
  const g = mergeGeometries(parts);
  g.rotateZ(-0.3);
  return g;
}

// ---------- 茂み：3 つの丸を合わせた形（葉っぱ模様のテクスチャを貼る。uv あり）----------
export function bushGeometry(): THREE.BufferGeometry {
  const lobes: [number, number, number, number][] = [
    [0, 0.05, 0, 1],
    [0.78, -0.12, 0.22, 0.76],
    [-0.72, -0.1, -0.2, 0.8],
  ];
  const parts = lobes.map(([x, y, z, s]) => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
      // 位置だけで決まるでこぼこ（面のつなぎ目が割れない）
      const k = 0.9 + 0.12 * Math.sin(px * 5.1 + pz * 3.7) * Math.cos(py * 4.3 + px * 2.9);
      p.setXYZ(i, px * k * s + x, py * k * s * 0.85 + y, pz * k * s + z);
    }
    g.computeVertexNormals();
    return g;
  });
  return paint(mergeGeometries(parts), (_x, y) => {
    const l = 0.5 + 0.5 * clamp01((y + 0.6) / 1.6);
    return [l, l, l];
  });
}

// ---------- サンゴ（4 種類）。根もとは暗く、先は明るい ----------
// 枝サンゴ：2〜3 段に枝分かれ（高さ 約 1.3m）
export function staghornGeometry(): THREE.BufferGeometry {
  const rr = mulberry32(17);
  const parts: THREE.BufferGeometry[] = [];
  const branch = (o: THREE.Vector3, dir: THREE.Vector3, len: number, r0: number, depth: number) => {
    const last = depth >= 2;
    const g = new THREE.CylinderGeometry(last ? 0.02 : r0 * 0.62, r0, len, 4, 1, true).translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
    g.translate(o.x, o.y, o.z);
    parts.push(flat(g));
    if (last) return;
    const n = 2 + (rr() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const from = o.clone().addScaledVector(dir, len * (0.55 + 0.4 * rr()));
      const nd = dir.clone().add(new THREE.Vector3((rr() - 0.5) * 1.3, 0.25 + rr() * 0.35, (rr() - 0.5) * 1.3)).normalize();
      branch(from, nd, len * (0.62 + 0.2 * rr()), r0 * 0.7, depth + 1);
    }
  };
  for (let i = 0; i < 3; i++) {
    const d = new THREE.Vector3((rr() - 0.5) * 0.5, 1, (rr() - 0.5) * 0.5).normalize();
    branch(new THREE.Vector3((rr() - 0.5) * 0.5, 0, (rr() - 0.5) * 0.5), d, 0.55 + rr() * 0.25, 0.11, 0);
  }
  return paint(mergeGeometries(parts), (_x, y) => {
    const l = 0.5 + 0.5 * clamp01(y / 1.3);
    return [l, l, l];
  });
}

// テーブルサンゴ：平たい笠（ふちが波うつ）と柄
export function tableCoralGeometry(): THREE.BufferGeometry {
  const wave = (g: THREE.BufferGeometry) => {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getZ(i));
      p.setY(i, p.getY(i) + 0.05 * Math.sin(Math.atan2(p.getZ(i), p.getX(i)) * 6) * smooth(0.5, 0.95, r));
    }
    return g;
  };
  const stalk = flat(new THREE.CylinderGeometry(0.15, 0.24, 0.5, 6, 1, true).translate(0, 0.25, 0));
  const cap = flat(wave(new THREE.CylinderGeometry(0.95, 0.3, 0.3, 12, 1, true).translate(0, 0.58, 0)));
  const top = flat(wave(new THREE.CircleGeometry(0.95, 12).rotateX(-Math.PI / 2).translate(0, 0.73, 0)));
  const g = mergeGeometries([stalk, cap, top]);
  g.computeVertexNormals();
  return paint(g, (x, y, z) => {
    const l = 0.55 + 0.3 * clamp01((y - 0.2) / 0.55) + 0.15 * smooth(0.5, 0.95, Math.hypot(x, z));
    return [l, l, l];
  });
}

// 脳サンゴ：ふくらんだドーム（しわ模様のでこぼこ）
export function brainCoralGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.8, 2);
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    const k = 1 + 0.05 * Math.sin(v.x * 16 + Math.sin(v.z * 9) * 2) * Math.sin(v.z * 14 + v.y * 7);
    p.setXYZ(i, v.x * 0.8 * k, Math.max(v.y * 0.8 * k * 0.72, -0.12), v.z * 0.8 * k);
  }
  g.computeVertexNormals();
  return paint(g, (_x, y) => {
    const l = 0.62 + 0.38 * clamp01((y + 0.12) / 0.65);
    return [l, l, l];
  });
}

// ウチワサンゴ：立っている扇（ホタテの形を軽くして流用）と柄
export function fanCoralGeometry(): THREE.BufferGeometry {
  const fan = scallopFanGeometry(0.05, 0.85, 7, 0.06, 0.02, [2, 3]).toNonIndexed();
  fan.deleteAttribute('color'); // 色は、あとで塗りなおす
  const stalk = flat(new THREE.CylinderGeometry(0.07, 0.1, 0.35, 5, 1, true).translate(0, -0.1, 0));
  const g = mergeGeometries([fan, stalk]);
  g.computeVertexNormals();
  return paint(g, (x, y) => {
    // 外ほど明るく、放射状のうね（ひだ）で濃淡をつける
    const rib = 0.82 + 0.18 * Math.abs(Math.sin(Math.atan2(y, x) * 7));
    const l = (0.62 + 0.38 * clamp01(Math.hypot(x, y) / 0.85)) * rib;
    return [l, l, l];
  });
}

// ---------- 浜のこもの ----------
// サーフボード（砂に立てる。先がとがる。真ん中に濃い帯）
export function surfboardGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.5, 2.1, 0.07, 1, 8, 1);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const ty = p.getY(i) / 1.05;
    const k = ty > 0 ? 1 - 0.85 * Math.pow(ty, 3) : 1 - 0.4 * ty * ty; // 先（上）はとがり、おしり（下）はまるい
    p.setX(i, p.getX(i) * k);
  }
  return paint(flat(g), (_x, y) => (Math.abs(y - 0.25) < 0.17 ? [0.5, 0.5, 0.55] : [1, 1, 1]));
}

// ビーチボール（6 色に塗りわけ）
export function beachBallGeometry(): THREE.BufferGeometry {
  const cols: RGB[] = [[0.95, 0.25, 0.28], [1, 1, 1], [1, 0.84, 0.2], [1, 1, 1], [0.25, 0.6, 1], [1, 1, 1]];
  return paint(flat(new THREE.SphereGeometry(0.38, 12, 8)), (x, y, z) => {
    if (Math.abs(y) > 0.34) return [1, 1, 1];
    return cols[Math.floor(((Math.atan2(z, x) + Math.PI) / TAU) * 6) % 6];
  });
}

// 浮き輪（ピンクと白のしま、浜に寝かせる）
export function floatRingGeometry(): THREE.BufferGeometry {
  return paint(flat(new THREE.TorusGeometry(0.5, 0.18, 6, 16).rotateX(Math.PI / 2)), (x, _y, z) => {
    const seg = Math.floor(((Math.atan2(z, x) + Math.PI) / TAU) * 8);
    return seg % 2 ? [1, 1, 1] : [1, 0.5, 0.65];
  });
}

// ---------- カモメ：体は +z 向き、翼は x にひろがる（羽ばたきは材質のシェーダーで）----------
export function birdGeometry(): THREE.BufferGeometry {
  const tri = (a: number[], b: number[], c: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
    g.computeVertexNormals();
    return g;
  };
  const parts = [tri([0, 0, 0.6], [-0.12, 0, -0.3], [0.12, 0, -0.3])];
  for (const s of [-1, 1]) {
    parts.push(tri([s * 0.08, 0, 0.28], [s * 1.2, 0, -0.12], [s * 0.15, 0, -0.34]));
    parts.push(tri([s * 1.2, 0, -0.12], [s * 0.55, 0, -0.45], [s * 0.15, 0, -0.34]));
  }
  return mergeGeometries(parts);
}

// ---------- 遠くの帆かけ舟（船体・マスト・2 枚の帆）----------
export function boatGeometry(): THREE.BufferGeometry {
  const sail = (pts: number[][]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
    g.computeVertexNormals();
    return g;
  };
  const parts = [
    solid(flat(new THREE.CylinderGeometry(0.9, 0.55, 0.9, 6).scale(1, 1, 2.8).translate(0, 0.45, 0)), [0.55, 0.33, 0.25]),
    solid(flat(new THREE.CylinderGeometry(0.05, 0.05, 7.2, 4).translate(0, 4.1, 0.1)), [0.4, 0.3, 0.25]),
    solid(sail([[0, 1.1, -0.2], [0, 7.1, -0.2], [0, 1.1, -3.0]]), [1, 0.95, 0.88]),
    solid(sail([[0, 1.1, 0.35], [0, 6.2, 0.2], [0, 1.1, 2.6]]), [1, 0.82, 0.72]),
  ];
  return mergeGeometries(parts);
}
