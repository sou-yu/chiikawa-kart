import type { CharacterSpec } from '../config/characters';
import { iconCanvas } from './faces';

// キャラの顔アイコン（ミニマップ・けっか・観客の絵）。
// 3D モデルがあるキャラは、モデルの顔を撮った絵（portraits.ts が作る）を使う。なければ手描きの顔アイコン
const modelIcons = new Map<string, HTMLCanvasElement>();

export function setModelIcon(id: string, icon: HTMLCanvasElement) {
  modelIcons.set(id, icon);
}

export function characterIcon(spec: CharacterSpec, size: number): HTMLCanvasElement {
  const src = modelIcons.get(spec.id);
  if (!src) return iconCanvas(spec, size);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, size, size);
  return c;
}
