import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { characterIcon } from '../characters/icons';
import { CHARACTERS } from '../config/characters';
import { mulberry32 } from '../core/random';
import { PAL } from '../config/palette';
import { FONT, heightToNormal, makeCanvas, toTexture, woodTexture } from '../core/textures';
import { DASH_LEN, DASH_W, type Track } from './Track';

type Rand = () => number;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

export interface Landmarks {
  group: THREE.Group;
  update(dt: number, camera: THREE.Camera): void;
}

// コースの名物（ダッシュ板・川と橋・屋台・旗・観客・池・風車・ちょうちょ）
export function buildLandmarks(track: Track): Landmarks {
  const group = new THREE.Group();
  const rand = mulberry32(99);
  const updaters: ((dt: number, cam: THREE.Camera, time: number) => void)[] = [];
  const add = (r: { obj: THREE.Object3D; update?: (dt: number, cam: THREE.Camera, time: number) => void }) => {
    group.add(r.obj);
    if (r.update) updaters.push(r.update);
  };

  add(dashPads(track));
  if (track.def.river) add(river(track));
  if (track.def.ramenStall) add(ramenStall(track));
  add(bunting(track));
  add(balloons(track, rand));
  // 観客はなし（お花とシャボン玉でにぎやかに）
  add(pond(track, rand));
  add(windmills(track, rand));
  add(butterflies(track, rand));
  add(bubbles(track, rand));

  let time = 0;
  return {
    group,
    update(dt, camera) {
      time += dt;
      for (const u of updaters) u(dt, camera, time);
    },
  };
}

// ---------- ダッシュ板 ----------

export function dashPads(track: Track) {
  const [c, g] = makeCanvas(64, 128);
  g.fillStyle = '#ff8a2a';
  g.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 2; i++) {
    const y = i * 64;
    g.fillStyle = '#ffe66b';
    g.beginPath();
    g.moveTo(6, y + 10);
    g.lineTo(32, y + 40);
    g.lineTo(58, y + 10);
    g.lineTo(58, y + 28);
    g.lineTo(32, y + 58);
    g.lineTo(6, y + 28);
    g.closePath();
    g.fill();
  }
  g.strokeStyle = '#fff6d0';
  g.lineWidth = 6;
  g.strokeRect(0, -4, 64, 136);
  const tex = toTexture(c);
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 2);
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const geo = new THREE.PlaneGeometry(DASH_W, DASH_LEN).rotateX(-Math.PI / 2);
  const obj = new THREE.Group();
  for (const d of track.def.dashPads) {
    const m = new THREE.Mesh(geo, mat);
    track.place(d.t, d.lateral, m.position).setY(0.05);
    const tan = track.tangentAt(d.t);
    m.rotation.y = Math.atan2(tan.x, tan.z);
    obj.add(m);
  }
  return { obj, update: (dt: number) => (tex.offset.y += dt * 2.5) };
}

// ---------- 川と木の橋 ----------

function waterTexture(): THREE.CanvasTexture {
  const [c, g] = makeCanvas(128, 128);
  const grd = g.createLinearGradient(0, 0, 128, 0);
  grd.addColorStop(0, '#94d6ea');
  grd.addColorStop(0.5, PAL.water);
  grd.addColorStop(1, '#94d6ea');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const rand = mulberry32(8);
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = rand() * 128, y = rand() * 128, w = 6 + rand() * 14;
    g.lineWidth = 1.5 + rand() * 2;
    g.beginPath();
    g.moveTo(x - w / 2, y);
    g.quadraticCurveTo(x, y - 3, x + w / 2, y);
    g.stroke();
  }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// さざ波の凹凸（空が揺れて映る）
