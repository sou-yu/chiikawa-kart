// 画面左半分：スティック（ハンドル） / 右下：アイテム・ブレーキボタン
export class TouchControls {
  steer = 0;
  brake = false;
  started = false; // 最初に触ったらアクセル自動ON

  private stickId: number | null = null;
  private originX = 0;
  // スティックの動く幅。縦持ちは画面の幅がせまいので少し小さく
  private get radius() {
    return window.innerHeight > window.innerWidth ? 50 : 60;
  }
  private base: HTMLDivElement;
  private knob: HTMLDivElement;

  constructor(parent: HTMLElement, onItem: () => void, onJump: () => void) {
    const root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      <div class="stick-zone"></div>
      <div class="stick-base"><div class="stick-knob"></div></div>
      <button class="tbtn item">アイテム</button>
      <button class="tbtn jump">ジャンプ</button>
      <button class="tbtn brake">ブレーキ</button>`;
    parent.appendChild(root);

    const zone = root.querySelector<HTMLDivElement>('.stick-zone')!;
    this.base = root.querySelector<HTMLDivElement>('.stick-base')!;
    this.knob = root.querySelector<HTMLDivElement>('.stick-knob')!;

    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.started = true;
      this.stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.originX = e.clientX;
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.base.classList.add('on');
      this.moveKnob(0);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      const dx = Math.max(-this.radius, Math.min(this.radius, e.clientX - this.originX));
      const v = dx / this.radius;
      this.steer = Math.abs(v) < 0.12 ? 0 : v;
      this.moveKnob(dx);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.steer = 0;
      this.base.classList.remove('on');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    this.bindButton(root.querySelector('.brake')!, (v) => (this.brake = v));
    this.bindButton(root.querySelector('.item')!, (v) => v && onItem());
    this.bindButton(root.querySelector('.jump')!, (v) => v && onJump());
  }

  private moveKnob(dx: number) {
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), -50%)`;
  }

  private bindButton(el: HTMLElement, set: (v: boolean) => void) {
    el.addEventListener('pointerdown', (e) => {
      this.started = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add('on');
      set(true);
    });
    const off = () => {
      el.classList.remove('on');
      set(false);
    };
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
