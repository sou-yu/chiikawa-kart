import * as THREE from 'three';
import { createCharacter, type CharacterModel } from '../characters/Character';
import { characterIcon } from '../characters/icons';
import { createGltfCharacter, hasCharacterModel } from '../characters/GltfCharacter';
import type { CharacterSpec } from '../config/characters';
import { KART } from '../config/tuning';
import { KartFX } from '../fx/KartFX';
import type { FXSystems } from '../fx/Particles';
import type { Track } from '../track/Track';
import type { AIDriver } from './AIDriver';
import type { ItemId } from './Items';
import { Kart } from './Kart';

export class Racer {
  readonly kart = new Kart();
  readonly obj = new THREE.Group(); // 位置・向き
  readonly visual = new THREE.Group(); // ドリフトの傾き・スピン・弾み
  readonly model: CharacterModel;
  readonly fx: KartFX;
  readonly icon: HTMLCanvasElement;
  ai: AIDriver | null = null;

  // レース進行
  lapCount = 0; // スタートラインを越えた回数（1 = 1周目）
  passedHalf = false;
  prevT = 0;
  progress = 0; // 順位計算用（周回 + t）
  place = 1;
  finished = false;
  finishTime = 0;

  // アイテム・コイン
  item: ItemId | null = null;
  pendingItem: ItemId | null = null;
  roulette = 0;
  coins = 0;

  // 絶対バリア：コース 1 周ぶん（進み具合 progress が、この値になるまで）続く
  barrierEnd = -Infinity;
  // 攻撃をはじいたとき（Race が、音・文字の演出につなぐ）
  onRepel: ((r: Racer, from: THREE.Vector3, power: number) => void) | null = null;

  private visYaw = 0;
  private pose = 0;
  private poseHold = 0;
  private glide = 0;
  private spinAngle = 0;
  private time = Math.random() * 10;
  private shadow: THREE.Mesh;

  constructor(readonly spec: CharacterSpec, readonly isPlayer: boolean, fx: FXSystems) {
    // 3D モデル（GLB）があるキャラはそれを使う。読み込めなかったときは手作りのモデル
    this.model = hasCharacterModel(spec.id) ? createGltfCharacter(spec) : createCharacter(spec);
    this.visual.add(this.model.root);
    this.obj.add(this.visual);
    this.shadow = blobShadow();
    this.obj.add(this.shadow);
    this.fx = new KartFX(this.model, fx, this.obj);
    this.icon = characterIcon(spec, 96);
    this.kart.speedMul = spec.stats.speed;
    this.kart.accelMul = spec.stats.accel;
    this.kart.turnMul = spec.stats.turn;
  }

  addCoins(n: number) {
    this.coins = Math.max(0, Math.min(10, this.coins + n));
    this.kart.bonusSpeed = this.coins * KART.coinSpeed;
  }

  // 攻撃を受けた
  hit() {
    if (this.kart.spinOut(1.3)) this.addCoins(-2);
  }

  // ばくだんの爆風：爆心から外へ吹き飛ばされて、高く舞い上がりながら、はげしくスピン（power：近いほど強い）
  blast(from: THREE.Vector3, power: number): boolean {
    const k = this.kart;
    if (!k.spinOut(1.5 + 0.7 * power)) return false; // 無敵（星）やスピン中は、影響なし
    this.addCoins(-3);
    k.vy = Math.max(k.vy, 7 + 6 * power);
    k.vel.add(_blastPush.set(k.pos.x - from.x, 0, k.pos.z - from.z).normalize().multiplyScalar(6 + 5 * power));
    return true;
  }

  // 絶対バリアをはる（いまの位置から、コース 1 周ぶん）
  activateBarrier(laps = 1) {
    this.barrierEnd = this.progress + laps;
    this.kart.barrier = true;
    this.kart.barrierLeft = 1;
    this.kart.barrierPop++;
  }

  // 攻撃を、バリアではじき返した（from：攻撃が来た場所。power：強さ）。演出をつなぐ。続けて何度も出ないよう、少し間をあける
  repel(from: THREE.Vector3, power = 1): boolean {
    const k = this.kart;
    if (!k.barrier || k.barrierCool > 0) return false;
    k.barrierCool = 0.3;
    k.barrierHits++;
    k.barrierHitPower = power;
    k.barrierHitDir.set(from.x - k.pos.x, Math.max(0.15, (from.y ?? 0) - k.y) * 0.4, from.z - k.pos.z).normalize();
    this.onRepel?.(this, from, power);
    return true;
  }

