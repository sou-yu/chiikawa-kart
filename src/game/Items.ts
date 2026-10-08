import { glassBoxTexture } from '../track/candy/textures';
import * as THREE from 'three';
import { itemBoxTexture } from '../core/textures';
import { BLAST_RADIUS, ExplosionFX, flashTexture } from '../fx/Explosion';
import { KartFX } from '../fx/KartFX';
import type { FXSystems } from '../fx/Particles';
import type { Track } from '../track/Track';
import { STAR_TIME } from './Kart';
import type { Racer } from './Racer';

export type ItemId = 'ramen' | 'missile' | 'bomb' | 'star' | 'barrier';

export const ITEMS: Record<ItemId, { icon: string; name: string }> = {
  ramen: { icon: '🍜', name: 'ラーメン' }, // ダッシュ
  missile: { icon: '🚀', name: '追尾ミサイル' }, // ロケットランチャーで撃つ。ひとつ前のライバルを追いかけて、的中してスピンさせる
  bomb: { icon: '💣', name: 'ばくだん' }, // うしろに落とす。すこしあとで爆発して、まわりのライバルをスピンさせる
  star: { icon: '⭐', name: '討伐の星' }, // 輝きながら巨大になる。ぶつかったライバルを踏みつぶし、爆弾もミサイルも効かない
  barrier: { icon: '🛡️', name: '絶対バリア' }, // 半透明の球のバリアで、どんな攻撃も無効に。コース 1 周ぶん続く
};
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

// 順位が後ろほど強いアイテム（ラバーバンディング）
const TABLE: [number, Record<ItemId, number>][] = [
  [0.0, { bomb: 0.45, missile: 0.25, ramen: 0.3, star: 0, barrier: 0.12 }],
  [0.5, { bomb: 0.2, missile: 0.35, ramen: 0.35, star: 0.1, barrier: 0.14 }],
  [1.0, { bomb: 0.05, missile: 0.3, ramen: 0.4, star: 0.25, barrier: 0.16 }],
];

function rollItem(placeRatio: number, leading: boolean): ItemId {
  let row = TABLE[0][1];
  for (const [r, w] of TABLE) if (placeRatio >= r - 0.01) row = w;
  // 1 位は、ねらう「ひとつ前」がいないので、ミサイルは出さない
  const w = (id: ItemId) => (leading && id === 'missile' ? 0 : row[id]);
  let x = Math.random() * ITEM_IDS.reduce((s, id) => s + w(id), 0);
  for (const id of ITEM_IDS) {
    x -= w(id);
    if (x <= 0) return id;
  }
  return 'ramen';
}

const ROULETTE_TIME = 1.1;
const COIN_RESPAWN = 8;
const BOX_RESPAWN = 2.5;
const BARRIER_LAPS = 1; // バリアが続く長さ（コース何周ぶん走るまで）
const MISSILE_SPEED = 88; // ミサイルの速さ（m/s）。カートの 3 倍ほど
const MISSILE_LIFE = 10; // 追いつけなくても、この秒数で爆発する
const MISSILE_BLANK = 2.2; // 的がないとき（1 位が撃ったとき）に、前方の空ではじけるまで
const MISSILE_RADIUS = 15; // ミサイルの衝撃波の広さ（見た目）
const BOMB_FUSE = 1.0; // ばくだんを落としてから、爆発するまで（秒）。そのあいだに、使った人は遠くへ走り去る
const BOMB_WARN = 0.6; // 爆発の前に、爆風の範囲を赤く光らせる時間
const BOMB_R = 0.5; // ばくだんの玉の半径

interface Box {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  respawn: number;
}
interface Coin {
  pos: THREE.Vector3;
  respawn: number;
}
// 追尾ミサイル：コースの上を、ひとつ前のライバルへ向かって、ぐんぐん追いかける（コースにそって飛ぶので、カーブでも曲がる）
interface Missile {
  mesh: THREE.Group;
  flame: THREE.Mesh;
  glow: THREE.Sprite;
  owner: Racer;
  target: Racer | null; // 1 位が撃ったときは、いない（まっすぐ飛んで、空で爆発する）
  mp: number; // コースの上の進み具合（周回 + t）
  lateral: number;
  speed: number;
  age: number;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  offset: THREE.Vector3; // 発射口から、コースの上の線へ、なめらかにうつるためのずれ
  projIndex: number;
  trail: number; // 煙のしっぽを、ちぎれないように出す端数
  // バリアにはじかれたあとは、コースをはなれて、くるくる回りながら飛んで、空で爆発する
  ballistic: boolean;
  vel: THREE.Vector3;
  deflector: Racer | null;
  deflectT: number;
}
// ロケットランチャー（撃つ人の肩に、出る）
interface Launcher {
  mesh: THREE.Group;
  tube: THREE.Group;
  muzzle: THREE.Sprite;
  back: THREE.Sprite;
  warhead: THREE.Mesh;
  owner: Racer;
  age: number;
}
interface Bomb {
  mesh: THREE.Group;
  body: THREE.Mesh;
  glow: THREE.MeshStandardMaterial;
  spark: THREE.Sprite;
  warn: THREE.Group; // 爆風の範囲を示す、赤いわっか（地面に）
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  owner: Racer;
  fuse: number; // 残り時間
  age: number;
  projIndex: number;
  landed: boolean;
}
// 演出のきっかけ（画面のゆれ・音・バックミラーなど）に、main が読む
export interface BlastEvent {
  kind: 'bomb' | 'missile';
  pos: THREE.Vector3;
  owner: Racer;
  victims: Racer[];
  blocked: Racer[]; // スターで、爆風を無効にしたカート
  shielded: Racer[]; // バリアで、はじき返したカート
}
export interface DropEvent {
  pos: THREE.Vector3;
  owner: Racer;
}
export interface LaunchEvent {
  pos: THREE.Vector3;
  owner: Racer;
  target: Racer | null;
  eta: number; // 的中までの目安（秒）
}