let waterNormalCache: THREE.CanvasTexture | null = null;
function waterNormal(): THREE.CanvasTexture {
  if (waterNormalCache) return waterNormalCache;
  const [c, g] = makeCanvas(256, 256);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 256, 256);
  const rand = mulberry32(12);
  for (let i = 0; i < 140; i++) {
    const x = rand() * 256, y = rand() * 256, r = 6 + rand() * 22;
    const grd = g.createRadialGradient(x, y, r * 0.6, x, y, r);
    grd.addColorStop(0, 'rgba(160,160,160,0)');
    grd.addColorStop(0.5, 'rgba(200,200,200,0.5)');
    grd.addColorStop(1, 'rgba(90,90,90,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  waterNormalCache = heightToNormal(c, 3);
  return waterNormalCache;
}

function waterMaterial(map: THREE.Texture, side: THREE.Side = THREE.FrontSide): THREE.MeshStandardMaterial {
  const nm = waterNormal().clone();
  nm.needsUpdate = true;
  nm.repeat.copy(map.repeat).multiplyScalar(1.5);
  const m = new THREE.MeshStandardMaterial({ map, normalMap: nm, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.3, metalness: 0.05, side });
  m.userData.normal = nm;
  return m;
}

function river(track: Track) {
  const def = track.def.river!;
  const hw = track.def.halfWidth;
  const obj = new THREE.Group();
  const center = track.pointAt(def.t);
  const nrm = track.normalAt(def.t);
  const tan = track.tangentAt(def.t);

  // 道と直角に、ゆるく蛇行させながら両側へ
  const pts: THREE.Vector3[] = [];
  for (let k = -32; k <= 32; k++) {
    const d = k * 3;
    const p = center.clone().addScaledVector(nrm, d).addScaledVector(tan, Math.sin(d * 0.05) * 6 * Math.min(1, Math.abs(d) / 25));
    // ほかの区間の道に近づいたらそこで止める
    const pr = track.project(p);
    if (Math.abs(d) > hw + 8 && Math.abs(pr.lateral) < hw + track.def.wallOffset + 4) {
      if (k < 0) pts.length = 0;
      else break;
      continue;
    }
    pts.push(p);
  }
  const tex = waterTexture();
  const w = def.width;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let dist = 0;
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dir = b.clone().sub(a).normalize();
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    if (i > 0) dist += p.distanceTo(pts[i - 1]);
    for (const s of [-1, 1]) {
      pos.push(p.x + side.x * (w / 2) * s, 0.04, p.z + side.z * (w / 2) * s);
      uv.push(s < 0 ? 0 : 1, dist / 12);
    }
    if (i > 0) {
      const o = (i - 1) * 2;
      idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const waterMat = waterMaterial(tex, THREE.DoubleSide);
  const water = new THREE.Mesh(geo, waterMat);
  water.receiveShadow = true;
  obj.add(water);

  // 川岸の石
  const stoneMat = new THREE.MeshLambertMaterial({ color: '#d4cedc' });
  const stones = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 0), stoneMat, pts.length * 2);
  const rand = mulberry32(3);
  let n = 0;
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dir = b.clone().sub(a).normalize();
    for (const s of [-1, 1]) {
      const q = p.clone().add(new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar((w / 2 + 0.2) * s));
      if (Math.abs(track.project(q).lateral) < hw + 1.5) continue;
      const k = 0.6 + rand() * 0.9;
      _m.compose(q.setY(0.1), _q.setFromEuler(_e.set(rand(), rand() * 6, 0)), _s.set(k * 1.3, k * 0.6, k));
      stones.setMatrixAt(n++, _m);
    }
  });
  stones.count = n;
  obj.add(stones);

  // 木の橋（道の上に板を並べる＋手すり）
  const plank = makeCanvas(64, 256);
  const pg = plank[1];
  const woodCols = ['#dcb58a', '#d1a97e', '#e3c098', '#d6ae84'];
  for (let i = 0; i < 8; i++) {
    pg.fillStyle = woodCols[i % 4];
    pg.fillRect(0, i * 32, 64, 32);
    pg.fillStyle = 'rgba(70,45,25,0.6)';
    pg.fillRect(0, i * 32, 64, 3);
    pg.fillStyle = '#6b4a2e';
    pg.beginPath();
    pg.arc(8, i * 32 + 16, 2.5, 0, 7);
    pg.arc(56, i * 32 + 16, 2.5, 0, 7);
    pg.fill();
  }
  const plankTex = toTexture(plank[0]);
  plankTex.wrapT = THREE.RepeatWrapping;
  const bridgeLen = w + 4;
  plankTex.repeat.set(1, bridgeLen / 8);
  const deckGeo = new THREE.BoxGeometry(hw * 2 + 1.2, 0.3, bridgeLen);
  const woodMat = new THREE.MeshLambertMaterial({ map: woodTexture(), color: '#caa27a' });
  const deck = new THREE.Mesh(deckGeo, [woodMat, woodMat, new THREE.MeshLambertMaterial({ map: plankTex }), woodMat, woodMat, woodMat]);
  deck.position.copy(center).setY(-0.08);
  deck.rotation.y = Math.atan2(tan.x, tan.z);
  deck.receiveShadow = true;
  obj.add(deck);
  for (const s of [-1, 1]) {
    for (let k = -2; k <= 2; k++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.2, 0.25).translate(0, 0.6, 0), woodMat);
      post.position.copy(center).addScaledVector(nrm, (hw + 0.45) * s).addScaledVector(tan, (k * bridgeLen) / 4.4);
      post.castShadow = true;
      obj.add(post);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, bridgeLen), woodMat);
    rail.position.copy(center).addScaledVector(nrm, (hw + 0.45) * s).setY(1.1);
    rail.rotation.y = deck.rotation.y;
    obj.add(rail);
  }
  const wn = waterMat.userData.normal as THREE.Texture;
  return {
    obj,
    update: (dt: number) => {
      tex.offset.y -= dt * 0.35;
      wn.offset.y -= dt * 0.5;
      wn.offset.x += dt * 0.05;
    },
  };
}