  // 周回・進み具合。スタートラインを越えたら true
  updateProgress(track: Track): boolean {
    const t = this.kart.proj.t;
    if (t > 0.4 && t < 0.6) this.passedHalf = true;
    let crossed = false;
    if (this.prevT > 0.8 && t < 0.2 && (this.passedHalf || this.lapCount === 0)) {
      this.lapCount++;
      this.passedHalf = false;
      crossed = true;
    } else if (this.prevT < 0.2 && t > 0.8 && this.lapCount > 0 && !this.passedHalf) {
      // 逆走でラインを戻った
      this.lapCount--;
      this.passedHalf = true;
    }
    this.prevT = t;
    this.progress = this.lapCount - 1 + t;
    // バリア：はった場所から、コースを 1 周走るまで
    const left = this.barrierEnd - this.progress;
    this.kart.barrier = left > 0;
    this.kart.barrierLeft = Math.max(0, Math.min(1, left));
    void track;
    return crossed;
  }

  updateVisual(dt: number) {
    const k = this.kart;
    this.time += dt;
    this.obj.position.set(k.pos.x, 0, k.pos.z);
    this.obj.rotation.y = k.heading;
    this.visual.position.y = k.y;

    // ドリフト中は車体を内側に振る
    const targetYaw = -k.driftDir * KART.driftVisualYaw;
    this.visYaw += (targetYaw - this.visYaw) * (1 - Math.exp(-10 * dt));
    if (k.spinTime > 0) this.spinAngle += dt * 14;
    else this.spinAngle *= Math.exp(-12 * dt);
    this.visual.rotation.y = this.visYaw + this.spinAngle;
    this.visual.rotation.z = k.driftDir * 0.07 + (k.grounded ? 0 : -k.steerInput * 0.1);

    // ジャンプトリック：その場で横に1回転（ヨー）。途中で顔がこちらを向く
    if (k.tricking) {
      const p = k.trickProgress;
      const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      this.visual.rotation.y += -k.trickDir * eased * Math.PI * 2;
      this.pose = Math.min(1, this.pose + dt * 10);
      this.poseHold = 0.6;
    } else if ((this.poseHold -= dt) <= 0) {
      // 着地後もしばらくバンザイと笑顔を残してから戻す。ゴール後も手は上げず、ハンドルを握ったまま
      // （頭だけぴょんと弾ませて喜ぶ。下の head の動き）
      this.pose = Math.max(0, this.pose - dt * 2);
    }
    this.model.setPose(this.pose);

    // グライダー：翼をぽんっと開き、ハンドルの方向へ機体を傾ける
    const gl = this.model.glider;
    this.glide += ((k.gliding ? 1 : 0) - this.glide) * (1 - Math.exp(-(k.gliding ? 7 : 10) * dt));
    gl.visible = this.glide > 0.02;
    if (gl.visible) {
      const pop = this.glide < 0.98 ? 1 + Math.sin(this.glide * Math.PI) * 0.15 : 1; // 開くときに少し弾む
      gl.scale.set(this.glide * pop, this.glide, this.glide * pop);
      gl.rotation.z = Math.sin(this.time * 2.2) * 0.05;
      this.visual.rotation.z += k.steerInput * 0.35 * this.glide;
      this.visual.rotation.x = (k.vy < 0 ? 0.08 : -0.05) * this.glide;
    }
    this.visual.rotation.x = k.grounded ? 0 : -Math.min(0.25, k.vy * 0.03);

    const speed = Math.abs(k.forwardSpeed);
    const bump = k.offroad ? 0.05 : 0.012;
    this.model.root.position.y = speed > 1 && k.grounded ? Math.abs(Math.sin(this.time * 20)) * bump : 0;
    this.model.head.rotation.z = Math.sin(this.time * 3) * 0.05 - k.driftDir * 0.14 - k.steerInput * 0.06;
    this.model.head.rotation.x = k.boostTime > 0 ? -0.12 : 0;
    // ゴール後は頭をぴょんぴょん弾ませて喜ぶ
    this.model.head.position.y = this.finished
      ? 1.8 + Math.abs(Math.sin(this.time * 6)) * 0.1
      : 1.8 + Math.sin(this.time * 9) * (speed > 1 ? 0.02 : 0.005);
    for (const w of this.model.spinWheels) w.rotation.x += (k.forwardSpeed / 0.4) * dt;
    for (const w of this.model.steerWheels) w.rotation.y = -k.steerInput * 0.4;

    // スターで巨大になる／踏まれてぺちゃんこになる（地面を中心に、大きさを変える）
    const gs = k.giantScale;
    k.squashScale(_sq);
    this.visual.scale.set(gs * _sq.x, gs * _sq.y, gs * _sq.z);

    // 影は地面に置いたまま、高く飛ぶほど小さく薄く
    this.shadow.position.y = k.groundY + 0.05;
    const s = 1 / (1 + (k.y - k.groundY) * 0.3);
    this.shadow.scale.set(s * gs * _sq.x, 1, s * 1.3 * gs * _sq.z);

    this.fx.update(dt, k);
  }
}

const _blastPush = new THREE.Vector3();
const _sq = new THREE.Vector3();

function blobShadow(): THREE.Mesh {
  const [w, h] = [64, 64];
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.45)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  );
  m.renderOrder = 1;
  return m;
}
