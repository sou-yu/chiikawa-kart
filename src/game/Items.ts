import { glassBoxTexture } from '../track/candy/textures';
import * as THREE from 'three';
import { itemBoxTexture } from '../core/textures';
import { KartFX } from '../fx/KartFX';
import type { FXSystems } from '../fx/Particles';
import type { Track } from '../track/Track';
import type { Racer } from './Racer';

export type ItemId = 'ramen' | 'donguri' | 'kusa' | 'star';

export const ITEMS: Record<ItemId, { icon: string; name: string }> = {
  ramen: { icon: '🍜', name: 'ラーメン' }, // ダッシュ
  donguri: { icon: '🌰', name: 'どんぐり' }, // 前に投げる
  kusa: { icon: '🌿', name: '草のたば' }, // 後ろに置く
  star: { icon: '⭐', name: '討伐の星' }, // 無敵
};
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

// 順位が後ろほど強いアイテム（ラバーバンディング）
const TABLE: [number, Record<ItemId, number>][] = [
  [0.0, { kusa: 0.45, donguri: 0.4, ramen: 0.15, star: 0 }],
  [0.5, { kusa: 0.2, donguri: 0.35, ramen: 0.35, star: 0.1 }],
  [1.0, { kusa: 0.05, donguri: 0.25, ramen: 0.45, star: 0.25 }],
];

function rollItem(placeRatio: number): ItemId {
  let row = TABLE[0][1];
  for (const [r, w] of TABLE) if (placeRatio >= r - 0.01) row = w;
  let x = Math.random();
  for (const id of ITEM_IDS) {
    x -= row[id];
    if (x <= 0) return id;
  }
  return 'ramen';
}

const ROULETTE_TIME = 1.1;
const COIN_RESPAWN = 8;
const BOX_RESPAWN = 2.5;

interface Box {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  respawn: number;
}
interface Coin {
  pos: THREE.Vector3;
  respawn: number;
}
interface Projectile {
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  owner: Racer;
  projIndex: number;
}
interface Trap {
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
}

const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

export class ItemSystem {
  readonly group = new THREE.Group();
  private boxes: Box[] = [];
  private coins: Coin[] = [];
  private coinMesh: THREE.InstancedMesh;
  private projectiles: Projectile[] = [];
  private traps: Trap[] = [];
  private time = 0;
  private aiHold = new Map<Racer, number>();

