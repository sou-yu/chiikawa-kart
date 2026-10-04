import type { TrackDef } from '../Track';

// コース3「キャンディーポップロード」（旧名「スイーツパラダイス」）：ビスケットの道、チョコの縄の柵、ケーキの段々と、ピンクの滝
export const CANDY: TrackDef = {
  name: 'キャンディーポップロード',
  theme: 'candy',
  title: 'スイーツグランプリ',
  // 長さ約960m。いちばんきついカーブでも半径 21m 以上（最高速でも曲がれる）
  points: [
    [-15, -60],
    [-15, 35],
    [-5, 85],
    [35, 115],
    [90, 125],
    [138, 112],
    [174, 86],
    [182, 46],
    [162, 14],
    [160, -22],
    [190, -44],
    [230, -54],
    [258, -90],
    [238, -130],
    [186, -146],
    [130, -138],
    [85, -122],
    [45, -136],
    [18, -136],
    [-4, -125],
    [-15, -100],
  ],
  halfWidth: 9.5,
  // 道のふちのチョコの縄が、そのまま壁
  wallOffset: 0.5,
  ramps: [
    { t: 0.09, length: 8, height: 1.6 },
    // グライダー台は、いちばん長いまっすぐ（下の道を西へ）の入り口
    { t: 0.712, length: 10, height: 3, glide: true },
  ],
  dashPads: [
    { t: 0.06, lateral: 0 },
    { t: 0.23, lateral: 3.5 },
    { t: 0.31, lateral: -3.5 },
    { t: 0.52, lateral: 0 },
    { t: 0.6, lateral: 3 },
    { t: 0.78, lateral: 0 },
    { t: 0.92, lateral: -3 },
  ],
  itemBoxes: [0.03, 0.27, 0.55, 0.84],
  coins: [
    { t: 0.13, lateral: 0, count: 5 },
    { t: 0.2, lateral: -4, count: 5 },
    { t: 0.37, lateral: 3, count: 4 },
    { t: 0.45, lateral: -3, count: 4 },
    { t: 0.66, lateral: 0, count: 5 },
    { t: 0.74, lateral: 4, count: 4 },
    { t: 0.88, lateral: -4, count: 5 },
    { t: 0.96, lateral: 0, count: 4 },
  ],
  signs: [],
};