// ---------- ラーメン屋台 ----------

function norenTexture(): THREE.CanvasTexture {
  const [c, g] = makeCanvas(512, 192);
  g.fillStyle = '#3b3f6e';
  g.fillRect(0, 0, 512, 192);
  g.fillStyle = '#fff8ea';
  g.font = `900 110px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  ['ラ', 'ー', 'メ', 'ン'].forEach((ch, i) => g.fillText(ch, 64 + i * 128, 104));
  g.fillStyle = '#fbe9c8';
  for (let i = 1; i < 4; i++) g.fillRect(i * 128 - 3, 60, 6, 132);
  return toTexture(c);
}

function lanternTexture(): THREE.CanvasTexture {
  const [c, g] = makeCanvas(256, 128);
  g.fillStyle = '#e8413a';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = 'rgba(120,20,20,0.35)';
  g.lineWidth = 3;
  for (let y = 8; y < 128; y += 14) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
  }
  g.fillStyle = '#1f1a1a';
  g.font = `900 80px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('ら', 64, 68);
  g.fillText('ら', 192, 68);
  return toTexture(c);
}

function ramenStall(track: Track) {
  const def = track.def.ramenStall!;
  const obj = new THREE.Group();
  // 柵のすぐ外に、走りながらでも目に入る大きさで
  const lat = (track.def.halfWidth + track.def.wallOffset + 3) * def.side;
  track.place(def.t, lat, obj.position);
  obj.scale.setScalar(1.5);
  const tan = track.tangentAt(def.t);
  const nrm = track.normalAt(def.t);
  // 道の方を向く
  const face = nrm.clone().multiplyScalar(-def.side);
  obj.rotation.y = Math.atan2(face.x, face.z);

  const wood = new THREE.MeshLambertMaterial({ map: woodTexture(), color: '#c8986c' });
  const light = new THREE.MeshLambertMaterial({ color: '#e9cfa3' });
  const counter = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.1, 1.6).translate(0, 0.55, 0), wood);
  const top = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.12, 1.9).translate(0, 1.16, 0.1), light);
  obj.add(counter, top);
  for (const x of [-2, 2]) {
    for (const z of [-0.7, 0.7]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.6, 0.15).translate(0, 1.3, 0), wood);
      p.position.set(x, 0, z);
      obj.add(p);
    }
  }
  // 屋根（赤白の縞）
  const [rc, rg] = makeCanvas(128, 32);
  for (let i = 0; i < 8; i++) {
    rg.fillStyle = i % 2 ? '#ffffff' : '#e8413a';
    rg.fillRect(i * 16, 0, 16, 32);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(5, 0.14, 2.6), new THREE.MeshLambertMaterial({ map: toTexture(rc) }));
  roof.position.set(0, 2.72, 0.25);
  roof.rotation.x = 0.18;
  roof.castShadow = true;
  obj.add(roof);
  // のれん
  const noren = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.9), new THREE.MeshLambertMaterial({ map: norenTexture(), side: THREE.DoubleSide }));
  noren.position.set(0, 2.15, 0.82);
  obj.add(noren);
  // ちょうちん
  const lantern = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 20, 14),
    new THREE.MeshLambertMaterial({ map: lanternTexture(), emissive: '#ff5a3a', emissiveIntensity: 0.35 }),
  );
  lantern.scale.set(1, 1.3, 1);
  lantern.position.set(2.45, 1.95, 0.9);
  obj.add(lantern);
  // 屋根の上の大きなどんぶり
  const bowl = new THREE.Group();
  const bowlMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: '#e8413a', side: THREE.DoubleSide }),
  );
  const soup = new THREE.Mesh(new THREE.CircleGeometry(0.95, 24).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#f4c16a' }));
  soup.position.y = -0.08;
  const naruto = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 16), new THREE.MeshLambertMaterial({ color: '#fff4f4' }));
  naruto.position.set(0.3, -0.03, 0.2);
  const egg = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshLambertMaterial({ color: '#ffd24a' }));
  egg.scale.set(1, 0.5, 1.2);
  egg.position.set(-0.3, -0.02, -0.1);
  bowl.add(bowlMesh, soup, naruto, egg);
  for (let i = 0; i < 2; i++) {
    const hashi = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.8, 6), wood);
    hashi.position.set(0.1 + i * 0.15, 0.4, 0);
    hashi.rotation.z = -0.5;
    bowl.add(hashi);
  }
  bowl.position.set(0, 3.8, 0.1);
  bowl.scale.setScalar(0.9);
  obj.add(bowl);
  // 椅子
  for (const x of [-1.2, 0, 1.2]) {
    const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.7, 12).translate(0, 0.35, 0), light);
    stool.position.set(x, 0, 1.45);
    obj.add(stool);
  }
  obj.traverse((o) => (o.castShadow ||= (o as THREE.Mesh).isMesh && o !== noren));
  void tan;
  return {
    obj,
    update: (_dt: number, _c: THREE.Camera, t: number) => {
      lantern.rotation.z = Math.sin(t * 1.7) * 0.08;
      bowl.position.y = 3.8 + Math.sin(t * 2) * 0.08;
      bowl.rotation.y = t * 0.4;
    },
  };
}

