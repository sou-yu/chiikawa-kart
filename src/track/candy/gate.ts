import * as THREE from 'three';
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js';
import { caneArchGeometry, heartShape, mat4, mergeParts, strawberryGeometry, swirlGeometry } from './geometry';
import { biscuitMaterial, caneMaterial, chocolateMaterial, creamMaterial, glazeMaterial } from './materials';
import { bearBadgeTexture, bearSignTexture, candyBannerTexture, strawberryTexture } from './textures';

// コースの目玉になる大きな飾り（ドーナツのゲート・キャンディケーンのアーチ・ハートの窓のクッキーの橋・くまの看板）
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

function goldMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#ffd24a', metalness: 0.75, roughness: 0.24, emissive: '#b8791a', emissiveIntensity: 0.4, envMapIntensity: 1.4 });
}

// ---------- ドーナツのゲート（スタートライン）----------
// 正面が +Z。ピンクのアイシングにカラフルなスプリンクル、てっぺんに王冠、くまの顔のバッジ
export function donutGate(hw: number, title: string): THREE.Group {
  const g = new THREE.Group();
  const Rm = hw + 3.6; // 脚の中心の間隔の半分
  const rt = 3.1; // 輪の太さ

  // 生地（なめらかな金色。つやのある焼き色）
  const doughMesh = new THREE.Mesh(
    new THREE.TorusGeometry(Rm, rt, 24, 80, Math.PI),
    new THREE.MeshPhysicalMaterial({ color: '#f0c274', roughness: 0.45, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.9 }),
  );
  doughMesh.castShadow = true;
  g.add(doughMesh);

  // アイシング：外側とまわりを包む。ふちはゆらゆら波うち、少し盛り上がる
  const th0 = 0.2;
  const frame = (th: number) => ({ cx: Rm * Math.cos(th), cy: Rm * Math.sin(th), nx: Math.cos(th), ny: Math.sin(th) });
  const phiMax = (th: number) => {
    const edge = Math.min(th, Math.PI - th) - th0;
    const wav = 1.72 + 0.2 * Math.sin(th * 13 + 1) + 0.12 * Math.sin(th * 29 + 2);
    return wav * Math.sqrt(smooth(edge / 0.32));
  };
  const surf = (u: number, v: number, target: THREE.Vector3) => {
    const th = th0 + u * (Math.PI - 2 * th0);
    const phi = (v - 0.5) * 2 * phiMax(th);
    const e = Math.abs(v - 0.5) * 2;
    const rg = rt + 0.12 + 0.18 * Math.pow(e, 6);
    const f = frame(th);
    return target.set(f.cx + rg * Math.cos(phi) * f.nx, f.cy + rg * Math.cos(phi) * f.ny, rg * Math.sin(phi));
  };
  const glazeGeo = new ParametricGeometry(surf, 100, 36);
  glazeGeo.computeVertexNormals();
  const glaze = new THREE.Mesh(glazeGeo, new THREE.MeshPhysicalMaterial({ color: '#ff8fbd', roughness: 0.22, clearcoat: 0.9, clearcoatRoughness: 0.12, side: THREE.DoubleSide, envMapIntensity: 1.3 }));
  glaze.castShadow = true;
  g.add(glaze);

  // スプリンクル（アイシングの表面にそって、ばらばらの向きで）
  const sprinkleParts: { geo: THREE.BufferGeometry; color: string; at: THREE.Matrix4 }[] = [];
  const cols = ['#ffd23a', '#4fd36a', '#4aa8ff', '#ffffff', '#ff9a3a', '#a77bff', '#ff4f6f'];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 120; i++) {
    const u = 0.04 + rnd() * 0.92, v = 0.1 + rnd() * 0.8;
    surf(u, v, a);
    surf(u + 0.002, v, b);
    surf(u, v + 0.002, c);
    const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    const th = th0 + u * (Math.PI - 2 * th0);
    const f = frame(th);
    if (n.x * (a.x - f.cx) + n.y * (a.y - f.cy) + n.z * a.z < 0) n.negate();
    const t1 = b.clone().sub(a).normalize();
    const t2 = n.clone().cross(t1).normalize();
    const psi = rnd() * TAU;
    const axis = t1.multiplyScalar(Math.cos(psi)).addScaledVector(t2, Math.sin(psi)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, axis);
    const len = 0.9 + rnd() * 0.7;
    sprinkleParts.push({
      geo: new THREE.CapsuleGeometry(0.2, len, 3, 8),
      color: cols[i % cols.length],
      at: new THREE.Matrix4().compose(a.clone().addScaledVector(n, 0.1), q, new THREE.Vector3(1, 1, 1)),
    });
  }
  const sprinkles = new THREE.Mesh(mergeParts(sprinkleParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, envMapIntensity: 1 }));
  sprinkles.castShadow = true;
  g.add(sprinkles);

  // くまの顔のバッジ（アーチのてっぺんの正面）
  const badge = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 6.4),
    new THREE.MeshStandardMaterial({ map: bearBadgeTexture(), transparent: true, alphaTest: 0.4, roughness: 0.5, side: THREE.DoubleSide }),
  );
  badge.position.set(0, Rm + 0.1, rt + 0.35);
  g.add(badge);
  const badgeBack = badge.clone();
  badgeBack.position.z = -(rt + 0.35);
  badgeBack.rotation.y = Math.PI;
  g.add(badgeBack);

  // 王冠
  const crownShape = new THREE.Shape();
  crownShape.moveTo(-3.2, 0);
  crownShape.lineTo(-3.5, 2.5);
  crownShape.lineTo(-1.8, 1.25);
  crownShape.lineTo(0, 3.4);
  crownShape.lineTo(1.8, 1.25);
  crownShape.lineTo(3.5, 2.5);
  crownShape.lineTo(3.2, 0);
  crownShape.closePath();
  const crownGeo = new THREE.ExtrudeGeometry(crownShape, { depth: 1.3, bevelEnabled: true, bevelSize: 0.22, bevelThickness: 0.22, bevelSegments: 3 });
  crownGeo.translate(0, 0, -0.65);
  const gold = goldMaterial();
  const crown = new THREE.Group();
  crown.add(new THREE.Mesh(crownGeo, gold));
  for (const [x, y] of [[-3.5, 2.5], [0, 3.4], [3.5, 2.5]]) {
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.46, 14, 10), gold);
    orb.position.set(x, y + 0.35, 0);
    crown.add(orb);
  }
  const gemCols = ['#ff4f6f', '#4aa8ff', '#ff4f6f', '#4fd36a', '#ff4f6f'];
  gemCols.forEach((col, i) => {
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.1, clearcoat: 1, emissive: col, emissiveIntensity: 0.35 }));
    gem.position.set((i - 2) * 1.35, 0.75, 0.95);
    gem.scale.z = 0.6;
    crown.add(gem);
    const gem2 = gem.clone();
    gem2.position.z = -0.95;
    crown.add(gem2);
  });
  crown.position.set(0, Rm + rt - 0.5, 0);
  crown.traverse((o) => (o.castShadow = true));
  g.add(crown);

  // 両足のそばのホイップクリームとさくらんぼ
  const creamGeo = swirlGeometry(2.5, 4.4, { ridges: 7, twist: 10, rings: 30, seg: 32 });
  const cherry = new THREE.SphereGeometry(0.9, 18, 14);
  const cherryMat = new THREE.MeshPhysicalMaterial({ color: '#d90f2c', roughness: 0.15, clearcoat: 1, envMapIntensity: 1.3 });
  for (const s of [-1, 1]) {
    const cream = new THREE.Mesh(creamGeo, creamMaterial());
    cream.position.set(s * (Rm + rt + 2.6), 0, 0.6);
    cream.castShadow = true;
    g.add(cream);
    const ch = new THREE.Mesh(cherry, cherryMat);
    ch.position.set(s * (Rm + rt + 2.6) + 0.3, 4.9, 0.6);
    ch.castShadow = true;
    g.add(ch);
  }

  // 垂れ幕（コース名）
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(hw * 2 - 1.6, ((hw * 2 - 1.6) * 320) / 2048),
    new THREE.MeshBasicMaterial({ map: candyBannerTexture(title), side: THREE.DoubleSide, toneMapped: false }),
  );
  banner.position.set(0, 6.6, 0);
  g.add(banner);
  g.rotation.y = Math.PI; // 正面（バッジ）が走ってくる側を向く
  return g;
}

