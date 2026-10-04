import * as THREE from 'three';
import { bannerTexture, checkerTexture, dirtTexture, dirtTextures, roadEdgeTexture, woodTexture } from '../core/textures';
import { crystalMaterial, edgeGlowMaterial, goldMaterial, lampMaterial, rainbowRoadMaterial } from './rainbowMaterials';
import { donutGate } from './candy/gate';
import { candyRoadMaterial, caneMaterial, chocolateMaterial, glazeMaterial, waffleMaterial } from './candy/materials';
import { ROAD_TILE_LEN } from './candy/textures';
import { beachStartGate } from './sunset/gate';
import { ROAD_TILE as SAND_TILE, sandRoadMaterial } from './sunset/materials';
import { driftwoodTexture } from './sunset/textures';

export interface RampDef {
  t: number;
  length: number;
  height: number;
  glide?: boolean; // グライダー台（飛び出すと滑空する）
}

export interface TrackDef {
  name: string;
  theme?: 'meadow' | 'rainbow' | 'candy' | 'sunset'; // 見た目の種類（道・ジャンプ台・ゲートの作り）。省略時は原っぱ
  title?: string; // スタートゲートの横断幕
  points: [number, number][]; // XZ 平面の制御点（閉じたループ）
  halfWidth: number;
  wallOffset: number; // 路肩からこの距離に柵（見えない壁）
  ramps: RampDef[];
  dashPads: { t: number; lateral: number }[];
  river?: { t: number; width: number }; // 道を横切る川（木の橋がかかる）
  ramenStall?: { t: number; side: 1 | -1 };
  itemBoxes: number[]; // t の位置に横一列で並べる
  coins: { t: number; lateral: number; count: number }[];
  signs: { t: number; side: 1 | -1; lines: string[] }[];
}

export interface TrackProjection {
  t: number; // 0..1 コース上の進み具合
  index: number; // 最寄りサンプル（次回検索のヒント）
  lateral: number; // 中心線からの横ずれ（+ が進行方向の左）
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface Ground {
  h: number;
  slope: number;
  glide: boolean;
}

const SAMPLES = 800;
export const DASH_LEN = 4;
export const DASH_W = 3.2;

export class Track {
  readonly group = new THREE.Group();
  readonly def: TrackDef;
  readonly length: number;
  readonly pts: THREE.Vector3[] = [];
  private tans: THREE.Vector3[] = [];
  private nrms: THREE.Vector3[] = [];
  private ground: Ground = { h: 0, slope: 0, glide: false };
  // 水の上か（夕焼け海岸の浅瀬）。世界を作るときに設定される
  waterAt: ((x: number, z: number) => boolean) | null = null;

  constructor(def: TrackDef) {
    this.def = def;
    const curve = new THREE.CatmullRomCurve3(
      def.points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'centripetal',
    );
    this.length = curve.getLength();
    for (let i = 0; i < SAMPLES; i++) {
      const u = i / SAMPLES;
      const p = curve.getPointAt(u);
      const t = curve.getTangentAt(u).setY(0).normalize();
      this.pts.push(p);
      this.tans.push(t);
      this.nrms.push(new THREE.Vector3(t.z, 0, -t.x));
    }
    this.buildRoad();
    for (const r of def.ramps) this.group.add(this.buildRamp(r));
    this.group.add(this.buildStart());
  }

