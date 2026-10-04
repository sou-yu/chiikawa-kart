import * as THREE from 'three';
import type { InputState } from '../core/Input';
import type { Track } from '../track/Track';
import type { Racer } from './Racer';

const _p = new THREE.Vector3();

// コースの少し先を狙って走る CPU。走るラインを時々ずらして抜きつ抜かれつを作る。
export class AIDriver {
  private readonly state: InputState = { steer: 0, throttle: true, brake: false, item: false, jump: false };
  private lane = 0;
  private laneTarget = 0;
  private laneTimer = 0;
  private wobble = Math.random() * 10;

  constructor(private readonly skill = 0.97) {}

  get skillMul(): number {
    return this.skill;
  }

  update(dt: number, r: Racer, track: Track): InputState {
    const k = r.kart;
    const hw = track.def.halfWidth;
    this.laneTimer -= dt;
    if (this.laneTimer <= 0) {
      this.laneTimer = 2 + Math.random() * 3;
      this.laneTarget = (Math.random() * 2 - 1) * hw * 0.55;
    }
    this.lane += (this.laneTarget - this.lane) * (1 - Math.exp(-0.8 * dt));
    this.wobble += dt;

    const look = (9 + Math.max(0, k.forwardSpeed) * 0.45) / track.length;
    const t = k.proj.t + look;
    track.place(t, this.lane + Math.sin(this.wobble * 0.7) * 0.8, _p);
    let d = Math.atan2(_p.x - k.pos.x, _p.z - k.pos.z) - k.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.state.steer = Math.max(-1, Math.min(1, -d * 2.4));
    this.state.throttle = true;
    return this.state;
  }
}
