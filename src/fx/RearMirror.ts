import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import type { Kart } from '../game/Kart';
import type { FXSystems } from './Particles';

// バックミラー：ばくだんを落としてから、爆発が終わるまでの数秒だけ、画面の上のほうに「うしろ」の景色を小さく映す。
// 自分の爆発は、自分のうしろで起きて、ふつうのカメラには映らないので、これで見えるようにする。
// ふだんは何も描かない（出ているあいだだけ、小さな絵を 1 枚ぶん、よけいに描く）。
// 影は、本体の描画で作ったものをそのまま使う（作り直さない）
export class RearMirror {
  private readonly el: HTMLDivElement;
  private readonly glass: HTMLDivElement;
  private composer: EffectComposer | null = null;
  // 本体のカメラと同じ遠さまで描く（空のドームが、これより遠いと、黒く抜けてしまう）
  private readonly cam = new THREE.PerspectiveCamera(64, 2.4, 0.3, 2000);
  private t = 0;
  private w = 0;
  private h = 0;
  private broken = false;
  private readonly look = new THREE.Vector3();

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    root: HTMLElement,
    private fx: FXSystems,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'rearmirror';
    this.el.innerHTML = '<div class="glass"></div><span class="tag">うしろ</span>';
    this.glass = this.el.querySelector('.glass')!;
    root.appendChild(this.el);
  }

  // seconds のあいだ、映す
  show(seconds: number) {
    this.t = Math.max(this.t, seconds);
  }

  get active(): boolean {
    return this.t > 0 && !this.broken;
  }

  update(dt: number) {
    this.t = Math.max(0, this.t - dt);
    this.el.classList.toggle('on', this.active);
  }

  // 本体の描画のあとに呼ぶ。画面の上の枠の中だけに、うしろ向きのカメラで描く。
  // hide：ミラーのカメラが「中」に入ってしまうもの（自分のバリアの球）。このあいだだけ隠す
  render(kart: Kart, hide: readonly THREE.Object3D[] = []) {
    if (!this.active) return;
    const was = hide.map((o) => o.visible);
    const r = this.glass.getBoundingClientRect();
    const W = Math.round(r.width), H = Math.round(r.height);
    if (W < 24 || H < 16) return;
    const rd = this.renderer;
    try {
      if (!this.composer) {
        this.composer = new EffectComposer(rd);
        this.composer.addPass(new RenderPass(this.scene, this.cam));
        this.composer.addPass(new OutputPass());
        this.composer.setPixelRatio(1);
      }
      if (W !== this.w || H !== this.h) {
        this.w = W;
        this.h = H;
        this.composer.setSize(W, H);
        this.cam.aspect = W / H;
        this.cam.updateProjectionMatrix();
      }
      // 車のうしろの、少し高いところから、来た道をふり返る
      const fx = Math.sin(kart.heading), fz = Math.cos(kart.heading);
      this.cam.position.set(kart.pos.x - fx * 0.5, kart.y + 2.3, kart.pos.z - fz * 0.5);
      this.look.set(kart.pos.x - fx * 30, kart.y + 1.2, kart.pos.z - fz * 30);
      this.cam.lookAt(this.look);

      const auto = rd.shadowMap.autoUpdate;
      rd.shadowMap.autoUpdate = false; // 影は、本体の描画で作ったものを使う
      rd.setScissorTest(true);
      rd.setViewport(r.left, window.innerHeight - r.bottom, W, H);
      rd.setScissor(r.left, window.innerHeight - r.bottom, W, H);
      this.fx.sparks.setViewport(H, this.cam.fov);
      this.fx.dust.setViewport(H, this.cam.fov);
      hide.forEach((o) => (o.visible = false));
      this.composer.render();
      hide.forEach((o, i) => (o.visible = was[i]));
      rd.setScissorTest(false);
      rd.setViewport(0, 0, window.innerWidth, window.innerHeight);
      rd.shadowMap.autoUpdate = auto;
    } catch (e) {
      // 描けない環境では、ミラーだけあきらめて、ゲームは続ける
      hide.forEach((o, i) => (o.visible = was[i]));
      this.broken = true;
      this.el.classList.remove('on');
      rd.setScissorTest(false);
      console.warn('バックミラーを描けませんでした', e);
    }
  }
}