// ---------- 旗飾り（スタートの直線）と風船 ----------

function bunting(track: Track) {
  const obj = new THREE.Group();
  const hw = track.def.halfWidth;
  const poleMat = new THREE.MeshLambertMaterial({ color: '#fffaf0' });
  const flagCols = ['#ff8fb1', '#ffd54a', '#8fd3ff', '#9be08a', '#c9a2ff', '#ffffff'];
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.35, 0, 0, 0.35, 0, 0, 0, -0.75, 0], 3));
  flagGeo.computeVertexNormals();
  const poles: THREE.Vector3[][] = [[], []];
  const step = 14;
  const startS = -70, endS = 90;
  for (let s = startS; s <= endS; s += step) {
    const t = s / track.length;
    for (const [i, side] of [[0, -1], [1, 1]] as const) {
      const p = track.place(t, (hw + 2.2) * side);
      poles[i].push(p);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 5, 8).translate(0, 2.5, 0), poleMat);
      pole.position.copy(p);
      obj.add(pole);
    }
  }
  const flagsPerSpan = 7;
  const count = (poles[0].length - 1) * 2 * flagsPerSpan;
  const flags = new THREE.InstancedMesh(flagGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), count);
  const linePts: number[] = [];
  let n = 0;
  for (const side of poles) {
    for (let i = 0; i < side.length - 1; i++) {
      const a = side[i], b = side[i + 1];
      const yaw = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
      let prev: THREE.Vector3 | null = null;
      for (let k = 0; k <= flagsPerSpan + 1; k++) {
        const f = k / (flagsPerSpan + 1);
        const p = a.clone().lerp(b, f).setY(4.9 - Math.sin(f * Math.PI) * 0.9);
        if (prev) linePts.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        prev = p;
        if (k === 0 || k === flagsPerSpan + 1) continue;
        _m.compose(p, _q.setFromEuler(_e.set(0, yaw, 0)), _s.set(1, 1, 1));
        flags.setMatrixAt(n, _m);
        flags.setColorAt(n, _c.set(flagCols[n % flagCols.length]));
        n++;
      }
    }
  }
  flags.count = n;
  obj.add(flags);
  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.Float32BufferAttribute(linePts, 3));
  obj.add(new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: '#7a6a60' })));
  return { obj };
}

