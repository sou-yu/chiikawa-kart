import * as THREE from 'three';
import { KART } from '../config/tuning';
import type { InputState } from '../core/Input';
import type { Track, TrackProjection } from '../track/Track';

const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const NEUTRAL: InputState = { steer: 0, throttle: false, brake: false, item: false, jump: false };

// アーケード向けの自作カート物理。見た目は持たず、状態だけを持つ。
export class Kart {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  heading = 0; // 前方向 = (sin h, 0, cos h)
  y = 0;
  vy = 0;
  groundY = 0;

  forwardSpeed = 0;
  steerInput = 0;
  drifting = false;
  driftDir = 0; // -1 左 / 1 右
  driftCharge = 0;
  driftLevel = 0; // 0..3
  boostTime = 0;
  boostPower = 0; // いまのダッシュで増えている最高速（m/s）
  boostTotal = 0; // いまのダッシュの長さ（残りの割合を出すため）
  offroad = false;
  inWater = false; // 浅瀬の水の上（水しぶきの演出用）
  airTime = 0;

  // キャラ性能・状態
  speedMul = 1;
  accelMul = 1;
  turnMul = 1;
  bonusSpeed = 0; // コイン
  rubberband = 1; // CPU の追い上げ補正
  spinTime = 0;
  starTime = 0;

  // 演出用のイベント（そのフレームだけ true）
  landed = false;
  wallHit = false;
  boostStarted = false;
  driftBoostCount = 0; // ドリフトを終えて、ミニターボが出た回数（演出のきっかけ）
  driftBoostLevel = 0; // そのときの段階（1..3）
  onDash = false;
  gliding = false;
  glideCount = 0; // 滑空を始めた回数（演出のきっかけ）
  private glideReady = false;
  trickStarted = false;
  trickLanded = false; // 1回転しきって着地した

  // ジャンプトリック（横に1回転）
  trickTime = 0; // 0 = トリック中ではない
  trickDir = 1;
  readonly trickDur = ((2 * KART.jumpVelocity) / KART.gravity) * 0.82;

  get tricking(): boolean {
    return this.trickTime > 0;
  }
  // 回転の進み具合 0..1
  get trickProgress(): number {
    return Math.min(1, this.trickTime / this.trickDur);
  }

  readonly proj: TrackProjection = {
    t: 0,
    index: -1,
    lateral: 0,
    point: new THREE.Vector3(),
    tangent: new THREE.Vector3(),
    normal: new THREE.Vector3(),
  };

  private sharpTime = 0;
  private sharpDir = 0;
  private releaseTime = 0;

  get grounded(): boolean {
    return this.y <= this.groundY + 0.02;
  }

  place(track: Track, t: number, lateral: number) {
    track.place(t, lateral, this.pos);
    const tan = track.tangentAt(t);
    this.heading = Math.atan2(tan.x, tan.z);
    this.vel.set(0, 0, 0);
    track.project(this.pos, this.proj);
  }

  spinOut(duration = 1.2) {
    if (this.starTime > 0 || this.spinTime > 0) return false;
    this.spinTime = duration;
    this.trickTime = 0;
    this.drifting = false;
    this.driftDir = 0;
    this.driftLevel = 0;
    this.boostTime = 0;
    this.vy = Math.max(this.vy, 4);
    return true;
  }

  // power = ダッシュで増える最高速（m/s）。いまのダッシュが続いているときは、強いほうになる
  addBoost(t: number, power: number = KART.boostSpeed) {
    if (this.boostTime <= 0) {
      this.boostStarted = true;
      this.boostPower = power;
    } else {
      this.boostPower = Math.max(this.boostPower, power);
    }
    this.boostTime = Math.max(this.boostTime, t);
    this.boostTotal = Math.max(this.boostTotal, this.boostTime);
  }

