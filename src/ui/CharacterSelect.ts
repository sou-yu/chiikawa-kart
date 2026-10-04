import type { CharArt } from '../characters/portraits';
import { CHARACTERS } from '../config/characters';
import { CharViewer } from './CharViewer';
import './charSelect.css';

// 「キャラをえらぼう」画面。用意した 1 枚の背景の絵（public/images/charselect-bg.webp、940×1672）の上に、
//  ・台の上に、えらんだキャラの 3D モデルを出す（左右になぞると、くるくる回せる）
//  ・本の上に、キャラの一覧（シール）を並べる。押すと、そのキャラが「えらばれた」状態になる
//  ・絵の中の「けってい」で決めて次へ進む。「もどる」はタイトルへ（null を返す）
// ?char=（キャラの id）を付けると、この画面を飛ばす。?course= だけ付けたときは先頭のキャラで始める（開発・確認用）

const SRC = new URL(`${import.meta.env.BASE_URL}images/charselect-bg.webp`, document.baseURI).href;
const IMG_W = 940;
const IMG_H = 1672;
// 絵の中のボタンの範囲（絵に対する割合）
const BTN_OK = { x: 172 / IMG_W, y: 1480 / IMG_H, w: 606 / IMG_W, h: 142 / IMG_H };
const BTN_BACK = { x: 24 / IMG_W, y: 20 / IMG_H, w: 192 / IMG_W, h: 82 / IMG_H };

export interface CharacterChoice {
  id: string;
  name: string;
  blurb: string;
  tint: string;
  stats: { speed: number; accel: number; turn: number };
}

// 能力の倍率（0.95〜1.08 くらい）を、5 段階の丸にする
const pips = (v: number) => {
  const n = Math.min(5, Math.max(1, Math.round(3 + (v - 1) * 30)));
  return '●'.repeat(n) + '○'.repeat(5 - n);
};

const place = (b: { x: number; y: number; w: number; h: number }) =>
  `left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%`;
// ボタンの部分だけを同じ絵から切り出す指定（押したときに、ふわっと動かすため）
const crop = (b: { x: number; y: number; w: number; h: number }) =>
  `background-image:url('${SRC}');background-size:${100 / b.w}% ${100 / b.h}%;background-position:${(b.x / (1 - b.w)) * 100}% ${(b.y / (1 - b.h)) * 100}%`;

