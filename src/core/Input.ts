import { TouchControls } from '../ui/TouchControls';

export interface InputState {
  steer: number; // -1（左）..1（右）
  throttle: boolean;
  brake: boolean;
  item: boolean; // 押した瞬間だけ true
  jump: boolean; // 押した瞬間だけ true
}

export const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

export class Input {
  readonly state: InputState = { steer: 0, throttle: false, brake: false, item: false, jump: false };
  private keys = new Set<string>();
  private itemPending = false;
  private jumpPending = false;
  private touch: TouchControls | null = null;
  private anyKey = false;

  constructor(uiRoot: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      if (!e.repeat && (e.code === 'Space' || e.code === 'KeyX')) this.itemPending = true;
      if (!e.repeat && (e.code === 'KeyZ' || e.code === 'ShiftLeft' || e.code === 'ShiftRight')) this.jumpPending = true;
      this.keys.add(e.code);
      this.anyKey = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    if (isTouchDevice) {
      document.body.classList.add('touch');
      this.touch = new TouchControls(uiRoot, () => (this.itemPending = true), () => (this.jumpPending = true));
    }
  }

  // スタート画面を抜けるための「なにか押した」
  get anyPressed(): boolean {
    return this.anyKey || (this.touch?.started ?? false);
  }

  update(): InputState {
    const k = this.keys;
    const left = k.has('ArrowLeft') || k.has('KeyA');
    const right = k.has('ArrowRight') || k.has('KeyD');
    const s = this.state;
    s.steer = (right ? 1 : 0) - (left ? 1 : 0);
    s.throttle = k.has('ArrowUp') || k.has('KeyW');
    s.brake = k.has('ArrowDown') || k.has('KeyS');
    s.item = this.itemPending;
    this.itemPending = false;
    s.jump = this.jumpPending;
    this.jumpPending = false;

    const t = this.touch;
    if (t) {
      if (Math.abs(t.steer) > Math.abs(s.steer)) s.steer = t.steer;
      s.brake ||= t.brake;
      if (t.started && !s.brake) s.throttle = true; // タッチはアクセル自動
    }
    return s;
  }
}
