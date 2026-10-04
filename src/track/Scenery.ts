import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/random';
import { SUN_DIR, applyWind } from '../core/shaders';
import { PAL } from '../config/palette';
import { faceDaisyTexture, pastelFlowerTexture, faceHillTexture, grassTexture, signTexture, woodTexture } from '../core/textures';
import type { Track } from './Track';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

type Rand = () => number;

// コースまわりの景色一式
export function buildScenery(track: Track): THREE.Group {
  const g = new THREE.Group();
  const rand = mulberry32(42);
  const center = new THREE.Box3().setFromPoints(track.pts).getCenter(new THREE.Vector3());

  g.add(sky());
  g.add(ground(center));
  g.add(fences(track));
  g.add(grassField(track, rand));
  g.add(flowers(track, rand));
  g.add(grassTufts(track, rand));
  g.add(leafPlants(track, rand));
  g.add(trees(track, rand, center));
  g.add(dandelions(track, rand));
  g.add(rocksAndBirds(track, rand));
  g.add(signs(track));
  g.add(backdrop(track, rand, center));
  g.add(clouds(rand, center));
  return g;
}

// ---------- 空と地面 ----------

// グラデーションの空＋太陽のまぶしさ
export function skyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSun: { value: SUN_DIR },
      uZenith: { value: new THREE.Color(PAL.skyTop) },
      uMid: { value: new THREE.Color(PAL.skyMid) },
      uHorizon: { value: new THREE.Color(PAL.skyHorizon) },
      uSunCol: { value: new THREE.Color('#fff2dc') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun, uZenith, uMid, uHorizon, uSunCol;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.18, h));
        col = mix(col, uZenith, smoothstep(0.15, 0.85, h));
        float s = max(dot(d, uSun), 0.0);
        // 太陽はまぶしすぎない、やさしい光の輪
        col += uSunCol * (smoothstep(0.9990, 0.9994, s) * 0.9 + pow(s, 60.0) * 0.3 + pow(s, 5.0) * 0.1);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function sky(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1400, 48, 24), skyMaterial());
  m.renderOrder = -1;
  return m;
}

function ground(center: THREE.Vector3): THREE.Mesh {
  const tex = grassTexture();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(220, 220);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshLambertMaterial({ map: tex }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(center.x, 0, center.z);
  m.receiveShadow = true;
  return m;
}

// ---------- コース沿い ----------

// 先のとがった白いピケットフェンス（ころんと丸みのある板）
function fences(track: Track): THREE.Group {
  const g = new THREE.Group();
  const d = track.def.halfWidth + track.def.wallOffset + 0.3;
  const shape = new THREE.Shape();
  shape.moveTo(-0.11, 0);
  shape.lineTo(0.11, 0);
  shape.lineTo(0.11, 1.02);
  shape.quadraticCurveTo(0.08, 1.14, 0, 1.24);
  shape.quadraticCurveTo(-0.08, 1.14, -0.11, 1.02);
  shape.closePath();
  const picketGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 6 });
  picketGeo.translate(0, 0, -0.025);
  const white = new THREE.MeshLambertMaterial({ color: '#fffaf4', emissive: '#fff4ea', emissiveIntensity: 0.15 });
  const step = 0.5;
  const n = Math.floor(track.length / step);
  const pickets = new THREE.InstancedMesh(picketGeo, white, n * 2);
  const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.1, 1).translate(0, 0, 0.5), white, Math.ceil(n / 6) * 4 + 8);
  let pi = 0, ri = 0;
  const pts: THREE.Vector3[][] = [[], []];
  for (let k = 0; k < n; k++) {
    const t = k / n;
    const nrm = track.normalAt(t);
    for (const [si, s] of [[0, -1], [1, 1]] as const) {
      const p = track.place(t, d * s);
      // 板の面を道に向ける。高さを少しずつ変えて手作り感
      _q.setFromEuler(_e.set(0, Math.atan2(nrm.x, nrm.z), (Math.sin(k * 5.3) * 0.03)));
      _m.compose(p, _q, _s.set(1, 0.92 + Math.sin(k * 1.7 + si) * 0.05, 1));
      pickets.setMatrixAt(pi++, _m);
      if (k % 6 === 0) pts[si].push(track.place(t, (d + 0.08) * s));
    }
  }
  for (const side of pts) {
    for (let k = 0; k < side.length; k++) {
      const a = side[k], b = side[(k + 1) % side.length];
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      for (const y of [0.3, 0.78]) {
        _q.setFromEuler(_e.set(0, yaw, 0));
        _m.compose(_p.set(a.x, y, a.z), _q, _s.set(1, 1, a.distanceTo(b)));
        rails.setMatrixAt(ri++, _m);
      }
    }
  }
  rails.count = ri;
  pickets.castShadow = true;
  g.add(pickets, rails);
  return g;
}