export function chooseCharacter(chars: CharacterChoice[], art: Promise<Record<string, CharArt>>, initial?: string): Promise<string | null> {
  const q = new URLSearchParams(location.search);
  const forced = q.get('char');
  if (forced && chars.some((c) => c.id === forced)) return Promise.resolve(forced);
  if (q.get('course')) return Promise.resolve(chars[0].id);

  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.id = 'char-select';
    el.style.setProperty('--cs-src', `url("${SRC}")`);
    el.innerHTML = `
      <div class="bg"></div>
      <div class="art">
        <img class="back-img" src="${SRC}" alt="キャラをえらぼう" draggable="false">
        <div class="stage-box">
          <div class="tag"><span></span></div>
          <div class="note"><p class="bl"></p><dl><dt>スピード</dt><dd class="sp"></dd><dt>ダッシュ</dt><dd class="ac"></dd><dt>ハンドル</dt><dd class="tn"></dd></dl></div>
          <div class="hint">↔ なぞって まわせるよ</div>
        </div>
        <div class="grid">
          ${chars
            .map(
              (c, i) => `<button class="item" type="button" data-i="${i}">
                <span class="sticker"><img alt="" draggable="false"></span><span class="lb">${c.name}</span><i class="chk"></i>
              </button>`,
            )
            .join('')}
        </div>
        <button class="back" type="button" aria-label="もどる" style="${place(BTN_BACK)}"><span style="${crop(BTN_BACK)}"></span></button>
        <button class="ok" type="button" aria-label="けってい" style="${place(BTN_OK)}"><span style="${crop(BTN_OK)}"></span></button>
      </div>`;
    document.body.appendChild(el);

    const artEl = el.querySelector<HTMLElement>('.art')!;
    const box = el.querySelector<HTMLElement>('.stage-box')!;
    const items = [...el.querySelectorAll<HTMLButtonElement>('.item')];
    const tagText = el.querySelector<HTMLElement>('.tag span')!;
    const hint = el.querySelector<HTMLElement>('.hint')!;
    const note = {
      bl: el.querySelector<HTMLElement>('.note .bl')!,
      sp: el.querySelector<HTMLElement>('.note .sp')!,
      ac: el.querySelector<HTMLElement>('.note .ac')!,
      tn: el.querySelector<HTMLElement>('.note .tn')!,
    };

    // 絵にぴったり合わせる：絵ぜんぶが見えるように収め、外側はぼかした同じ絵で埋める（タイトル画面と同じ）
    const fit = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const r = vw / vh / (IMG_W / IMG_H);
      const s = r > 0.92 && r < 1.08 ? Math.max(vw / IMG_W, vh / IMG_H) : Math.min(vw / IMG_W, vh / IMG_H);
      artEl.style.width = `${IMG_W * s}px`;
      artEl.style.height = `${IMG_H * s}px`;
    };
    fit();
    window.addEventListener('resize', fit);

    let sel = Math.max(0, chars.findIndex((c) => c.id === initial));
    let viewer: CharViewer | null = null;
    let done = false;

    const showModel = () => {
      const spec = CHARACTERS.find((s) => s.id === chars[sel].id);
      if (viewer && spec) viewer.show(spec);
    };

    const applySel = () => {
      const c = chars[sel];
      items.forEach((it, i) => it.classList.toggle('sel', i === sel));
      tagText.textContent = c.name;
      tagText.parentElement!.classList.remove('pop');
      void tagText.offsetWidth;
      tagText.parentElement!.classList.add('pop');
      note.bl.textContent = c.blurb;
      note.sp.textContent = pips(c.stats.speed);
      note.ac.textContent = pips(c.stats.accel);
      note.tn.textContent = pips(c.stats.turn);
    };

    // 一覧のシールは、できしだい入れる。大きなキャラ（3D）は、モデルが読み込めてから出す
    art.then((a) => {
      if (done) return;
      chars.forEach((c, i) => {
        const x = a[c.id];
        if (!x) return;
        const t = items[i].querySelector('img')!;
        t.src = x.thumb;
        t.classList.add('ready');
      });
      viewer = new CharViewer(box);
      viewer.onInteract = () => hint.classList.add('gone');
      showModel();
    });

    // えらばれたシールのまわりに、きらきらをはじけさせる
    const burst = (it: HTMLElement) => {
      for (let k = 0; k < 9; k++) {
        const sp = document.createElement('i');
        sp.className = 'spark';
        const a = (k / 9) * Math.PI * 2 + Math.random() * 0.5;
        const r = 7 + Math.random() * 5;
        sp.style.setProperty('--dx', `${Math.cos(a) * r}cqw`);
        sp.style.setProperty('--dy', `${Math.sin(a) * r}cqw`);
        sp.style.setProperty('--c', ['#ffd54a', '#ff8fb5', '#fff', '#9be3c4'][k % 4]);
        it.appendChild(sp);
        window.setTimeout(() => sp.remove(), 800);
      }
    };

    const select = (i: number, byTap = false) => {
      const n = ((i % chars.length) + chars.length) % chars.length;
      if (n === sel && !byTap) return;
      const changed = n !== sel;
      sel = n;
      applySel();
      if (changed) showModel();
      const it = items[sel];
      it.classList.remove('pick');
      void it.offsetWidth;
      it.classList.add('pick');
      burst(it);
    };
    items.forEach((it, i) => it.addEventListener('click', () => select(i, true)));

    const finish = (result: string | null) => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', fit);
      el.classList.add('out');
      window.setTimeout(() => {
        viewer?.dispose();
        el.remove();
      }, 300);
      resolve(result);
    };
    el.querySelector('.ok')!.addEventListener('click', () => finish(chars[sel].id));
    el.querySelector('.back')!.addEventListener('click', () => finish(null));

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') select(sel - 1);
      else if (e.key === 'ArrowRight') select(sel + 1);
      else if (e.key === 'Enter' || e.key === ' ') finish(chars[sel].id);
      else if (e.key === 'Escape') finish(null);
      else if (Number(e.key) >= 1 && Number(e.key) <= chars.length) select(Number(e.key) - 1, true);
    };
    window.addEventListener('keydown', onKey);

    applySel();
  });
}
