import * as THREE from 'three';
import { RACE } from '../config/tuning';
import type { InputState } from '../core/Input';
import type { Track } from '../track/Track';
import { AIDriver } from './AIDriver';
import type { ItemSystem } from './Items';
import type { Racer } from './Racer';

const NEUTRAL: InputState = { steer: 0, throttle: false, brake: false, item: false, jump: false };
const _d = new THREE.Vector3();

export type RaceState = 'ready' | 'countdown' | 'racing' | 'finished';

export class Race {
  state: RaceState = 'ready';
  countdown = 3.99;
  time = 0;
  readonly finishOrder: Racer[] = [];
  onLap: ((r: Racer) => void) | null = null;
  // 踏みつぶしの出来事（回数が増えたら lastStomp を読む。音・ゆれ・文字の演出のきっかけ）
  stompCount = 0;
  lastStomp: { pos: THREE.Vector3; by: Racer; victim: Racer } | null = null;
  // バリアが攻撃をはじいた出来事（回数が増えたら lastRepel を読む）
  repelCount = 0;
  lastRepel: { racer: Racer; from: THREE.Vector3; power: number } | null = null;

  constructor(
    readonly track: Track,
    readonly racers: Racer[],
    readonly player: Racer,
    private items: ItemSystem,
  ) {
    // スタートグリッド：2列、プレイヤーは最後尾
    racers.forEach((r, i) => {
      const row = i;
      const lateral = (i % 2 === 0 ? 1 : -1) * 3.2;
      r.kart.place(track, 1 - (8 + row * 5.5) / track.length, lateral);
      r.prevT = r.kart.proj.t;
      r.updateProgress(track);
      if (!r.isPlayer) r.ai = new AIDriver(0.95 + Math.random() * 0.04);
      r.onRepel = (racer, from, power) => {
        this.repelCount++;
        this.lastRepel = { racer, from: from.clone(), power };
      };
    });
  }

  start() {
    if (this.state === 'ready') this.state = 'countdown';
  }

  update(dt: number, playerInput: InputState) {
    if (this.state === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.state = 'racing';
    }
    const moving = this.state === 'racing' || this.state === 'finished';
    if (moving) this.time += dt;

    for (const r of this.racers) {
      let input = NEUTRAL;
      if (moving) {
        if (r.isPlayer && !r.finished) {
          input = playerInput;
          if (playerInput.item && r.kart.squashTime <= 0) this.items.use(r, this.racers);
        } else {
          r.ai ??= new AIDriver(0.97);
          input = r.ai.update(dt, r, this.track);
        }
      }
      r.kart.update(dt, input, this.track);
      if (r.updateProgress(this.track) && moving) {
        if (r.lapCount > RACE.laps && !r.finished) {
          r.finished = true;
          r.finishTime = this.time;
          this.finishOrder.push(r);
          // ゴールしたら、巨大なスターは、すっとしぼませる（ゴールのカメラに合わせて）
          r.kart.starTime = Math.min(r.kart.starTime, 0.9);
          r.barrierEnd = Math.min(r.barrierEnd, r.progress); // バリアも、ゴールで消える
          if (r.isPlayer) this.state = 'finished';
        } else {
          this.onLap?.(r);
        }
      }
    }

    this.collide();
    this.rank();
    this.rubberband();
    this.items.update(dt, this.racers, moving);
  }

  // カート同士のぶつかり
  private collide() {
    const rs = this.racers;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i].kart, b = rs[j].kart;
        if (a.squashTime > 0 || b.squashTime > 0) continue; // ぺちゃんこのカートは、だれにも押されない
        _d.subVectors(b.pos, a.pos).setY(0);
        const d = _d.length();
        // 巨大なほど、ぶつかる範囲も広い（ふつうは 2.0m）
        const sa = a.giantScale, sb = b.giantScale;
        const reach = sa + sb;
        if (d > reach || d < 1e-4 || Math.abs(a.y - b.y) > 1.5 * Math.max(sa, sb)) continue;
        // 巨大なスターは、ふつうのカートを押しのけず、踏みつぶして通りぬける
        if (a.starTime > 0 && b.starTime <= 0) {
          this.stomp(rs[i], rs[j]);
          continue;
        }
        if (b.starTime > 0 && a.starTime <= 0) {
          this.stomp(rs[j], rs[i]);
          continue;
        }
        _d.divideScalar(d);
        const push = (reach - d) / 2;
        a.pos.addScaledVector(_d, -push);
        b.pos.addScaledVector(_d, push);
        const rel = (b.vel.x - a.vel.x) * _d.x + (b.vel.z - a.vel.z) * _d.z;
        if (rel < 0) {
          a.vel.addScaledVector(_d, rel * 0.6);
          b.vel.addScaledVector(_d, -rel * 0.6);
        }
      }
    }
  }

  // 踏みつぶす：ぺちゃんこにして、しばらく止める（コインも少し落とす）
  private stomp(by: Racer, victim: Racer) {
    // バリアは、踏みつぶしも、はじき返す
    if (victim.kart.barrier) {
      victim.repel(by.kart.pos, 1.5);
      return;
    }
    if (!victim.kart.squash(2.2)) return;
    victim.addCoins(-2);
    this.stompCount++;
    this.lastStomp = { pos: new THREE.Vector3(victim.kart.pos.x, victim.kart.y, victim.kart.pos.z), by, victim };
  }

  private rank() {
    const order = [...this.racers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    order.forEach((r, i) => (r.place = i + 1));
  }

  // CPU の追い上げ・手加減（プレイヤーとの距離で最高速を少し調整）
  private rubberband() {
    const L = this.track.length;
    for (const r of this.racers) {
      if (r.isPlayer && !r.finished) {
        r.kart.rubberband = 1;
        continue;
      }
      const gap = (r.progress - this.player.progress) * L; // + なら前にいる
      const rb = 1 - Math.max(-0.1, Math.min(0.08, gap / 700));
      r.kart.rubberband = (r.ai?.skillMul ?? 1) * rb;
      // ゴール後は、ウィニングランのカメラにプレイヤーだけがきれいに映るよう、近くのカートは道をゆずる
      if (this.state === 'finished' && !r.isPlayer && Math.abs(gap) < 24) r.kart.rubberband *= 0.4;
    }
  }
}
