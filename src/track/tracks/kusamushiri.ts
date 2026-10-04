import type { TrackDef } from '../Track';

// コース1「草むしり原っぱ」
export const KUSAMUSHIRI: TrackDef = {
  name: '草むしり原っぱ',
  // 最高速(24m/s)で一番きついカーブでも 1.4rad/s 以下になるように調整済み
  points: [
    [0, -50],
    [0, 50],
    [20, 95],
    [65, 115],
    [110, 100],
    [130, 60],
    [115, 20],
    [125, -20],
    [150, -55],
    [140, -100],
    [95, -125],
    [45, -120],
    [12, -90],
  ],
  halfWidth: 8,
  wallOffset: 6,
  ramps: [
    { t: 0.1, length: 8, height: 1.5 },
    { t: 0.462, length: 10, height: 3, glide: true },
  ],
  dashPads: [
    { t: 0.3, lateral: 0 },
    { t: 0.52, lateral: -3.5 },
    { t: 0.86, lateral: 3 },
    { t: 0.95, lateral: -2.5 },
  ],
  river: { t: 0.745, width: 9 },
  ramenStall: { t: 0.8, side: -1 },
  itemBoxes: [0.05, 0.36, 0.7],
  coins: [
    { t: 0.16, lateral: 0, count: 5 },
    { t: 0.28, lateral: 4, count: 4 },
    { t: 0.45, lateral: -4, count: 4 },
    { t: 0.58, lateral: 3, count: 4 },
    { t: 0.82, lateral: -3, count: 5 },
    { t: 0.93, lateral: 0, count: 4 },
  ],
  signs: [
    { t: 0.02, side: 1, lines: ['よい草', 'よい生活'] },
    { t: 0.2, side: -1, lines: ['草をぬいて', 'みんなでしあわせ'] },
    { t: 0.5, side: 1, lines: ['草むしり', '検定会場 →'] },
    { t: 0.76, side: -1, lines: ['ラーメン', 'この先すぐ'] },
  ],
};