function balloons(track: Track, rand: Rand) {
  const obj = new THREE.Group();
  const hw = track.def.halfWidth;
  const cols = ['#ff8fb1', '#ffd54a', '#8fd3ff', '#9be08a', '#c9a2ff', '#ffb36b'];
  const geo = new THREE.SphereGeometry(0.55, 16, 12);
  const items: { m: THREE.Mesh; base: THREE.Vector3; ph: number }[] = [];
  const tan = track.tangentAt(0);
  for (const side of [-1, 1]) {
    const anchor = track.place(0, (hw + 1.2) * side).setY(7.2);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: cols[i], emissive: cols[i], emissiveIntensity: 0.15 }));
      m.scale.set(1, 1.2, 1);
      const base = anchor.clone().add(new THREE.Vector3((rand() - 0.5) * 2, 0.8 + rand() * 1.6, (rand() - 0.5) * 2).addScaledVector(tan, 0));
      m.position.copy(base);
      obj.add(m);
      items.push({ m, base, ph: rand() * 6 });
    }
  }
  return {
    obj,
    update: (_dt: number, _c: THREE.Camera, t: number) => {
      for (const b of items) {
        b.m.position.set(b.base.x + Math.sin(t * 1.3 + b.ph) * 0.15, b.base.y + Math.sin(t * 1.9 + b.ph) * 0.2, b.base.z + Math.cos(t * 1.1 + b.ph) * 0.15);
      }
    },
  };
}

// ---------- 観客（柵の外でぴょんぴょん） ----------

function spectators(track: Track, rand: Rand) {
  const obj = new THREE.Group();
  const d = track.def.halfWidth + track.def.wallOffset;
  const geo = new THREE.PlaneGeometry(2.3, 2.3).translate(0, 1.15, 0);
  const per = 9;
  // 盛り上がる場所：スタート前後・ジャンプ台・屋台のそば
  const zones = [-0.03, 0.02, 0.1, 0.475, 0.8];
  const groups: { mesh: THREE.InstancedMesh; pos: THREE.Vector3[]; ph: number[] }[] = [];
  for (const spec of CHARACTERS) {
    const tex = toTexture(characterIcon(spec, 256));
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }), per);
    const pos: THREE.Vector3[] = [];
    const ph: number[] = [];
    for (let i = 0; i < per; i++) {
      const z = zones[Math.floor(rand() * zones.length)];
      const t = z + (rand() - 0.5) * 0.03;
      const side = rand() < 0.5 ? -1 : 1;
      pos.push(track.place(t, (d + 1.3 + rand() * 3.5) * side));
      ph.push(rand() * 10);
    }
    obj.add(mesh);
    groups.push({ mesh, pos, ph });
  }
  return {
    obj,
    update: (_dt: number, cam: THREE.Camera, t: number) => {
      for (const g of groups) {
        g.pos.forEach((p, i) => {
          const hop = Math.abs(Math.sin(t * 5 + g.ph[i])) * 0.5;
          const yaw = Math.atan2(cam.position.x - p.x, cam.position.z - p.z);
          const sq = 1 - hop * 0.12;
          _m.compose(_p.set(p.x, hop, p.z), _q.setFromEuler(_e.set(0, yaw, Math.sin(t * 3 + g.ph[i]) * 0.1)), _s.set(1 / sq, sq, 1));
          g.mesh.setMatrixAt(i, _m);
        });
        g.mesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}

// ---------- 池 ----------

function pond(track: Track, rand: Rand) {
  const obj = new THREE.Group();
  const box = new THREE.Box3().setFromPoints(track.pts);
  let spot: THREE.Vector3 | null = null;
  for (let i = 0; i < 400 && !spot; i++) {
    const p = new THREE.Vector3(box.min.x + rand() * (box.max.x - box.min.x), 0, box.min.z + rand() * (box.max.z - box.min.z));
    if (Math.abs(track.project(p).lateral) > 34) spot = p;
  }
  if (!spot) return { obj };
  const tex = waterTexture();
  tex.repeat.set(3, 3);
  const pondMat = waterMaterial(tex);
  const water = new THREE.Mesh(new THREE.CircleGeometry(14, 64).rotateX(-Math.PI / 2), pondMat);
  water.scale.set(1, 1, 0.7);
  water.position.copy(spot).setY(0.05);
  water.receiveShadow = true;
  obj.add(water);
  // 岸
  const rim = new THREE.Mesh(new THREE.RingGeometry(13.6, 15, 40).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#c9b08a' }));
  rim.scale.set(1, 1, 0.7);
  rim.position.copy(spot).setY(0.045);
  obj.add(rim);
  // 蓮の葉と花
  const pad = new THREE.CircleGeometry(1, 16, 0.3, Math.PI * 2 - 0.6).rotateX(-Math.PI / 2);
  const pads = new THREE.InstancedMesh(pad, new THREE.MeshLambertMaterial({ color: '#5fae45', side: THREE.DoubleSide }), 18);
  const flowerGeo = mergeGeometries([
    new THREE.ConeGeometry(0.28, 0.4, 6).translate(0, 0.2, 0),
    new THREE.SphereGeometry(0.12, 8, 6).translate(0, 0.35, 0),
  ])!;
  const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshLambertMaterial({ color: '#ffb3cf' }), 6);
  for (let i = 0; i < 18; i++) {
    const a = rand() * Math.PI * 2, r = rand() * 11;
    const p = spot.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.08, Math.sin(a) * r * 0.7));
    const k = 0.6 + rand() * 0.8;
    _m.compose(p, _q.setFromEuler(_e.set(0, rand() * 6, 0)), _s.setScalar(k));
    pads.setMatrixAt(i, _m);
    if (i < 6) {
      _m.compose(p.setY(0.1), _q, _s.setScalar(1));
      flowers.setMatrixAt(i, _m);
    }
  }
  obj.add(pads, flowers);
  // 葦
  const reeds = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.03, 0.05, 1, 5).translate(0, 0.5, 0),
    new THREE.MeshLambertMaterial({ color: '#6f9e45' }),
    60,
  );
  for (let i = 0; i < 60; i++) {
    const a = rand() * Math.PI * 2;
    const p = spot.clone().add(new THREE.Vector3(Math.cos(a) * 14, 0, Math.sin(a) * 14 * 0.7));
    _m.compose(p, _q.setFromEuler(_e.set((rand() - 0.5) * 0.3, 0, (rand() - 0.5) * 0.3)), _s.set(1, 1.2 + rand() * 1.6, 1));
    reeds.setMatrixAt(i, _m);
  }
  obj.add(reeds);
  const pn = pondMat.userData.normal as THREE.Texture;
  return {
    obj,
    update: (dt: number) => {
      tex.offset.x += dt * 0.03;
      pn.offset.x += dt * 0.06;
      pn.offset.y += dt * 0.04;
    },
  };
}