// コース沿いのランダムな位置（横ずれ min..max、左右ランダム）
// 川の上には置かない
function nearTrack(track: Track, rand: Rand, min: number, max: number, target = new THREE.Vector3()): THREE.Vector3 {
  const river = track.def.river;
  for (let tries = 0; ; tries++) {
    const side = rand() < 0.5 ? -1 : 1;
    const lat = track.def.halfWidth + min + rand() * (max - min);
    const t = rand();
    if (river && tries < 20) {
      let ds = Math.abs(t - river.t) * track.length;
      ds = Math.min(ds, track.length - ds);
      // 川は離れるほど蛇行するので、外側ほど広めに避ける
      if (ds < river.width / 2 + 1.5 + Math.min(6, lat * 0.12)) continue;
    }
    return track.place(t, lat * side, target);
  }
}

// 茎つきの花（花びらは上向きの板、茎と一緒に風で揺れる）
function flowers(track: Track, rand: Rand): THREE.Group {
  const g = new THREE.Group();
  const count = 11000;
  const head = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 1, 0);
  const headMat = applyWind(new THREE.MeshLambertMaterial({ map: pastelFlowerTexture(), alphaTest: 0.5, side: THREE.DoubleSide, emissive: '#ffffff', emissiveIntensity: 0.12 }), 0.12, 1);
  const heads = new THREE.InstancedMesh(head, headMat, count);
  const stem = new THREE.CylinderGeometry(0.02, 0.025, 1, 4, 2).translate(0, 0.5, 0);
  const stems = new THREE.InstancedMesh(stem, applyWind(new THREE.MeshLambertMaterial({ color: '#8cc46a' }), 0.12, 1), count);
  // パステルのお花（白・ピンク・黄・水色・ラベンダー・ピーチ）
  const palette = ['#ffffff', '#ffffff', '#ffc9dc', '#ffb3cc', '#fff0a0', '#ffe27a', '#bfe2ff', '#a9d4ff', '#e2ccff', '#ffd3b8'];
  for (let i = 0; i < count; i++) {
    // 大半は道〜柵の間、残りは柵の外
    if (i < count * 0.72) nearTrack(track, rand, 1.2, track.def.wallOffset - 0.2, _p);
    else nearTrack(track, rand, track.def.wallOffset + 1, track.def.wallOffset + 45, _p);
    _p.y = 0;
    const h = 0.4 + rand() * 0.6; // 草より上に咲く
    const s = 0.55 + rand() * 0.7;
    const yaw = rand() * 6.28;
    // 花：茎の高さに置き、少し傾ける
    _q.setFromEuler(_e.set((rand() - 0.5) * 0.5, yaw, (rand() - 0.5) * 0.5));
    _m.compose(_p, _q, _s.set(s, h, s));
    heads.setMatrixAt(i, _m);
    heads.setColorAt(i, _c.set(palette[Math.floor(rand() * palette.length)]));
    _m.compose(_p, _q.setFromEuler(_e.set(0, yaw, 0)), _s.set(1, h, 1));
    stems.setMatrixAt(i, _m);
  }
  g.add(stems, heads);
  g.add(faceDaisies(track, rand));
  return g;
}