const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();

export class ItemSystem {
  readonly group = new THREE.Group();
  private boxes: Box[] = [];
  private coins: Coin[] = [];
  private coinMesh: THREE.InstancedMesh;
  private missiles: Missile[] = [];
  private launchers: Launcher[] = [];
  private bombs: Bomb[] = [];
  private explosions: ExplosionFX;
  private time = 0;
  private aiHold = new Map<Racer, number>();

  // ばくだん・ミサイルの出来事（回数が増えたら、lastDrop / lastLaunch / lastBlast を読む）
  dropCount = 0;
  launchCount = 0;
  blastCount = 0;
  starCount = 0; // スターを使った回数
  lastStar: { owner: Racer } | null = null;
  barrierCount = 0; // バリアをはった回数
  lastBarrier: { owner: Racer } | null = null;
  lastDrop: DropEvent | null = null;
  lastLaunch: LaunchEvent | null = null;
  lastBlast: BlastEvent | null = null;

  constructor(private track: Track, private fx: FXSystems) {
    this.explosions = new ExplosionFX(this.group, fx);
    // ？ボックス
    const candy = track.def.theme === 'candy' || track.def.theme === 'sunset'; // 水色に光るガラスの箱
    // お菓子のコースは、透明なガラスの箱に青い「？」
    const boxMat = new THREE.MeshBasicMaterial({ map: candy ? glassBoxTexture() : itemBoxTexture(), transparent: true, opacity: candy ? 1 : 0.88, depthWrite: false });
    const boxGeo = new THREE.BoxGeometry(1.3, 1.3, 1.3);
    for (const t of track.def.itemBoxes) {
      for (const lat of [-5, -1.7, 1.7, 5]) {
        const mesh = new THREE.Mesh(boxGeo, boxMat);
        const pos = track.place(t, lat).setY(1.1);
        mesh.position.copy(pos);
        this.group.add(mesh);
        this.boxes.push({ mesh, pos, respawn: 0 });
      }
    }
    // コイン
    for (const c of track.def.coins) {
      for (let i = 0; i < c.count; i++) {
        this.coins.push({ pos: track.place(c.t + (i * 3) / track.length, c.lateral).setY(0.9), respawn: 0 });
      }
    }
    const coinGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 20).rotateX(Math.PI / 2);
    this.coinMesh = new THREE.InstancedMesh(
      coinGeo,
      // レインボーロードは夜の紫が映り込んで茶色っぽくなるので、自分で光る金色にする
      track.def.theme === 'rainbow'
        ? new THREE.MeshStandardMaterial({ color: '#ffd23a', metalness: 0.5, roughness: 0.3, emissive: '#e0a010', emissiveIntensity: 0.7 })
        : new THREE.MeshStandardMaterial({ color: '#ffc928', metalness: 0.6, roughness: 0.3, emissive: '#6b4a00' }),
      this.coins.length,
    );
    this.group.add(this.coinMesh);
  }

  update(dt: number, racers: Racer[], active: boolean) {
    this.time += dt;
    this.updateBoxes(dt, racers, active);
    this.updateCoins(dt, racers);
    this.updateLaunchers(dt);
    this.updateMissiles(dt, racers);
    this.updateBombs(dt, racers);
    this.explosions.update(dt);
    for (const r of racers) {
      if (r.roulette > 0) {
        r.roulette -= dt;
        if (r.roulette <= 0) r.item = r.pendingItem;
      }
      if (!r.isPlayer || r.finished) this.aiUse(dt, r, racers);
    }
  }

  private updateBoxes(dt: number, racers: Racer[], active: boolean) {
    const bob = Math.sin(this.time * 2.5) * 0.15;
    for (const b of this.boxes) {
      if (b.respawn > 0) {
        b.respawn -= dt;
        b.mesh.visible = b.respawn <= 0;
        if (b.mesh.visible) b.mesh.scale.setScalar(0.2);
        continue;
      }
      b.mesh.scale.setScalar(Math.min(1, b.mesh.scale.x + dt * 3));
      b.mesh.rotation.set(this.time * 0.9, this.time * 1.3, 0);
      b.mesh.position.y = b.pos.y + bob;
      if (!active) continue;
      for (const r of racers) {
        const k = r.kart;
        if (Math.abs(k.pos.x - b.pos.x) < 1.7 && Math.abs(k.pos.z - b.pos.z) < 1.7 && k.y < 2.5) {
          b.respawn = BOX_RESPAWN;
          b.mesh.visible = false;
          KartFX.burst(this.fx, b.mesh.position, ['#ff9bd2', '#ffe082', '#86d6ff', '#c7a2ff', '#ffffff'], 26, 8);
          if (!r.item && r.roulette <= 0) {
            r.pendingItem = rollItem((r.place - 1) / Math.max(1, racers.length - 1), r.place <= 1);
            r.roulette = ROULETTE_TIME;
          }
          break;
        }
      }
    }
  }

  private updateCoins(dt: number, racers: Racer[]) {
    this.coins.forEach((c, i) => {
      if (c.respawn > 0) c.respawn -= dt;
      const show = c.respawn <= 0;
      if (show) {
        for (const r of racers) {
          if (r.kart.pos.distanceToSquared(c.pos) < 2.6 && r.kart.y < 2) {
            c.respawn = COIN_RESPAWN;
            r.addCoins(1);
            KartFX.burst(this.fx, c.pos, ['#ffe26b', '#fff6c2'], 10, 4);
            break;
          }
        }
      }
      _q.setFromEuler(_e.set(0, this.time * 3 + i * 0.4, 0));
      _m.compose(c.pos, _q, _s.setScalar(c.respawn > 0 ? 0 : 1));
      this.coinMesh.setMatrixAt(i, _m);
    });
    this.coinMesh.instanceMatrix.needsUpdate = true;
  }

  // アイテムを使う
  use(r: Racer, racers: Racer[]) {
    const id = r.item;
    if (!id) return;
    r.item = null;
    const k = r.kart;
    const fwd = new THREE.Vector3(Math.sin(k.heading), 0, Math.cos(k.heading));
    switch (id) {
      case 'ramen':
        k.addBoost(1.5);
        KartFX.burst(this.fx, _p.copy(k.pos).setY(k.y + 1), ['#ffcf6b', '#ffffff', '#ff9a3c'], 20, 6);
        break;
      case 'star':
        // スター：キラキラ輝きながら巨大になる（巨大なあいだは無敵。ぶつかったライバルを踏みつぶす）
        k.starTime = k.starMax = STAR_TIME;
        k.starBurst++;
        k.addBoost(0.1);
        this.starCount++;
        this.lastStar = { owner: r };
        break;
      case 'barrier':
        // 絶対バリア：半透明の球で、まわりを包む（コース 1 周）
        r.activateBarrier(BARRIER_LAPS);
        this.barrierCount++;
        this.lastBarrier = { owner: r };
        break;
      case 'missile': {
        // 的は、ひとつ前の順位のライバル（1 位のときは、的がなく、まっすぐ飛ぶ）
        const target = r.place > 1 ? (racers.find((o) => o.place === r.place - 1) ?? null) : null;
        this.fireMissile(r, target);
        break;
      }
      case 'bomb': {
        // うしろへ、ぽいっと落とす。使った人は、爆発までに走り去る（爆風にも、使った人は巻き込まれない）
        const made = bombMesh();
        const pos = k.pos.clone().addScaledVector(fwd, -2.4).setY(k.y + 0.9);
        const vel = fwd.clone().multiplyScalar(Math.max(k.forwardSpeed, 0) * 0.3 - 5);
        vel.y = 4;
        made.mesh.position.copy(pos);
        const warn = warnMesh();
        warn.visible = false;
        this.group.add(made.mesh, warn);
        this.bombs.push({ ...made, warn, pos, vel, owner: r, fuse: BOMB_FUSE, age: 0, projIndex: k.proj.index, landed: false });
        this.dropCount++;
        this.lastDrop = { pos: pos.clone(), owner: r };
        break;
      }
    }
    void racers;
  }

  // ---------- 追尾ミサイル（ロケットランチャー）----------
  // ランチャーを肩に出して撃つ。ミサイルは、コースにそって的を追いかけ、かならず的中する
  private fireMissile(r: Racer, target: Racer | null) {
    const k = r.kart;
    const L = this.track.length;
    const fx = Math.sin(k.heading), fz = Math.cos(k.heading);
    const lm = launcherMesh();
    r.visual.add(lm.mesh);
    r.obj.updateMatrixWorld(true);
    const muzzle = lm.mesh.localToWorld(new THREE.Vector3(0, 0, 1.45));
    const made = missileMesh();
    made.mesh.position.copy(muzzle);
    made.mesh.quaternion.setFromUnitVectors(_zAxis, new THREE.Vector3(fx, 0.12, fz).normalize());
    this.group.add(made.mesh);
    const gap = target ? Math.max(0, (target.progress - r.progress) * L) : 0;
    this.missiles.push({
      ...made,
      owner: r,
      target,
      mp: r.progress,
      lateral: k.proj.lateral,
      speed: Math.max(24, k.forwardSpeed),
      age: 0,
      pos: muzzle.clone(),
      dir: new THREE.Vector3(fx, 0.1, fz).normalize(),
      offset: new THREE.Vector3(),
      projIndex: k.proj.index,
      trail: 0,
      ballistic: false,
      vel: new THREE.Vector3(),
      deflector: null,
      deflectT: 0,
    });
    this.launchers.push({ ...lm, owner: r, age: 0 });

    // 発射の瞬間：銃口の火と、うしろへ噴き出す爆風（ロケットランチャーの、バックブラスト）
    const back = new THREE.Vector3(-fx, 0, -fz);
    const rear = lm.mesh.localToWorld(new THREE.Vector3(0, 0, -1.2));
    for (let i = 0; i < 34; i++) {
      const v = back.clone().multiplyScalar(14 + Math.random() * 18).add(new THREE.Vector3((Math.random() - 0.5) * 9, Math.random() * 5, (Math.random() - 0.5) * 9));
      this.fx.sparks.emit(rear, v, _sparkCols[i % 2], { size: 0.45, life: 0.35 + Math.random() * 0.3, gravity: 6, drag: 1.4 });
    }
    for (let i = 0; i < 16; i++) {
      const v = back.clone().multiplyScalar(5 + Math.random() * 9).add(new THREE.Vector3((Math.random() - 0.5) * 4, 0.5 + Math.random() * 2.5, (Math.random() - 0.5) * 4));
      this.fx.dust.emit(rear, v, _colorSmoke.clone().lerp(new THREE.Color('#e9e4dc'), 0.5 + Math.random() * 0.4), { size: 1.6 + Math.random() * 1.2, life: 1.1 + Math.random() * 0.6, grow: 3.6, drag: 1.6 });
    }
    for (let i = 0; i < 22; i++) {
      const v = new THREE.Vector3(fx, 0.15, fz).multiplyScalar(10 + Math.random() * 22).add(new THREE.Vector3((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 7));
      this.fx.sparks.emit(muzzle, v, _sparkCols[i % 2], { size: 0.42, life: 0.3 + Math.random() * 0.25, gravity: 3, drag: 1.6 });
    }
    this.launchCount++;
    this.lastLaunch = { pos: muzzle.clone(), owner: r, target, eta: target ? gap / Math.max(20, MISSILE_SPEED - 30) + 0.4 : MISSILE_BLANK };
  }

  // ランチャーの出し入れ・反動・銃口の火
  private updateLaunchers(dt: number) {
    for (const l of [...this.launchers]) {
      l.age += dt;
      const a = l.age;
      // ぽんっと出て（少しふくらんでから戻る）、しばらく構えて、すっと引っこむ
      const pop = a < 0.14 ? (a / 0.14) * 1.15 : 1 + 0.15 * Math.exp(-(a - 0.14) * 14);
      const out = a > 0.85 ? Math.max(0, 1 - (a - 0.85) / 0.25) : 1;
      l.mesh.scale.setScalar(Math.max(0.001, pop * out));
      // 反動：発射のとたんに、うしろへ下がって、もどる
      l.tube.position.z = -0.34 * Math.exp(-a * 11);
      l.tube.rotation.x = -0.1 * Math.exp(-a * 9);
      l.warhead.visible = false;
      const mf = a < 0.22;
      l.muzzle.visible = mf;
      if (mf) {
        const u = a / 0.22;
        l.muzzle.scale.setScalar(1.2 + 3.2 * (1 - (1 - u) * (1 - u)));
        (l.muzzle.material as THREE.SpriteMaterial).color.setScalar(3 * (1 - u));
      }
      const bf = a < 0.32;
      l.back.visible = bf;
      if (bf) {
        const u = a / 0.32;
        l.back.scale.setScalar(1.4 + 4.2 * u);
        (l.back.material as THREE.SpriteMaterial).color.setScalar(2.4 * (1 - u));
      }
      if (a > 1.12) {
        l.mesh.removeFromParent();
        l.mesh.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.geometry.dispose();
            (m.material as THREE.Material).dispose();
          } else if ((o as THREE.Sprite).isSprite) (o as THREE.Sprite).material.dispose();
        });
        this.launchers.splice(this.launchers.indexOf(l), 1);
      }
    }
  }

  private updateMissiles(dt: number, racers: Racer[]) {
    if (!this.missiles.length) return;
    const L = this.track.length;
    const proj = { t: 0, index: 0, lateral: 0, point: new THREE.Vector3(), tangent: new THREE.Vector3(), normal: new THREE.Vector3() };
    const next = new THREE.Vector3();
    for (const m of [...this.missiles]) {
      m.age += dt;
      if (m.ballistic) {
        this.updateDeflected(m, dt, racers);
        continue;
      }
      const tk = m.target?.kart ?? null;
      // 速さ：発射のあと、ぐんと加速。遠い的には、さらに速く
      const gap0 = m.target ? (m.target.progress - m.mp) * L : 999;
      const vmax = MISSILE_SPEED * (gap0 > 220 ? 1.3 : 1);
      m.speed += (vmax - m.speed) * (1 - Math.exp(-3.5 * dt));
      m.mp += (m.speed * dt) / L;
      let hit = m.age > MISSILE_LIFE;
      if (tk) {
        m.lateral += (tk.proj.lateral - m.lateral) * (1 - Math.exp(-3.5 * dt)); // 的の横ずれへ寄っていく
        const gapNow = (m.target!.progress - m.mp) * L;
        if (tk.barrier) {
          // 絶対バリアの球に届いたら、はじき返される
          if (gapNow <= 3.8 && m.age > 0.1) {
            this.deflectMissile(m);
            continue;
          }
        } else if (gapNow <= 2 && m.age > 0.25) hit = true;
      } else if (m.age > MISSILE_BLANK) hit = true; // 的がないときは、前方の空で、はじける
      // コースの上の位置（高さは、地面から少し上。的に近づいたら、的の高さへ）
      this.track.place(((m.mp % 1) + 1) % 1, m.lateral, next);
      this.track.project(next, proj, m.projIndex);
      m.projIndex = proj.index;
      let y = this.track.groundAt(proj).h + 1.3;
      if (tk) {
        const w = THREE.MathUtils.clamp(1 - ((m.target!.progress - m.mp) * L) / 28, 0, 1);
        y = THREE.MathUtils.lerp(y, tk.y + 0.9, w);
      }
      next.y = y;
      if (m.age <= dt + 1e-6) m.offset.subVectors(m.pos, next); // 発射口 → コースの線
      const s = THREE.MathUtils.smoothstep(m.age, 0, 0.32);
      next.addScaledVector(m.offset, 1 - s);
      // 向きは、進む向きへ、なめらかに
      _d.subVectors(next, m.pos);
      const dist = _d.length();
      if (dist > 1e-4) {
        _d.multiplyScalar(1 / dist);
        m.dir.lerp(_d, 1 - Math.exp(-16 * dt)).normalize();
      }
      // 煙のしっぽ（動いたぶんを、すき間なく埋める）と、火花
      m.trail += dist / 1.1;
      const puffs = Math.min(6, Math.floor(m.trail));
      m.trail -= puffs;
      for (let i = 0; i < puffs; i++) {
        _p.lerpVectors(m.pos, next, (i + 1) / (puffs + 1)).addScaledVector(m.dir, -1.1);
        this.fx.dust.emit(_p, _v.set((Math.random() - 0.5) * 1.2, (Math.random() - 0.3) * 1.4, (Math.random() - 0.5) * 1.2), _trailSmoke, { size: 1.15, life: 1.5, grow: 3.4, drag: 0.9 });
        if (i % 2 === 0) this.fx.sparks.emit(_p, _v.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3), _sparkCols[i % 4 < 2 ? 0 : 1], { size: 0.5, life: 0.3, drag: 2 });
      }
      m.pos.copy(next);
      m.mesh.position.copy(next);
      _q.setFromUnitVectors(_zAxis, m.dir);
      m.mesh.quaternion.slerp(_q, 1 - Math.exp(-20 * dt));
      m.flame.scale.set(1, 1, 1.1 + Math.random() * 0.9);
      m.glow.scale.setScalar(1.7 + Math.random() * 0.7);

      if (hit) this.explodeMissile(m, racers);
    }
  }

  // バリアに当たった：球の面ではね返って、コースをはなれ、くるくる回りながら飛んでいく
  private deflectMissile(m: Missile) {
    const t = m.target!;
    const k = t.kart;
    const center = _p.set(k.pos.x, k.y + 1.1 * k.giantScale, k.pos.z);
    const n = new THREE.Vector3().subVectors(m.pos, center);
    if (n.lengthSq() < 1e-4) n.copy(m.dir).negate();
    n.normalize();
    t.repel(m.pos, 1.4);
    // 入ってきた向きを、球の面で反射して、外へ弾き出す
    const v = m.dir.clone().multiplyScalar(m.speed);
    v.addScaledVector(n, -2 * v.dot(n)).multiplyScalar(0.3);
    v.addScaledVector(n, 6);
    // まっすぐ戻らず、横へそれて、高く跳ね上がる（カメラからも見える）
    const side = _s.set(-m.dir.z, 0, m.dir.x).normalize().multiplyScalar((Math.random() < 0.5 ? -1 : 1) * (13 + Math.random() * 5));
    v.add(side);
    v.y += 12 + Math.random() * 3;
    m.vel.copy(v);
    m.ballistic = true;
    m.deflector = t;
    m.target = null;
    m.deflectT = 0;
  }

  private updateDeflected(m: Missile, dt: number, racers: Racer[]) {
    m.deflectT += dt;
    m.vel.y -= 20 * dt;
    _d.copy(m.pos);
    m.pos.addScaledVector(m.vel, dt);
    // 煙のしっぽ（はじかれても、火は噴いたまま）
    const dist = _d.distanceTo(m.pos);
    m.trail += dist / 0.9;
    const puffs = Math.min(5, Math.floor(m.trail));
    m.trail -= puffs;
    for (let i = 0; i < puffs; i++) {
      _p.lerpVectors(_d, m.pos, (i + 1) / (puffs + 1));
      this.fx.dust.emit(_p, _v.set((Math.random() - 0.5) * 1.5, Math.random() * 1.2, (Math.random() - 0.5) * 1.5), _trailSmoke, { size: 1.1, life: 1.2, grow: 3, drag: 0.9 });
      this.fx.sparks.emit(_p, _v.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4), _sparkCols[i % 2], { size: 0.5, life: 0.3, drag: 2 });
    }
    m.mesh.position.copy(m.pos);
    const sp = m.vel.length();
    if (sp > 0.1) {
      m.dir.lerp(_d.copy(m.vel).multiplyScalar(1 / sp), 1 - Math.exp(-9 * dt)).normalize();
      m.mesh.quaternion.setFromUnitVectors(_zAxis, m.dir);
      m.mesh.rotateZ(m.deflectT * 16); // くるくる回る
    }
    m.flame.scale.set(1, 1, 1.1 + Math.random() * 0.9);
    m.glow.scale.setScalar(1.5 + Math.random() * 0.6);
    const proj = { t: 0, index: 0, lateral: 0, point: new THREE.Vector3(), tangent: new THREE.Vector3(), normal: new THREE.Vector3() };
    this.track.project(m.pos, proj, m.projIndex);
    m.projIndex = proj.index;
    if (m.pos.y < this.track.groundAt(proj).h + 0.4 || m.deflectT > 1.15) this.explodeMissile(m, racers);
  }

  private explodeMissile(m: Missile, racers: Racer[]) {
    const tk = m.target?.kart ?? null;
    const at = tk ? _p.set(tk.pos.x, tk.y, tk.pos.z) : _p.copy(m.pos);
    const ground = tk ? tk.y : this.track.groundAt(this.track.project(m.pos, { t: 0, index: 0, lateral: 0, point: new THREE.Vector3(), tangent: new THREE.Vector3(), normal: new THREE.Vector3() }, m.projIndex)).h;
    const origin = new THREE.Vector3(at.x, tk ? ground : m.deflector ? Math.max(ground, m.pos.y - 0.6) : m.pos.y - 1.3, at.z);
    // バリアではじかれたミサイルは、少し小さな爆発で、空しく散る
    this.explosions.spawn(origin, m.deflector ? MISSILE_RADIUS * 0.7 : MISSILE_RADIUS, m.deflector ? 0.48 : 0.62);
    const victims: Racer[] = [];
    const blocked: Racer[] = [];
    const shielded: Racer[] = m.deflector ? [m.deflector] : [];
    if (m.target && m.target.kart.barrier) {
      // 爆発の瞬間にバリアがあったとき（まれ）も、はじき返す
      m.target.repel(m.pos, 1.3);
      shielded.push(m.target);
    } else if (m.target && m.target.kart.starTime > 0) {
      // スターのカートには、ミサイルも効かない（光のバリアに、はじかれる）
      this.shieldFlash(m.target);
      blocked.push(m.target);
    } else if (m.target && m.target.blast(m.pos, 1.05)) {
      victims.push(m.target);
      _p.set(origin.x, origin.y + 0.9, origin.z);
      KartFX.burst(this.fx, _p, ['#ffb23c', '#ff7a1a', '#fff2b0', '#ffffff'], 44, 15);
      for (let i = 0; i < 10; i++) {
        this.fx.dust.emit(_p, _v.set((Math.random() - 0.5) * 6, 4 + Math.random() * 5, (Math.random() - 0.5) * 6), _colorSmoke.clone().multiplyScalar(0.7), { size: 2.4, life: 1.6, grow: 3.2, drag: 0.9, gravity: -1 });
      }
    }
    this.blastCount++;
    this.lastBlast = { kind: 'missile', pos: origin, owner: m.owner, victims, blocked, shielded };
    m.mesh.removeFromParent();
    m.mesh.traverse((o) => {
      const mm = o as THREE.Mesh;
      if (mm.isMesh) {
        mm.geometry.dispose();
        (mm.material as THREE.Material).dispose();
      } else if ((o as THREE.Sprite).isSprite) (o as THREE.Sprite).material.dispose();
    });
    this.missiles.splice(this.missiles.indexOf(m), 1);
    void racers;
  }

  // ---------- ばくだん ----------
  private updateBombs(dt: number, racers: Racer[]) {
    if (!this.bombs.length) return;
    const proj = { t: 0, index: 0, lateral: 0, point: new THREE.Vector3(), tangent: new THREE.Vector3(), normal: new THREE.Vector3() };
    for (const b of [...this.bombs]) {
      b.age += dt;
      b.fuse -= dt;
      // 落ちて、地面ではねて、止まる
      if (!b.landed) b.vel.y -= 26 * dt;
      b.pos.addScaledVector(b.vel, dt);
      this.track.project(b.pos, proj, b.projIndex);
      b.projIndex = proj.index;
      const ground = this.track.groundAt(proj).h;
      if (b.pos.y <= ground + BOMB_R) {
        b.pos.y = ground + BOMB_R;
        if (b.vel.y < -2.5) {
          b.vel.y *= -0.32;
          b.vel.x *= 0.6;
          b.vel.z *= 0.6;
        } else {
          b.vel.y = 0;
          b.landed = true;
        }
      }
      if (b.landed) {
        const f = Math.exp(-6 * dt);
        b.vel.x *= f;
        b.vel.z *= f;
      }
      b.mesh.position.copy(b.pos);
      // ころころ転がる（いきおいが弱まると止まる）
      b.body.rotation.x += (b.vel.z * 0.9 + 0.2) * dt;
      b.body.rotation.z -= b.vel.x * 0.9 * dt;

      // 導火線の火花・煙
      const tipX = b.pos.x + 0.22, tipY = b.pos.y + 0.46, tipZ = b.pos.z;
      for (let i = 0; i < 2; i++) {
        _v.set((Math.random() - 0.5) * 5, 2 + Math.random() * 5, (Math.random() - 0.5) * 5);
        this.fx.sparks.emit(_p.set(tipX, tipY, tipZ), _v, _colorSpark(i), { size: 0.26, life: 0.3 + Math.random() * 0.2, gravity: 9, drag: 1.2 });
      }
      if (Math.random() < 0.35) {
        this.fx.dust.emit(_p.set(tipX, tipY, tipZ), _v.set((Math.random() - 0.5) * 0.8, 1.4, (Math.random() - 0.5) * 0.8), _colorSmoke, { size: 0.55, life: 0.8, grow: 3, drag: 1 });
      }
      b.spark.scale.setScalar(0.55 + Math.random() * 0.35);

      // 爆発が近づくと、赤く点滅（だんだん速く）して、爆風の範囲が光る
      const warn = b.fuse < BOMB_WARN;
      const blink = warn ? 0.5 + 0.5 * Math.sin(b.age * (22 + (BOMB_WARN - b.fuse) * 40)) : 0.12 + 0.1 * Math.sin(b.age * 8);
      b.glow.emissiveIntensity = (warn ? 1.6 : 0.5) * blink;
      b.warn.visible = warn;
      if (warn) {
        const u = 1 - b.fuse / BOMB_WARN; // 0 → 1
        b.warn.position.set(b.pos.x, ground + 0.1, b.pos.z);
        const ring = b.warn.children[0] as THREE.Mesh;
        const disc = b.warn.children[1] as THREE.Mesh;
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.45 * blink;
        (disc.material as THREE.MeshBasicMaterial).opacity = 0.05 + 0.13 * u * blink;
        // 範囲がぐっと縮んで、またもどる脈（危ない合図）
        b.warn.scale.setScalar(1 - 0.04 * Math.sin(u * 28));
      }

      if (b.fuse <= 0) this.explode(b, racers);
    }
  }

  private explode(b: Bomb, racers: Racer[]) {
    const ground = b.pos.y - BOMB_R;
    const origin = new THREE.Vector3(b.pos.x, ground, b.pos.z);
    this.explosions.spawn(origin, BLAST_RADIUS);
    // 爆風：使った人以外で、範囲の中にいるライバルを、高く吹き飛ばしてスピンさせる（近いほど強い）
    const victims: Racer[] = [];
    const blocked: Racer[] = [];
    const shielded: Racer[] = [];
    for (const r of racers) {
      if (r === b.owner) continue;
      const k = r.kart;
      const d = Math.hypot(k.pos.x - origin.x, k.pos.z - origin.z);
      if (d > BLAST_RADIUS || Math.abs(k.y - ground) > 8) continue;
      if (k.barrier) {
        // 絶対バリア：爆風を、球ではじき返す（光の波が、爆心側から走る）
        r.repel(origin, 1.6 - 0.9 * (d / BLAST_RADIUS));
        shielded.push(r);
        continue;
      }
      if (k.starTime > 0) {
        this.shieldFlash(r);
        blocked.push(r);
        continue;
      }
      if (r.blast(origin, 1 - 0.45 * (d / BLAST_RADIUS))) {
        victims.push(r);
        // 吹き飛ぶカートから、火の粉と黒い煙
        _p.set(k.pos.x, k.y + 0.8, k.pos.z);
        KartFX.burst(this.fx, _p, ['#ffb23c', '#ff7a1a', '#fff2b0', '#ffffff'], 40, 14);
        for (let i = 0; i < 10; i++) {
          this.fx.dust.emit(_p, _v.set((Math.random() - 0.5) * 6, 4 + Math.random() * 5, (Math.random() - 0.5) * 6), _colorSmoke.clone().multiplyScalar(0.7), { size: 2.4, life: 1.6, grow: 3.2, drag: 0.9, gravity: -1 });
        }
      }
    }
    this.blastCount++;
    this.lastBlast = { kind: 'bomb', pos: origin, owner: b.owner, victims, blocked, shielded };
    this.group.remove(b.mesh, b.warn);
    // 使い終わった形と材質を、片づける（絵のテクスチャは、ほかの演出と共有なので残す）
    for (const root of [b.mesh, b.warn]) {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        } else if ((o as THREE.Sprite).isSprite) (o as THREE.Sprite).material.dispose();
      });
    }
    this.bombs.splice(this.bombs.indexOf(b), 1);
  }

  // スターが、爆風を無効にした：金と虹のキラキラが、バリアのようにはじける
  private shieldFlash(r: Racer) {
    const k = r.kart;
    const s = k.giantScale;
    _p.set(k.pos.x, k.y + 1.4 * s, k.pos.z);
    KartFX.burst(this.fx, _p, ['#ffe27a', '#ffffff', '#9be3ff', '#ffb0e6', '#b6ffb0'], 56, 16 * Math.sqrt(s));
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      this.fx.sparks.emit(_p, _v.set(Math.cos(a) * 14 * s, 3, Math.sin(a) * 14 * s), _shield.setHSL(i / 26, 1, 0.7), { size: 0.5 * Math.sqrt(s), life: 0.5, drag: 3 });
    }
  }

  // CPU のアイテム判断
  private aiUse(dt: number, r: Racer, racers: Racer[]) {
    if (!r.item) {
      this.aiHold.delete(r);
      return;
    }
    if (r.kart.squashTime > 0) return; // ぺちゃんこのあいだは、使えない
    const held = (this.aiHold.get(r) ?? 0) + dt;
    this.aiHold.set(r, held);
    if (held < 0.8) return;
    const k = r.kart;
    let use = false;
    switch (r.item) {
      case 'ramen':
      case 'star':
        use = Math.abs(k.steerInput) < 0.4;
        break;
      case 'missile':
        // ひとつ前のライバルがいれば、すぐ撃つ（1 位のときは、的ができるまで待つ。持ちすぎたら、空砲でも撃つ）
        use = r.place > 1 || held > 14;
        break;
      case 'bomb':
        // うしろ 3〜40m に、巻き込めるライバルがいるとき（持ちすぎたら、いなくても使う）
        use = held > 9 || racers.some((o) => {
          if (o === r) return false;
          const gap = (r.progress - o.progress) * this.track.length;
          return gap > 3 && gap < 40;
        });
        break;
      case 'barrier':
        // ねらわれたとき（ミサイル・ばくだん・巨大スター）に張る。持ちすぎたら、ふつうに張る
        use = held > 10
          || this.missiles.some((m) => m.target === r && !m.ballistic)
          || this.bombs.some((b) => b.owner !== r && Math.hypot(b.pos.x - k.pos.x, b.pos.z - k.pos.z) < BLAST_RADIUS + 6)
          || racers.some((o) => {
            if (o === r || o.kart.starTime <= 0) return false;
            return Math.hypot(o.kart.pos.x - k.pos.x, o.kart.pos.z - k.pos.z) < 28;
          });
        break;
    }
    if (use) this.use(r, racers);
  }
}

