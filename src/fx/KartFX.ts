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

  // スター（巨大化）：虹色の光、星の光、足もとの輪。使った瞬間の輪と、踏まれたときのぴよぴよの星
  private aura: THREE.Sprite;
  private halo: THREE.Sprite;
  private starRing: THREE.Mesh;
  private shock: THREE.Mesh;
  private shockT = 1;
  private shockDur = 0.5;
  private shockR = 10;
  private dizzy: THREE.Sprite[] = [];
  private lastStarBurst = 0;
  private lastSquash = 0;

  // 絶対バリア：半透明の球（ふちが光り、玉虫色にゆらぎ、パネルの線が走る）。当たると、そこから波紋が広がる
  private shield: THREE.Mesh;
  private shieldMat: THREE.ShaderMaterial;
  private echo: THREE.Mesh; // 当たったとき・張ったとき・砕けるときに、外へ広がって消える光の殻
  private echoMat: THREE.ShaderMaterial;
  private echoT = 1;
  private echoDur = 0.45;
  private echoGrow = 0.55;
  private shieldRing: THREE.Mesh; // 球が地面に接する所の光の輪
  private flashGlow: THREE.Sprite; // 当たった所の閃光
  private flashStar: THREE.Sprite;
  private flashT = 1;
  private rips = [new THREE.Vector4(0, 1, 0, -1), new THREE.Vector4(0, 1, 0, -1), new THREE.Vector4(0, 1, 0, -1)];
  private ripNext = 0;
  private lastPop = 0;
  private lastHits = 0;
  private popT = 9; // 張ってからの秒
  private outT = 1; // 消えるときの進み（1 = 消えきった）
  private kick = 0; // 当たった瞬間の、球のふくらみ
  private boost = 0; // 当たったあと、全体が明るくなる
  private shieldOn = false;

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

    // スター：虹色の光（にじむ丸）、ゆっくり回る星の光、足もとの輪
    const glowMat = (map: THREE.Texture) => new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.aura = new THREE.Sprite(glowMat(glowTexture()));
    this.halo = new THREE.Sprite(glowMat(starTexture()));
    this.aura.visible = this.halo.visible = false;
    this.aura.renderOrder = this.halo.renderOrder = 6;
    anchor.add(this.aura, this.halo);
    this.starRing = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 1.0, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
    );
    this.starRing.visible = false;
    anchor.add(this.starRing);
    this.shock = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.0, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
    );
    this.shock.visible = false;
    anchor.add(this.shock);
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture(), color: '#ffe46a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      s.visible = false;
      anchor.add(s);
      this.dizzy.push(s);
    }

    // 絶対バリア
    this.shieldMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 }, uBoost: { value: 0 }, uReveal: { value: 0 }, uBreak: { value: 0 }, uRip: { value: this.rips } },
      vertexShader: SHIELD_VERT,
      fragmentShader: SHIELD_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      premultipliedAlpha: true,
      fog: false,
    });
    this.shield = new THREE.Mesh(shieldGeometry(), this.shieldMat);
    this.shield.visible = false;
    this.shield.renderOrder = 5;
    anchor.add(this.shield);
    this.echoMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uBreak: { value: 0 }, uColor: { value: new THREE.Color('#8fe6ff') } },
      vertexShader: SHIELD_VERT,
      fragmentShader: ECHO_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      premultipliedAlpha: true,
      fog: false,
    });
    this.echo = new THREE.Mesh(shieldGeometry(), this.echoMat);
    this.echo.visible = false;
    this.echo.renderOrder = 6;
    anchor.add(this.echo);
    this.shieldRing = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.0, 72).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#8fe6ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
    );
    this.shieldRing.visible = false;
    anchor.add(this.shieldRing);
    this.flashGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#bff4ff', transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false }));
    this.flashStar = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture(), color: '#ffffff', transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false }));
    this.flashGlow.visible = this.flashStar.visible = false;
    this.flashGlow.renderOrder = this.flashStar.renderOrder = 7;
    anchor.add(this.flashGlow, this.flashStar);
  }

  // バックミラーのカメラは、自分のバリアの「中」にあるので、ミラーを描くあいだだけ隠すもの
  get insideObjects(): THREE.Object3D[] {
    return [this.shield, this.echo];
  }

  // バリアのシェーダーを、あらかじめ用意しておく（はじめて張った瞬間に、カクつかないように）。実際に描く先（target）と同じ条件で
  warm(renderer: THREE.WebGLRenderer, camera: THREE.Camera, target: THREE.WebGLRenderTarget) {
    const s = new THREE.Scene();
    s.add(new THREE.Mesh(this.shield.geometry, this.shieldMat), new THREE.Mesh(this.echo.geometry, this.echoMat));
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.compile(s, camera);
    renderer.setRenderTarget(prev);
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

    // スター：使った瞬間のはじけ／踏まれた瞬間の衝撃／虹色に輝く巨大なカート
    if (kart.starBurst !== this.lastStarBurst) {
      this.lastStarBurst = kart.starBurst;
      this.starPop(kart);
    }
    if (kart.squashCount !== this.lastSquash) {
      this.lastSquash = kart.squashCount;
      this.impact(kart);
    }
    this.updateShock(dt);
    this.updateDizzy(kart);
    this.updateBarrier(dt, kart, frames);
    const gs = kart.giantScale;
    if (kart.starTime > 0) {
      const age = kart.starMax - kart.starTime;
      // おわりが近づくと、ちかちか点滅（もうすぐ元にもどる合図）
      const warn = kart.starTime < 1.6;
      const blink = warn ? (Math.sin(this.time * 34) > 0 ? 1 : 0.2) : 1;
      const fade = Math.min(1, age / 0.25, kart.starTime / 0.4);
      const hue = (this.time * 1.5) % 1;
      _c.setHSL(hue, 1, 0.6);
      for (const m of this.model.materials) m.emissive.copy(_c).multiplyScalar(0.62 * blink);
      // 体のまわりの、虹色の光（大きくなるほど、広い）と、ゆっくり回る星の光
      // 光は、カートの少し先（うしろのカメラから見て、カートの向こう側）に置く。カートの前に光がかぶって、白くなるのを防ぐ
      const cy = kart.y + 1.5 * gs;
      this.aura.visible = this.halo.visible = this.starRing.visible = true;
      this.aura.position.set(0, cy, 1.7 * gs);
      this.aura.scale.setScalar((3.6 + Math.sin(this.time * 9) * 0.35) * gs);
      (this.aura.material as THREE.SpriteMaterial).color.setHSL((hue + 0.1) % 1, 1, 0.55).multiplyScalar(1.3);
      (this.aura.material as THREE.SpriteMaterial).opacity = 0.5 * fade * blink;
      this.halo.position.set(0, cy, 2.2 * gs);
      this.halo.scale.setScalar((5.0 + Math.sin(this.time * 6) * 0.5) * gs);
      (this.halo.material as THREE.SpriteMaterial).rotation = this.time * 0.9;
      (this.halo.material as THREE.SpriteMaterial).color.setHSL((hue + 0.55) % 1, 0.7, 0.8).multiplyScalar(1.2);
      (this.halo.material as THREE.SpriteMaterial).opacity = 0.42 * fade * blink;
      // 足もとの、虹色にまわる光の輪
      this.starRing.position.set(0, kart.groundY + 0.14, 0);
      this.starRing.scale.setScalar(2.7 * gs * (1 + 0.05 * Math.sin(this.time * 8)));
      this.starRing.rotation.y = this.time * 1.4;
      (this.starRing.material as THREE.MeshBasicMaterial).color.setHSL((hue + 0.3) % 1, 1, 0.6).multiplyScalar(1.6);
      (this.starRing.material as THREE.MeshBasicMaterial).opacity = 0.7 * fade * blink;
      // 虹色のキラキラが、体じゅうからこぼれる（大きいほど、たくさん・大きく）
      const n = Math.round(3 * Math.sqrt(gs));
      const sz = 0.3 * Math.sqrt(gs);
      for (let f = 0; f < frames; f++) {
        for (let i = 0; i < n; i++) {
          _p.set(kart.pos.x + (Math.random() - 0.5) * 2.8 * gs, kart.y + Math.random() * 2.8 * gs, kart.pos.z + (Math.random() - 0.5) * 2.8 * gs);
          _v.set((Math.random() - 0.5) * 2, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 2);
          this.fx.sparks.emit(_p, _v, _c.setHSL(Math.random(), 1, 0.7), { size: sz * (0.7 + Math.random() * 0.8), life: 0.45 + Math.random() * 0.3, gravity: -1 });
        }
        // うしろへ流れる、金色のキラキラの尾
        const fx = Math.sin(kart.heading), fz = Math.cos(kart.heading);
        _p.set(kart.pos.x - fx * 1.8 * gs + (Math.random() - 0.5) * gs, kart.y + (0.3 + Math.random() * 1.6) * gs, kart.pos.z - fz * 1.8 * gs + (Math.random() - 0.5) * gs);
        _v.set(-fx * (3 + Math.random() * 3), Math.random() * 2, -fz * (3 + Math.random() * 3));
        this.fx.sparks.emit(_p, _v, _c.setHSL(0.12 + Math.random() * 0.06, 1, 0.75), { size: 0.5 * Math.sqrt(gs), life: 0.55, drag: 1 });
      }
    } else {
      this.aura.visible = this.halo.visible = this.starRing.visible = false;
      if (this.starred) {
        for (const m of this.model.materials) {
          if (m.userData.baseEmissive) m.emissive.copy(m.userData.baseEmissive);
          else m.emissive.setRGB(0, 0, 0);
        }
      }
    }
    this.starred = kart.starTime > 0;
  }

  // ---------- 絶対バリア ----------
  private updateBarrier(dt: number, kart: Kart, frames: number) {
    const gs = kart.giantScale;
    const R = SHIELD_R * gs;
    const cy = kart.y + SHIELD_H * gs;
    if (kart.barrierPop !== this.lastPop) {
      this.lastPop = kart.barrierPop;
      this.popT = 0;
      this.outT = 1;
      this.shieldPop(kart, R, cy);
    }
    if (kart.barrierHits !== this.lastHits) {
      this.lastHits = kart.barrierHits;
      this.shieldHit(kart, R, cy);
    }
    const on = kart.barrier;
    if (!on && this.shieldOn) {
      this.outT = 0; // バリアが切れた：ガラスのように砕ける
      this.shieldBreak(kart, R, cy);
    }
    this.shieldOn = on;

    // 当たった所の閃光
    if (this.flashT < 1) {
      this.flashT = Math.min(1, this.flashT + dt / 0.36);
      const u = this.flashT;
      const a = Math.pow(1 - u, 2);
      const e = 1 - Math.pow(1 - u, 3);
      this.flashGlow.scale.setScalar(R * (0.55 + 1.5 * e));
      this.flashStar.scale.setScalar(R * (0.45 + 1.2 * e));
      (this.flashGlow.material as THREE.SpriteMaterial).opacity = a * 0.7;
      (this.flashStar.material as THREE.SpriteMaterial).opacity = a;
      (this.flashStar.material as THREE.SpriteMaterial).rotation = u * 1.2;
      if (u >= 1) this.flashGlow.visible = this.flashStar.visible = false;
    }

    // 外へ広がって消える光の殻
    if (this.echoT < 1) {
      this.echoT = Math.min(1, this.echoT + dt / this.echoDur);
      const e = 1 - Math.pow(1 - this.echoT, 3);
      this.echo.visible = this.echoT < 1;
      this.echo.position.set(0, cy, 0);
      this.echo.scale.setScalar(R * (1.02 + this.echoGrow * e));
      this.echoMat.uniforms.uOpacity.value = Math.pow(1 - this.echoT, 1.6);
    }

    if (!on && this.outT >= 1) {
      this.shield.visible = false;
      this.shieldRing.visible = false;
      return;
    }
    this.popT += dt;
    this.kick *= Math.exp(-8 * dt);
    this.boost = Math.max(0, this.boost - dt * 2.8);
    for (const r of this.rips) {
      if (r.w < 0) continue;
      r.w += dt;
      if (r.w > 2.4) r.w = -1;
    }
    // 張った瞬間は、ぼよんと弾みながら大きくなる。切れる直前は点滅。切れるときは、広がりながら消える
    const t = this.popT;
    let sc = t < 0.9 ? 1 - Math.exp(-7 * t) * Math.cos(15 * t) : 1;
    let opacity = 1;
    if (on) {
      const left = kart.barrierLeft;
      if (left < 0.12) {
        const u = 1 - left / 0.12;
        opacity = Math.sin(this.time * (12 + u * 40)) > -0.1 ? 1 : 0.18;
      }
    } else {
      this.outT = Math.min(1, this.outT + dt / 0.6);
      opacity = Math.pow(1 - this.outT, 0.9);
    }
    sc *= 1 + 0.09 * this.kick;
    const reveal = Math.pow(Math.max(0, 1 - t / 0.4), 2) * 1.3 + (on ? 0 : Math.pow(1 - this.outT, 6) * 0.9);
    this.shield.visible = true;
    this.shield.position.set(0, cy, 0);
    this.shield.scale.setScalar(Math.max(0.001, R * sc));
    const u = this.shieldMat.uniforms;
    u.uTime.value = this.time;
    u.uOpacity.value = opacity;
    u.uBoost.value = this.boost + (on ? 0 : 0.9);
    u.uReveal.value = reveal;
    u.uBreak.value = on ? 0 : 1 - Math.pow(1 - this.outT, 2.2);

    // 足もとの、球が地面にふれる所の光の輪
    this.shieldRing.visible = true;
    this.shieldRing.position.set(0, kart.groundY + 0.12, 0);
    this.shieldRing.scale.setScalar(Math.sqrt(SHIELD_R * SHIELD_R - SHIELD_H * SHIELD_H) * gs * sc * (1 + 0.025 * Math.sin(this.time * 7)));
    this.shieldRing.rotation.y = this.time * 0.8;
    (this.shieldRing.material as THREE.MeshBasicMaterial).opacity = (0.45 + 0.3 * this.boost) * opacity * Math.min(1, t / 0.2);
    (this.shieldRing.material as THREE.MeshBasicMaterial).color.setHSL((0.52 + 0.1 * Math.sin(this.time * 1.3)) % 1, 0.9, 0.62 + 0.15 * this.boost);

    // 表面で、小さな光の粒が、ちらちら生まれて昇っていく
    if (on) {
      for (let f = 0; f < frames; f++) {
        if (Math.random() > 0.6 * Math.sqrt(gs)) continue;
        randomOnSphere(_v);
        _p.set(kart.pos.x + _v.x * R, cy + _v.y * R, kart.pos.z + _v.z * R);
        _v.multiplyScalar(0.8).setY(_v.y * 0.8 + 0.9);
        this.fx.sparks.emit(_p, _v, _c.setHSL(0.5 + Math.random() * 0.2, 0.8, 0.8), { size: 0.22 * Math.sqrt(gs) * (0.7 + Math.random() * 0.7), life: 0.5 + Math.random() * 0.4, drag: 1.5 });
      }
    }
  }

  // バリアをはった瞬間：中心からぱっと光が広がり、球がぼよんと現れる
  private shieldPop(kart: Kart, R: number, cy: number) {
    this.boost = Math.max(this.boost, 0.7);
    for (let i = 0; i < 110; i++) {
      randomOnSphere(_v);
      _p.set(kart.pos.x + _v.x * R * 0.55, cy + _v.y * R * 0.55, kart.pos.z + _v.z * R * 0.55);
      _v.multiplyScalar(8 + Math.random() * 16);
      this.fx.sparks.emit(_p, _v, _c.setHSL(0.48 + Math.random() * 0.25, 0.9, 0.72), { size: 0.35 + Math.random() * 0.3, life: 0.5 + Math.random() * 0.5, drag: 2.2 });
    }
    this.shockStart(kart, R * 3.4, 0.5, '#a8f0ff', 1.3);
    this.echoStart(0.9, 0.55, '#a8f0ff');
    // 地面の砂ぼこりの輪
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.fx.dust.emit(_p.set(kart.pos.x, kart.groundY + 0.3, kart.pos.z), _v.set(Math.cos(a) * 8, 0.5 + Math.random(), Math.sin(a) * 8), _c.set('#d9e8f0'), { size: 1.1, life: 0.7, grow: 2.2, drag: 2.5 });
    }
  }

  // 攻撃が当たった：当たった所から光の波が球をつたい、閃光と火花がはね返される
  private shieldHit(kart: Kart, R: number, cy: number) {
    const power = THREE.MathUtils.clamp(kart.barrierHitPower, 0.5, 2);
    // 当たった向き（ワールド）→ カートの向きに合わせた、ローカルの向き
    const wd = _w.copy(kart.barrierHitDir).normalize();
    _v.copy(wd).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -kart.heading);
    const rip = this.rips[this.ripNext];
    this.ripNext = (this.ripNext + 1) % this.rips.length;
    rip.set(_v.x, _v.y, _v.z, 0);
    this.boost = Math.min(1.3, 0.5 + 0.35 * power);
    this.kick = 1;
    this.flashT = 0;
    this.flashGlow.visible = this.flashStar.visible = true;
    this.flashGlow.position.set(_v.x * R, cy + _v.y * R, _v.z * R);
    this.flashStar.position.copy(this.flashGlow.position);
    // はね返される火花：当たった面から、外へ扇形に（はね返り）と、面にそって散る光
    const t1 = _t1.set(-wd.z, 0, wd.x);
    if (t1.lengthSq() < 1e-4) t1.set(1, 0, 0);
    t1.normalize();
    const t2 = _t2.crossVectors(wd, t1);
    const hitX = kart.pos.x + wd.x * R, hitY = cy + wd.y * R, hitZ = kart.pos.z + wd.z * R;
    const n = Math.round(120 * (0.7 + 0.4 * power));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.pow(Math.random(), 0.55) * 1.25;
      _v.copy(wd).addScaledVector(t1, Math.cos(a) * s).addScaledVector(t2, Math.sin(a) * s).normalize();
      const sp = (10 + Math.random() * 28) * (0.8 + 0.3 * power);
      _p.set(hitX, hitY, hitZ);
      _v.multiplyScalar(sp).addScaledVector(kart.vel, 0.7);
      const hue = i % 6 === 0 ? 0.92 : i % 4 === 0 ? 0.13 : 0.5 + Math.random() * 0.1;
      this.fx.sparks.emit(_p, _v, _c.setHSL(hue, i % 3 === 0 ? 0.15 : 0.95, 0.76), { size: 0.13 + Math.random() * 0.3, life: 0.3 + Math.random() * 0.7, drag: 1.6, gravity: 5 });
    }
    // 球の面を、四方へ走る光の筋
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      _v.copy(t1).multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a)).multiplyScalar(12 + Math.random() * 5).addScaledVector(kart.vel, 0.8);
      _p.set(hitX, hitY, hitZ);
      this.fx.sparks.emit(_p, _v, _c.set('#ffffff'), { size: 0.3, life: 0.3, drag: 3 });
    }
    // 球の表面を走る稲妻（命中点から枝分かれして、ふらつきながら広がる）
    const bolts = 8;
    for (let a = 0; a < bolts; a++) {
      const th = (a / bolts) * Math.PI * 2 + Math.random() * 0.6;
      const u = _u.copy(wd);
      const dir = _dir.copy(t1).multiplyScalar(Math.cos(th)).addScaledVector(t2, Math.sin(th));
      const steps = 12 + Math.floor(Math.random() * 8);
      for (let s = 0; s < steps; s++) {
        const st = 0.1 + Math.random() * 0.03;
        const cu = Math.cos(st), su = Math.sin(st);
        _nx.copy(u).multiplyScalar(cu).addScaledVector(dir, su);
        dir.multiplyScalar(cu).addScaledVector(u, -su).normalize();
        u.copy(_nx).normalize();
        // 進む向きを、面の上で、ふらっと曲げる
        const j = (Math.random() - 0.5) * 1.1;
        dir.applyAxisAngle(u, j).normalize();
        _p.set(kart.pos.x + u.x * R * 1.01, cy + u.y * R * 1.01, kart.pos.z + u.z * R * 1.01);
        _v.copy(kart.vel).multiplyScalar(0.85);
        this.fx.sparks.emit(_p, _v, _c.setHSL(0.52, 0.5, 0.9), { size: 0.26 * (1 - 0.5 * s / steps), life: 0.2 + 0.1 * Math.random(), drag: 1 });
      }
    }
    this.shockStart(kart, R * (1.8 + 0.4 * power), 0.4, '#a8ecff', 1.0);
    this.echoStart(0.5, 0.42, '#9aeaff');
  }

  private echoStart(grow: number, dur: number, color: string) {
    this.echoT = 0;
    this.echoGrow = grow;
    this.echoDur = dur;
    this.echoMat.uniforms.uColor.value.set(color);
    this.echo.visible = true;
  }

  // バリアが切れた：球がガラスのように砕けて、かけらが飛び散る
  private shieldBreak(kart: Kart, R: number, cy: number) {
    for (let i = 0; i < 130; i++) {
      randomOnSphere(_v);
      _p.set(kart.pos.x + _v.x * R, cy + _v.y * R, kart.pos.z + _v.z * R);
      _v.multiplyScalar(5 + Math.random() * 12).add(_w.set(kart.vel.x * 0.5, 2 + Math.random() * 4, kart.vel.z * 0.5));
      this.fx.sparks.emit(_p, _v, _c.setHSL(i % 4 === 0 ? 0.9 : 0.5 + Math.random() * 0.1, i % 5 === 0 ? 0.1 : 0.9, 0.78), { size: 0.3 + Math.random() * 0.45, life: 0.7 + Math.random() * 0.6, drag: 0.9, gravity: 14 });
    }
    this.shockStart(kart, R * 2.4, 0.4, '#d8f4ff', 1.2);
    this.echoStart(0.8, 0.4, '#d8f4ff');
  }

  // スターを使った瞬間：虹色の光がはじけ飛び、地面に大きな衝撃波が広がる（ぐんと巨大になる合図）
  private starPop(kart: Kart) {
    _p.set(kart.pos.x, kart.y + 1.6, kart.pos.z);
    for (let i = 0; i < 120; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.25) * 1.6;
      const sp = 9 + Math.random() * 24;
      _v.set(Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 3, Math.sin(a) * Math.cos(e) * sp);
      this.fx.sparks.emit(_p, _v, _c.setHSL(Math.random(), 1, 0.7), { size: 0.4 + Math.random() * 0.3, life: 0.8 + Math.random() * 0.6, drag: 1.6, gravity: 3 });
    }
    KartFX.burst(this.fx, _p, ['#ffffff', '#fff3b0'], 30, 22);
    // 地面の砂ぼこりの輪
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + Math.random() * 0.2;
      this.fx.dust.emit(_p.set(kart.pos.x, kart.groundY + 0.3, kart.pos.z), _v.set(Math.cos(a) * 11, 0.6 + Math.random() * 1.2, Math.sin(a) * 11), _c.set('#d9c8a4'), { size: 1.4, life: 0.9, grow: 2.4, drag: 2.4, gravity: -0.3 });
    }
    this.shockStart(kart, 17, 0.6, '#ffe9a0');
  }

  // 踏みつぶされた瞬間：ぺちゃっと、砂ぼこりとキラキラ（ぴよぴよの星は、止まっているあいだ頭の上を回る）
  private impact(kart: Kart) {
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + Math.random() * 0.2;
      const sp = 9 + Math.random() * 8;
      this.fx.dust.emit(_p.set(kart.pos.x, kart.groundY + 0.3, kart.pos.z), _v.set(Math.cos(a) * sp, 0.6 + Math.random() * 1.4, Math.sin(a) * sp), _c.set(i % 3 ? '#cdb996' : '#9a8a72'), { size: 1.7, life: 1.0, grow: 2.8, drag: 2.5, gravity: -0.3 });
    }
    _p.set(kart.pos.x, kart.groundY + 0.6, kart.pos.z);
    KartFX.burst(this.fx, _p, ['#fff3b0', '#ffffff', '#ffd23a'], 44, 13);
    this.shockStart(kart, 8, 0.38, '#fff3b0');
  }

  // 地面にぱっと広がる、光の輪（ミニターボの輪とは別）
  private shockStart(kart: Kart, radius: number, dur: number, color: string, intensity = 1.8) {
    this.shockT = 0;
    this.shockDur = dur;
    this.shockR = radius;
    this.shock.position.set(0, kart.groundY + 0.2, 0);
    (this.shock.material as THREE.MeshBasicMaterial).color.set(color).multiplyScalar(intensity);
    this.shock.visible = true;
  }
  private updateShock(dt: number) {
    if (!this.shock.visible) return;
    this.shockT += dt / this.shockDur;
    if (this.shockT >= 1) {
      this.shock.visible = false;
      return;
    }
    const u = 1 - Math.pow(1 - this.shockT, 3);
    this.shock.scale.setScalar(Math.max(0.01, this.shockR * u));
    (this.shock.material as THREE.MeshBasicMaterial).opacity = Math.pow(1 - this.shockT, 1.4);
  }

  // 止まっているあいだ、平らになったカートの上を、星がくるくる回る（ぴよぴよ）
  private updateDizzy(kart: Kart) {
    const on = kart.squashTime > 0.55 + 0.05;
    this.dizzy.forEach((s, i) => {
      s.visible = on;
      if (!on) return;
      const a = this.time * 5 + (i / this.dizzy.length) * Math.PI * 2;
      s.position.set(Math.cos(a) * 1.25, kart.y + 0.75 + Math.sin(a * 2 + i) * 0.12, Math.sin(a) * 1.25);
      s.scale.setScalar(0.55 + Math.abs(Math.sin(this.time * 10 + i)) * 0.3);
      s.material.rotation = this.time * 4 + i;
    });
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
const _w = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _u = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _nx = new THREE.Vector3();
const rand01 = Math.random;

// バリアの大きさ：中心の高さと、半径（カートの 1.0 倍のとき。巨大になると、それに合わせて大きくなる）
const SHIELD_R = 2.3;
const SHIELD_H = 1.25;

// 球の表面の、ランダムな向き（単位ベクトル）
function randomOnSphere(out: THREE.Vector3): THREE.Vector3 {
  const z = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return out.set(Math.cos(a) * r, z, Math.sin(a) * r);
}

// バリアの球：三角のパネル（測地線ドーム）。パネルごとの中心の向きと、辺からの距離（重心座標）を持たせる。全員で共有
let shieldGeo: THREE.BufferGeometry | null = null;
function shieldGeometry(): THREE.BufferGeometry {
  if (shieldGeo) return shieldGeo;
  const g = new THREE.IcosahedronGeometry(1, 5).toNonIndexed();
  const pos = g.getAttribute('position');
  const n = pos.count;
  const center = new Float32Array(n * 3);
  const bary = new Float32Array(n * 3);
  const c = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    c.set(0, 0, 0);
    for (let j = 0; j < 3; j++) c.x += pos.getX(i + j), c.y += pos.getY(i + j), c.z += pos.getZ(i + j);
    c.normalize();
    for (let j = 0; j < 3; j++) {
      center.set([c.x, c.y, c.z], (i + j) * 3);
      bary[(i + j) * 3 + j] = 1;
    }
  }
  g.setAttribute('aCenter', new THREE.BufferAttribute(center, 3));
  g.setAttribute('aBary', new THREE.BufferAttribute(bary, 3));
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  return (shieldGeo = g);
}