// 顔のついた大きなデイジー（道のわき・柵の手前に）
function faceDaisies(track: Track, rand: Rand): THREE.Group {
  const g = new THREE.Group();
  const count = 120;
  const head = new THREE.PlaneGeometry(1, 1);
  const heads = new THREE.InstancedMesh(head, new THREE.MeshLambertMaterial({ map: faceDaisyTexture(), alphaTest: 0.5, side: THREE.DoubleSide, emissive: '#ffffff', emissiveIntensity: 0.15 }), count);
  const stems = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.05, 0.07, 1, 6).translate(0, 0.5, 0),
    applyWind(new THREE.MeshLambertMaterial({ color: '#8cc46a' }), 0.06, 1),
    count,
  );
  const leaves = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 6), new THREE.MeshLambertMaterial({ color: '#9fd07a' }), count * 2);
  const tints = ['#ffffff', '#ffffff', '#ffe0ea', '#fff4c4', '#e8f3ff'];
  for (let i = 0; i < count; i++) {
    const t = rand();
    const side = rand() < 0.5 ? -1 : 1;
    const lat = (track.def.halfWidth + 2.2 + rand() * (track.def.wallOffset - 3)) * side;
    const p = track.place(t, lat);
    const size = 1.5 + rand() * 1.3;
    const h = 1.0 + rand() * 1.0;
    // 顔を道の方へ向け、少し上を見上げる
    const nrm = track.normalAt(t);
    const yaw = Math.atan2(-nrm.x * side, -nrm.z * side) + (rand() - 0.5) * 0.8;
    _q.setFromEuler(_e.set(-0.35, yaw, (rand() - 0.5) * 0.3, 'YXZ'));
    _m.compose(_p.copy(p).setY(h + size * 0.35), _q, _s.set(size, size, size));
    heads.setMatrixAt(i, _m);
    heads.setColorAt(i, _c.set(tints[i % tints.length]));
    _m.compose(p, _q.identity(), _s.set(1, h + size * 0.3, 1));
    stems.setMatrixAt(i, _m);
    for (let k = 0; k < 2; k++) {
      const a = yaw + (k ? 1.6 : -1.6);
      _m.compose(_p.copy(p).add(new THREE.Vector3(Math.sin(a) * 0.3, h * 0.35, Math.cos(a) * 0.3)), _q.setFromEuler(_e.set(0, a, 0.5)), _s.set(0.35, 0.07, 0.16));
      leaves.setMatrixAt(i * 2 + k, _m);
    }
  }
  g.add(stems, leaves, heads);
  return g;
}

// 草の株：根元が濃く先が明るい、しなった葉
function tuftGeometry(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + (i % 2) * 0.3;
    blades.push(bladeGeometry(0.5 + (i % 3) * 0.22, 0.09, 0.3, a));
  }
  return mergeGeometries(blades)!;
}