// ---------- アイテムの見た目 ----------

const _colorSmoke = new THREE.Color('#4a4540');
const _sparkCols = [new THREE.Color('#ffd25a'), new THREE.Color('#ff8a2a')];
const _colorSpark = (i: number) => _sparkCols[i % 2];

const _shield = new THREE.Color();
const _zAxis = new THREE.Vector3(0, 0, 1);
const _d = new THREE.Vector3();
const _trailSmoke = new THREE.Color('#e4dfd7');

// ロケットランチャー：オリーブ色の太い筒、うしろへ広がる噴射口、前の銃口、グリップ、スコープ、赤と黄色の帯。
// 肩にかついだ形で、筒（tube）が反動で動く。ミサイルの先（warhead）が、撃つ前は銃口から顔を出す
function launcherMesh() {
  const mesh = new THREE.Group();
  mesh.position.set(-0.7, 1.55, 0.05); // 右の肩（モデルの +x は、進行方向に向かって左）
  mesh.rotation.x = -0.06;
  const tube = new THREE.Group();
  mesh.add(tube);
  const olive = new THREE.MeshStandardMaterial({ color: '#5a6b3c', metalness: 0.55, roughness: 0.38, envMapIntensity: 1.1 });
  const dark = new THREE.MeshStandardMaterial({ color: '#26292b', metalness: 0.7, roughness: 0.45 });
  const steel = new THREE.MeshStandardMaterial({ color: '#a4adb2', metalness: 0.85, roughness: 0.28, envMapIntensity: 1.3 });
  const red = new THREE.MeshStandardMaterial({ color: '#d9392c', metalness: 0.3, roughness: 0.4 });
  const yellow = new THREE.MeshStandardMaterial({ color: '#f2c230', metalness: 0.3, roughness: 0.4 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    tube.add(m);
    return m;
  };
  add(new THREE.CylinderGeometry(0.2, 0.2, 2.0, 20).rotateX(Math.PI / 2), olive);
  add(new THREE.CylinderGeometry(0.19, 0.34, 0.4, 20, 1, true).rotateX(Math.PI / 2), steel, 0, 0, -1.18).material.side = THREE.DoubleSide;
  add(new THREE.CylinderGeometry(0.26, 0.2, 0.24, 20).rotateX(Math.PI / 2), dark, 0, 0, 1.0);
  add(new THREE.TorusGeometry(0.205, 0.03, 8, 22), red, 0, 0, -0.5);
  add(new THREE.TorusGeometry(0.205, 0.03, 8, 22), yellow, 0, 0, 0.5);
  add(new THREE.TorusGeometry(0.205, 0.03, 8, 22), yellow, 0, 0, 0.62);
  // グリップ（持ち手）と前の持ち手
  add(new THREE.BoxGeometry(0.09, 0.3, 0.11), dark, 0, -0.27, 0.05).rotation.x = 0.2;
  add(new THREE.BoxGeometry(0.08, 0.22, 0.09), dark, 0, -0.25, 0.58);
  // スコープ（ねらう筒）。前のレンズは、うっすら光る
  add(new THREE.BoxGeometry(0.08, 0.1, 0.3), dark, 0, 0.23, 0.15);
  add(new THREE.CylinderGeometry(0.055, 0.055, 0.55, 12).rotateX(Math.PI / 2), dark, 0, 0.3, 0.15);
  add(new THREE.CircleGeometry(0.05, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 2.0), side: THREE.DoubleSide }), 0, 0.3, 0.43);
  // 撃つ前の、ミサイルの先（銃口から、顔を出している）
  const warhead = add(new THREE.ConeGeometry(0.16, 0.5, 14).rotateX(Math.PI / 2), red, 0, 0, 1.3);
  // 銃口の火と、うしろの噴射の光
  const flashMat = () => new THREE.SpriteMaterial({ map: flashTexture(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  const muzzle = new THREE.Sprite(flashMat());
  muzzle.position.set(0, 0, 1.45);
  muzzle.renderOrder = 8;
  const back = new THREE.Sprite(flashMat());
  back.position.set(0, 0, -1.45);
  back.renderOrder = 8;
  mesh.add(muzzle, back);
  return { mesh, tube, muzzle, back, warhead };
}

// ミサイル：白い胴体に、赤い先と帯、4 枚の尾翼。うしろへ、炎と光が伸びる
function missileMesh() {
  const mesh = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: '#f2eee6', metalness: 0.3, roughness: 0.34, envMapIntensity: 1.2 });
  const red = new THREE.MeshStandardMaterial({ color: '#d9392c', metalness: 0.3, roughness: 0.38 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2b2e30', metalness: 0.7, roughness: 0.4 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    mesh.add(m);
    return m;
  };
  add(new THREE.CylinderGeometry(0.14, 0.14, 1.5, 16).rotateX(Math.PI / 2), white);
  add(new THREE.ConeGeometry(0.14, 0.55, 16).rotateX(Math.PI / 2), red, 0, 0, 1.02);
  add(new THREE.TorusGeometry(0.145, 0.03, 8, 18), red, 0, 0, 0.32);
  add(new THREE.TorusGeometry(0.145, 0.03, 8, 18), dark, 0, 0, -0.5);
  add(new THREE.CylinderGeometry(0.1, 0.13, 0.22, 14).rotateX(Math.PI / 2), dark, 0, 0, -0.8);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.36, 0.42), dark);
    const holder = new THREE.Group();
    holder.rotation.z = (i * Math.PI) / 2;
    fin.position.set(0, 0.24, -0.58);
    holder.add(fin);
    mesh.add(holder);
  }
  // 炎（先がとがった、光る円すい）と、噴射口の光
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.17, 2.4, 14, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -2.0),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.3, 0.5), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
  );
  mesh.add(flame);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), color: new THREE.Color(2.6, 1.6, 0.7), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  glow.position.set(0, 0, -0.95);
  glow.scale.setScalar(1.8);
  glow.renderOrder = 8;
  mesh.add(glow);
  mesh.scale.setScalar(1.25);
  return { mesh, flame, glow };
}

