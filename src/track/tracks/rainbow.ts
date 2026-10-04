import type { TrackDef } from '../Track';

// コース2「レインボーロード」：雲の海に浮かぶ、虹色の道。夜空とオーロラ、水晶の城
export const RAINBOW: TrackDef = {
  name: 'レインボーロード',
  theme: 'rainbow',
  title: 'レインボーグランプリ',
  // 大きな S 字のつづら折り。きついカーブでも半径 25m 以上
  points: [
    [0, -60],
    [0, 40],
    [16, 86],
    [56, 104],
    [92, 84],
    [96, 46],
    [74, 14],
    [80, -22],
    [116, -38],
    [156, -22],
    [180, 16],
    [214, 22],
    [236, -12],
    [226, -62],
    [184, -100],
    [128, -118],
    [70, -122],
    [24, -102],
  ],
  halfWidth: 8.5,
  // 道のふちに金の手すり。手すりのすぐ内側が壁（雲の海へは落ちない）
  wallOffset: 0.4,
  ramps: [
    { t: 0.115, length: 8, height: 1.6 },
    // グライダー台は、いちばん長いまっすぐの入り口に
    { t: 0.762, length: 10, height: 3, glide: true },
  ],
  dashPads: [
    { t: 0.06, lateral: 0 },
    { t: 0.24, lateral: 3.5 },
    { t: 0.42, lateral: -3 },
    { t: 0.5, lateral: 0 },
    { t: 0.74, lateral: 0 },
    { t: 0.9, lateral: -3 },
  ],
  itemBoxes: [0.03, 0.33, 0.66, 0.86],
  coins: [
    { t: 0.14, lateral: -3, count: 5 },
    { t: 0.2, lateral: 3, count: 4 },
    { t: 0.37, lateral: 0, count: 5 },
    { t: 0.5, lateral: -4, count: 4 },
    { t: 0.72, lateral: 4, count: 4 },
    { t: 0.82, lateral: -3, count: 5 },
    { t: 0.95, lateral: 0, count: 4 },
  ],
  signs: [],
};
