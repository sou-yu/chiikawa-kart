export type Species = 'bear' | 'cat' | 'rabbit';

export interface CharacterSpec {
  id: string;
  name: string;
  species: Species;
  base: string; // 体の色
  pattern?: string; // ねこの八割れ柄の色
  kart: string;
  kartTrim: string;
  leaf?: boolean; // 頭の葉っぱ
  mouth: 'omega' | 'open';
  style?: 'deluxe'; // 手作りモデルで走るとき：参考画像に忠実なモデル（ピンクのカート・起毛の顔）
  blurb?: string; // キャラ選択画面のひとこと
  tint?: string; // キャラ選択画面のカードの背景色
  pickable?: boolean; // 最初に選べるキャラ（3D モデルがあるキャラ）
  stats: { speed: number; accel: number; turn: number };
}

export const CHARACTERS: CharacterSpec[] = [
  {
    id: 'shirokuma',
    name: 'ちいかわ',
    blurb: 'バランスのいい、がんばりや',
    tint: '#ffdbe6',
    pickable: true,
    species: 'bear',
    base: '#fbeaea',
    kart: '#ef6f9f',
    kartTrim: '#f7ebd8',
    mouth: 'omega',
    style: 'deluxe',
    stats: { speed: 1, accel: 1, turn: 1 },
  },
  {
    id: 'neko',
    name: 'ハチワレ',
    blurb: 'ダッシュが得意で、小まわりもきく',
    tint: '#d2e7ff',
    pickable: true,
    species: 'cat',
    base: '#ffffff',
    pattern: '#6f9be0',
    kart: '#4d80d8',
    kartTrim: '#f4f6fb',
    mouth: 'open',
    stats: { speed: 0.99, accel: 1.08, turn: 1.03 },
  },
  {
    id: 'usagi',
    name: 'うさぎ',
    blurb: '最高速がはやい、ちょっとクセつよ',
    tint: '#fff0b8',
    pickable: true,
    species: 'rabbit',
    base: '#fff0c0',
    kart: '#f4c83a',
    kartTrim: '#fffbe9',
    mouth: 'open',
    stats: { speed: 1.02, accel: 0.95, turn: 0.97 },
  },
  // 以下の 4 キャラも 3D モデル（GLB）で走る。species・base・mouth は、モデルが読めなかったときの手作りモデルと、
  // 顔アイコンの代わり用。kart・kartTrim は、グライダーの色にも使う
  {
    id: 'kurimanju',
    name: '栗まんじゅう',
    blurb: 'ふつうに速い、どっしり安定',
    tint: '#f6dfc2',
    pickable: true,
    species: 'bear',
    base: '#f6e2b2',
    kart: '#8b4a2f',
    kartTrim: '#fff3de',
    mouth: 'omega',
    stats: { speed: 1.01, accel: 0.97, turn: 1.02 },
  },
  {
    id: 'shisa',
    name: 'シーサー',
    blurb: '最高速はトップクラスのパワー型',
    tint: '#ffdca6',
    pickable: true,
    species: 'bear',
    base: '#fdf1d9',
    kart: '#f2a11c',
    kartTrim: '#fffbe9',
    mouth: 'omega',
    stats: { speed: 1.04, accel: 0.94, turn: 0.95 },
  },
  {
    id: 'momonga',
    name: 'モモンガ',
    blurb: 'ひらりとダッシュ、加速がすごい',
    tint: '#e4dafc',
    pickable: true,
    species: 'rabbit',
    base: '#ffffff',
    kart: '#b695ee',
    kartTrim: '#ffffff',
    mouth: 'open',
    stats: { speed: 0.96, accel: 1.1, turn: 1.02 },
  },
  {
    id: 'kani',
    name: 'カニちゃん',
    blurb: 'ハンドルが軽い、カーブ名人',
    tint: '#ffcfe0',
    pickable: true,
    species: 'bear',
    base: '#fff1ec',
    kart: '#f48fb6',
    kartTrim: '#fff6e3',
    mouth: 'open',
    stats: { speed: 0.98, accel: 1.0, turn: 1.07 },
  },
  {
    id: 'rakko',
    name: 'ラッコ',
    blurb: '加速がいい、マントの剣士',
    tint: '#f1e4cc',
    pickable: true,
    species: 'bear',
    base: '#f6ecd2',
    kart: '#d9b16a',
    kartTrim: '#fff4dc',
    mouth: 'omega',
    stats: { speed: 1.01, accel: 1.06, turn: 0.98 },
  },
];
