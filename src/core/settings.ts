// 操作方法：ボタン（左下でハンドル＋右下のボタン）／おや指（右手の親指だけ：スライドでハンドル、↑ジャンプ、↓アイテム）
export type ControlMode = 'buttons' | 'thumb';

const KEY = 'chiikawa-kart.controls';

// 保存できない環境（プライベートブラウズなど）でも、選んだものがこの回のレースに届くようにメモリにも持つ
let current: ControlMode | null = null;

export function getControlMode(): ControlMode {
  if (current) return current;
  try {
    return localStorage.getItem(KEY) === 'thumb' ? 'thumb' : 'buttons';
  } catch {
    return 'buttons';
  }
}

export function setControlMode(mode: ControlMode) {
  current = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* 保存できなくても、この回は選んだとおりに動く */
  }
}
