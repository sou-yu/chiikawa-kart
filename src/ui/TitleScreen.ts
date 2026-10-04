// 最初に出す「タイトル画面」。用意した 1 枚の絵（public/images/title.webp、941×1672）をそのまま見せ、
// 絵の中の「スタート」ボタン（または画面のどこか）を押すと次へ進む。
// ?char= や ?course= を付けたとき、または ?notitle のときは、この画面を飛ばす（開発・確認用）

import { getControlMode, setControlMode } from '../core/settings';

// CSS 変数の url() は CSS ファイル（assets/）からの相対で解かれるので、ページ基準の絶対 URL にしておく
const SRC = new URL(`${import.meta.env.BASE_URL}images/title.webp`, document.baseURI).href;
const IMG_W = 941;
const IMG_H = 1672;
// 絵の中の「スタート」ボタンの範囲（絵に対する割合）。少しだけ内側にとる
const BTN = { x: 226 / IMG_W, y: 568 / IMG_H, w: 496 / IMG_W, h: 164 / IMG_H };

export function showTitle(): Promise<void> {
  const q = new URLSearchParams(location.search);
  if (q.has('char') || q.has('course') || q.has('notitle')) return Promise.resolve();

  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.id = 'title-screen';
    el.innerHTML = `
      <div class="bg"></div>
      <div class="art">
        <img src="${SRC}" alt="ちいかわカート" draggable="false">
        <span class="go"></span>
        <div class="ctl" role="group" aria-label="そうさほうほう">
          <span class="lb">そうさ</span>
          <button type="button" data-mode="buttons"><i>🕹️</i>ボタン</button>
          <button type="button" data-mode="thumb"><i>☝️</i>おやゆび</button>
        </div>
      </div>`;
    el.style.setProperty('--title-src', `url("${SRC}")`);
    const art = el.querySelector<HTMLDivElement>('.art')!;
    const go = el.querySelector<HTMLSpanElement>('.go')!;
    // ボタンの部分だけを同じ絵から切り出して重ね、ふわっと脈打たせる
    Object.assign(go.style, {
      left: `${BTN.x * 100}%`,
      top: `${BTN.y * 100}%`,
      width: `${BTN.w * 100}%`,
      height: `${BTN.h * 100}%`,
      backgroundImage: `url("${SRC}")`,
      backgroundSize: `${100 / BTN.w}% ${100 / BTN.h}%`,
      backgroundPosition: `${(BTN.x / (1 - BTN.w)) * 100}% ${(BTN.y / (1 - BTN.h)) * 100}%`,
    });

    // 操作方法のえらび（ボタン／おやゆび）。えらんだほうをピンクで強調。ここを押しても、ゲームは始まらない
    const ctl = el.querySelector<HTMLDivElement>('.ctl')!;
    const paintCtl = () => {
      const now = getControlMode();
      for (const b of ctl.querySelectorAll<HTMLButtonElement>('button')) {
        const on = b.dataset.mode === now;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      }
    };
    paintCtl();
    ctl.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b) return;
      setControlMode(b.dataset.mode === 'thumb' ? 'thumb' : 'buttons');
      paintCtl();
      b.blur(); // 押したあとも、キーでスタートできるように
    });
    // キーボードで押したときに、ゲームが始まってしまわないように
    ctl.addEventListener('keydown', (e) => e.stopPropagation());

    // 絵ぜんぶが見えるように収める（絵の外側は、ぼかした同じ絵で埋める）。画面の形が絵とほとんど同じなら、いっぱいに広げる
    const fit = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const r = vw / vh / (IMG_W / IMG_H);
      const s = r > 0.92 && r < 1.08 ? Math.max(vw / IMG_W, vh / IMG_H) : Math.min(vw / IMG_W, vh / IMG_H);
      art.style.width = `${IMG_W * s}px`;
      art.style.height = `${IMG_H * s}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    document.body.appendChild(el);

    let done = false;
    const start = () => {
      if (done) return;
      done = true;
      window.removeEventListener('resize', fit);
      window.removeEventListener('keydown', onKey);
      el.classList.add('out');
      window.setTimeout(() => el.remove(), 350);
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      start();
    };
    el.addEventListener('click', start);
    window.addEventListener('keydown', onKey);
  });
}