// 3段に折れて先が細くなる草の葉1枚
function bladeGeometry(h: number, w: number, lean: number, yaw: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const segs = 3;
  const dx = Math.cos(yaw), dz = Math.sin(yaw);
  const px = -dz, pz = dx;
  for (let k = 0; k <= segs; k++) {
    const f = k / segs;
    const y = h * f;
    const off = lean * f * f;
    const ww = w * (1 - f * 0.92);
    const cx = dx * off, cz = dz * off;
    pos.push(cx + px * ww, y, cz + pz * ww, cx - px * ww, y, cz - pz * ww);
    const l = 0.55 + f * 0.5;
    col.push(0.5 * l, 0.78 * l, 0.36 * l, 0.5 * l, 0.78 * l, 0.36 * l);
  }
  const idx: number[] = [];
  for (let k = 0; k < segs; k++) {
    const a = k * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // 上向きの法線にしておくと、裏表で明るさが変わらずふんわり見える
  const n = geo.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return geo.toNonIndexed();
}

// 一面の草原（数万本の草が風になびく）
function grassField(track: Track, rand: Rand): THREE.InstancedMesh {
  const count = 22000;
  const geo = mergeGeometries([bladeGeometry(0.42, 0.05, 0.12, 0), bladeGeometry(0.34, 0.045, 0.1, 2.1), bladeGeometry(0.38, 0.05, 0.14, 4.2)])!;
  const mat = applyWind(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 0.16, 0.45);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const greens = [PAL.grass, PAL.grassDark, PAL.grassLight, '#a8d680', '#bfe39a'];
  for (let i = 0; i < count; i++) {
    // 道のそばほど密に
    const r = rand();
    nearTrack(track, rand, 0.9, 0.9 + r * r * (track.def.wallOffset + 26), _p);
    _p.y = 0;
    const s = 0.8 + rand() * 0.8;
    _q.setFromEuler(_e.set(0, rand() * 6.28, 0));
    _m.compose(_p, _q, _s.set(s, s * (0.45 + rand() * 0.4), s));
    mesh.setMatrixAt(i, _m);
    mesh.setColorAt(i, _c.set(greens[Math.floor(rand() * greens.length)]));
  }
  mesh.name = 'grassField'; // 低画質のときは本数を減らす
  return mesh;
}

function grassTufts(track: Track, rand: Rand): THREE.InstancedMesh {
  const count = 3600;
  const mat = applyWind(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 0.14, 0.9);
  const mesh = new THREE.InstancedMesh(tuftGeometry(), mat, count);
  const greens = [PAL.grass, PAL.grassDark, '#a6d67e', PAL.grassLight];
  for (let i = 0; i < count; i++) {
    // 半分は道のふちに沿わせて境目を隠す
    if (i < count * 0.5) nearTrack(track, rand, -0.2, 1.6, _p);
    else nearTrack(track, rand, 1.6, track.def.wallOffset + 30, _p);
    _p.y = 0;
    const s = 0.7 + rand() * 0.9;
    _q.setFromEuler(_e.set(0, rand() * 6.28, 0));
    _m.compose(_p, _q, _s.set(s, s * (0.5 + rand() * 0.35), s));
    mesh.setMatrixAt(i, _m);
    mesh.setColorAt(i, _c.set(greens[Math.floor(rand() * greens.length)]));
  }
  return mesh;
}

// 大きな葉っぱ（根元から外に反る）
function leafGeometry(): THREE.BufferGeometry {
  const L = 14, W = 6;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= L; i++) {
    const s = i / L;
    const width = Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.08)), 0.8) * 0.38;
    for (let j = 0; j <= W; j++) {
      const v = j / W - 0.5;
      const x = v * 2 * width;
      const z = s;
      // 先がしなり、縁が下がる（中央の葉脈が少し盛り上がる）
      const y = -s * s * 0.45 - Math.abs(v) * width * 0.35 + Math.sin(s * 9 + v * 3) * 0.006;
      pos.push(x, y, z);
      const light = 0.72 + s * 0.28 - Math.abs(v) * 0.12;
      const rib = Math.abs(v) < 0.05 ? 0.18 : 0; // 葉脈は明るく
      col.push(0.45 * light + rib, 0.78 * light + rib, 0.32 * light + rib * 0.6);
    }
  }
  for (let i = 0; i < L; i++) {
    for (let j = 0; j < W; j++) {
      const a = i * (W + 1) + j, b = a + W + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function leafPlants(track: Track, rand: Rand): THREE.Group {
  const g = new THREE.Group();
  const clusters = 150;
  const perCluster = 7;
  // 葉の裏が暗くなりすぎないよう、ほんのり自ら光らせる
  const mat = applyWind(
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: '#6f9a55', emissiveIntensity: 0.35 }),
    0.08,
    1,
    'z',
  );
  const leaves = new THREE.InstancedMesh(leafGeometry(), mat, clusters * perCluster);
  const stems = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.05, 0.08, 1, 6).translate(0, 0.5, 0),
    new THREE.MeshLambertMaterial({ color: '#8cc46a' }),
    clusters * perCluster,
  );
  let n = 0;
  for (let c = 0; c < clusters; c++) {
    // 柵の内側は小さな株だけ（カメラが葉に埋もれないように）、大きな葉は柵のすぐ外
    const near = c < clusters * 0.35;
    nearTrack(track, rand, near ? 2.5 : track.def.wallOffset + 1.8, near ? track.def.wallOffset - 1 : track.def.wallOffset + 16, _p);
    const size = near ? 0.6 + rand() * 0.5 : 2 + rand() * 3;
    const base = _p.clone();
    const rot0 = rand() * 6.28;
    for (let k = 0; k < perCluster; k++) {
      const yaw = rot0 + (k / perCluster) * Math.PI * 2 + (rand() - 0.5) * 0.5;
      const stemH = size * (0.3 + rand() * 0.5);
      const pitch = -(0.5 + rand() * 0.6);
      // 茎
      _q.setFromEuler(_e.set(Math.sin(yaw) * 0.25, 0, -Math.cos(yaw) * 0.25));
      _m.compose(base, _q, _s.set(1, stemH, 1));
      stems.setMatrixAt(n, _m);
      // 葉
      const tip = base.clone().add(new THREE.Vector3(Math.sin(yaw) * 0.25 * stemH, stemH, Math.cos(yaw) * 0.25 * stemH));
      _q.setFromEuler(_e.set(pitch, yaw, 0, 'YXZ'));
      const ls = size * (0.8 + rand() * 0.5);
      _m.compose(tip, _q, _s.set(ls, ls, ls));
      leaves.setMatrixAt(n, _m);
      n++;
    }
  }
  g.add(stems, leaves);
  return g;
}

