import { RACE, KART, DRIFT_COLORS } from '../config/tuning';
import { ITEMS, ITEM_IDS } from '../game/Items';
import type { Race } from '../game/Race';
import type { Racer } from '../game/Racer';
import type { Track } from '../track/Track';

const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

export class HUD {
  private el: Record<string, HTMLElement> = {};
  private map: HTMLCanvasElement;
  private mapBg: HTMLCanvasElement;
  private mapTf: { s: number; ox: number; oz: number };
  private last: Record<string, string | number> = {};
  private flashTimer = 0;
  private rouletteT = 0;

  constructor(root: HTMLElement, private track: Track) {
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="speedlines"></div>
      <div id="item-slot"><div class="ring"><span></span></div></div>
      <div id="bottom-left">
        <div class="pill coins"><i class="coin"></i><b>0</b></div>
        <div class="pill lap"><i class="flag"></i><b>1/${RACE.laps}</b></div>
      </div>
      <canvas id="minimap"></canvas>
      <div id="place"><span class="back">5th</span><span class="front">5th</span></div>
      <div id="timer">0:00.00</div>
      <div id="drift"><i></i></div>
      <div id="banner"></div>
      <div id="center"></div>
      <div id="results"></div>`,
    );
    for (const id of ['speedlines', 'item-slot', 'minimap', 'place', 'timer', 'drift', 'banner', 'center', 'results']) {
      this.el[id] = document.getElementById(id)!;
    }
    this.el.itemIcon = this.el['item-slot'].querySelector('span')!;
    this.el.coins = root.querySelector('.coins b')!;
    this.el.lap = root.querySelector('.lap b')!;
    this.el.placeBack = this.el.place.querySelector('.back')!;
    this.el.placeFront = this.el.place.querySelector('.front')!;

    // ミニマップの背景（コース形状）を先に描いておく
    this.map = this.el.minimap as HTMLCanvasElement;
    const S = 180 * Math.min(2, devicePixelRatio);
    this.map.width = this.map.height = S;
    const xs = track.pts.map((p) => p.x), zs = track.pts.map((p) => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const s = (S * 0.8) / Math.max(maxX - minX, maxZ - minZ);
    // 画面の上 = コースの +Z（スタートの進行方向）、左右は画面と合わせて反転
    this.mapTf = { s, ox: S / 2 + ((minX + maxX) / 2) * s, oz: S / 2 + ((minZ + maxZ) / 2) * s };
    this.mapBg = document.createElement('canvas');
    this.mapBg.width = this.mapBg.height = S;
    const g = this.mapBg.getContext('2d')!;
    g.lineJoin = g.lineCap = 'round';
    const path = () => {
      g.beginPath();
      track.pts.forEach((p, i) => {
        const [x, y] = this.toMap(p.x, p.z);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.closePath();
    };
    path();
    g.strokeStyle = 'rgba(60,50,45,0.55)';
    g.lineWidth = S * 0.075;
    g.stroke();
    path();
    g.strokeStyle = '#ffffff';
    g.lineWidth = S * 0.05;
    g.stroke();
    // スタートの市松
    const [sx, sy] = this.toMap(track.pts[0].x, track.pts[0].z);
    const cs = S * 0.02;
    for (let i = -2; i < 2; i++) {
      for (let j = -1; j < 1; j++) {
        g.fillStyle = (i + j) % 2 ? '#222' : '#fff';
        g.fillRect(sx + i * cs, sy + j * cs, cs, cs);
      }
    }
  }

  private toMap(x: number, z: number): [number, number] {
    const { s, ox, oz } = this.mapTf;
    return [ox - x * s, oz - z * s];
  }

  private set(key: string, value: string | number, apply: () => void) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply();
  }

  flash(text: string, big = false, color = '') {
    const b = this.el.banner;
    b.textContent = text;
    b.style.color = color;
    b.className = big ? 'show big' : 'show';
    void b.offsetWidth;
    this.flashTimer = 1.6;
  }

  showCenter(text: string, cls = '') {
    this.el.center.innerHTML = text;
    this.el.center.className = cls;
  }

  update(dt: number, race: Race) {
    const p = race.player;
    const k = p.kart;

    // アイテム枠（ルーレット中は絵柄が回る）
    if (p.roulette > 0) {
      this.rouletteT += dt;
      const icon = ITEMS[ITEM_IDS[Math.floor(this.rouletteT * 14) % ITEM_IDS.length]].icon;
      this.set('item', 'r' + icon, () => {
        this.el.itemIcon.textContent = icon;
        this.el['item-slot'].className = 'rolling';
      });
    } else {
      const icon = p.item ? ITEMS[p.item].icon : '';
      this.set('item', icon, () => {
        this.el.itemIcon.textContent = icon;
        this.el['item-slot'].className = icon ? 'got' : '';
      });
    }

    this.set('coins', p.coins, () => (this.el.coins.textContent = String(p.coins)));
    const lap = Math.max(1, Math.min(p.lapCount, RACE.laps));
    this.set('lap', lap, () => (this.el.lap.textContent = `${lap}/${RACE.laps}`));
    this.set('place', p.place, () => {
      this.el.placeBack.textContent = this.el.placeFront.textContent = ORD[p.place - 1];
      this.el.place.classList.remove('pop');
      void this.el.place.offsetWidth;
      this.el.place.classList.add('pop');
    });
    const tm = formatTime(race.time);
    this.set('time', tm, () => (this.el.timer.textContent = tm));

    // スピード線
    // ダッシュが強いほど、スピード線も濃く
    const sp = Math.max(0, k.forwardSpeed - KART.maxSpeed * 0.92) / 8 + (k.boostTime > 0 ? 0.35 + 0.65 * Math.min(1, k.boostPower / KART.driftBoostPower[1]) : 0);
    const op = Math.min(1, sp);
    const ops = op.toFixed(2);
    this.set('speedOp', ops, () => (this.el.speedlines.style.opacity = ops));
    if (op > 0) this.el.speedlines.style.transform = `rotate(${(Math.random() * 6).toFixed(1)}deg) scale(1.15)`;

    // ドリフトゲージ：ドリフト中は溜まり具合（色は段階）、ダッシュ中は残りの勢い
    let fill = 0, color = '', mode = '';
    if (k.drifting && k.grounded) {
      fill = Math.min(1, k.driftCharge / KART.driftChargeMax);
      color = k.driftLevel > 0 ? DRIFT_COLORS[k.driftLevel - 1] : '#ffffff';
      mode = k.driftLevel >= 3 ? 'on max' : 'on';
      this.boostColor = color;
    } else if (k.boostTime > 0 && k.boostTotal > 0.6 && k.boostPower > 6) {
      fill = Math.min(1, k.boostTime / k.boostTotal);
      color = this.boostColor;
      mode = 'on boost';
    }
    const f = Math.round(fill * 100);
    this.set('driftFill', f + color + mode, () => {
      const d = this.el.drift;
      d.className = mode;
      const i = d.firstElementChild as HTMLElement;
      i.style.width = f + '%';
      i.style.background = color;
    });

    if (this.flashTimer > 0 && (this.flashTimer -= dt) <= 0) this.el.banner.className = '';

    // ミニマップは小さいので、1秒に30回の描き直しで十分（毎フレームの描き直しを半分に）
    this.mapT += dt;
    if (this.mapT >= 1 / 30 - 1e-3) {
      this.mapT = 0;
      this.drawMap(race.racers, p);
    }
  }
  private mapT = 1;
  private boostColor = '#ffb040'; // ダッシュ中のゲージの色（直前のドリフトの段階の色）

  private drawMap(racers: Racer[], player: Racer) {
    const g = this.map.getContext('2d')!;
    const S = this.map.width;
    g.clearRect(0, 0, S, S);
    g.drawImage(this.mapBg, 0, 0);
    const size = S * 0.17;
    const order = [...racers].sort((a) => (a === player ? 1 : -1));
    for (const r of order) {
      const [x, y] = this.toMap(r.kart.pos.x, r.kart.pos.z);
      const sz = r === player ? size * 1.25 : size;
      if (r === player) {
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.beginPath();
        g.arc(x, y, sz * 0.42, 0, Math.PI * 2);
        g.fill();
      }
      g.drawImage(r.icon, x - sz / 2, y - sz * 0.6, sz, sz);
    }
  }

  showResults(race: Race, onRetry: () => void) {
    const rows = [...race.racers]
      .sort((a, b) => a.place - b.place)
      .map((r) => {
        const time = r.finished ? formatTime(r.finishTime) : '--:--.--';
        const img = r.icon.toDataURL();
        return `<li class="${r.isPlayer ? 'me' : ''}"><span class="rk">${ORD[r.place - 1]}</span><img src="${img}"><span class="nm">${r.spec.name}</span><span class="tm">${time}</span></li>`;
      })
      .join('');
    this.el.results.innerHTML = `<div class="panel"><h2>けっか</h2><ol>${rows}</ol><button class="retry">もういっかい</button></div>`;
    this.el.results.classList.add('show');
    document.body.classList.add('finished'); // 操作ボタンは、けっかと重なるので隠す
    const btn = this.el.results.querySelector<HTMLButtonElement>('.retry')!;
    btn.addEventListener('pointerup', onRetry);
  }
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
