import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { CharacterSpec } from '../config/characters';
import type { CharacterModel } from '../characters/Character';
import { createGltfCharacter, hasCharacterModel } from '../characters/GltfCharacter';

// キャラ選択画面の「大きなキャラ」。ゲームで使う 3D モデルそのものを、専用の小さな描画器で動かして見せる。
// 指（マウス）で左右になぞると、台の上でくるくる回せる（はなすと勢いでしばらく回り、少したつと正面にもどる）。
// キャラを切りかえるときは、回りながらぽんと登場する
export class CharViewer {
  readonly canvas = document.createElement('canvas');
  onInteract: (() => void) | null = null;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(20, 1, 0.1, 60);
  private pivot = new THREE.Group();
  private models = new Map<string, CharacterModel>();
  private current: CharacterModel | null = null;
  private pmrem: THREE.PMREMGenerator;
  private shadow: THREE.Mesh;
  private ro: ResizeObserver;

  private readonly home = 0.5; // ふだんの向き（少し斜め）
  private yaw = this.home;
  private vel = 0;
  private idle = 0;
  private spawn = 1; // 登場の動き（0 → 1）
  private dragId: number | null = null;
  private lastX = 0;
  private lastT = 0;
  private raf = 0;
  private last = 0;
  private time = 0;

  constructor(parent: HTMLElement) {
    this.canvas.className = 'viewer';
    parent.appendChild(this.canvas);
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.05;
    r.setClearColor(0x000000, 0);
    this.renderer = r;

    this.pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.85;
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#ffd9e4', 1.1));
    const sun = new THREE.DirectionalLight('#fff4e4', 2.3);
    sun.position.set(3.5, 6, 5);
    this.scene.add(sun);

    // 足もとのやわらかい影
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(90,60,40,0.4)');
    grd.addColorStop(1, 'rgba(90,60,40,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 4.6).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
    );
    this.shadow.position.y = 0.01;
    this.scene.add(this.shadow, this.pivot);

    this.camera.position.set(0, 2.85, 9.9);
    this.camera.lookAt(0, 1.18, 0);

    // 指でなぞって回す
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => {
      if (this.dragId !== null) return;
      this.dragId = e.pointerId;
      cv.setPointerCapture(e.pointerId);
      this.lastX = e.clientX;
      this.lastT = performance.now();
      this.vel = 0;
      this.idle = 0;
      this.onInteract?.();
    });
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.dragId) return;
      const now = performance.now();
      const dx = e.clientX - this.lastX;
      const rad = (dx / Math.max(1, cv.clientWidth)) * Math.PI * 2.2; // 画面の幅をなぞると、1 回転ぐらい
      this.yaw += rad;
      this.vel = rad / Math.max(0.008, (now - this.lastT) / 1000);
      this.lastX = e.clientX;
      this.lastT = now;
      this.idle = 0;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.dragId) return;
      this.dragId = null;
      if (performance.now() - this.lastT > 90) this.vel = 0; // なぞったあと止めていたら、勢いはつけない
      this.vel = Math.max(-9, Math.min(9, this.vel));
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(cv);
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w < 2 || h < 2) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // キャラを切りかえる（モデルは、初めて出すときに作って覚えておく）
  show(spec: CharacterSpec) {
    if (!hasCharacterModel(spec.id)) return;
    let m = this.models.get(spec.id);
    if (!m) {
      m = createGltfCharacter(spec);
      m.setPose(0);
      this.models.set(spec.id, m);
    }
    if (this.current) this.pivot.remove(this.current.root);
    this.current = m;
    this.pivot.add(m.root);
    // まわりながら登場
    this.yaw = this.home - 1.6;
    this.vel = 0;
    this.idle = 99;
    this.spawn = 0;
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) {
      this.last = now;
      return;
    }
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;

    if (this.dragId === null) {
      this.yaw += this.vel * dt;
      this.vel *= Math.exp(-3.2 * dt); // 勢いはだんだん弱まる
      if (Math.abs(this.vel) < 0.25) {
        this.idle += dt;
        // しばらく触らなければ、正面にもどる（いちばん近い向きへ）
        if (this.idle > (this.spawn < 1 ? 0 : 4)) {
          const d = Math.atan2(Math.sin(this.home - this.yaw), Math.cos(this.home - this.yaw));
          this.yaw += d * (1 - Math.exp(-(this.spawn < 1 ? 5 : 2.2) * dt));
        }
      }
    }
    if (this.spawn < 1) this.spawn = Math.min(1, this.spawn + dt / 0.55);

    // ぽんと大きくなって、ちょっと弾む
    const s = this.spawn;
    const back = 1 + 2.70158 * (s - 1) ** 3 + 1.70158 * (s - 1) ** 2; // easeOutBack
    this.pivot.scale.setScalar(s < 1 ? 0.5 + 0.5 * back : 1);
    this.pivot.rotation.y = this.yaw;
    this.pivot.position.y = Math.sin(this.time * 2.2) * 0.04; // ふわふわ
    this.shadow.scale.setScalar(this.pivot.scale.x);
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.pmrem.dispose();
    this.scene.environment?.dispose();
    (this.shadow.material as THREE.MeshBasicMaterial).map?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