  update(dt: number, rawInput: InputState, track: Track) {
    this.landed = this.wallHit = this.boostStarted = this.trickStarted = this.trickLanded = false;
    if (rawInput.jump && this.spinTime <= 0 && this.grounded && !this.tricking) {
      this.vy = KART.jumpVelocity;
      this.trickTime = 1e-4;
      this.trickDir = rawInput.steer < -0.2 ? -1 : 1; // ハンドルを切っている方へ回る
      this.trickStarted = true;
      this.drifting = false;
      this.driftDir = 0;
      this.driftLevel = 0;
    }
    if (this.tricking) this.trickTime += dt;
    const spinning = this.spinTime > 0;
    const input = spinning ? NEUTRAL : rawInput;
    this.steerInput = input.steer;

    fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    right.set(-Math.cos(this.heading), 0, Math.sin(this.heading));
    let vF = this.vel.dot(fwd);
    let vL = this.vel.dot(right);

    if (!spinning) this.updateDrift(dt, input, vF);

    // --- 前後 ---
    const boosting = this.boostTime > 0 || this.starTime > 0;
    let max = (KART.maxSpeed * this.speedMul + this.bonusSpeed) * this.rubberband;
    if (this.offroad && !boosting) max = KART.offroadMax;
    if (this.boostTime > 0) max += this.boostPower;
    if (this.gliding) max += KART.glideSpeed;
    if (this.starTime > 0) max += KART.starSpeed;

    // 加速は最高速までに限る（超過分は overspeedDecel でなめらかに戻す）
    if (spinning) {
      vF *= Math.exp(-2.2 * dt);
    } else if (boosting) {
      if (vF < max) vF = Math.min(max, vF + KART.boostAccel * dt);
    } else if (input.throttle && !input.brake && vF < max) {
      vF = Math.min(max, vF + (vF < 0 ? KART.brake : KART.accel * this.accelMul) * dt);
    }
    if (input.brake) {
      vF -= (vF > 0 ? KART.brake : KART.accel * 0.6) * dt;
      vF = Math.max(vF, -KART.reverseMax);
    } else if (!input.throttle && !boosting && !spinning) {
      vF -= Math.sign(vF) * Math.min(Math.abs(vF), KART.coast * dt);
    }
    if (vF > max) vF = Math.max(max, vF - KART.overspeedDecel * dt);

    // --- ハンドル ---
    // 低速でも少しは曲がれる（壁に正面から止まっても抜け出せるように）
    const speedFactor = Math.min(0.35 + Math.abs(vF) / KART.steerFullSpeed, 1) * (vF < -0.1 ? -1 : 1);
    let turn: number;
    // ドリフト中は、内側（driftDir 側）に切るほど +、外側に切る（カウンター）ほど −
    const inward = input.steer * this.driftDir;
    if (this.drifting) {
      turn = this.driftDir * (KART.driftTurnBase + (inward >= 0 ? KART.driftTurnIn : KART.driftTurnOut) * inward);
    } else {
      turn = input.steer * KART.steerRate * (1 - 0.25 * Math.min(vF / KART.maxSpeed, 1));
      if (!this.grounded && !this.gliding) turn *= 0.6;
    }
    this.heading -= turn * this.turnMul * speedFactor * dt;

    // 横滑りはグリップで減衰。速度ベクトルは新しい向きに付け替える（アーケード的）
    // カウンターを当てているあいだは横滑りがすぐ収まり、車体を立て直せる
    const grip = this.drifting ? KART.driftGrip + KART.driftCounterGrip * Math.max(0, -inward) : KART.grip;
    vL *= Math.exp(-grip * dt);
    fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    right.set(-Math.cos(this.heading), 0, Math.sin(this.heading));
    this.vel.copy(fwd).multiplyScalar(vF).addScaledVector(right, vL);
    this.pos.addScaledVector(this.vel, dt);
    this.forwardSpeed = vF;

    this.boostTime = Math.max(0, this.boostTime - dt);
    if (this.boostTime <= 0) {
      this.boostPower = 0;
      this.boostTotal = 0;
    }
    this.starTime = Math.max(0, this.starTime - dt);
    this.spinTime = Math.max(0, this.spinTime - dt);
    this.collideTrack(track);
    this.onDash = this.grounded && track.onDash(this.proj);
    this.inWater = !!track.waterAt && track.waterAt(this.pos.x, this.pos.z);
    if (this.onDash) this.addBoost(KART.dashBoost);

    // --- 上下（ジャンプ台・ホップ）---
    const g = track.groundAt(this.proj);
    this.groundY = g.h;
    // グライダー中は重力が弱く、落ちる速さにも上限（ふわっと長く飛ぶ）
    this.vy -= (this.gliding ? KART.glideGravity : KART.gravity) * dt;
    if (this.gliding) this.vy = Math.max(this.vy, -KART.glideSink);
    this.y += this.vy * dt;
    if (this.y <= g.h) {
      if (this.airTime > 0.3) this.landed = true;
      this.gliding = false;
      this.glideReady = g.glide; // グライダー台の上にいる
      if (this.tricking && this.vy <= 0) {
        // 回りきって着地したらごほうびのダッシュ
        if (this.trickProgress >= 0.95) {
          this.trickLanded = true;
          this.addBoost(KART.trickBoost);
        }
        this.trickTime = 0;
      }
      this.y = g.h;
      const along = this.vel.x * this.proj.tangent.x + this.vel.z * this.proj.tangent.z;
      this.vy = Math.max(0, g.slope * along);
      this.airTime = 0;
    } else {
      this.airTime += dt;
      // グライダー台から飛び出したら翼を開く
      if (this.glideReady && !this.gliding) {
        this.gliding = true;
        this.glideReady = false;
        this.glideCount++;
        this.trickTime = 0;
      }
    }
  }