// ---------- キャンディケーンのアーチ ----------
// 道をまたぐ赤白の半円。軸は +Z（道の進行方向）に直角
export function caneArch(hw: number, big = 1): THREE.Group {
  const g = new THREE.Group();
  const R = (hw + 3.7) * big;
  const arch = new THREE.Mesh(caneArchGeometry(R, 0.9 * big), caneMaterial());
  arch.castShadow = true;
  g.add(arch);
  // 足もとのクリームといちご
  const cream = swirlGeometry(1.7 * big, 2.5 * big, { ridges: 6, twist: 8 });
  const berry = strawberryGeometry();
  const berryMat = new THREE.MeshStandardMaterial({ map: strawberryTexture(), roughness: 0.3, envMapIntensity: 1 });
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(cream, creamMaterial());
    m.position.set(s * (R + 1.5 * big), 0, 0);
    m.castShadow = true;
    g.add(m);
    const b = new THREE.Mesh(berry, berryMat);
    b.scale.setScalar(1.2 * big);
    b.position.set(s * (R + 1.5 * big), 2.1 * big, 0);
    b.castShadow = true;
    g.add(b);
  }
  return g;
}

// ---------- ハートの窓のクッキーの橋 ----------
// 道をまたぐ。x が道と直角方向、z が進行方向。道の上の空間は大きなアーチ
export function cookieBridge(hw: number): THREE.Group {
  const g = new THREE.Group();
  const half = hw + 25;
  const H = 15;
  const S = hw + 14.5; // 外側の小さなアーチの中心
  const mw = hw + 3.2; // 道の上の大きなアーチの半幅
  // 外形：底の線に 3 つのアーチの切りこみを入れた形（穴にすると底の辺と重なって崩れるため）
  const shape = new THREE.Shape();
  shape.moveTo(-half, 0);
  shape.lineTo(-half, H);
  shape.lineTo(half, H);
  shape.lineTo(half, 0);
  shape.lineTo(S + 5, 0);
  shape.lineTo(S + 5, 3.6);
  shape.quadraticCurveTo(S, 11.2, S - 5, 3.6);
  shape.lineTo(S - 5, 0);
  shape.lineTo(mw, 0);
  shape.lineTo(mw, 5.6);
  shape.quadraticCurveTo(0, 17.6, -mw, 5.6);
  shape.lineTo(-mw, 0);
  shape.lineTo(-S + 5, 0);
  shape.lineTo(-S + 5, 3.6);
  shape.quadraticCurveTo(-S, 11.2, -S - 5, 3.6);
  shape.lineTo(-S - 5, 0);
  shape.closePath();
  // ハートの窓
  const heartY = 13.4;
  for (let x = -half + 3.6; x <= half - 3.5; x += 4.3) {
    if (Math.abs(x) < 1.6) continue;
    const h = new THREE.Path(heartShape(1.35).getPoints().map((p) => new THREE.Vector2(p.x + x, p.y + heartY)));
    shape.holes.push(h);
  }
  const depth = 7;
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.25, bevelThickness: 0.25, bevelSegments: 2, curveSegments: 14 });
  geo.translate(0, 0, -depth / 2);
  const mat = biscuitMaterial(9);
  const bridge = new THREE.Mesh(geo, mat);
  bridge.castShadow = true;
  bridge.receiveShadow = true;
  g.add(bridge);

  // 手すり：チョコの板に白いクリームのかざり
  const choc = chocolateMaterial();
  for (const z of [-depth / 2 + 0.1, depth / 2 - 0.1]) {
    const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, half * 2 - 1.5, 4, 12).rotateZ(Math.PI / 2), choc);
    bar.position.set(0, H + 0.4, z);
    bar.castShadow = true;
    g.add(bar);
  }
  const blobs: { geo: THREE.BufferGeometry; at: THREE.Matrix4 }[] = [];
  for (let x = -half + 2; x < half; x += 3.1) {
    for (const z of [-depth / 2 + 0.1, depth / 2 - 0.1]) {
      blobs.push({ geo: new THREE.SphereGeometry(0.62, 10, 8), at: mat4(x + Math.sin(x * 3.1) * 0.5, H + 0.95, z, 0, 0, 0, 1.15, 0.7, 1) });
    }
  }
  const cream = new THREE.Mesh(mergeParts(blobs, false), creamMaterial());
  cream.castShadow = true;
  g.add(cream);
  // ふちどりのクリーム（アーチのまわり）
  const trim = new THREE.CatmullRomCurve3(
    Array.from({ length: 25 }, (_, i) => {
      const t = i / 24;
      const x = -mw + 2 * mw * t;
      const y = 5.6 + 12 * 0.5 * (1 - Math.pow(x / mw, 2)) + 0.05;
      return new THREE.Vector3(x, y, 0);
    }),
  );
  for (const z of [-depth / 2 - 0.2, depth / 2 + 0.2]) {
    const tube = new THREE.Mesh(new THREE.TubeGeometry(trim, 40, 0.34, 8, false), creamMaterial());
    tube.position.z = z;
    g.add(tube);
  }
  return g;
}

// ---------- くまの顔の木の看板 ----------
export function bearSign(): THREE.Group {
  const g = new THREE.Group();
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 5.6),
    new THREE.MeshStandardMaterial({ map: bearSignTexture(), transparent: true, alphaTest: 0.45, roughness: 0.7, side: THREE.DoubleSide }),
  );
  board.position.y = 4.9;
  board.castShadow = true;
  g.add(board);
  const wood = new THREE.MeshStandardMaterial({ color: '#8a5a2e', roughness: 0.7 });
  for (const x of [-0.9, 0.9]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.34, 3.4, 0.34).translate(0, 1.7, 0), wood);
    post.position.set(x, 0, -0.1);
    post.castShadow = true;
    g.add(post);
  }
  return g;
}