function dandelions(track: Track, rand: Rand): THREE.Group {
  const g = new THREE.Group();
  const count = 90;
  const stems = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.025, 0.03, 1, 5).translate(0, 0.5, 0),
    new THREE.MeshLambertMaterial({ color: '#7fb356' }),
    count,
  );
  const puffs = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, emissive: '#555555' }),
    count,
  );
  for (let i = 0; i < count; i++) {
    nearTrack(track, rand, 1.5, track.def.wallOffset + 12, _p);
    const h = 0.8 + rand() * 1.4;
    _m.compose(_p.setY(0), _q.identity(), _s.set(1, h, 1));
    stems.setMatrixAt(i, _m);
    const r = 0.22 + rand() * 0.12;
    _m.compose(_p.setY(h + r * 0.6), _q, _s.set(r, r, r));
    puffs.setMatrixAt(i, _m);
  }
  g.add(stems, puffs);
  return g;
}

function rocksAndBirds(track: Track, rand: Rand): THREE.Group {
  const g = new THREE.Group();
  const rockMat = new THREE.MeshLambertMaterial({ color: '#cfc9d6' });
  const white = new THREE.MeshLambertMaterial({ color: '#fbfbf7' });
  const orange = new THREE.MeshLambertMaterial({ color: '#f5a13a' });
  const ink = new THREE.MeshBasicMaterial({ color: '#222222' });
  const body = new THREE.SphereGeometry(1, 16, 12);
  const beak = new THREE.ConeGeometry(0.25, 0.5, 8).rotateX(Math.PI / 2);
  for (let i = 0; i < 16; i++) {
    nearTrack(track, rand, 2.5, track.def.wallOffset + 25, _p);
    const r = 0.8 + rand() * 1.6;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 1), rockMat);
    rock.position.copy(_p).setY(r * 0.45);
    rock.scale.set(1.3, 0.75, 1);
    rock.rotation.y = rand() * 6;
    rock.castShadow = true;
    g.add(rock);
    if (i % 3 !== 0) continue;
    // 石の上の小鳥
    for (let b = 0; b < 2; b++) {
      const bird = new THREE.Group();
      const bs = 0.32;
      bird.add(new THREE.Mesh(body, white));
      const bk = new THREE.Mesh(beak, orange);
      bk.position.set(0, 0.05, 0.95);
      bird.add(bk);
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(body, ink);
        eye.scale.setScalar(0.1);
        eye.position.set(s * 0.35, 0.25, 0.85);
        bird.add(eye);
        const foot = new THREE.Mesh(body, orange);
        foot.scale.set(0.12, 0.08, 0.2);
        foot.position.set(s * 0.3, -0.95, 0.2);
        bird.add(foot);
      }
      bird.scale.setScalar(bs);
      bird.position.copy(rock.position).add(new THREE.Vector3((b - 0.5) * r * 0.8, r * 0.75 + bs, 0));
      bird.lookAt(nearestRoadPoint(track, bird.position).setY(bird.position.y));
      g.add(bird);
    }
  }
  return g;
}

