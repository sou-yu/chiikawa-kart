import * as THREE from 'three';
import type { Racer } from './Racer';

// スタート前のカメラ演出。スタートに並んだキャラたちを「前 → 横 → 後ろ」の順に見せ、
// 最後は、ふだんの「うしろから追いかける」カメラの位置にぴたりと着く（そのままレースのカメラにつながる）。
export const INTRO_TIME = 6.2; // 秒

export interface CamPose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

// 通過点。v = [位置 x y z, 見る先 x y z, 画角]
interface Key {
  t: number;
  v: number[];
}

export class IntroCam {
  readonly center = new THREE.Vector3(); // 並んだカートのまんなか（影の中心にする）
  private keys: Key[];
  private sway = new THREE.Vector2(); // タイトル中に揺らす向き（先頭カートの真横）

  private karts: Racer['kart'][];

  // end = レースが始まったときのカメラ
  constructor(player: Racer, racers: Racer[], end: CamPose, portrait = false) {
    const P = player.kart;
    this.karts = racers.map((r) => r.kart);
    // 先頭のカート（プレイヤーより前で、いちばん遠いもの）
    let lead = P;
    let best = 0;
    for (const r of racers) {
      const s = (r.kart.pos.x - P.pos.x) * Math.sin(P.heading) + (r.kart.pos.z - P.pos.z) * Math.cos(P.heading);
      if (s > best) {
        best = s;
        lead = r.kart;
      }
    }
    const dh = Math.atan2(Math.sin(lead.heading - P.heading), Math.cos(lead.heading - P.heading));
    // 2 列に並んでいるので、並びのまんなかの線は、プレイヤーと先頭をむすぶ線から横にずれている（プレイヤーから見て右が +）
    let lo = 0, hi = 0;
    for (const k of this.karts) {
      const r = -(k.pos.x - P.pos.x) * Math.cos(P.heading) + (k.pos.z - P.pos.z) * Math.sin(P.heading);
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
    const mid = (lo + hi) / 2;
    // 通る側は、プレイヤーのいる列の外側（プレイヤーのすぐ横を通って、最後に後ろへ回り込む）
    const s = mid > 0 ? -1 : 1;

    // 並びのまんなかの線の上の点：a = 0 がプレイヤー、1 が先頭。d = 進行方向（前が +）、x = 右が +、y = 高さ
    const at = (a: number, d: number, x: number, y: number): number[] => {
      const h = P.heading + dh * a;
      const cx = P.pos.x + (lead.pos.x - P.pos.x) * a;
      const cz = P.pos.z + (lead.pos.z - P.pos.z) * a;
      x += mid;
      return [cx + Math.sin(h) * d - Math.cos(h) * x, P.y + (lead.y - P.y) * a + y, cz + Math.cos(h) * d + Math.sin(h) * x];
    };
    const mp = at(0.5, 0, 0, 0);
    this.center.set(mp[0], mp[1], mp[2]);
    this.sway.set(-Math.cos(lead.heading), Math.sin(lead.heading));

    const key = (t: number, pos: number[], look: number[], fov: number): Key => ({ t, v: [...pos, ...look, fov] });
    this.keys = [
      // 1. 先頭のキャラの正面（低めから、並んだみんなの顔を見渡す）。カートを画面の下のほうに置き、上はタイトルの文字にあける
      key(0.0, portrait ? at(1, 9.5, 1.0 * s, 1.6) : at(1, 7.0, 1.0 * s, 1.45), at(0.78, 0, 0, portrait ? 4.6 : 3.8), 54),
      // 2. 先頭のまわりを回って、横へ
      key(1.7, at(1, 3.0, 6.0 * s, 1.7), at(0.78, 0, 0, 1.2), 54),
      // 3. 並びの真横を、前から後ろへ滑っていく（道はば 17〜19m の中に収まる横の距離）
      key(3.3, at(0.55, -1.0, 7.5 * s, 2.0), at(0.42, 0, 0, 1.2), 56),
      // 4. プレイヤーの横まで来て、キャラのほうを向く
      key(4.8, at(0.06, -2.5, 6.0 * s, 2.2), at(0, 2.5, 0, 1.3), 60),
      // 5. 後ろへ回り込んで、いつものカメラに
      { t: INTRO_TIME, v: [end.pos.x, end.pos.y, end.pos.z, end.look.x, end.look.y, end.look.z, end.fov] },
    ];
  }

  // カートにめり込まないよう、近すぎたら横へ押し出す（念のため）
  private avoid(p: THREE.Vector3) {
    const R = 3.0;
    for (const k of this.karts) {
      const dx = p.x - k.pos.x, dz = p.z - k.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < R && p.y < k.y + 3.5) {
        const f = d > 1e-3 ? (R - d) / d : 0;
        p.x += d > 1e-3 ? dx * f : R;
        p.z += dz * f;
      }
    }
  }

  // 演出を始める。最初の 1 枚は、いまのカメラ（タイトル中の揺れた位置）にして、つなぎ目をなくす
  begin(cur: CamPose) {
    this.keys[0].v = [cur.pos.x, cur.pos.y, cur.pos.z, cur.look.x, cur.look.y, cur.look.z, cur.fov];
  }

  // t 秒目のカメラ。t < 0 は「タイトル中」：正面の構図で、ゆっくり横に揺れる（clock = 経過秒）
  pose(t: number, clock: number, out: CamPose) {
    if (t < 0) {
      const v = this.keys[0].v;
      const sw = Math.sin(clock * 0.55) * 0.9;
      out.pos.set(v[0] + this.sway.x * sw, v[1] + Math.sin(clock * 0.8) * 0.04, v[2] + this.sway.y * sw);
      out.look.set(v[3], v[4], v[5]);
      out.fov = v[6];
      return;
    }
    const keys = this.keys;
    t = Math.min(INTRO_TIME, t);
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1].t) i++;
    const a = keys[i], b = keys[i + 1];
    const h = b.t - a.t;
    const u = Math.min(1, Math.max(0, (t - a.t) / h));
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    // 通過点では速さが途切れないよう前後の点から傾きを決め、始めと終わりは止まった状態（ゆっくり出て、ゆっくり着く）
    const slope = (j: number, d: number) => (j === 0 || j === keys.length - 1 ? 0 : (keys[j + 1].v[d] - keys[j - 1].v[d]) / (keys[j + 1].t - keys[j - 1].t));
    const v: number[] = [];
    for (let d = 0; d < 7; d++) {
      v.push(h00 * a.v[d] + h10 * h * slope(i, d) + h01 * b.v[d] + h11 * h * slope(i + 1, d));
    }
    out.pos.set(v[0], v[1], v[2]);
    this.avoid(out.pos);
    out.look.set(v[3], v[4], v[5]);
    out.fov = v[6];
  }
}
