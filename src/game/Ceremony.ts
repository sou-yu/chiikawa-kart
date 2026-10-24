import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { KartFX } from '../fx/KartFX';
import { Particles, type FXSystems } from '../fx/Particles';
import type { Track } from '../track/Track';
import type { Racer } from './Racer';

// グランプリの表彰式：最終戦のコースのゴールの少し先、道の上に表彰台を置き、合計 1〜3 位のカートを乗せる。
// 1 位はまんなかの高い台、2 位はカメラから見て左、3 位は右。
// 演出：台のうしろから打ち上げ花火（いろいろな形）、空をなでる光の柱、花吹雪の大砲と、ひらひら降る花吹雪。
// カメラは「全体 → 3 位のアップ → 2 位のアップ → 1 位を下から見上げる → 台のまわりをゆっくり回る」の順。
// レースの計算は止め（main が race.update を呼ばない）、カートの位置はここで直接置く。

const T0 = 0.035; // 台を置くコース上の位置（スタートラインの少し先）
const STEPS = [
  { rank: 1, lat: 0, h: 1.7, color: '#f5c242' },
  { rank: 2, lat: -3.6, h: 1.15, color: '#c9d3e0' },
  { rank: 3, lat: 3.6, h: 0.75, color: '#df9a5e' },
];
const CONFETTI = 620;
const CONFETTI_COLORS = ['#ff6f9f', '#ffd23a', '#7fd3ff', '#9be37a', '#c89bff', '#ffffff', '#ff9a4a'];
const FALL = 1.6; // 花吹雪の、ひらひら落ちる速さ（これ以上は速く落ちない）

// カメラのカット：始まる時刻（秒）。最後のカットは、ずっと続く
const SHOTS = [0, 3.6, 6.4, 9.2, 13.5];
const BLEND = 0.8; // カットのつなぎ（なめらかに移る秒）

type Shell = 'peony' | 'ring' | 'willow' | 'double' | 'crackle' | 'heart';
interface Rocket {
  p: THREE.Vector3;
  v: THREE.Vector3;
  t: number; // 破裂までの残り
  shell: Shell;
  hue: number;
}
interface Crackle {
  p: THREE.Vector3;
  t: number;
}

