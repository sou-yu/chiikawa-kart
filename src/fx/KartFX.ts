import * as THREE from 'three';
import { DRIFT_COLORS, KART } from '../config/tuning';
import type { CharacterModel } from '../characters/Character';
import type { Kart } from '../game/Kart';
import type { FXSystems } from './Particles';

const DRIFT = DRIFT_COLORS.map((c) => new THREE.Color(c));
const DIRT = new THREE.Color('#c9a57c');
const GRASS = new THREE.Color('#8cc462');
const FLAME = new THREE.Color('#ffb040');

// タイヤから舞う粒の色をコースに合わせる（レインボーロードは土ぼこりではなく、水色の光の粒）
export function setGroundFx(theme: 'meadow' | 'rainbow' | 'candy' | 'sunset') {
  DIRT.set(theme === 'rainbow' ? '#bfe4ff' : theme === 'candy' ? '#ffe6c8' : theme === 'sunset' ? '#ecd0aa' : '#c9a57c');
  GRASS.set(theme === 'rainbow' ? '#ffd1f0' : theme === 'candy' ? '#ffc2d8' : theme === 'sunset' ? '#f2dcbc' : '#8cc462');
}
const SPRAY = new THREE.Color('#f4fbff');
const SPRAY2 = new THREE.Color('#bfeee6');
const FOAM = new THREE.Color('#ffffff');
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();

// カートに付く演出。Kart の状態を読むだけでロジックには触らない。
export class KartFX {
  private flame: THREE.Mesh;
  private flameInner: THREE.Mesh;
  private time = 0;
  private prevLevel = 0;
  private emitAcc = 0;
  private starred = false;
  private glowing = false; // ドリフトの溜まりで車体が光っている
  private lastBoostCount = 0;
  private boostLevel = 0; // いまのダッシュが、ドリフトの何段階めか（0 = ふつうのダッシュ）
  private flameLevel = -1;
  private ring: THREE.Mesh; // ミニターボが出たときに広がる輪
  private ringT = 1;

  // トリックのキラキラ星（カートの周りをくるくる回る）
  private stars: THREE.Sprite[] = [];
  private starTime = 0;
  private lastGlide = 0;