function nearestRoadPoint(track: Track, p: THREE.Vector3): THREE.Vector3 {
  return track.project(p).point.clone();
}

function signs(track: Track): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ map: woodTexture(), color: '#caa27a' });
  for (const s of track.def.signs) {
    const sign = new THREE.Group();
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(4.2, 2.1, 0.15),
      [wood, wood, wood, wood, new THREE.MeshLambertMaterial({ map: signTexture(s.lines) }), wood],
    );
    board.position.y = 2.2;
    board.castShadow = true;
    sign.add(board);
    for (const x of [-1.5, 1.5]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.4, 0.22).translate(0, 1.2, 0), wood);
      post.position.set(x, 0, -0.1);
      post.castShadow = true;
      sign.add(post);
    }
    const lat = (track.def.halfWidth + 3.5) * s.side;
    track.place(s.t, lat, sign.position);
    // 走ってくる方向（-進行方向）と道の中央を向ける
    const tan = track.tangentAt(s.t);
    const nrm = track.normalAt(s.t);
    const face = tan.clone().multiplyScalar(-0.8).addScaledVector(nrm, -s.side * 0.6);
    sign.rotation.y = Math.atan2(face.x, face.z);
    g.add(sign);
  }
  return g;
}

// ---------- 木 ----------

// 下ほど暗く上ほど明るい頂点色（木や雲の立体感）
function shadeByHeight(geo: THREE.BufferGeometry, low: number, high: number, tint = [1, 1, 1]): THREE.BufferGeometry {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const pos = geo.getAttribute('position');
  const col: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const f = (pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y);
    const l = low + (high - low) * Math.pow(f, 0.8);
    col.push(l * tint[0], l * tint[1], l * tint[2]);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function crownGeometry(): THREE.BufferGeometry {
  const parts = [
    new THREE.IcosahedronGeometry(1, 2),
    new THREE.IcosahedronGeometry(0.75, 2).translate(0.62, -0.2, 0.2),
    new THREE.IcosahedronGeometry(0.72, 2).translate(-0.58, -0.15, -0.25),
    new THREE.IcosahedronGeometry(0.66, 2).translate(0.1, 0.48, -0.4),
    new THREE.IcosahedronGeometry(0.6, 2).translate(-0.2, -0.35, 0.6),
    new THREE.IcosahedronGeometry(0.55, 2).translate(0.35, 0.3, 0.55),
  ];
  return shadeByHeight(mergeGeometries(parts)!, 0.8, 1.08);
}

// 3段重ねの針葉樹
function pineGeometry(): THREE.BufferGeometry {
  const parts = [
    new THREE.ConeGeometry(1.7, 2.6, 14).translate(0, 1.3, 0),
    new THREE.ConeGeometry(1.35, 2.2, 14).translate(0, 2.7, 0),
    new THREE.ConeGeometry(0.95, 1.9, 14).translate(0, 3.9, 0),
  ];
  return shadeByHeight(mergeGeometries(parts.map((p) => p.toNonIndexed()))!, 0.78, 1.06);
}

function trees(track: Track, rand: Rand, center: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const spots: THREE.Vector3[] = [];
  const minLat = track.def.halfWidth + track.def.wallOffset + 3;
  const box = new THREE.Box3().setFromPoints(track.pts).expandByScalar(110);
  const size = box.getSize(new THREE.Vector3());
  for (let tries = 0; spots.length < 320 && tries < 6000; tries++) {
    const p = new THREE.Vector3(box.min.x + rand() * size.x, 0, box.min.z + rand() * size.z);
    if (Math.abs(track.project(p).lateral) > minLat) spots.push(p);
  }
  void center;
  const round = spots.filter((_, i) => i % 5 !== 0);
  const pines = spots.filter((_, i) => i % 5 === 0);

  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.28, 0.48, 3, 10).translate(0, 1.5, 0),
    new THREE.MeshLambertMaterial({ map: woodTexture(), color: '#d3a97e' }),
    spots.length,
  );
  const crownMat = applyWind(new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true }), 0.12, 1.5);
  const crowns = new THREE.InstancedMesh(crownGeometry(), crownMat, round.length);
  const cones = new THREE.InstancedMesh(
    pineGeometry(),
    applyWind(new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true }), 0.08, 5),
    pines.length,
  );
  const greens = ['#9fd67e', '#b2df8e', '#8cc872', '#c2e7a0', '#a5d985'];
  let ti = 0;
  round.forEach((p, i) => {
    const k = 0.9 + rand() * 1.1;
    _m.compose(p, _q.setFromEuler(_e.set(0, rand() * 6, 0)), _s.setScalar(k));
    trunk.setMatrixAt(ti++, _m);
    _m.compose(_p.copy(p).setY(3.6 * k), _q, _s.set(2.2 * k, 1.9 * k, 2.2 * k));
    crowns.setMatrixAt(i, _m);
    crowns.setColorAt(i, _c.set(greens[Math.floor(rand() * greens.length)]));
  });
  pines.forEach((p, i) => {
    const k = 0.9 + rand() * 0.9;
    _m.compose(p, _q.identity(), _s.set(k * 0.6, k * 0.6, k * 0.6));
    trunk.setMatrixAt(ti++, _m);
    _m.compose(_p.copy(p).setY(1.2 * k), _q, _s.set(k, k * 1.2, k));
    cones.setMatrixAt(i, _m);
    cones.setColorAt(i, _c.set(greens[Math.floor(rand() * 3)]).multiplyScalar(0.85));
  });
  g.add(trunk, crowns, cones);
  return g;
}

