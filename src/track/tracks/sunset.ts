import type { TrackDef } from '../Track';

// コース4「夕焼け海岸」：海ぞいの砂の道 → 貝殻のゲートをくぐって浅瀬の水の上へ → 岬を回って、ヤシ林の中を通って戻る。
// 海は西（-x）側。夕日も西の水平線に沈んでいく
export const SUNSET: TrackDef = {
  name: '夕焼け海岸',
  theme: 'sunset',
  title: 'サンセットカップ',
  // 長さ約955m。いちばんきついカーブでも半径 22m 以上
  points: [
    [-10, -120],
    [-10, -40],
    [-14, 20],
    [-30, 60],
    [-55, 90],
    [-70, 130],
    [-58, 170],
    [-30, 195],
    [5, 215],
    [50, 220],
    [90, 200],
    [115, 165],
    [120, 120],
    [105, 80],
    [118, 40],
    [125, 0],
    [115, -45],
    [95, -95],
    [70, -135],
    [35, -160],
    [5, -155],
    [-8, -140],
  ],
  halfWidth: 9.5,
  // 道のふちのロープの柵が、そのまま壁
  wallOffset: 0.6,
  ramps: [
    // 浅瀬の中の木のジャンプ台（着水すると水しぶきが上がる）
    { t: 0.255, length: 8, height: 1.6 },
    // グライダー台は、ヤシ林の東のまっすぐ
    { t: 0.615, length: 10, height: 3, glide: true },
  ],
  dashPads: [
    { t: 0.045, lateral: 0 },
    { t: 0.13, lateral: 3 },
    { t: 0.3, lateral: -3 },
    { t: 0.44, lateral: 0 },
    { t: 0.54, lateral: 3 },
    { t: 0.76, lateral: -3 },
    { t: 0.88, lateral: 0 },
  ],
  itemBoxes: [0.1, 0.33, 0.5, 0.8],
  coins: [
    { t: 0.07, lateral: -3, count: 5 },
    { t: 0.16, lateral: 3, count: 4 },
    { t: 0.22, lateral: 0, count: 5 },
    { t: 0.38, lateral: -3, count: 4 },
    { t: 0.48, lateral: 3, count: 5 },
    { t: 0.66, lateral: 0, count: 5 },
    { t: 0.72, lateral: -4, count: 4 },
    { t: 0.93, lateral: 3, count: 5 },
  ],
  signs: [],
};