  // オートドリフト：一定速度以上で大きくハンドルを切り続けると自動でドリフト開始、
  // ハンドルを真ん中に戻すとミニターボ発動
  private updateDrift(dt: number, input: InputState, vF: number) {
    const steer = input.steer;

    if (!this.drifting) {
      const sharp = Math.abs(steer) >= KART.autoDriftSteer && vF > KART.driftMinSpeed && this.grounded;
      this.sharpTime = sharp && Math.sign(steer) === this.sharpDir ? this.sharpTime + dt : 0;
      this.sharpDir = Math.sign(steer);
      if (this.sharpTime >= KART.autoDriftDelay) {
        this.drifting = true;
        this.driftDir = this.sharpDir;
        this.driftCharge = 0;
        this.driftLevel = 0;
        this.releaseTime = 0;
        this.sharpTime = 0;
        this.vy = KART.hopVelocity;
      }
      return;
    }

    // ハンドルを真ん中に戻したら解除カウント（外側に切るのはドリフトを緩めるだけ）
    const holding = Math.abs(steer) > KART.autoDriftRelease;
    this.releaseTime = holding ? 0 : this.releaseTime + dt;
    const release = this.releaseTime >= KART.autoDriftReleaseDelay;

    if (release || input.brake || vF < KART.driftMinSpeed * 0.6) {
      // 減速やブレーキでキャンセルされたときは不発
      if (release && this.driftLevel > 0) {
        // 溜まった時間が長いほど、ダッシュは速く、長くなる
        const n = Math.min(1, Math.max(0, (this.driftCharge - KART.driftLevelTimes[0]) / (KART.driftChargeMax - KART.driftLevelTimes[0])));
        const [t0, t1] = KART.driftBoostTime;
        const [p0, p1] = KART.driftBoostPower;
        this.addBoost(t0 + (t1 - t0) * n, p0 + (p1 - p0) * n);
        this.driftBoostCount++;
        this.driftBoostLevel = this.driftLevel;
      }
      this.drifting = false;
      this.driftDir = 0;
      this.driftLevel = 0;
      return;
    }

    // 内側に切り込むほど早く溜まる（カウンターを当てているあいだは、ゆっくり）
    const inward = steer * this.driftDir;
    this.driftCharge = Math.min(KART.driftChargeMax, this.driftCharge + dt * (inward >= 0 ? 0.7 + 0.6 * inward : 0.7 + 0.35 * inward));
    const times = KART.driftLevelTimes;
    this.driftLevel = this.driftCharge >= times[2] ? 3 : this.driftCharge >= times[1] ? 2 : this.driftCharge >= times[0] ? 1 : 0;
  }

  private collideTrack(track: Track) {
    const p = track.project(this.pos, this.proj, this.proj.index);
    const hw = track.def.halfWidth;
    this.offroad = Math.abs(p.lateral) > hw + 0.8 && this.grounded;

    const wall = hw + track.def.wallOffset;
    if (Math.abs(p.lateral) > wall) {
      const s = Math.sign(p.lateral);
      this.pos.x = p.point.x + p.normal.x * wall * s;
      this.pos.z = p.point.z + p.normal.z * wall * s;
      const vn = (this.vel.x * p.normal.x + this.vel.z * p.normal.z) * s;
      if (vn > 0) {
        this.vel.x -= p.normal.x * s * vn * (1 + KART.wallBounce);
        this.vel.z -= p.normal.z * s * vn * (1 + KART.wallBounce);
        // 正面衝突ほど減速、こすっただけならほぼ減速しない
        this.vel.multiplyScalar(1 - 0.5 * Math.min(1, vn / KART.maxSpeed));
        // 向きをコースの進行方向（前向き側）へ少し戻す
        const sgn = Math.sin(this.heading) * p.tangent.x + Math.cos(this.heading) * p.tangent.z >= 0 ? 1 : -1;
        let d = Math.atan2(p.tangent.x * sgn, p.tangent.z * sgn) - this.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.heading += d * 0.15;
        if (vn > 4) this.wallHit = true;
      }
    }
  }
}