// 外へ広がって消える殻：ふちだけが光る
const ECHO_FRAG = /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor;
varying vec3 vN;
varying vec3 vV;
void main() {
  float ndv = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
  float f = pow(1.0 - ndv, 1.5);
  float side = gl_FrontFacing ? 1.0 : 0.6;
  gl_FragColor = vec4(uColor * f * 1.7 * uOpacity * side, f * 0.45 * uOpacity * side);
}`;

const SHIELD_VERT = /* glsl */ `
attribute vec3 aCenter;
attribute vec3 aBary;
uniform float uBreak;
varying vec3 vDir;
varying vec3 vCenter;
varying vec3 vBary;
varying vec3 vN;
varying vec3 vV;
void main() {
  vDir = normalize(position);
  vCenter = aCenter;
  vBary = aBary;
  vec3 pos = position;
  if (uBreak > 0.0) {
    // 砕ける：パネルがそれぞれ、くるくる回りながら外へ飛び、落ちていく
    float h = fract(sin(dot(aCenter, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float h2 = fract(h * 7.31 + 0.37);
    vec3 axis = normalize(cross(aCenter, vec3(0.3 + h2, 1.0, 0.2 - h)));
    float ang = uBreak * (h - 0.5) * 16.0;
    vec3 rel = position - aCenter;
    float c = cos(ang);
    float s = sin(ang);
    rel = rel * c + cross(axis, rel) * s + axis * dot(axis, rel) * (1.0 - c);
    pos = aCenter * (1.0 + uBreak * (0.3 + 1.7 * h)) + rel;
    pos.y -= uBreak * uBreak * (0.5 + 1.4 * h);
  }
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vN = normalize(normalMatrix * vDir);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

// ふち（フレネル）が強く光る、玉虫色の半透明の球。パネルの線、ちらつく光、命中点から広がる波紋
const SHIELD_FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uBoost;
uniform float uReveal;
uniform vec4 uRip[3];
varying vec3 vDir;
varying vec3 vCenter;
varying vec3 vBary;
varying vec3 vN;
varying vec3 vV;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.2);
  // 玉虫色（見る角度と高さで、色が移ろう）
  float hh = ndv * 1.1 + vDir.y * 0.4 + vDir.x * 0.15 + uTime * 0.1;
  vec3 film = 0.55 + 0.45 * cos(6.28318 * (hh + vec3(0.0, 0.33, 0.67)));
  vec3 tint = mix(vec3(0.16, 0.62, 1.0), film, 0.32);
  // パネルの縁
  float e = min(min(vBary.x, vBary.y), vBary.z);
  float line = 1.0 - smoothstep(0.0, max(fwidth(e) * 1.5, 0.04), e);
  // ちらつき・走査線
  float h0 = hash(vCenter * 37.0);
  float twinkle = pow(max(0.0, sin(uTime * 2.4 + h0 * 60.0)), 40.0);
  float scan = smoothstep(0.93, 1.0, sin(vDir.y * 5.5 - uTime * 1.7 + vDir.x * 1.5));
  // 命中点から広がる波紋（リング、パネルの点灯、命中点の閃き）
  float wave = 0.0;
  float hot = 0.0;
  float panel = 0.0;
  for (int i = 0; i < 3; i++) {
    float age = uRip[i].w;
    if (age >= 0.0) {
      float ang = acos(clamp(dot(vDir, uRip[i].xyz), -1.0, 1.0));
      float angC = acos(clamp(dot(vCenter, uRip[i].xyz), -1.0, 1.0));
      float fall = exp(-age * 1.7);
      float front = age * 3.6;
      float d1 = (ang - front) * 6.5;
      float d2 = (angC - front) * 4.5;
      wave += exp(-d1 * d1) * fall;
      panel += exp(-d2 * d2) * fall;
      hot += exp(-ang * ang * 28.0) * exp(-age * 8.0);
    }
  }
  float rim = 0.16 + 1.1 * fres;
  vec3 col = tint * rim;
  col += tint * line * (0.5 + 0.7 * fres + 2.6 * panel + 1.8 * wave);
  col += tint * panel * 0.8;
  col += vec3(1.0) * (wave * 0.8 + hot * 1.5);
  col += mix(tint, vec3(1.0), 0.5) * (twinkle * 0.45 + scan * 0.4 * (0.4 + fres));
  col *= 1.0 + uBoost * 0.55;
  col += tint * uBoost * 0.08;
  col += vec3(uReveal);
  float a = 0.11 + 0.4 * fres + 0.2 * (panel + wave) + 0.25 * hot + 0.3 * line * (0.4 + panel + wave);
  a = clamp(a + uReveal * 0.4, 0.0, 0.9);
  float side = gl_FrontFacing ? 1.0 : 0.65;
  col *= side * uOpacity;
  a *= side * uOpacity;
  gl_FragColor = vec4(col, a);
}`;

const WIND = new THREE.Color('#f4fbff');
const WHITE = new THREE.Color('#ffffff');
const SPARKLE = ['#fff6b0', '#ffffff', '#ffc2dd', '#bfe6ff', '#ffe08a', '#e6ccff'];

// ふんわり広がる丸い光（スターのまわりのにじみ）
function glowTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.14)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

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
