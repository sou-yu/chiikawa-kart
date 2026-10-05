import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

// コース全体に散らばった大きな InstancedMesh を、地面の区画ごとに分ける。
// 1つのかたまりのままだと、範囲（バウンディング球）がコース全体になって、
// カメラの後ろや遠くの分まで毎フレーム描いてしまう（影の描画も同じ）。
// 区画に分けると、画面や影の範囲に入らない区画は丸ごと省かれる。見た目は変わらない。
// 動かない景色だけに使うこと（あとで setMatrixAt するものには使わない）。
// 区画が増えると描画命令も増えるので、ポリゴンが多い物（合計 minTris 以上）だけを分ける。
export function chunkInstances(root: THREE.Object3D, minTris = 60000) {
  const targets: THREE.InstancedMesh[] = [];
  root.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (!im.isInstancedMesh) return;
    const geo = im.geometry;
    const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    if (tris * im.count >= minTris) targets.push(im);
  });
  for (const im of targets) split(im);
}

function split(im: THREE.InstancedMesh) {
  const n = im.count;
  const xs = new Float32Array(n), zs = new Float32Array(n);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    im.getMatrixAt(i, _m);
    _p.setFromMatrixPosition(_m);
    xs[i] = _p.x;
    zs[i] = _p.z;
    x0 = Math.min(x0, _p.x); x1 = Math.max(x1, _p.x);
    z0 = Math.min(z0, _p.z); z1 = Math.max(z1, _p.z);
  }
  // 区画の大きさ：最低45m。広い物は縦横5区画程度までにして、描画命令が増えすぎないようにする
  // （小さな飾りは userData.divisions で、もっと粗く分けられる）
  const cell = Math.max(45, Math.max(x1 - x0, z1 - z0) / (im.userData.divisions ?? 5));
  const cols = Math.max(1, Math.ceil((x1 - x0) / cell + 1e-6));
  const rows = Math.max(1, Math.ceil((z1 - z0) / cell + 1e-6));
  if (cols * rows <= 1) return;

  const bins = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const cx = Math.min(cols - 1, Math.floor((xs[i] - x0) / cell));
    const cz = Math.min(rows - 1, Math.floor((zs[i] - z0) / cell));
    const k = cz * cols + cx;
    let b = bins.get(k);
    if (!b) bins.set(k, (b = []));
    b.push(i);
  }
  if (bins.size <= 1) return;

  const parent = im.parent!;
  const chunks = new THREE.Group();
  chunks.name = `${im.name || 'instances'}Chunks`;
  chunks.position.copy(im.position);
  chunks.quaternion.copy(im.quaternion);
  chunks.scale.copy(im.scale);
  for (const ids of bins.values()) {
    const c = new THREE.InstancedMesh(im.geometry, im.material, ids.length);
    ids.forEach((src, j) => {
      im.getMatrixAt(src, _m);
      c.setMatrixAt(j, _m);
      if (im.instanceColor) {
        im.getColorAt(src, _c);
        c.setColorAt(j, _c);
      }
    });
    c.name = im.name;
    c.castShadow = im.castShadow;
    c.receiveShadow = im.receiveShadow;
    c.layers.mask = im.layers.mask;
    c.renderOrder = im.renderOrder;
    c.userData.fullCount = ids.length; // 画質で本数を減らすときの元の数
    if (im.userData.maxDist) c.userData.maxDist = im.userData.maxDist; // 遠くでは描かない距離
    c.computeBoundingSphere();
    chunks.add(c);
  }
  parent.add(chunks);
  parent.remove(im);
  im.dispose(); // 元のインスタンス用バッファだけ解放（形と素材は区画で共有）
}
