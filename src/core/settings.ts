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

// 画質：高画質（カートの塗装のクリアコート・キャラのふんわりした質感・光のにじみなど）／標準（軽い）
export type GraphicsQuality = 'high' | 'standard';
const GKEY = 'chiikawa-kart.graphics';
let gCurrent: GraphicsQuality | null = null;

export function getGraphicsQuality(): GraphicsQuality {
  if (gCurrent) return gCurrent;
  try {
    return localStorage.getItem(GKEY) === 'standard' ? 'standard' : 'high';
  } catch {
    return 'high';
  }
}

export function setGraphicsQuality(q: GraphicsQuality) {
  gCurrent = q;
  try {
    localStorage.setItem(GKEY, q);
  } catch {
    /* 保存できなくても、この回は選んだとおりに動く */
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
