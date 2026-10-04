import type { ControlMode } from '../core/settings';

// おや指操作の「はじく」の判定（px）。実機で触りながら調整する
const SWIPE = 44; // 置いた点からこれだけ上下に動いたら、ジャンプ（上）／アイテム（下）
const SWIPE_RATIO = 0.5; // 横に動いた量の半分以上、縦に動いたときだけ（曲がりながらの上下は拾い、ハンドルのふらつきは拾わない）
const REARM = 22; // 置いた点にこれだけ近づいたら、同じ向きをもう一度出せる

// ボタン：画面の左〜中央にハンドル（浮動スティック）、右下にジャンプ・アイテムのボタン
// おや指：画面の下半分のどこかに指を置き、左右にスライドでハンドル、そのまま上にはじくとジャンプ、下にはじくとアイテム
export class TouchControls {
  steer = 0;
  started = false; // 最初に触ったらアクセル自動ON

  private stickId: number | null = null;
  private originX = 0;
  private originY = 0;
  private upLock = false;
  private downLock = false;
  // スティックの動く幅。縦持ちは画面の幅がせまいので少し小さく
  private get radius() {
    return window.innerHeight > window.innerWidth ? 50 : 60;
  }
  private base: HTMLDivElement;
  private knob: HTMLDivElement;

  constructor(
    parent: HTMLElement,
    private onItem: () => void,
    private onJump: () => void,
    mode: ControlMode,
  ) {
    const thumb = mode === 'thumb';
    const root = document.createElement('div');
    root.id = 'touch';
    root.classList.add(thumb ? 'thumb' : 'buttons');
    root.innerHTML = thumb
      ? `
      <div class="thumb-guide"><div class="ring"></div><span class="up">↑ ジャンプ</span><span class="dn">↓ アイテム</span><span class="lr">◀ ハンドル ▶</span></div>
      <div class="stick-zone"></div>
      <div class="stick-base">
        <span class="hint up">↑ ジャンプ</span>
        <div class="stick-knob"></div>
        <span class="hint dn">↓ アイテム</span>
      </div>`
      : `
      <div class="stick-zone"></div>
      <div class="stick-base"><div class="stick-knob"></div></div>
      <button class="tbtn item">アイテム</button>
      <button class="tbtn jump">ジャンプ</button>`;
    parent.appendChild(root);

    const zone = root.querySelector<HTMLDivElement>('.stick-zone')!;
    this.base = root.querySelector<HTMLDivElement>('.stick-base')!;
    this.knob = root.querySelector<HTMLDivElement>('.stick-knob')!;
    const guide = root.querySelector<HTMLDivElement>('.thumb-guide');

    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.started = true;
      this.stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.originX = e.clientX;
      this.originY = e.clientY;
      this.upLock = false;
      this.downLock = false;
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.base.classList.add('on');
      guide?.classList.add('gone'); // 薄いガイドは、最初に触ったら消す
      this.moveKnob(0, 0);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      const rawX = e.clientX - this.originX;
      const dx = Math.max(-this.radius, Math.min(this.radius, rawX));
      const v = dx / this.radius;
      this.steer = Math.abs(v) < 0.12 ? 0 : v;
      let dy = 0;
      if (thumb) {
        const rawY = e.clientY - this.originY;
        dy = Math.max(-18, Math.min(18, rawY * 0.4)); // つまみは、上下にも少しだけついてくる
        this.swipe(rawX, rawY);
      }
      this.moveKnob(dx, dy);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.steer = 0;
      this.base.classList.remove('on');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    if (!thumb) {
      this.bindButton(root.querySelector('.item')!, () => this.onItem());
      this.bindButton(root.querySelector('.jump')!, () => this.onJump());
    }
  }

  // 置いた点からの動き（rawX, rawY）で、上にはじいたらジャンプ、下にはじいたらアイテム
  private swipe(rawX: number, rawY: number) {
    const ay = Math.abs(rawY);
    if (ay < REARM) {
      this.upLock = false;
      this.downLock = false;
    }
    if (ay < SWIPE || ay < Math.abs(rawX) * SWIPE_RATIO) return;
    if (rawY < 0 && !this.upLock) {
      this.upLock = true;
      this.onJump();
      this.fire('.hint.up');
    } else if (rawY > 0 && !this.downLock) {
      this.downLock = true;
      this.onItem();
      this.fire('.hint.dn');
    }
  }

  // 出したことが分かるように、表示をぴかっと光らせる
  private fire(sel: string) {
    const el = this.base.querySelector<HTMLElement>(sel);
    if (!el) return;
    el.classList.remove('fire');
    void el.offsetWidth;
    el.classList.add('fire');
  }

  private moveKnob(dx: number, dy: number) {
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  private bindButton(el: HTMLElement, press: () => void) {
    el.addEventListener('pointerdown', (e) => {
      this.started = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add('on');
      press();
    });
    const off = () => el.classList.remove('on');
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