// ---------- 遠景 ----------

function backdrop(track: Track, rand: Rand, center: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const hillGeo = shadeByHeight(new THREE.SphereGeometry(1, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2), 0.84, 1.06);
  const hillCols = ['#b5dd96', '#a8d68a', '#c3e4a6', '#bbe0a0', '#aed990'];

  // なだらかな丘の輪
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rand() * 0.2;
    const d = 330 + rand() * 120;
    const hill = new THREE.Mesh(hillGeo, new THREE.MeshLambertMaterial({ color: hillCols[i % hillCols.length], vertexColors: true }));
    hill.position.set(center.x + Math.cos(a) * d, -2, center.z + Math.sin(a) * d);
    hill.scale.set(90 + rand() * 80, 30 + rand() * 45, 70 + rand() * 60);
    g.add(hill);
  }

  // 顔のある丘（スタートの正面）
  const start = track.pointAt(0);
  const dir = track.tangentAt(0);
  const faceHill = new THREE.Mesh(
    new THREE.SphereGeometry(1, 96, 48, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: faceHillTexture() }),
  );
  faceHill.scale.set(95, 70, 70);
  faceHill.position.copy(start).addScaledVector(dir, 330).setY(-4);
  faceHill.rotation.y = Math.atan2(dir.x, dir.z);
  g.add(faceHill);

  // 丘のまわりの家
  const domeMat = new THREE.MeshLambertMaterial({ color: '#f4ece0' });
  const doorMat = new THREE.MeshLambertMaterial({ color: '#6a5040' });
  const roofMats = ['#f0a08c', '#f2c08a', '#b3c4e6'].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const wallMat = new THREE.MeshLambertMaterial({ color: '#fff6e6' });
  const dome = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const d = 170 + rand() * 120;
    const p = new THREE.Vector3(center.x + Math.cos(a) * d, 0, center.z + Math.sin(a) * d);
    if (Math.abs(track.project(p).lateral) < 60) continue;
    const house = new THREE.Group();
    const facing = Math.atan2(center.x - p.x, center.z - p.z);
    if (i % 2 === 0) {
      const s = 5 + rand() * 4;
      const d0 = new THREE.Mesh(dome, domeMat);
      d0.scale.set(s, s * 0.85, s);
      house.add(d0);
      const door = new THREE.Mesh(new THREE.CircleGeometry(s * 0.28, 16, 0, Math.PI), doorMat);
      door.position.set(0, 0, s * 0.98);
      house.add(door);
    } else {
      const w = 5 + rand() * 3;
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, w * 0.7, w * 0.8).translate(0, w * 0.35, 0), wallMat);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.8, w * 0.6, 4).translate(0, w * 0.7 + w * 0.3, 0), roofMats[i % 3]);
      roof.rotation.y = Math.PI / 4;
      house.add(body, roof);
    }
    house.position.copy(p);
    house.rotation.y = facing;
    g.add(house);
  }
  return g;
}