  constructor(private track: Track, private fx: FXSystems) {
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
    this.updateProjectiles(dt, racers);
    this.updateTraps(racers);
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
            r.pendingItem = rollItem((r.place - 1) / Math.max(1, racers.length - 1));
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
        k.starTime = 7;
        k.addBoost(0.1);
        break;
      case 'donguri': {
        const mesh = acornMesh();
        const pos = k.pos.clone().addScaledVector(fwd, 2.5).setY(k.y + 0.5);
        const vel = fwd.clone().multiplyScalar(Math.max(k.forwardSpeed, 0) + 22);
        mesh.position.copy(pos);
        this.group.add(mesh);
        this.projectiles.push({ mesh, pos, vel, life: 5, owner: r, projIndex: k.proj.index });
        break;
      }
      case 'kusa': {
        const mesh = grassBundleMesh();
        const pos = k.pos.clone().addScaledVector(fwd, -2.6).setY(0);
        mesh.position.copy(pos);
        this.group.add(mesh);
        this.traps.push({ mesh, pos });
        if (this.traps.length > 12) this.removeTrap(this.traps[0]);
        break;
      }
    }
    void racers;
  }

  private updateProjectiles(dt: number, racers: Racer[]) {
    const proj = { t: 0, index: 0, lateral: 0, point: new THREE.Vector3(), tangent: new THREE.Vector3(), normal: new THREE.Vector3() };
    const wall = this.track.def.halfWidth + this.track.def.wallOffset;
    for (const p of [...this.projectiles]) {
      p.life -= dt;
      p.pos.addScaledVector(p.vel, dt);
      this.track.project(p.pos, proj, p.projIndex);
      p.projIndex = proj.index;
      // 壁で跳ね返る
      if (Math.abs(proj.lateral) > wall) {
        const s = Math.sign(proj.lateral);
        const vn = (p.vel.x * proj.normal.x + p.vel.z * proj.normal.z) * s;
        if (vn > 0) {
          p.vel.x -= 2 * vn * proj.normal.x * s;
          p.vel.z -= 2 * vn * proj.normal.z * s;
        }
      }
      p.mesh.position.copy(p.pos);
      p.mesh.rotation.x += dt * 15;
      p.mesh.rotation.y = Math.atan2(p.vel.x, p.vel.z);
      let hit = p.life <= 0;
      for (const r of racers) {
        if (r === p.owner && p.life > 4.6) continue;
        if (r.kart.pos.distanceToSquared(p.pos) < 2.4 && Math.abs(r.kart.y - p.pos.y) < 2) {
          r.hit();
          hit = true;
          break;
        }
      }
      for (const t of this.traps) {
        if (t.pos.distanceToSquared(p.pos) < 1.8) {
          this.removeTrap(t);
          hit = true;
          break;
        }
      }
      if (hit) {
        KartFX.burst(this.fx, p.pos, ['#a86a3a', '#ffe0a0', '#ffffff'], 18, 6);
        this.group.remove(p.mesh);
        this.projectiles.splice(this.projectiles.indexOf(p), 1);
      }
    }
  }

  private updateTraps(racers: Racer[]) {
    for (const t of [...this.traps]) {
      t.mesh.rotation.y += 0.01;
      for (const r of racers) {
        if (r.kart.pos.distanceToSquared(t.pos) < 1.7 && r.kart.y < 1) {
          r.hit();
          KartFX.burst(this.fx, _p.copy(t.pos).setY(0.6), ['#6cc24a', '#a6e07a', '#ffffff'], 20, 6);
          this.removeTrap(t);
          break;
        }
      }
    }
  }

  private removeTrap(t: Trap) {
    this.group.remove(t.mesh);
    this.traps.splice(this.traps.indexOf(t), 1);
  }

  // CPU のアイテム判断
  private aiUse(dt: number, r: Racer, racers: Racer[]) {
    if (!r.item) {
      this.aiHold.delete(r);
      return;
    }
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
      case 'donguri': {
        const fwd = _p.set(Math.sin(k.heading), 0, Math.cos(k.heading));
        use = held > 7 || racers.some((o) => {
          if (o === r) return false;
          const dx = o.kart.pos.x - k.pos.x, dz = o.kart.pos.z - k.pos.z;
          const d = Math.hypot(dx, dz);
          return d < 35 && (dx * fwd.x + dz * fwd.z) / d > 0.93;
        });
        break;
      }
      case 'kusa':
        use = held > 5 || racers.some((o) => o !== r && o.progress < r.progress && (r.progress - o.progress) * this.track.length < 12);
        break;
    }
    if (use) this.use(r, racers);
  }
}

// ---------- アイテムの見た目 ----------

function acornMesh(): THREE.Group {
  const g = new THREE.Group();
  const nut = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), new THREE.MeshStandardMaterial({ color: '#b5723c', roughness: 0.4 }));
  nut.scale.set(1, 1, 1.25);
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.46, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#7a5230', roughness: 0.9 }),
  );
  cap.rotation.x = -Math.PI / 2;
  cap.position.z = 0.1;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.2), cap.material);
  stem.rotation.x = Math.PI / 2;
  stem.position.z = 0.6;
  g.add(nut, cap, stem);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function grassBundleMesh(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#5fb744', roughness: 0.7 });
  const blade = new THREE.ConeGeometry(0.14, 1.1, 6).translate(0, 0.55, 0);
  for (let i = 0; i < 9; i++) {
    const b = new THREE.Mesh(blade, mat);
    const a = (i / 9) * Math.PI * 2;
    b.position.set(Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25);
    b.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
    b.castShadow = true;
    g.add(b);
  }
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.07, 8, 16), new THREE.MeshStandardMaterial({ color: '#ffd54a' }));
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.3;
  g.add(band);
  return g;
}

