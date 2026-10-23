import type { Race } from './Race';

// グランプリ：4 つのコースを決まった順に走り、順位のポイントの合計で競う。
// 1 レースごとにページを読み込み直すので、途中経過は sessionStorage に持つ（このタブのあいだだけ残る）。
// URL に ?gp=<何戦目> があるときだけ、続きとして扱う。

export const GP_ORDER = ['meadow', 'sunset', 'candy', 'rainbow'] as const;
export const GP_NAMES: Record<string, string> = { meadow: '草原', sunset: '浜辺', candy: 'お菓子', rainbow: 'レインボーロード' };
// 順位ごとのポイント（5 台）
export const POINTS = [10, 8, 6, 4, 2, 1, 1, 1];

export interface GPState {
  char: string; // プレイヤーのキャラ
  cpus: string[]; // 相手（4 レースとも同じ顔ぶれ・同じ並び）
  leg: number; // いま何戦目か（0..3）
  points: Record<string, number>; // 合計
  last: Record<string, number>; // 直前のレースの順位（同点のときに使う）
  gained: Record<string, number>; // 直前のレースで足したポイント
  added: number; // 結果を足し終えたレース（同じレースを 2 度足さないため）
}

const KEY = 'chiikawa-kart.gp';
let mem: GPState | null = null;

function save(s: GPState) {
  mem = s;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 保存できなくても、このページのあいだは続く */
  }
}

// いまのページがグランプリの続きなら、その状態（違えば null。古い状態は消す）
export function loadGP(): GPState | null {
  const q = new URLSearchParams(location.search).get('gp');
  if (q === null) {
    clearGP();
    return null;
  }
  try {
    const raw = sessionStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as GPState) : mem;
    if (s && s.leg === Number(q)) return (mem = s);
  } catch {
    /* 読めなければ、ふつうに始める */
  }
  return null;
}

export function startGP(char: string, cpus: string[]): GPState {
  const s: GPState = { char, cpus, leg: 0, points: {}, last: {}, gained: {}, added: -1 };
  for (const id of [char, ...cpus]) s.points[id] = 0;
  save(s);
  return s;
}

export function clearGP() {
  mem = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* なにもしない */
  }
}

// レースの順位でポイントを足す（ゴールしていない CPU は、いまの順位で）
export function addResults(s: GPState, race: Race) {
  if (s.added === s.leg) return;
  s.added = s.leg;
  s.gained = {};
  for (const r of race.racers) {
    const p = POINTS[r.place - 1] ?? 0;
    s.points[r.spec.id] = (s.points[r.spec.id] ?? 0) + p;
    s.gained[r.spec.id] = p;
    s.last[r.spec.id] = r.place;
  }
  save(s);
}

// 合計の順位（ポイントの多い順。同点は直前のレースの順位で）
export function standings(s: GPState): string[] {
  return Object.keys(s.points).sort((a, b) => s.points[b] - s.points[a] || (s.last[a] ?? 9) - (s.last[b] ?? 9));
}

export const isFinalLeg = (s: GPState) => s.leg >= GP_ORDER.length - 1;

// つぎのレースへ（ページを開き直す）
export function goNextLeg(s: GPState) {
  s.leg++;
  save(s);
  location.search = `?gp=${s.leg}`;
}