// もこもこの雲（下側は少し青みがかった影）。全部で1回の描画
function clouds(rand: Rand, center: THREE.Vector3): THREE.InstancedMesh {
  // クリーム白、下は薄紫の「絵の雲」
  const geo = shadeByHeight(new THREE.IcosahedronGeometry(1, 2), 0.86, 1.02, [0.95, 0.93, 1]);
  const mat = new THREE.MeshLambertMaterial({ color: PAL.cloud, emissive: PAL.cloudShade, emissiveIntensity: 0.75, vertexColors: true, fog: false });
  const puffsList: THREE.Matrix4[] = [];
  const obj = new THREE.Object3D();
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rand() * 0.3;
    const d = 420 + rand() * 300;
    obj.position.set(center.x + Math.cos(a) * d, 85 + rand() * 90, center.z + Math.sin(a) * d);
    obj.lookAt(center.x, obj.position.y, center.z);
    obj.updateMatrixWorld();
    const puffs = 7 + Math.floor(rand() * 6);
    for (let j = 0; j < puffs; j++) {
      const r = 8 + rand() * 13 - Math.abs(j - puffs / 2) * 0.8;
      const local = new THREE.Vector3((j - puffs / 2) * 9 + rand() * 6, rand() * 7 + Math.max(0, 6 - Math.abs(j - puffs / 2) * 2), (rand() - 0.5) * 10);
      const m = new THREE.Matrix4().compose(local.applyMatrix4(obj.matrixWorld), _q.identity(), _s.set(r, r * 0.78, r));
      puffsList.push(m);
    }
  }
  const mesh = new THREE.InstancedMesh(geo, mat, puffsList.length);
  puffsList.forEach((m, i) => mesh.setMatrixAt(i, m));
  return mesh;
}
