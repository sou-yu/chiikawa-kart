import './courseSelect.css';

// 「コースをえらぼう」画面。用意した 1 枚の背景の絵（public/images/courseselect-bg.webp、941×1672）の上に、
//  ・4 つのコースのカードを押すと、そのコースが「えらばれた」状態になる（大きくなり、ピンクの枠とチェックがつく）
//  ・絵の中の「けってい」で決めて次へ進む。「もどる」はキャラ選択へ（null を返す）
// 絵の中では、キャンディーポップロードが「えらばれた」状態で描かれている。ほかのコースをえらんだときは、
// その絵のカードの部分を切り出して重ね、キャンディーポップロードのほうは枠の色とチェックをかくして、ふつうのカードに戻す。
// ?course=（コースの id）を付けると、この画面を飛ばす（開発・確認用）

const SRC = `${import.meta.env.BASE_URL}images/courseselect-bg.webp`;
const IMG_W = 941;
const IMG_H = 1672;

interface R {
  x: number;
  y: number;
  w: number;
  h: number;
}
// 絵の中の座標（ピクセル）。frame = 絵の部分の枠、lab = 名前のリボン、box = カードぜんたい（切り出す範囲）
interface Card {
  id: string;
  frame: R;
  lab: R;
  box: R;
  hit: R; // 押せる範囲
  baked?: boolean; // 絵の中で「えらばれた」状態になっているカード
}
const CARDS: Card[] = [
  {
    id: 'meadow',
    frame: { x: 33, y: 392, w: 423, h: 424 },
    lab: { x: 46, y: 772, w: 408, h: 88 },
    box: { x: 22, y: 384, w: 444, h: 484 },
    hit: { x: 22, y: 384, w: 444, h: 484 },
  },
  {
    id: 'rainbow',
    frame: { x: 494, y: 398, w: 424, h: 424 },
    lab: { x: 494, y: 780, w: 424, h: 92 },
    box: { x: 484, y: 388, w: 444, h: 490 },
    hit: { x: 484, y: 388, w: 444, h: 490 },
  },
  {
    id: 'candy',
    frame: { x: 14, y: 867, w: 454, h: 446 },
    lab: { x: 6, y: 1284, w: 462, h: 132 },
    box: { x: 4, y: 858, w: 472, h: 566 },
    hit: { x: 4, y: 858, w: 472, h: 566 },
    baked: true,
  },
  {
    id: 'sunset',
    frame: { x: 494, y: 880, w: 424, h: 424 },
    lab: { x: 500, y: 1288, w: 424, h: 120 },
    box: { x: 484, y: 872, w: 446, h: 546 },
    hit: { x: 484, y: 872, w: 446, h: 546 },
  },
];
// 絵の中のボタンの範囲
const BTN_OK: R = { x: 262, y: 1486, w: 420, h: 134 };
const BTN_BACK: R = { x: 34, y: 44, w: 178, h: 80 };

const SEL_SCALE = 1.07; // えらばれたカードの大きさ（絵の中のキャンディーのカードが、ほかより約 7% 大きい）

export interface CourseChoice {
  id: string;
  name: string;
}

// px（絵の座標）→ 絵の幅に対する割合（cqw）
const u = (v: number) => `${((v * 100) / IMG_W).toFixed(4)}cqw`;
const box = (r: R) => `left:${u(r.x)};top:${u(r.y)};width:${u(r.w)};height:${u(r.h)}`;
// dest の場所（origin の左上からの位置）
const place = (dest: R, origin: R) => `left:${u(dest.x - origin.x)};top:${u(dest.y - origin.y)};width:${u(dest.w)};height:${u(dest.h)}`;
// 絵の一部（src）を、dw×dh の大きさに引きのばして背景にする
const bg = (src: R, dw: number, dh: number) =>
  `background-image:url('${SRC}');background-size:${u((IMG_W * dw) / src.w)} ${u((IMG_H * dh) / src.h)};background-position:${u((-src.x * dw) / src.w)} ${u((-src.y * dh) / src.h)}`;