// ---------- 風車 ----------

function windmills(track: Track, rand: Rand) {
  const obj = new THREE.Group();
  const center = new THREE.Box3().setFromPoints(track.pts).getCenter(new THREE.Vector3());
  const bladesList: THREE.Object3D[] = [];
  const white = new THREE.MeshLambertMaterial({ color: '#fbf6ec' });
  const roofMat = new THREE.MeshLambertMaterial({ color: '#f0a08c' });
  const sail = new THREE.MeshLambertMaterial({ color: '#fffaf2', side: THREE.DoubleSide });
  const frame = new THREE.MeshLambertMaterial({ map: woodTexture(), color: '#b8906a' });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.6;
    const d = 200 + rand() * 60;
    const mill = new THREE.Group();
    mill.position.set(center.x + Math.cos(a) * d, 0, center.z + Math.sin(a) * d);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 4.5, 16, 12).translate(0, 8, 0), white);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.8, 4, 12).translate(0, 18, 0), roofMat);
    const door = new THREE.Mesh(new THREE.CircleGeometry(1.2, 12, 0, Math.PI), frame);
    door.position.set(0, 0, 4.45);
    const blades = new THREE.Group();
    blades.position.set(0, 15, 3.8);
    for (let k = 0; k < 4; k++) {
      const arm = new THREE.Group();
      arm.rotation.z = (k * Math.PI) / 2;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 11, 0.3).translate(0, 5.5, 0), frame);
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 8).translate(1.4, 6.5, 0.1), sail);
      arm.add(beam, cloth);
      blades.add(arm);
    }
    mill.add(tower, roof, door, blades);
    mill.lookAt(center.x, 0, center.z);
    obj.add(mill);
    bladesList.push(blades);
  }
  return { obj, update: (dt: number) => bladesList.forEach((b, i) => (b.rotation.z += dt * (0.5 + i * 0.1))) };
}

