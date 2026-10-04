// 効果音。音の素材ファイルは使わず、Web Audio でその場で作る（ファイルが増えず、すぐ鳴る）。
// iPhone の Safari は、タップ（ユーザー操作）の中で AudioContext を作る／再開しないと鳴らないので、
// unlock() は「タップしてスタート」の操作の中から呼ぶ。
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  // ユーザー操作の中で呼ぶ
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.ctx.destination);
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) void this.ctx?.resume();
        });
      }
      void this.ctx.resume();
    } catch {
      /* 音が使えない環境では、無音で続ける */
    }
  }

  // ベルのような、まるい音 1 つ（基本の音に、倍音を少し重ねる）
  private bell(freq: number, when: number, len: number, vol: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + when;
    for (const [mul, gain] of [[1, 1], [2, 0.32], [3, 0.12]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq * mul;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol * gain, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + len / mul ** 0.35);
      o.connect(g).connect(this.master);
      o.start(t0);
      o.stop(t0 + len + 0.05);
    }
  }

  // スタートの「3・2・1」：ぽん、ぽん、ぽん（同じ高さ）
  countBeep() {
    this.bell(523.25, 0, 0.32, 0.5); // ド
  }

  // ドリフトの溜まりが次の段階に上がった：ぴんっ（段階が上がるほど高い）
  driftLevel(level: number) {
    this.bell([740, 932, 1175][level - 1] ?? 740, 0, 0.2, 0.22);
  }

  // ミニターボが出た：風を切る音と、上がっていく音（段階が上がるほど強く・高く）
  driftBoost(level: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    const dur = 0.35 + level * 0.12;
    // 風を切る音（ノイズを、だんだん高い帯域へ）
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const n = ctx.createBufferSource();
    n.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(500, t0);
    bp.frequency.exponentialRampToValueAtTime(2200 + level * 900, t0 + dur);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t0);
    ng.gain.exponentialRampToValueAtTime(0.32 + level * 0.06, t0 + 0.06);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    n.connect(bp).connect(ng).connect(this.master);
    n.start(t0);
    // 上がっていく音
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(330, t0);
    o.frequency.exponentialRampToValueAtTime(330 + level * 330, t0 + dur * 0.8);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.16, t0 + 0.05);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(og).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  // 「GO!」：高いドミソの和音が、きらっと上がる
  goChime() {
    this.bell(784.0, 0, 0.9, 0.42); // ソ
    this.bell(1046.5, 0.0, 0.9, 0.42); // ド
    this.bell(1318.5, 0.05, 0.9, 0.34); // ミ
    this.bell(1568.0, 0.1, 1.0, 0.3); // ソ
  }
}
