import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { KartFX } from '../fx/KartFX';
import type { FXSystems } from '../fx/Particles';
import type { Track } from '../track/Track';
import type { Racer } from './Racer';

// グランプリの表彰式：最終戦のコースのゴールの少し先、道の上に表彰台を置き、合計 1〜3 位のカートを乗せる。
// 1 位はまんなかの高い台、2 位はカメラから見て左、3 位は右。花吹雪がひらひら降り、空に光の花火が上がる。
// レースの計算は止め（main が race.update を呼ばない）、カートの位置はここで直接置く。

const T0 = 0.035; // 台を置くコース上の位置（スタートラインの少し先）
const STEPS = [
  { rank: 1, lat: 0, h: 1.7, color: '#f5c242' },
  { rank: 2, lat: -3.6, h: 1.15, color: '#c9d3e0' },
  { rank: 3, lat: 3.6, h: 0.75, color: '#df9a5e' },
];
const CONFETTI = 520;
const CONFETTI_COLORS = ['#ff6f9f', '#ffd23a', '#7fd3ff', '#9be37a', '#c89bff', '#ffffff', '#ff9a4a'];

export class Ceremony {
  readonly group = new THREE.Group();
  private readonly center = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private time = 0;
  private fireT = 0.4;
  private confetti: THREE.InstancedMesh;
  private pieces: { p: THREE.Vector3; v: THREE.Vector3; axis: THREE.Vector3; rot: number; spin: number; sway: number; ph: number }[] = [];
  private readonly _m = new THREE.Matrix4();
  private readonly _q = new THREE.Quaternion();
  private readonly _s = new THREE.Vector3(1, 1, 1);
  private readonly _p = new THREE.Vector3();
  private readonly _v = new THREE.Vector3();

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
    });

    // 花吹雪：小さな紙片を、台のまわりの空から降らせる（毎フレーム、行列だけ動かす）
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
    this.group.add(this.confetti);

    // はじまりの、金色のキラキラ
    for (const r of top) KartFX.burst(fx, this._p.set(r.kart.pos.x, r.kart.y + 1.6, r.kart.pos.z), ['#fff3b0', '#ffd23a', '#ffffff'], 40, 9);
  }

  // 紙片を、台の上の空（ランダムな位置）に戻す。h は、どのくらいの高さから始めるか
  private respawn(c: (typeof this.pieces)[number], h = 0) {
    c.p.copy(this.center)
      .addScaledVector(this.side, (Math.random() - 0.5) * 18)
      .addScaledVector(this.fwd, (Math.random() - 0.5) * 12 + 1);
    c.p.y = this.center.y + 9 + Math.random() * 5 - h;
    c.v.set(0, -(1.1 + Math.random() * 1.1), 0);
  }

  // カメラの位置と見る先（カメラは台の正面＝コースの前方向から、ゆっくり寄る）
  camera(pos: THREE.Vector3, look: THREE.Vector3, portrait: boolean) {
    const e = 1 - Math.exp(-this.time * 0.35);
    const back = (portrait ? 15 : 12) - (portrait ? 4 : 3.5) * e;
    pos.copy(this.center).addScaledVector(this.fwd, back).addScaledVector(this.side, Math.sin(this.time * 0.25) * 1.2);
    pos.y = this.center.y + 3.6 - 0.9 * e;
    look.copy(this.center).addScaledVector(this.fwd, 0.5);
    look.y = this.center.y + (portrait ? 2.9 : 2.3);
  }

  get focus(): THREE.Vector3 {
    return this.center;
  }

  update(dt: number) {
    this.time += dt;
    // 花吹雪：ひらひら回りながら、左右にゆれて落ちる
    for (let i = 0; i < this.pieces.length; i++) {
      const c = this.pieces[i];
      c.ph += dt * c.sway * 2;
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

    // 1 位のまわりに、ときどきキラキラ
    if (Math.random() < dt * 6) {
      const r = this.top[0];
      if (r) {
        this._p.set(r.kart.pos.x + (Math.random() - 0.5) * 3, r.kart.y + Math.random() * 3, r.kart.pos.z + (Math.random() - 0.5) * 3);
        this.fx.sparks.emit(this._p, this._v.set(0, 1.5, 0), new THREE.Color('#fff3b0'), { size: 0.35, life: 0.8, drag: 1 });
      }
    }
    // 空に、光の花火
    this.fireT -= dt;
    if (this.fireT <= 0) {
      this.fireT = 0.7 + Math.random() * 0.9;
      const at = this._p.copy(this.center)
        .addScaledVector(this.side, (Math.random() - 0.5) * 30)
        .addScaledVector(this.fwd, -8 - Math.random() * 14);
      at.y = this.center.y + 12 + Math.random() * 7;
      const hue = Math.random();
      const col = new THREE.Color().setHSL(hue, 1, 0.65);
      const col2 = new THREE.Color().setHSL((hue + 0.12) % 1, 1, 0.8);
      for (let i = 0; i < 70; i++) {
        const v = this._v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(7 + Math.random() * 3);
        this.fx.sparks.emit(at, v, i % 3 ? col : col2, { size: 0.7, life: 1.1 + Math.random() * 0.5, drag: 1.4, gravity: 2.5 });
      }
    }
  }
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