// ---------- シャボン玉 ----------

// ふちが虹色に光る透明な玉。コース沿いをふわふわ上っていき、上がりきったら下からまた現れる
function bubbles(track: Track, rand: Rand) {
  const count = 150;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying float vSeed;
      void main() {
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vec4 mv = viewMatrix * wp;
        vN = normalize(mat3(viewMatrix) * mat3(modelMatrix * instanceMatrix) * normal);
        vV = normalize(-mv.xyz);
        vSeed = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.07;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vV;
      varying float vSeed;
      vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(f, 2.2);
        // 薄い膜の虹色（見る角度と時間でゆっくり変わる）
        vec3 film = mix(vec3(1.0), hue(f * 1.4 + vSeed + uTime * 0.08), 0.55);
        // 左上に白いハイライト
        vec3 l = normalize(vec3(-0.5, 0.6, 0.6));
        float spec = pow(max(dot(normalize(vN), l), 0.0), 60.0);
        vec3 col = film * (0.7 + rim) + spec * 1.5;
        float a = clamp(rim * 1.1 + 0.1 + spec, 0.0, 0.95);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 24, 16), mat, count);
  mesh.frustumCulled = false;
  const items = Array.from({ length: count }, () => {
    const lat = (rand() - 0.5) * 2 * (track.def.halfWidth + 5);
    return {
      base: track.place(rand(), lat),
      y: rand() * 9,
      r: 0.45 + rand() * 1.0,
      rise: 0.35 + rand() * 0.5,
      ph: rand() * 10,
    };
  });
  return {
    obj: mesh,
    update: (dt: number, _c: THREE.Camera, t: number) => {
      mat.uniforms.uTime.value = t;
      items.forEach((b, i) => {
        b.y += b.rise * dt;
        if (b.y > 10) b.y = 0.4; // 上がりきったら下から
        const wob = Math.sin(t * 1.3 + b.ph);
        _p.set(b.base.x + Math.sin(t * 0.7 + b.ph) * 1.2, 0.8 + b.y + wob * 0.3, b.base.z + Math.cos(t * 0.6 + b.ph) * 1.2);
        // ぷるぷる揺れる
        const sq = 1 + Math.sin(t * 4 + b.ph) * 0.05;
        const grow = Math.min(1, b.y / 0.8);
        _m.compose(_p, _q.identity(), _s.set(b.r * sq * grow, (b.r / sq) * grow, b.r * sq * grow));
        mesh.setMatrixAt(i, _m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------- ちょうちょ ----------

function butterflies(track: Track, rand: Rand) {
  const [c, g] = makeCanvas(64, 64);
  g.fillStyle = '#ffffff';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(32 + s * 15, 22, 14, 16, s * 0.3, 0, Math.PI * 2);
    g.ellipse(32 + s * 12, 46, 10, 11, -s * 0.3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#4a3a30';
  g.fillRect(30, 12, 4, 42);
  const count = 40;
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.6, 0.6).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: toTexture(c), alphaTest: 0.5, side: THREE.DoubleSide }),
    count,
  );
  const cols = ['#ffe36b', '#ffffff', '#ffb3cf', '#9fd6ff', '#ffc27a'];
  const bugs = Array.from({ length: count }, (_, i) => {
    const home = track.place(rand(), (track.def.halfWidth + 2 + rand() * 20) * (rand() < 0.5 ? -1 : 1));
    mesh.setColorAt(i, _c.set(cols[i % cols.length]));
    return { home, ph: rand() * 10, r: 1.5 + rand() * 3, sp: 0.4 + rand() * 0.6 };
  });
  return {
    obj: mesh,
    update: (_dt: number, _c2: THREE.Camera, t: number) => {
      bugs.forEach((b, i) => {
        const a = t * b.sp + b.ph;
        _p.set(b.home.x + Math.cos(a) * b.r, 1 + Math.sin(a * 2.3) * 0.5 + 0.6, b.home.z + Math.sin(a * 1.3) * b.r);
        const flap = 0.25 + Math.abs(Math.sin(t * 14 + b.ph)) * 0.75;
        _m.compose(_p, _q.setFromEuler(_e.set(0, -a, 0)), _s.set(flap, 1, 1));
        mesh.setMatrixAt(i, _m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
