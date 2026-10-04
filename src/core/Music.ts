// BGM（ループ再生）。ゲームごとの曲は BGM に、キャラ・コース選択の曲も同じ仕組みで鳴らす。
// iPhone の Safari は、画面をタップ（ユーザー操作）したあとでないと音を鳴らせないので、
// start() は、タップなどの操作の中から呼ぶ。
export const BGM = {
  menu: 'audio/bgm-chara-select.mp3', // キャラ選択・コース選択
  meadow: 'audio/bgm-sougen.mp3', // 草むしり原っぱ「草原の疾走感」
  rainbow: 'audio/bgm-rainbow.mp3', // レインボーロード
  candy: 'audio/bgm-candy.mp3', // キャンディーポップロード
  sunset: 'audio/bgm-sunset.mp3', // 夕焼け海岸
} as const;

export class Music {
  readonly audio: HTMLAudioElement; // 開発中の確認用に公開
  private volume: number;
  private want = false; // 鳴らしたい状態（画面が隠れたら止め、戻ったら再開する）
  private fadeTimer = 0;

  constructor(file: string = BGM.meadow, volume = 0.7) {
    this.volume = volume;
    const a = new Audio(`${import.meta.env.BASE_URL}${file}`);
    a.loop = true;
    a.preload = 'auto';
    a.volume = 0;
    // iOS でホーム画面のプレイヤーに出さず、インライン再生にする
    a.setAttribute('playsinline', '');
    this.audio = a;

    // ホーム画面へ戻る・タブを切り替えたら止め、戻ってきたら続きから再開
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.audio.pause();
      else if (this.want) void this.play();
    });
  }

  private async play() {
    try {
      await this.audio.play();
    } catch {
      /* 自動再生が許可されていない場合は、次のタップで再挑戦する */
    }
  }

  // ユーザー操作の中で呼ぶ。最初から流し、音量はふわっと上げる
  start() {
    this.want = true;
    this.audio.currentTime = 0;
    void this.play();
    this.fadeTo(this.volume, 1.2);
  }

  // 音量をなめらかに変える
  fadeTo(target: number, seconds: number, onDone?: () => void) {
    window.clearInterval(this.fadeTimer);
    const from = this.audio.volume;
    const t0 = performance.now();
    this.fadeTimer = window.setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / (seconds * 1000));
      this.audio.volume = Math.max(0, Math.min(1, from + (target - from) * k));
      if (k >= 1) {
        window.clearInterval(this.fadeTimer);
        onDone?.();
      }
    }, 50);
  }

  // ゴール後は少し音を下げ、結果画面ではさらに静かに
  duck(level: number, seconds = 1.5) {
    this.fadeTo(this.volume * level, seconds);
  }

  stop(seconds = 1.5) {
    this.want = false;
    this.fadeTo(0, seconds, () => this.audio.pause());
  }
}