export function chooseCourse(courses: CourseChoice[], initial?: string): Promise<string | null> {
  const forced = new URLSearchParams(location.search).get('course');
  if (forced && courses.some((c) => c.id === forced)) return Promise.resolve(forced);

  const list = CARDS.filter((c) => courses.some((x) => x.id === c.id));
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.id = 'course-pick';
    el.style.setProperty('--cp-src', `url("${SRC}")`);

    const cardHtml = list
      .map((c) => {
        const b = c.box;
        const f = c.frame;
        const white = !!c.baked;
        // ふつうのカードは、えらばれると「ピンクの枠 + チェック」。絵の中でえらばれているカードは、えらばれていないとき
        // 「白い枠」にして、チェックの部分を空の色でうめる
        const ringPad = white ? 4 : 3;
        const ring = { x: f.x - ringPad, y: f.y - ringPad, w: f.w + ringPad * 2, h: Math.min(f.h, c.lab.y + 24 - f.y) + ringPad * 2 };
        const fix: R = { x: f.x + f.w - 108, y: f.y - 12, w: 106, h: 112 };
        return `<div class="cc ${white ? 'white' : 'pink'}" data-id="${c.id}" style="${box(b)};--s:${c.baked ? 1 : SEL_SCALE}">
          <div class="clone" style="${place(b, b)};${bg(b, b.w, b.h)}"></div>
          ${white ? `<div class="fix" style="${place(fix, b)}"></div>` : ''}
          <div class="ring" style="${place(ring, b)}"></div>
          <div class="lab" style="${place(c.lab, b)};${bg(c.lab, c.lab.w, c.lab.h)}"></div>
          <i class="chk" style="left:${u(f.x + f.w - 52 - 44 - b.x)};top:${u(f.y + 38 - 44 - b.y)}"></i>
        </div>`;
      })
      .join('');
    const hitHtml = list.map((c) => `<button class="hit" type="button" data-id="${c.id}" aria-label="${courses.find((x) => x.id === c.id)!.name}" style="${box(c.hit)}"></button>`).join('');
    // ほかのカードをえらんだとき、絵の中の「えらばれたキャンディー」を、紙の色でうめる（上の細いすきまの紙を、たてにのばして使う）
    const baked = list.find((c) => c.baked);
    const paper = baked ? `<div class="paper" style="${box({ x: 4, y: 858, w: 474, h: 560 })}"></div>` : '';

    el.innerHTML = `
      <div class="bg"></div>
      <div class="art">
        <img class="back-img" src="${SRC}" alt="コースをえらぼう" draggable="false">
        ${paper}
        ${cardHtml}
        ${hitHtml}
        <button class="back" type="button" aria-label="もどる" style="${box(BTN_BACK)}"><span style="left:0;top:0;width:${u(BTN_BACK.w)};height:${u(BTN_BACK.h)};${bg(BTN_BACK, BTN_BACK.w, BTN_BACK.h)}"></span></button>
        <button class="ok" type="button" aria-label="けってい" style="${box(BTN_OK)}"><span style="left:0;top:0;width:${u(BTN_OK.w)};height:${u(BTN_OK.h)};${bg(BTN_OK, BTN_OK.w, BTN_OK.h)}"></span></button>
        <div class="loading">じゅんび中…</div>
      </div>`;
    document.body.appendChild(el);

    const artEl = el.querySelector<HTMLElement>('.art')!;
    const ccs = new Map<string, HTMLElement>();
    el.querySelectorAll<HTMLElement>('.cc').forEach((e) => ccs.set(e.dataset.id!, e));
    const paperEl = el.querySelector<HTMLElement>('.paper');

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

    const bakedId = baked?.id;
    let sel = list.some((c) => c.id === initial) ? initial! : bakedId ?? list[0].id;

    const burst = (c: Card) => {
      const cc = ccs.get(c.id)!;
      const f = c.frame;
      for (let k = 0; k < 12; k++) {
        const sp = document.createElement('i');
        sp.className = 'spark';
        const a = (k / 12) * Math.PI * 2 + Math.random() * 0.4;
        const r = 9 + Math.random() * 6;
        sp.style.left = u(f.x + f.w * (0.5 + Math.cos(a) * 0.35) - c.box.x);
        sp.style.top = u(f.y + f.h * (0.5 + Math.sin(a) * 0.35) - c.box.y);
        sp.style.setProperty('--dx', `${Math.cos(a) * r}cqw`);
        sp.style.setProperty('--dy', `${Math.sin(a) * r}cqw`);
        sp.style.setProperty('--c', ['#ffd54a', '#ff8fb5', '#ffffff', '#9be3c4'][k % 4]);
        cc.appendChild(sp);
        window.setTimeout(() => sp.remove(), 800);
      }
    };

    const apply = (pop: boolean) => {
      for (const c of list) {
        const cc = ccs.get(c.id)!;
        const on = c.id === sel;
        if (c.baked) {
          // 絵の中のカードそのまま（えらばれているとき）／ふつうのカードに戻す（えらばれていないとき）
          cc.classList.toggle('on', true);
          cc.classList.toggle('baked', on);
          cc.style.setProperty('--s', on ? '1' : String(1 / SEL_SCALE));
          paperEl?.classList.toggle('show', !on);
        } else {
          cc.classList.toggle('on', on);
        }
        cc.classList.remove('pick');
        if (on && pop) {
          void cc.offsetWidth;
          cc.classList.add('pick');
          burst(c);
        }
      }
    };

    el.querySelectorAll<HTMLButtonElement>('.hit').forEach((b) => {
      b.addEventListener('click', () => {
        const changed = b.dataset.id !== sel;
        sel = b.dataset.id!;
        apply(changed);
      });
    });

    let done = false;
    const finish = (result: string | null) => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', fit);
      if (result === null) {
        el.classList.add('out');
        window.setTimeout(() => el.remove(), 300);
        resolve(null);
        return;
      }
      // 画面に「じゅんび中」を出してから、重いコース作りを始める
      el.classList.add('go');
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          resolve(result);
          el.remove();
        }),
      );
    };
    el.querySelector('.ok')!.addEventListener('click', () => finish(sel));
    el.querySelector('.back')!.addEventListener('click', () => finish(null));

    const onKey = (e: KeyboardEvent) => {
      const i = list.findIndex((c) => c.id === sel);
      const go = (n: number) => {
        const id = list[(n + list.length) % list.length].id;
        const changed = id !== sel;
        sel = id;
        apply(changed);
      };
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(i - 1);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(i + 1);
      else if (e.key === 'Enter' || e.key === ' ') finish(sel);
      else if (e.key === 'Escape') finish(null);
      else if (Number(e.key) >= 1 && Number(e.key) <= list.length) go(Number(e.key) - 1);
    };
    window.addEventListener('keydown', onKey);

    apply(false);

    // 絵の中のチェックの下にかくれている「空」を、すぐ左の空の色から作る（たての色のならび）。上の少しは、紙の色
    const bakedCard = baked;
    const fixEl = el.querySelector<HTMLElement>('.fix');
    if (bakedCard && fixEl) {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = IMG_W;
        c.height = IMG_H;
        const g = c.getContext('2d', { willReadFrequently: true });
        if (!g) return;
        g.drawImage(img, 0, 0);
        const avg = (x: number, y: number) => {
          const d = g.getImageData(x - 3, y - 3, 7, 7).data;
          let r = 0, gg = 0, b = 0;
          for (let i = 0; i < d.length; i += 4) {
            r += d[i];
            gg += d[i + 1];
            b += d[i + 2];
          }
          const n = d.length / 4;
          return [r / n, gg / n, b / n].map(Math.round);
        };
        const f = bakedCard.frame;
        const x0 = f.x + f.w - 118; // チェックのすぐ左
        const paperC = avg(f.x + f.w - 70, f.y - 10);
        const ys = [f.y + 26, f.y + 46, f.y + 66, f.y + 86, f.y + 106];
        const sky = ys.map((y) => avg(x0, y));
        const rgb = (v: number[]) => `rgb(${v[0]},${v[1]},${v[2]})`;
        const top = 12 / 112; // fix の高さのうち、紙の色の部分
        const stops = [`${rgb(paperC)} 0%`, `${rgb(paperC)} ${(top * 100).toFixed(1)}%`, `${rgb(sky[0])} ${((top + 0.1) * 100).toFixed(1)}%`];
        sky.forEach((cc, i) => stops.push(`${rgb(cc)} ${(((12 + 18 + i * 18) / 112) * 100).toFixed(1)}%`));
        fixEl.style.background = `linear-gradient(to bottom, ${stops.join(',')})`;
        // 紙：カードの下の、ほかに何もない紙の色を横にならべて、たてにのばす（ページのまんなかのへこみも、そのまま）
        if (paperEl) {
          const ps: string[] = [];
          for (let x = 8; x <= 476; x += 26) ps.push(`${rgb(avg(Math.min(x, IMG_W - 4), 1426))} ${(((x - 4) / 474) * 100).toFixed(1)}%`);
          paperEl.style.background = `linear-gradient(to right, ${ps.join(',')})`;
        }
      };
      img.src = SRC;
    }
  });
}