// ばくだん：つやつやの黒い玉、真ちゅうの口金、ねじれた導火線と、火花
function bombMesh() {
  const g = new THREE.Group();
  const glow = new THREE.MeshStandardMaterial({ color: '#1b1b24', metalness: 0.45, roughness: 0.26, emissive: '#ff2a10', emissiveIntensity: 0.12, envMapIntensity: 1.3 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(BOMB_R, 24, 16), glow);
  body.castShadow = true;
  g.add(body);
  // 玉のおなかの、白いドクロ風の目じるし（まるい白目が 2 つ）
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#f6f1e6' });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), eyeMat);
    eye.position.set(s * 0.15, 0.04, BOMB_R - 0.03);
    eye.scale.z = 0.4;
    body.add(eye);
  }
  const brass = new THREE.MeshStandardMaterial({ color: '#c9a24a', metalness: 0.85, roughness: 0.3 });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.17, 14), brass);
  cap.position.y = BOMB_R + 0.02;
  g.add(cap);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.035, 8, 18), brass);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = BOMB_R - 0.06;
  g.add(ring);
  // 導火線
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, BOMB_R + 0.08, 0),
    new THREE.Vector3(0.05, BOMB_R + 0.26, 0.02),
    new THREE.Vector3(0.18, BOMB_R + 0.34, 0),
    new THREE.Vector3(0.22, BOMB_R + 0.46, 0),
  ]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.028, 5), new THREE.MeshStandardMaterial({ color: '#d9c9a2', roughness: 0.9 })));
  // 火花（先で、ぱちぱち光る）
  const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), color: new THREE.Color(2.2, 1.5, 0.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  spark.position.set(0.22, BOMB_R + 0.46, 0);
  spark.scale.setScalar(0.7);
  g.add(spark);
  return { mesh: g, body, glow, spark };
}

// 爆風の範囲を示す、地面の赤いわっか（と、うっすら赤い円）
function warnMesh(): THREE.Group {
  const g = new THREE.Group();
  // 地面の起伏にうもれないよう、奥行きの判定はしない（丘のかげでも、範囲が見える）
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(BLAST_RADIUS - 2.4, BLAST_RADIUS, 72).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.25, 0.12), transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
  );
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(BLAST_RADIUS, 56).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.2, 0.08), transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
  );
  ring.renderOrder = disc.renderOrder = 9;
  g.add(ring, disc);
  return g;
}