  // 位置 → コース上の最寄り点。out を渡すとそこに書き込む。hint があれば周辺だけ探す。
  project(pos: THREE.Vector3, out?: TrackProjection, hint = -1): TrackProjection {
    out ??= { t: 0, index: 0, lateral: 0, point: new THREE.Vector3(), tangent: new THREE.Vector3(), normal: new THREE.Vector3() };
    let best = 0;
    let bestD = Infinity;
    const range = hint >= 0 ? 60 : SAMPLES / 2;
    const start = hint >= 0 ? hint : SAMPLES / 2;
    for (let k = -range; k < range; k++) {
      const i = (((start + k) % SAMPLES) + SAMPLES) % SAMPLES;
      const p = this.pts[i];
      const dx = pos.x - p.x;
      const dz = pos.z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const a = this.pts[best];
    const b = this.pts[(best + 1) % SAMPLES];
    let f = ((pos.x - a.x) * (b.x - a.x) + (pos.z - a.z) * (b.z - a.z)) / a.distanceToSquared(b);
    let i0 = best;
    if (f < 0) {
      i0 = (best - 1 + SAMPLES) % SAMPLES;
      const c = this.pts[i0];
      f = Math.max(0, ((pos.x - c.x) * (a.x - c.x) + (pos.z - c.z) * (a.z - c.z)) / c.distanceToSquared(a));
    }
    f = Math.min(f, 1);
    const i1 = (i0 + 1) % SAMPLES;
    out.point.lerpVectors(this.pts[i0], this.pts[i1], f);
    out.tangent.lerpVectors(this.tans[i0], this.tans[i1], f).normalize();
    out.normal.set(out.tangent.z, 0, -out.tangent.x);
    out.lateral = (pos.x - out.point.x) * out.normal.x + (pos.z - out.point.z) * out.normal.z;
    out.t = (i0 + f) / SAMPLES;
    out.index = best;
    return out;
  }

  // ジャンプ台の上なら高さと傾き
  groundAt(p: TrackProjection): Ground {
    const g = this.ground;
    g.h = 0;
    g.slope = 0;
    g.glide = false;
    const s = p.t * this.length;
    for (const r of this.def.ramps) {
      let d = s - r.t * this.length;
      if (d < -this.length / 2) d += this.length;
      if (d >= 0 && d <= r.length && Math.abs(p.lateral) < this.def.halfWidth) {
        g.h = (r.height * d) / r.length;
        g.slope = r.height / r.length;
        g.glide = !!r.glide;
      }
    }
    return g;
  }

  // ダッシュ板の上か
  onDash(p: TrackProjection): boolean {
    const s = p.t * this.length;
    for (const d of this.def.dashPads) {
      let ds = s - d.t * this.length;
      if (ds < -this.length / 2) ds += this.length;
      if (ds > this.length / 2) ds -= this.length;
      if (Math.abs(ds) <= DASH_LEN / 2 && Math.abs(p.lateral - d.lateral) < DASH_W / 2) return true;
    }
    return false;
  }

  private idx(t: number): number {
    return Math.floor((((t % 1) + 1) % 1) * SAMPLES) % SAMPLES;
  }
  pointAt(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.pts[this.idx(t)]);
  }
  tangentAt(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.tans[this.idx(t)]);
  }
  normalAt(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.nrms[this.idx(t)]);
  }
  // コース上の t・横ずれから位置
  place(t: number, lateral: number, target = new THREE.Vector3()): THREE.Vector3 {
    const i = this.idx(t);
    return target.copy(this.pts[i]).addScaledVector(this.nrms[i], lateral);
  }

  // ---------- 見た目 ----------

  get rainbow(): boolean {
    return this.def.theme === 'rainbow';
  }
  get candy(): boolean {
    return this.def.theme === 'candy';
  }
  get sunset(): boolean {
    return this.def.theme === 'sunset';
  }

  private buildRoad() {
    const hw = this.def.halfWidth;
    if (this.rainbow) {
      // 虹色に光る道＋ふちの白い光の線
      const mesh = new THREE.Mesh(this.strip(-hw, hw, 0.02, 1, 1, 14), rainbowRoadMaterial());
      mesh.receiveShadow = true;
      this.group.add(mesh);
      const glow = edgeGlowMaterial();
      glow.color.multiplyScalar(1.6); // 明るさ 1 を超えて、ふんわり光をにじませる
      for (const s of [-1, 1]) {
        const a = s * (hw - 0.05), b = s * (hw - 0.45);
        this.group.add(new THREE.Mesh(this.strip(Math.min(a, b), Math.max(a, b), 0.035, 1, 1, 14), glow));
      }
      return;
    }
    if (this.sunset) {
      // 砂の道（わだち・貝殻・ヒトデ。ふちは浜の砂になじむ）
      const mesh = new THREE.Mesh(this.strip(-hw, hw, 0.02, 1, 1, SAND_TILE), sandRoadMaterial());
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return;
    }
    if (this.candy) {
      // ビスケットの道（ピンクのアイシングとカラースプリンクルつき）
      const mesh = new THREE.Mesh(this.strip(-hw, hw, 0.02, 1, 1, ROAD_TILE_LEN), candyRoadMaterial());
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return;
    }
    const { map: dirt, normal } = dirtTextures();
    const road = this.strip(-hw, hw, 0.02, 1, 1, 10);
    // 小石や砂の凹凸が光で浮き出るよう法線マップ付き
    const mat = new THREE.MeshStandardMaterial({ map: dirt, normalMap: normal, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.97 });
    const mesh = new THREE.Mesh(road, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    // 道のふちに草のギザギザをかぶせて、まっすぐな境目を隠す
    const edgeMat = new THREE.MeshLambertMaterial({ map: roadEdgeTexture(), alphaTest: 0.5, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(this.edgeStrip(s, hw - 1.3, hw + 0.9, 0.03), edgeMat);
      e.receiveShadow = true;
      this.group.add(e);
    }
  }

  // ふちの帯：u = 進行方向（4m で1周）、v = 外側 0 → 内側 1
  private edgeStrip(side: number, inner: number, outer: number, y: number): THREE.BufferGeometry {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const seg = this.length / SAMPLES;
    for (let i = 0; i <= SAMPLES; i++) {
      const k = i % SAMPLES;
      const p = this.pts[k], n = this.nrms[k];
      const u = (i * seg) / 4;
      pos.push(p.x + n.x * outer * side, y, p.z + n.z * outer * side);
      uv.push(u, 0);
      pos.push(p.x + n.x * inner * side, y, p.z + n.z * inner * side);
      uv.push(u, 1);
      if (i < SAMPLES) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  // 中心線に沿った帯。alphaA/alphaB は内外の不透明度（頂点カラーの a）
  private strip(a: number, b: number, y: number, alphaA: number, alphaB: number, vScale: number): THREE.BufferGeometry {
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const seg = this.length / SAMPLES;
    for (let i = 0; i < SAMPLES; i++) {
      const j = (i + 1) % SAMPLES;
      const pa = this.pts[i], pb = this.pts[j];
      const na = this.nrms[i], nb = this.nrms[j];
      const va = (i * seg) / vScale, vb = ((i + 1) * seg) / vScale;
      const hw2 = this.def.halfWidth * 2;
      const ua = (a + this.def.halfWidth) / hw2, ub = (b + this.def.halfWidth) / hw2;
      const q = [
        [pa.x + na.x * a, pa.z + na.z * a, ua, va, alphaA],
        [pa.x + na.x * b, pa.z + na.z * b, ub, va, alphaB],
        [pb.x + nb.x * a, pb.z + nb.z * a, ua, vb, alphaA],
        [pb.x + nb.x * b, pb.z + nb.z * b, ub, vb, alphaB],
      ];
      for (const k of [0, 2, 1, 1, 2, 3]) {
        pos.push(q[k][0], y, q[k][1]);
        uv.push(q[k][2], q[k][3]);
        col.push(1, 1, 1, q[k][4]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    geo.computeVertexNormals();
    return geo;
  }

  private buildRamp(r: RampDef): THREE.Group {
    const g = new THREE.Group();
    const hw = this.def.halfWidth;
    const n = 12;
    const s0 = r.t * this.length;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const rows: { p: THREE.Vector3; n: THREE.Vector3; h: number }[] = [];
    for (let k = 0; k <= n; k++) {
      const s = s0 + (r.length * k) / n;
      const i = this.idx(s / this.length);
      rows.push({ p: this.pts[i], n: this.nrms[i], h: 0.03 + (r.height * k) / n });
    }
    // 上面
    rows.forEach((row, k) => {
      for (const side of [-1, 1]) {
        pos.push(row.p.x + row.n.x * hw * side, row.h, row.p.z + row.n.z * hw * side);
        uv.push(side < 0 ? 0 : 1, (k * r.length) / n / 6);
      }
    });
    for (let k = 0; k < n; k++) {
      const a = k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    // 側面と後ろの壁
    const base = pos.length / 3;
    rows.forEach((row) => {
      for (const side of [-1, 1]) {
        const x = row.p.x + row.n.x * hw * side, z = row.p.z + row.n.z * hw * side;
        pos.push(x, row.h, z, x, 0, z);
        uv.push(0, row.h / 3, 0, 0);
      }
    });
    for (let k = 0; k < n; k++) {
      for (const side of [0, 1]) {
        const a = base + (k * 2 + side) * 2, b = base + ((k + 1) * 2 + side) * 2;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const e0 = base + n * 4, e1 = base + n * 4 + 2;
    idx.push(e0, e0 + 1, e1, e1, e0 + 1, e1 + 1);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    let rampMat: THREE.Material;
    if (this.candy) {
      // ふつうの台はワッフル、グライダー台は赤白のキャンディのしま
      if (r.glide) {
        rampMat = caneMaterial();
        const t = (rampMat as THREE.MeshPhysicalMaterial).map!.clone();
        t.repeat.set(5, 1);
        t.needsUpdate = true;
        (rampMat as THREE.MeshPhysicalMaterial).map = t;
        (rampMat as THREE.MeshPhysicalMaterial).side = THREE.DoubleSide;
      } else {
        rampMat = waffleMaterial((hw * 2) / 3, 6 / 3);
        (rampMat as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      }
    } else if (this.sunset) {
      // 木の板のデッキ
      const tex = driftwoodTexture().clone();
      tex.repeat.set(6, 2);
      tex.needsUpdate = true;
      rampMat = new THREE.MeshStandardMaterial({ map: tex, color: r.glide ? '#e8d2b4' : '#d9b48c', roughness: 0.85, side: THREE.DoubleSide });
    } else if (this.rainbow) {
      // 水晶の台。グライダー台は水色、ふつうのジャンプ台はうす桃色
      rampMat = crystalMaterial(r.glide ? '#bfe6ff' : '#ffd1ec', r.glide ? '#5fa8ff' : '#ff7dc0', 0.45);
      (rampMat as THREE.MeshStandardMaterial).flatShading = false;
      (rampMat as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    } else {
      const tex = dirtTexture();
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      rampMat = new THREE.MeshLambertMaterial({ map: tex, color: r.glide ? '#c9e8ff' : '#f0d6b4', side: THREE.DoubleSide });
    }
    const mesh = new THREE.Mesh(geo, rampMat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    g.add(mesh);
    if (this.rainbow) {
      // 両脇は金の手すり
      const gold = goldMaterial();
      const first = rows[0], last = rows[n];
      for (const side of [-1, 1]) {
        const off = (hw + 0.3) * side;
        const a = first.p.clone().addScaledVector(first.n, off).setY(0.9);
        const b = last.p.clone().addScaledVector(last.n, off).setY(r.height + 0.9);
        const len = a.distanceTo(b);
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, len, 10), gold);
        rail.position.copy(a).lerp(b, 0.5);
        rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        rail.castShadow = true;
        g.add(rail);
      }
      if (r.glide) g.add(this.glideGate(first.p, first.n, r));
      return g;
    }

    // 両脇の丸太
    const logMat = this.candy ? chocolateMaterial() : new THREE.MeshLambertMaterial({ map: this.sunset ? driftwoodTexture() : woodTexture(), color: '#d8b28a' });
    const endMat = this.candy ? chocolateMaterial() : new THREE.MeshLambertMaterial({ color: '#d9b37e' });
    const first = rows[0], last = rows[n];
    for (const side of [-1, 1]) {
      for (let layer = 0; layer < 2; layer++) {
        const off = (hw + 0.35) * side;
        const a = first.p.clone().addScaledVector(first.n, off).setY(0.25 + layer * 0.45);
        const b = last.p.clone().addScaledVector(last.n, off).setY(r.height * (layer ? 0.9 : 0.45) + 0.25);
        const len = a.distanceTo(b);
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, len, 10), [logMat, endMat, endMat]);
        log.position.copy(a).lerp(b, 0.5);
        log.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        log.castShadow = true;
        g.add(log);
      }
    }
    if (r.glide) g.add(this.glideGate(first.p, first.n, r));
    return g;
  }

  // グライダー台の目印：水色の台＋手前のゲートと横断幕
  private glideGate(p: THREE.Vector3, n: THREE.Vector3, r: RampDef): THREE.Group {
    const g = new THREE.Group();
    const hw = this.def.halfWidth;
    const tan = this.tangentAt(r.t);
    let poleMat: THREE.Material = this.rainbow ? goldMaterial() : new THREE.MeshLambertMaterial({ color: '#ffffff' });
    let capMat: THREE.Material = this.rainbow ? lampMaterial('#a8dcff') : new THREE.MeshLambertMaterial({ color: '#8fd3ff', emissive: '#8fd3ff', emissiveIntensity: 0.3 });
    if (this.rainbow) (capMat as THREE.MeshBasicMaterial).color.multiplyScalar(2);
    if (this.candy) {
      // 赤白のキャンディの柱に、ペロペロキャンディの玉
      poleMat = caneMaterial();
      const t = (poleMat as THREE.MeshPhysicalMaterial).map!.clone();
      t.repeat.set(1, 6);
      t.needsUpdate = true;
      (poleMat as THREE.MeshPhysicalMaterial).map = t;
      capMat = glazeMaterial();
      (capMat as THREE.MeshPhysicalMaterial).color.set('#ff7aa8');
    }
    for (const s of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 7.5, 12).translate(0, 3.75, 0), poleMat);
      pole.position.copy(p).addScaledVector(n, (hw + 1.3) * s).addScaledVector(tan, -1);
      pole.castShadow = true;
      g.add(pole);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), capMat);
      cap.position.copy(pole.position).setY(7.7);
      g.add(cap);
    }
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(hw * 2 + 2, 1.9),
      new THREE.MeshLambertMaterial({ map: bannerTexture('ふわっとグライダー台'), side: THREE.DoubleSide }),
    );
    banner.position.copy(p).addScaledVector(tan, -1).setY(6.6);
    banner.rotation.y = Math.atan2(tan.x, tan.z) + Math.PI;
    g.add(banner);
    return g;
  }

  private buildStart(): THREE.Group {
    const g = new THREE.Group();
    const hw = this.def.halfWidth;
    const t = this.tans[0];
    const yaw = Math.atan2(t.x, t.z);
    g.position.copy(this.pts[0]);
    g.rotation.y = yaw;

    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(hw * 2, 2).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ map: checkerTexture() }),
    );
    line.position.y = 0.04;
    line.receiveShadow = true;
    g.add(line);

    if (this.sunset) {
      // 流木と貝殻のゲート
      g.add(beachStartGate(hw, this.def.title ?? 'サンセットカップ'));
      return g;
    }
    if (this.candy) {
      // 大きなドーナツのゲート（くまの顔のバッジと王冠つき）
      g.add(donutGate(hw, this.def.title ?? 'スイーツグランプリ'));
      return g;
    }
    // ゲート
    const poleMat = this.rainbow ? goldMaterial() : new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const ballMat = this.rainbow ? lampMaterial('#ffc4e6') : new THREE.MeshLambertMaterial({ color: '#ff9db8' });
    if (this.rainbow) (ballMat as THREE.MeshBasicMaterial).color.multiplyScalar(2.2);
    for (const s of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 7, 12), poleMat);
      pole.position.set(s * (hw + 1.2), 3.5, 0);
      pole.castShadow = true;
      g.add(pole);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), ballMat);
      ball.position.set(s * (hw + 1.2), 7.2, 0);
      g.add(ball);
    }
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(hw * 2 + 2, 1.9),
      new THREE.MeshLambertMaterial({ map: bannerTexture(this.def.title ?? '草むしりグランプリ'), side: THREE.DoubleSide }),
    );
    banner.position.set(0, 6.1, 0);
    banner.rotation.y = Math.PI; // 走ってくる側に文字を向ける
    g.add(banner);
    return g;
  }
}
