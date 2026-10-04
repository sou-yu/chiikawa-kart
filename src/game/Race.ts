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
          if (playerInput.item) this.items.use(r, this.racers);
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
        _d.subVectors(b.pos, a.pos).setY(0);
        const d = _d.length();
        if (d > 2.0 || d < 1e-4 || Math.abs(a.y - b.y) > 1.5) continue;
        _d.divideScalar(d);
        const push = (2.0 - d) / 2;
        a.pos.addScaledVector(_d, -push);
        b.pos.addScaledVector(_d, push);
        const rel = (b.vel.x - a.vel.x) * _d.x + (b.vel.z - a.vel.z) * _d.z;
        if (rel < 0) {
          a.vel.addScaledVector(_d, rel * 0.6);
          b.vel.addScaledVector(_d, -rel * 0.6);
        }
        // 無敵は相手を弾き飛ばす
        if (a.starTime > 0 && b.starTime <= 0) rs[j].hit();
        if (b.starTime > 0 && a.starTime <= 0) rs[i].hit();
      }
    }
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