export interface CamPoseOut {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

export class Ceremony {
  readonly group = new THREE.Group();
  // 花火専用の光の粒（重ねると明るくなる合成。夜空でよく光る）
  readonly sparks = new Particles(4200, true, false, 0.6);
  private readonly center = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private time = 0;
  private launchT = 0.3;
  private cannonT = 0;
  private rockets: Rocket[] = [];
  private crackles: Crackle[] = [];
  private beams: THREE.Mesh[] = [];
  private confetti: THREE.InstancedMesh;
  private pieces: { p: THREE.Vector3; v: THREE.Vector3; axis: THREE.Vector3; rot: number; spin: number; sway: number; ph: number }[] = [];
  private readonly _m = new THREE.Matrix4();
  private readonly _q = new THREE.Quaternion();
  private readonly _s = new THREE.Vector3(1, 1, 1);
  private readonly _p = new THREE.Vector3();
  private readonly _v = new THREE.Vector3();
  private readonly _c = new THREE.Color();
  private readonly _c2 = new THREE.Color();
  private readonly poseA: CamPoseOut = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };
  private readonly poseB: CamPoseOut = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };
  // 花火が開いた瞬間の、まぶしさ（main が画面の明るさに足す）と、音のきっかけ
  flash = 0;
  onBurst: ((distance: number, big: boolean) => void) | null = null;

  constructor(
    track: Track,
    racers: Racer[],
    private top: Racer[], // 合計の 1・2・3 位
    private fx: FXSystems,
  ) {
    track.pointAt(T0, this.center);
    track.tangentAt(T0, this.fwd).setY(0).normalize();
    track.normalAt(T0, this.side).setY(0).normalize();
    const heading = Math.atan2(this.fwd.x, this.fwd.z);

    // 台：角の丸い白い箱に、金・銀・銅の帯と、順位の数字
    STEPS.forEach((st) => {
      const body = new THREE.Mesh(new RoundedBoxGeometry(3.3, st.h, 3.6, 3, 0.18), new THREE.MeshStandardMaterial({ color: '#fff8ef', roughness: 0.55 }));
      const band = new THREE.Mesh(new RoundedBoxGeometry(3.42, 0.22, 3.72, 2, 0.08), new THREE.MeshStandardMaterial({ color: st.color, roughness: 0.3, metalness: st.rank === 3 ? 0.6 : 0.8 }));
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ map: numberTexture(st.rank, st.color), transparent: true }));
      const holder = new THREE.Group();
      body.position.y = st.h / 2;
      band.position.y = st.h - 0.11;
      // 数字は、カメラ側（コースの前方向）の面に
      label.position.set(0, Math.max(0.42, st.h * 0.45), 1.81);
      label.scale.setScalar(Math.min(1, st.h / 1.1));
      body.castShadow = body.receiveShadow = true;
      band.castShadow = true;
      holder.add(body, band, label);
      holder.position.copy(this.center).addScaledVector(this.side, st.lat);
      holder.rotation.y = heading;
      this.group.add(holder);
    });
    // 足もとの赤いじゅうたん
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(12, 7).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e8456b', roughness: 0.85 }));
    carpet.position.copy(this.center).setY(this.center.y + 0.03).addScaledVector(this.fwd, 1.2);
    carpet.rotation.y = heading;
    carpet.receiveShadow = true;
    this.group.add(carpet);

    // 台のうしろから空をなでる、光の柱（色が移り変わりながら、左右にゆれる）
    const beamGeo = new THREE.CylinderGeometry(0.25, 3.2, 46, 24, 1, true).translate(0, 23, 0);
    const beamTex = beamTexture();
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        beamGeo,
        new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
      );
      const s = (i / 5 - 0.5) * 2; // -1..1
      m.position.copy(this.center).addScaledVector(this.side, s * 13).addScaledVector(this.fwd, -9 - Math.abs(s) * 3);
      m.userData.s = s;
      m.renderOrder = 3;
      this.beams.push(m);
      this.group.add(m);
    }

    // カートを台の上に。4 位以下は見せない
    for (const r of racers) r.obj.visible = top.includes(r);
    top.forEach((r, i) => {
      const st = STEPS[i];
      const k = r.kart;
      k.pos.copy(this.center).addScaledVector(this.side, st.lat);
      k.vel.set(0, 0, 0);
      k.heading = heading;
      k.y = k.groundY = this.center.y + st.h;
      k.spinTime = k.squashTime = k.starTime = k.boostTime = 0;
      k.drifting = false;
      k.driftDir = 0;
      k.steerInput = 0;
      r.barrierEnd = -Infinity;
      k.barrier = false;
      r.cheer = true;
      r.vibe = 0;
    });

    // 花吹雪：小さな紙片（毎フレーム、行列だけ動かす）
    const geo = new THREE.PlaneGeometry(0.26, 0.16);
    this.confetti = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false }), CONFETTI);
    this.confetti.frustumCulled = false;
    const col = new THREE.Color();
    for (let i = 0; i < CONFETTI; i++) {
      const piece = {
        p: new THREE.Vector3(),
        v: new THREE.Vector3(),
        axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
        rot: Math.random() * 6.28,
        spin: 3 + Math.random() * 6,
        sway: 0.6 + Math.random() * 1.2,
        ph: Math.random() * 6.28,
      };
      this.respawn(piece, Math.random() * 14);
      this.pieces.push(piece);
      this.confetti.setColorAt(i, col.set(CONFETTI_COLORS[i % CONFETTI_COLORS.length]));
    }
    this.group.add(this.confetti, this.sparks.points);
    this.sparks.points.frustumCulled = false;

    // はじまり：台の両わきから花吹雪の大砲、金色のキラキラ
    this.cannon(1);
    for (const r of top) KartFX.burst(fx, this._p.set(r.kart.pos.x, r.kart.y + 1.6, r.kart.pos.z), ['#fff3b0', '#ffd23a', '#ffffff'], 40, 9);
  }

  // 紙片を、台の上の空（ランダムな位置）に戻す。h は、どのくらいの高さから始めるか
  private respawn(c: (typeof this.pieces)[number], h = 0) {
    c.p.copy(this.center)
      .addScaledVector(this.side, (Math.random() - 0.5) * 18)
      .addScaledVector(this.fwd, (Math.random() - 0.5) * 12 + 1);
    c.p.y = this.center.y + 9 + Math.random() * 5 - h;
    c.v.set(0, -(FALL * 0.7 + Math.random() * FALL * 0.6), 0);
  }

  // 花吹雪の大砲：台の両わきから、紙片をどっと吹き上げる（power：0..1）
  private cannon(power: number) {
    const n = Math.round(260 * power);
    for (let i = 0; i < n; i++) {
      const c = this.pieces[Math.floor(Math.random() * this.pieces.length)];
      const sx = i % 2 ? 1 : -1;
      c.p.copy(this.center).addScaledVector(this.side, sx * 6.2).addScaledVector(this.fwd, 1.5);
      c.p.y = this.center.y + 0.6;
      c.v.copy(this.side).multiplyScalar(-sx * (2 + Math.random() * 4)).addScaledVector(this.fwd, (Math.random() - 0.3) * 3);
      c.v.y = 9 + Math.random() * 7;
    }
    // 大砲の口の、光と煙
    for (const sx of [-1, 1]) {
      this._p.copy(this.center).addScaledVector(this.side, sx * 6.2).addScaledVector(this.fwd, 1.5);
      this._p.y = this.center.y + 0.8;
      KartFX.burst(this.fx, this._p, ['#ffffff', '#ffe27a', '#ff9ac0'], 30, 8);
    }
  }

  // 打ち上げ：台のうしろの地面から、光の尾を引いて昇る
  private launch() {
    const shells: Shell[] = ['peony', 'peony', 'ring', 'willow', 'double', 'crackle', 'heart'];
    const p = this.center.clone()
      .addScaledVector(this.side, (Math.random() - 0.5) * 44)
      .addScaledVector(this.fwd, -16 - Math.random() * 22);
    const v = new THREE.Vector3(0, 23 + Math.random() * 7, 0)
      .addScaledVector(this.side, (Math.random() - 0.5) * 3)
      .addScaledVector(this.fwd, Math.random() * 1.5);
    this.rockets.push({ p, v, t: 1.15 + Math.random() * 0.45, shell: shells[Math.floor(Math.random() * shells.length)], hue: Math.random() });
  }

  private burst(r: Rocket) {
    const P = r.p;
    const col = this._c.setHSL(r.hue, 1, 0.62).multiplyScalar(2.2);
    const col2 = this._c2.setHSL((r.hue + 0.15) % 1, 1, 0.75).multiplyScalar(2.2);
    const emit = (dir: THREE.Vector3, speed: number, c: THREE.Color, life: number, size: number, gravity = 2.6, drag = 1.25) => {
      this.sparks.emit(P, this._v.copy(dir).multiplyScalar(speed), c, { size, life, gravity, drag });
    };
    const rnd = () => this._p.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    let big = false;
    switch (r.shell) {
      case 'peony':
        for (let i = 0; i < 150; i++) emit(rnd(), 9 + Math.random() * 3, i % 4 ? col : col2, 1.5 + Math.random() * 0.6, 0.85);
        break;
      case 'double':
        big = true;
        for (let i = 0; i < 160; i++) emit(rnd(), 12 + Math.random() * 2, col, 1.7 + Math.random() * 0.5, 0.9);
        for (let i = 0; i < 80; i++) emit(rnd(), 5 + Math.random() * 1.5, col2, 1.3 + Math.random() * 0.4, 0.75);
        break;
      case 'ring': {
        // 輪：ランダムに傾いた円の上に並ぶ
        const n = new THREE.Vector3(Math.random() - 0.5, 1.2, Math.random() - 0.5).normalize();
        const a = new THREE.Vector3(1, 0, 0).cross(n).normalize();
        const b = n.clone().cross(a);
        for (let i = 0; i < 90; i++) {
          const th = (i / 90) * Math.PI * 2;
          this._p.copy(a).multiplyScalar(Math.cos(th)).addScaledVector(b, Math.sin(th));
          emit(this._p, 11, i % 2 ? col : col2, 1.6, 0.85, 1.8);
        }
        for (let i = 0; i < 30; i++) emit(rnd(), 3, col2, 1.2, 0.7);
        break;
      }
      case 'willow': // しだれ柳：金色で、ゆっくり垂れて長く残る
        big = true;
        for (let i = 0; i < 140; i++) emit(rnd(), 7 + Math.random() * 2, this._c.setHSL(0.11, 1, 0.6).multiplyScalar(2), 2.6 + Math.random() * 0.8, 0.75, 4.5, 0.9);
        break;
      case 'crackle': // 開いたあと、ぱちぱちと小さく光る
        for (let i = 0; i < 110; i++) emit(rnd(), 9 + Math.random() * 2, col, 1.1 + Math.random() * 0.3, 0.75);
        for (let i = 0; i < 26; i++) this.crackles.push({ p: P.clone().add(rnd().multiplyScalar(5 + Math.random() * 7)), t: 0.55 + Math.random() * 0.7 });
        break;
      case 'heart': {
        // ハート形（カメラのほうを向いた面に）
        const up = new THREE.Vector3(0, 1, 0);
        for (let i = 0; i < 120; i++) {
          const th = (i / 120) * Math.PI * 2;
          const x = 16 * Math.pow(Math.sin(th), 3);
          const y = 13 * Math.cos(th) - 5 * Math.cos(2 * th) - 2 * Math.cos(3 * th) - Math.cos(4 * th);
          this._p.copy(this.side).multiplyScalar(x / 16).addScaledVector(up, y / 16);
          emit(this._p, 9, this._c.setHSL(0.94, 1, 0.66).multiplyScalar(2.2), 1.7, 0.85, 1.2, 1.1);
        }
        break;
      }
    }
    // 中心の、まぶしい光
    for (let i = 0; i < 12; i++) emit(rnd(), 1 + Math.random() * 2, this._c.setRGB(3, 3, 3), 0.25, 3.2, 0, 3);
    this.flash = Math.max(this.flash, big ? 1 : 0.7);
    this.onBurst?.(P.distanceTo(this.center), big);
  }

  // カメラ：カットごとの位置（seconds：そのカットに入ってからの秒）
  private shot(i: number, s: number, portrait: boolean, out: CamPoseOut) {
    const c = this.center;
    const k = portrait ? 1.3 : 1; // 縦持ちは横がせまいので、少し引く
    const kartAt = (rank: number) => {
      const r = this.top[rank - 1];
      return r ? this._p.set(r.kart.pos.x, r.kart.y, r.kart.pos.z) : this._p.copy(c);
    };
    switch (i) {
      case 0: {
        // 全体：高い所から、台の正面へ降りてくる
        const e = ease(Math.min(1, s / 3.6));
        out.pos.copy(c).addScaledVector(this.fwd, (26 - 10 * e) * k);
        out.pos.y = c.y + 11 - 7 * e;
        out.look.copy(c).setY(c.y + 2.6 + 1.5 * (1 - e));
        out.fov = 52;
        break;
      }
      case 1:
      case 2: {
        // 3 位・2 位のアップ：ななめ前から、ゆっくり寄る
        const rank = i === 1 ? 3 : 2;
        const P = kartAt(rank).clone();
        const sx = rank === 3 ? 1 : -1;
        const e = Math.min(1, s / 2.8);
        out.pos.copy(P).addScaledVector(this.fwd, (5.8 - 1.2 * e) * k).addScaledVector(this.side, sx * (2.4 - 0.7 * e));
        out.pos.y = P.y + 1.7;
        out.look.copy(P).setY(P.y + 1.05);
        out.fov = 36;
        break;
      }
      case 3: {
        // 1 位：下から見上げて、ゆっくり回り込む（うしろで花火が開く）
        const P = kartAt(1).clone();
        const a = -0.45 + 0.9 * ease(Math.min(1, s / 4.3));
        out.pos.copy(P)
          .addScaledVector(this.fwd, Math.cos(a) * 4.9 * k)
          .addScaledVector(this.side, Math.sin(a) * 4.9 * k);
        out.pos.y = c.y + 1.35;
        out.look.copy(P).setY(P.y + 1.55);
        out.fov = 46;
        break;
      }
      default: {
        // 台のまわりを、ゆっくり行ったり来たり
        const a = Math.sin(s * 0.18) * 0.6;
        const d = (14 + 2 * Math.sin(s * 0.11)) * k;
        out.pos.copy(c).addScaledVector(this.fwd, Math.cos(a) * d).addScaledVector(this.side, Math.sin(a) * d);
        out.pos.y = c.y + 4.2 + 1.2 * Math.sin(s * 0.23);
        out.look.copy(c).setY(c.y + 2.6);
        out.fov = 50;
      }
    }
  }

  // いまのカメラ（カットのつなぎは、なめらかに）
  camera(out: CamPoseOut, portrait: boolean) {
    let i = 0;
    while (i < SHOTS.length - 1 && this.time >= SHOTS[i + 1]) i++;
    const s = this.time - SHOTS[i];
    this.shot(i, s, portrait, out);
    if (i > 0 && s < BLEND) {
      this.shot(i - 1, this.time - SHOTS[i - 1], portrait, this.poseA);
      const f = ease(s / BLEND);
      out.pos.lerpVectors(this.poseA.pos, out.pos, f);
      out.look.lerpVectors(this.poseA.look, out.look, f);
      out.fov = this.poseA.fov + (out.fov - this.poseA.fov) * f;
    }
    void this.poseB;
  }

  // いまアップで映している順位（0 = 全体）。画面の名札を光らせるのに使う
  get focusRank(): number {
    const t = this.time;
    if (t >= SHOTS[1] && t < SHOTS[2]) return 3;
    if (t >= SHOTS[2] && t < SHOTS[3]) return 2;
    if (t >= SHOTS[3] && t < SHOTS[4]) return 1;
    return 0;
  }

  get focus(): THREE.Vector3 {
    return this.center;
  }

  update(dt: number) {
    const prevT = this.time;
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 3);

    // 花吹雪：ひらひら回りながら、左右にゆれて落ちる（大砲で吹き上げられたものは、重さで減速してから）
    for (let i = 0; i < this.pieces.length; i++) {
      const c = this.pieces[i];
      c.ph += dt * c.sway * 2;
      c.v.y = Math.max(-FALL, c.v.y - 9.8 * dt);
      const damp = Math.exp(-1.6 * dt);
      c.v.x *= damp;
      c.v.z *= damp;
      c.p.addScaledVector(c.v, dt);
      c.p.addScaledVector(this.side, Math.sin(c.ph) * 0.9 * dt);
      c.p.addScaledVector(this.fwd, Math.cos(c.ph * 0.7) * 0.5 * dt);
      c.rot += c.spin * dt;
      if (c.p.y < this.center.y - 0.2) this.respawn(c);
      this._q.setFromAxisAngle(c.axis, c.rot);
      this._m.compose(c.p, this._q, this._s);
      this.confetti.setMatrixAt(i, this._m);
    }
    this.confetti.instanceMatrix.needsUpdate = true;
    // 1 位のアップに入るときと、そのあとはときどき、花吹雪の大砲
    if (prevT < SHOTS[3] && this.time >= SHOTS[3]) this.cannon(1);
    this.cannonT += dt;
    if (this.time > SHOTS[4] && this.cannonT > 9) {
      this.cannonT = 0;
      this.cannon(0.6);
    }

    // 光の柱：左右にゆれ、色が移り変わる
    this.beams.forEach((m, i) => {
      const s = m.userData.s as number;
      const a = Math.sin(this.time * (0.7 + i * 0.07) + i * 1.3) * 0.45 + s * 0.25;
      m.rotation.set(0, 0, 0);
      m.rotateOnWorldAxis(this.fwd, a);
      m.rotateOnWorldAxis(this.side, -0.18 + Math.sin(this.time * 0.5 + i) * 0.1);
      (m.material as THREE.MeshBasicMaterial).color.setHSL((this.time * 0.08 + i / 6) % 1, 0.8, 0.6);
    });

    // 1 位のまわりに、ときどきキラキラ
    if (Math.random() < dt * 8) {
      const r = this.top[0];
      if (r) {
        this._p.set(r.kart.pos.x + (Math.random() - 0.5) * 3, r.kart.y + Math.random() * 3, r.kart.pos.z + (Math.random() - 0.5) * 3);
        this.fx.sparks.emit(this._p, this._v.set(0, 1.5, 0), this._c.set('#fff3b0'), { size: 0.35, life: 0.8, drag: 1 });
      }
    }

    // 打ち上げ花火：だんだん増えて、1 位のアップでは連発
    this.launchT -= dt;
    if (this.launchT <= 0) {
      const hot = this.time >= SHOTS[3] && this.time < SHOTS[4] + 2;
      this.launchT = hot ? 0.22 + Math.random() * 0.25 : 0.45 + Math.random() * 0.55;
      this.launch();
      if (hot && Math.random() < 0.4) this.launch();
    }
    for (const r of [...this.rockets]) {
      r.t -= dt;
      r.v.y -= 9 * dt;
      r.p.addScaledVector(r.v, dt);
      // 昇る光の尾
      for (let j = 0; j < 2; j++) {
        this.sparks.emit(r.p, this._v.set((Math.random() - 0.5) * 1.2, -2 - Math.random() * 2, (Math.random() - 0.5) * 1.2), this._c.setRGB(2, 1.5, 0.8), { size: 0.45, life: 0.45, gravity: 2, drag: 1.5 });
      }
      if (r.t <= 0) {
        this.burst(r);
        this.rockets.splice(this.rockets.indexOf(r), 1);
      }
    }
    for (const c of [...this.crackles]) {
      c.t -= dt;
      if (c.t > 0) continue;
      for (let j = 0; j < 6; j++) this.sparks.emit(c.p, this._v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4), this._c.setRGB(3, 2.8, 2.2), { size: 0.55, life: 0.18, drag: 2 });
      this.crackles.splice(this.crackles.indexOf(c), 1);
    }
    this.sparks.update(dt);
  }
}

const ease = (x: number) => x * x * (3 - 2 * x);

// 光の柱：根もとが明るく、上へいくほど、ふちへいくほど消える
function beamTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  const v = g.createLinearGradient(0, 256, 0, 0);
  v.addColorStop(0, 'rgba(255,255,255,0.9)');
  v.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v;
  g.fillRect(0, 0, 64, 256);
  g.globalCompositeOperation = 'destination-in';
  const h = g.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(0,0,0,0.2)');
  h.addColorStop(0.5, 'rgba(0,0,0,1)');
  h.addColorStop(1, 'rgba(0,0,0,0.2)');
  g.fillStyle = h;
  g.fillRect(0, 0, 64, 256);
  return new THREE.CanvasTexture(c);
}

// 台の正面の、順位の数字（色の丸の中に、白い数字）
function numberTexture(n: number, color: string): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.46, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = S * 0.05;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = `900 ${S * 0.62}px "M PLUS Rounded 1c", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(80,40,0,0.35)';
  g.shadowBlur = S * 0.04;
  g.fillText(String(n), S / 2, S * 0.54);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