  constructor(private model: CharacterModel, private fx: FXSystems, anchor: THREE.Object3D) {
    const starMat = new THREE.SpriteMaterial({ map: starTexture(), transparent: true, depthWrite: false, fog: false });
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Sprite(starMat.clone());
      s.material.color.set(SPARKLE[i % SPARKLE.length]);
      s.visible = false;
      anchor.add(s);
      this.stars.push(s);
    }
    const cone = new THREE.ConeGeometry(0.2, 1, 12).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
    this.flame = new THREE.Mesh(
      cone,
      new THREE.MeshBasicMaterial({ color: '#ff9a3c', transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.flameInner = new THREE.Mesh(
      cone,
      new THREE.MeshBasicMaterial({ color: '#fff3b0', transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.flameInner.scale.set(0.5, 0.5, 0.7);
    this.flame.add(this.flameInner);
    this.flame.position.set(0, 0.64, -1.4);
    this.flame.visible = false;
    model.root.add(this.flame);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 1.0, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
    );
    this.ring.position.set(0, 0.18, -0.9);
    this.ring.visible = false;
    anchor.add(this.ring);
  }

  update(dt: number, kart: Kart) {
    this.time += dt;
    const speed = Math.abs(kart.forwardSpeed);
    this.emitAcc += dt * 60;
    const frames = Math.floor(this.emitAcc);
    this.emitAcc -= frames;

    // ドリフト火花（後輪から）
    const lvl = kart.drifting && kart.grounded ? kart.driftLevel : 0;
    if (kart.drifting && kart.grounded) {
      for (const wp of this.model.rearWheelPos) {
        for (let f = 0; f < frames; f++) {
          // 溜まるほど（時間が長いほど）火花が増えて、大きくなる
          const norm = Math.min(1, kart.driftCharge / KART.driftChargeMax);
          const n = lvl === 0 ? 1 : 3 + lvl * 2 + Math.floor(norm * 5);
          for (let i = 0; i < n; i++) {
            this.model.root.localToWorld(_p.copy(wp));
            // 外側・後ろ・上へ勢いよく飛び散る
            _v.set((Math.random() - 0.3) * 7 * Math.sign(wp.x), 1.5 + Math.random() * 5, -5 - Math.random() * 5);
            this.localDir(_v);
            _v.addScaledVector(kart.vel, 0.55);
            const col = lvl === 0 ? _c.set('#fff2c0') : DRIFT[lvl - 1];
            const size = lvl === 0 ? 0.12 : (0.22 + lvl * 0.06 + norm * 0.1) * (0.6 + Math.random() * 0.8);
            this.fx.sparks.emit(_p, _v, col, { size, life: 0.15 + Math.random() * 0.2, gravity: 14, grow: 0.4 });
          }
        }
      }
    }
    // 段階が上がった瞬間にパッと光る
    if (lvl > this.prevLevel && lvl > 0) {
      for (const wp of this.model.rearWheelPos) {
        this.model.root.localToWorld(_p.copy(wp)).y += 0.3;
        for (let i = 0; i < 14; i++) {
          _v.set((Math.random() - 0.5) * 8, Math.random() * 6, (Math.random() - 0.5) * 8).addScaledVector(kart.vel, 0.8);
          this.fx.sparks.emit(_p, _v, DRIFT[lvl - 1], { size: 0.35, life: 0.35, drag: 3 });
        }
      }
    }
    this.prevLevel = lvl;

    // ドリフト中は、車体が溜まりの色にほんのり光る（段階が上がるほど強く、速く脈打つ）
    if (lvl > 0 && kart.starTime <= 0) {
      const pulse = 0.65 + 0.35 * Math.sin(this.time * (14 + lvl * 4));
      _c.copy(DRIFT[lvl - 1]).multiplyScalar(0.15 * lvl * pulse);
      for (const m of this.model.materials) {
        const base = m.userData.baseEmissive as THREE.Color | undefined;
        if (base) m.emissive.copy(base);
        else m.emissive.setRGB(0, 0, 0);
        m.emissive.add(_c);
      }
      this.glowing = true;
    } else if (this.glowing && kart.starTime <= 0) {
      for (const m of this.model.materials) {
        if (m.userData.baseEmissive) m.emissive.copy(m.userData.baseEmissive);
        else m.emissive.setRGB(0, 0, 0);
      }
      this.glowing = false;
    }

    // ミニターボが出た瞬間：後ろにドンと光が飛び、輪が広がる（段階が上がるほど大きく）
    if (kart.driftBoostCount !== this.lastBoostCount) {
      this.lastBoostCount = kart.driftBoostCount;
      const L = kart.driftBoostLevel;
      this.boostLevel = L;
      for (const wp of this.model.rearWheelPos) {
        this.model.root.localToWorld(_p.copy(wp)).y += 0.25;
        for (let i = 0; i < 12 + L * 10; i++) {
          _v.set((Math.random() - 0.5) * 9, Math.random() * 5, -4 - Math.random() * 9);
          this.localDir(_v);
          _v.addScaledVector(kart.vel, 0.5);
          this.fx.sparks.emit(_p, _v, i % 3 === 0 ? _c.set('#ffffff') : DRIFT[L - 1], { size: 0.4 + L * 0.08, life: 0.45, drag: 2.2, grow: 0.3 });
        }
      }
      this.ringT = 0;
      (this.ring.material as THREE.MeshBasicMaterial).color.copy(DRIFT[L - 1]);
    }
    if (this.ringT < 1) {
      this.ringT = Math.min(1, this.ringT + dt / 0.5);
      const e = 1 - (1 - this.ringT) ** 3;
      this.ring.visible = this.ringT < 1;
      this.ring.scale.setScalar(1 + e * (3.5 + this.boostLevel * 1.8));
      (this.ring.material as THREE.MeshBasicMaterial).opacity = (1 - this.ringT) * 0.9;
    }

    // 浅瀬：タイヤから水しぶき、うしろに白い泡の筋。ドリフト中は大きく扇形に
    if (kart.inWater && kart.grounded && speed > 3) {
      const k = Math.min(1, speed / 24);
      for (const wp of this.model.rearWheelPos) {
        for (let f = 0; f < frames; f++) {
          const n = Math.round((kart.drifting ? 4 : 2) * k + (rand01() < k ? 1 : 0));
          for (let i = 0; i < n; i++) {
            this.model.root.localToWorld(_p.copy(wp)).y = 0.15;
            _v.set((Math.random() - 0.3) * (kart.drifting ? 7 : 3.5) * Math.sign(wp.x), 2 + Math.random() * (kart.drifting ? 5 : 3.5), -2 - Math.random() * 4);
            this.localDir(_v);
            _v.addScaledVector(kart.vel, 0.45);
            this.fx.sparks.emit(_p, _v, Math.random() < 0.5 ? SPRAY : SPRAY2, { size: 0.16 + Math.random() * 0.16, life: 0.35 + Math.random() * 0.25, gravity: 16, grow: 0.5 });
          }
          // 泡の筋（水面に残って広がる）
          if (Math.random() < 0.7) {
            this.model.root.localToWorld(_p.copy(wp)).y = 0.13;
            _v.set((Math.random() - 0.5) * 1.2, 0.05, (Math.random() - 0.5) * 1.2);
            this.fx.dust.emit(_p, _v, FOAM, { size: 0.55 + Math.random() * 0.4, life: 0.9 + Math.random() * 0.5, grow: 2.2, drag: 3 });
          }
        }
      }
    }
    // 着水：まわりに大きく水しぶき
    if (kart.landed && kart.inWater) {
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2;
        _p.set(kart.pos.x + Math.cos(a) * 1.2, 0.2, kart.pos.z + Math.sin(a) * 1.2);
        _v.set(Math.cos(a) * (3 + Math.random() * 4), 4 + Math.random() * 6, Math.sin(a) * (3 + Math.random() * 4)).addScaledVector(kart.vel, 0.3);
        this.fx.sparks.emit(_p, _v, i % 2 ? SPRAY : SPRAY2, { size: 0.22 + Math.random() * 0.2, life: 0.6, gravity: 18, grow: 0.4 });
      }
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        _p.set(kart.pos.x + Math.cos(a) * 1.5, 0.13, kart.pos.z + Math.sin(a) * 1.5);
        _v.set(Math.cos(a) * 3, 0, Math.sin(a) * 3);
        this.fx.dust.emit(_p, _v, FOAM, { size: 0.8, life: 1.0, grow: 2.5, drag: 2.5 });
      }
    }
    // 砂ぼこり・草
    if (kart.grounded && speed > 8 && !kart.inWater) {
      const rate = kart.drifting ? 0.9 : 0.35;
      for (const wp of this.model.rearWheelPos) {
        for (let f = 0; f < frames; f++) {
          if (Math.random() > rate) continue;
          this.model.root.localToWorld(_p.copy(wp)).y += 0.1;
          _v.set((Math.random() - 0.5) * 2, 0.6 + Math.random() * 1.4, -2 - Math.random() * 2);
          this.localDir(_v);
          _v.addScaledVector(kart.vel, 0.35);
          this.fx.dust.emit(_p, _v, kart.offroad ? GRASS : DIRT, { size: 0.5 + Math.random() * 0.5, life: 0.5 + Math.random() * 0.4, grow: 2.5, drag: 2 });
        }
      }
    }
    // 着地
    if (kart.landed && !kart.inWater) {
      for (let i = 0; i < 24; i++) {
        _p.set(kart.pos.x + (Math.random() - 0.5) * 2, kart.y + 0.1, kart.pos.z + (Math.random() - 0.5) * 2);
        const a = Math.random() * Math.PI * 2;
        _v.set(Math.cos(a) * 5, 1 + Math.random() * 2, Math.sin(a) * 5).addScaledVector(kart.vel, 0.4);
        this.fx.dust.emit(_p, _v, DIRT, { size: 0.7, life: 0.6, grow: 2.2, drag: 3 });
      }
    }
    if (kart.wallHit) {
      for (let i = 0; i < 12; i++) {
        this.model.root.localToWorld(_p.set((Math.random() - 0.5) * 1.5, 0.6, 1.2));
        _v.set((Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8);
        this.fx.sparks.emit(_p, _v, _c.set('#ffe9a8'), { size: 0.18, life: 0.3, gravity: 15 });
      }
    }

    this.updateTrick(dt, kart, frames);

    // グライダー：翼の両端から風の筋、開いた瞬間にキラキラ
    if (kart.glideCount !== this.lastGlide) {
      this.lastGlide = kart.glideCount;
      KartFX.burst(this.fx, _p.set(kart.pos.x, kart.y + 3, kart.pos.z), SPARKLE, 34, 7);
    }
    if (kart.gliding) {
      for (let f = 0; f < frames; f++) {
        for (const s of [-1, 1]) {
          this.model.root.localToWorld(_p.set(s * 2.25, 2.95, -0.2));
          _v.set(0, 0, 0).addScaledVector(kart.vel, 0.15);
          this.fx.sparks.emit(_p, _v, WIND, { size: 0.16, life: 0.45, grow: 0.5 });
        }
      }
    }

    // ブーストの炎
    // ダッシュが強いほど（ドリフトを長く続けたほど）炎は長く太く、色も溜まりの色になる
    const boosting = kart.boostTime > 0;
    this.flame.visible = boosting;
    if (!boosting) this.boostLevel = 0;
    if (boosting) {
      const pw = Math.min(1, kart.boostPower / KART.driftBoostPower[1]);
      if (this.flameLevel !== this.boostLevel) {
        this.flameLevel = this.boostLevel;
        const col = this.boostLevel > 0 ? DRIFT[this.boostLevel - 1] : null;
        (this.flame.material as THREE.MeshBasicMaterial).color.copy(col ?? _c.set('#ff9a3c'));
        (this.flameInner.material as THREE.MeshBasicMaterial).color.copy(col ? _c.copy(col).lerp(WHITE, 0.6) : _c.set('#fff3b0'));
      }
      const f = (1 + Math.sin(this.time * 50) * 0.2) * (0.9 + pw * 0.9);
      this.flame.scale.set(f, f, (0.9 + Math.random() * 0.7) * (0.8 + pw * 1.8));
      const col = this.boostLevel > 0 ? DRIFT[this.boostLevel - 1] : FLAME;
      for (let f2 = 0; f2 < frames; f2++) {
        for (let k2 = 0; k2 < 1 + Math.floor(pw * 2.5); k2++) {
          this.model.root.localToWorld(_p.set((Math.random() - 0.5) * 0.4, 0.64, -1.6));
          _v.set((Math.random() - 0.5) * 1.5, Math.random() * 1.5, -3 - pw * 5).applyAxisAngle(THREE.Object3D.DEFAULT_UP, kart.heading);
          this.fx.sparks.emit(_p, _v, col, { size: 0.35 + pw * 0.2, life: 0.25 + pw * 0.15, grow: 0.3 });
        }
      }
    } else {
      this.flameLevel = -1;
    }

    // 無敵：虹色のキラキラと発光
    if (kart.starTime > 0) {
      const hue = (this.time * 1.5) % 1;
      _c.setHSL(hue, 1, 0.6);
      for (const m of this.model.materials) m.emissive.copy(_c).multiplyScalar(0.45);
      for (let f = 0; f < frames; f++) {
        _p.set(kart.pos.x + (Math.random() - 0.5) * 2.5, kart.y + Math.random() * 2.5, kart.pos.z + (Math.random() - 0.5) * 2.5);
        _v.set(0, 1.5, 0);
        this.fx.sparks.emit(_p, _v, _c.setHSL(Math.random(), 1, 0.7), { size: 0.3, life: 0.4 });
      }
    } else if (this.starred) {
      for (const m of this.model.materials) {
        if (m.userData.baseEmissive) m.emissive.copy(m.userData.baseEmissive);
        else m.emissive.setRGB(0, 0, 0);
      }
    }
    this.starred = kart.starTime > 0;
  }

  // ジャンプトリックのキラキラ
  private updateTrick(dt: number, kart: Kart, frames: number) {
    const center = () => _p.set(kart.pos.x, kart.y + 1.2, kart.pos.z);
    if (kart.trickStarted) {
      this.starTime = 1.3;
      KartFX.burst(this.fx, center(), SPARKLE, 26, 6);
    }
    if (kart.trickLanded) {
      this.starTime = Math.max(this.starTime, 0.7);
      KartFX.burst(this.fx, center(), SPARKLE, 40, 9);
    }
    // 回転中は体のまわりからキラキラがこぼれる
    if (kart.tricking) {
      for (let f = 0; f < frames; f++) {
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2;
          center().add(_v.set(Math.cos(a) * 1.3, (Math.random() - 0.3) * 1.6, Math.sin(a) * 1.3));
          _v.set(Math.cos(a) * 1.5, 1 + Math.random() * 2, Math.sin(a) * 1.5).addScaledVector(kart.vel, 0.7);
          this.fx.sparks.emit(_p, _v, _c.set(SPARKLE[Math.floor(Math.random() * SPARKLE.length)]), { size: 0.35 + Math.random() * 0.3, life: 0.6, drag: 2, gravity: 2 });
        }
      }
    }
    // 星のスプライト（カートの周りを回りながら瞬く）
    this.starTime = Math.max(0, this.starTime - dt);
    const on = this.starTime > 0;
    const fade = Math.min(1, this.starTime / 0.4);
    this.stars.forEach((s, i) => {
      s.visible = on;
      if (!on) return;
      const a = this.time * 5 + (i / this.stars.length) * Math.PI * 2;
      const r = 1.6 + Math.sin(this.time * 7 + i) * 0.25;
      s.position.set(Math.cos(a) * r, 1.3 + kart.y + Math.sin(a * 1.5 + i) * 0.6, Math.sin(a) * r);
      const tw = 0.6 + Math.abs(Math.sin(this.time * 12 + i * 1.7)) * 0.6;
      s.scale.setScalar(tw * fade);
      s.material.rotation = this.time * 3 + i;
      s.material.opacity = fade;
    });
  }

  // カートのローカル方向 → ワールド方向（向きだけ）
  private localDir(v: THREE.Vector3) {
    const q = this.model.root.getWorldQuaternion(_q);
    v.applyQuaternion(q);
  }

  static burst(fx: FXSystems, p: THREE.Vector3, colors: THREE.ColorRepresentation[], n = 30, speed = 7) {
    for (let i = 0; i < n; i++) {
      _v.set(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.6));
      fx.sparks.emit(p, _v, _c.set(colors[i % colors.length]), { size: 0.35, life: 0.5, drag: 2.5, gravity: 4 });
    }
  }
}

const _q = new THREE.Quaternion();
const rand01 = Math.random;

const WIND = new THREE.Color('#f4fbff');
const WHITE = new THREE.Color('#ffffff');
const SPARKLE = ['#fff6b0', '#ffffff', '#ffc2dd', '#bfe6ff', '#ffe08a', '#e6ccff'];

// 4つの角がとがったキラキラ星
function starTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const glow = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  glow.addColorStop(0, 'rgba(255,255,255,0.9)');
  glow.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#ffffff';
  g.beginPath();
  const cx = S / 2, r = S * 0.48, k = S * 0.07;
  g.moveTo(cx, cx - r);
  g.quadraticCurveTo(cx + k, cx - k, cx + r, cx);
  g.quadraticCurveTo(cx + k, cx + k, cx, cx + r);
  g.quadraticCurveTo(cx - k, cx + k, cx - r, cx);
  g.quadraticCurveTo(cx - k, cx - k, cx, cx - r);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
