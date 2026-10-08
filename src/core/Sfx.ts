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

  // ノイズ（ざーっという音）の素材
  private noiseBuf(dur: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ばくだんを落とした：どすん、と地面に落ちる音
  bombDrop(vol = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + 0.12; // 落ちるまでの、ちょっとの間
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(190, t0);
    o.frequency.exponentialRampToValueAtTime(60, t0 + 0.14);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5 * vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + 0.25);
  }

  // 導火線が、じりじり燃える音（火花のぱちぱちが、だんだん速く・高く）
  bombFuse(vol = 1, dur = 0.95) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf(dur);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(2600, t0);
    hp.frequency.linearRampToValueAtTime(4200, t0 + dur);
    const g = ctx.createGain();
    // ぱちぱち：短い山をランダムに並べる（終わりに近いほど、間がつまる）
    g.gain.setValueAtTime(0.0001, t0);
    for (let t = 0; t < dur; ) {
      const hot = t / dur;
      g.gain.setValueAtTime(0.03 * vol, t0 + t);
      g.gain.linearRampToValueAtTime((0.16 + 0.14 * hot) * vol * (0.4 + Math.random() * 0.6), t0 + t + 0.008);
      g.gain.linearRampToValueAtTime(0.02 * vol, t0 + t + 0.03);
      t += 0.035 - 0.022 * hot + Math.random() * 0.02;
    }
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    n.connect(hp).connect(g).connect(this.master);
    n.start(t0);
  }

  // スターを使った：きらきらの上りのファンファーレ → ぐんと大きくなる低い音と、昇る風 → 明るい和音がのびる
  starUse(vol = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    const v = Math.max(0.1, Math.min(1, vol));
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568.0, 2093.0];
    notes.forEach((f, i) => this.bell(f, i * 0.062, 0.55, 0.3 * v));
    for (const f of [1046.5, 1318.5, 1568.0, 2093.0]) this.bell(f, 0.5, 1.5, 0.22 * v); // のびる和音
    // ぐんと大きくなる低い音（下から、ぐぐっと上がる）
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(70, t0);
    o.frequency.exponentialRampToValueAtTime(190, t0 + 0.6);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.5 * v, t0 + 0.08);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    o.connect(og).connect(this.master);
    o.start(t0);
    o.stop(t0 + 0.95);
    // 昇る風
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf(0.9);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(300, t0);
    bp.frequency.exponentialRampToValueAtTime(5200, t0 + 0.7);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t0);
    ng.gain.exponentialRampToValueAtTime(0.4 * v, t0 + 0.2);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.85);
    n.connect(bp).connect(ng).connect(this.master);
    n.start(t0);
  }

  // スターが終わった：3つの音が下がって、ぷしゅっと空気がぬける
  starEnd(vol = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    const v = Math.max(0.1, Math.min(1, vol));
    [1568.0, 1318.5, 1046.5].forEach((f, i) => this.bell(f, i * 0.09, 0.35, 0.22 * v));
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf(0.35);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(5000, t0 + 0.25);
    hp.frequency.exponentialRampToValueAtTime(1200, t0 + 0.55);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0 + 0.25);
    g.gain.exponentialRampToValueAtTime(0.18 * v, t0 + 0.28);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
    n.connect(hp).connect(g).connect(this.master);
    n.start(t0 + 0.25);
  }

  // 踏みつぶした：どんっという重さ → ぺちゃっという潰れる音 → ぎゅっと縮んで、ぷぎゅっ
  stomp(vol = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    const v = Math.max(0.08, Math.min(1, vol));
    const out = ctx.createGain();
    out.gain.value = v;
    out.connect(this.master);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t0);
    o.frequency.exponentialRampToValueAtTime(40, t0 + 0.22);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(1.0, t0 + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
    o.connect(og).connect(out);
    o.start(t0);
    o.stop(t0 + 0.35);
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf(0.18);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t0);
    lp.frequency.exponentialRampToValueAtTime(300, t0 + 0.15);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.9, t0);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    n.connect(lp).connect(ng).connect(out);
    n.start(t0);
    const b = ctx.createOscillator();
    b.type = 'triangle';
    b.frequency.setValueAtTime(620, t0 + 0.02);
    b.frequency.exponentialRampToValueAtTime(150, t0 + 0.3);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t0 + 0.02);
    bg.gain.exponentialRampToValueAtTime(0.34, t0 + 0.04);
    bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
    b.connect(bg).connect(out);
    b.start(t0 + 0.02);
    b.stop(t0 + 0.4);
  }

  // つぶれた状態から起き上がる：ぼよよーん
  squashRecover(vol = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    const v = Math.max(0.1, Math.min(1, vol));
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(170, t0);
    o.frequency.exponentialRampToValueAtTime(640, t0 + 0.18);
    o.frequency.exponentialRampToValueAtTime(300, t0 + 0.32);
    o.frequency.exponentialRampToValueAtTime(520, t0 + 0.46);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 22;
    const lg = ctx.createGain();
    lg.gain.value = 26;
    lfo.connect(lg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.32 * v, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
    o.connect(g).connect(this.master);
    o.start(t0);
    lfo.start(t0);
    o.stop(t0 + 0.6);
    lfo.stop(t0 + 0.6);
  }

  // 巨大なカートの足音（どすん、どすん）
  giantStep(vol = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    const v = Math.max(0.05, Math.min(1, vol));
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t0);
    o.frequency.exponentialRampToValueAtTime(34, t0 + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.7 * v, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + 0.3);
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf(0.12);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.35 * v, t0);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    n.connect(lp).connect(ng).connect(this.master);
    n.start(t0);
  }

  // スターが爆風を無効にした：きらんっと光が、はじく
  starShield(vol = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    const v = Math.max(0.1, Math.min(1, vol));
    [2093.0, 2637.0, 3136.0].forEach((f, i) => this.bell(f, i * 0.05, 0.5, 0.26 * v));
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf(0.25);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.2 * v, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
    n.connect(hp).connect(g).connect(this.master);
    n.start(t0);
  }

  // 絶対バリアをはった：ぶぉんっと球がふくらむ低い音 → 昇っていく電子音 → きらきらの和音
  barrierOn(vol = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    const v = Math.max(0.1, Math.min(1, vol));
    const sweep = (type: OscillatorType, f0: number, f1: number, dur: number, gain: number, vib = 0) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t0);
      o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain * v, t0 + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.2);
      if (vib > 0) {
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = 22;
        lg.gain.value = vib;
        lfo.connect(lg).connect(o.frequency);
        lfo.start(t0);
        lfo.stop(t0 + dur + 0.3);
      }
      o.connect(g).connect(this.master!);
      o.start(t0);
      o.stop(t0 + dur + 0.3);
    };
    sweep('sine', 80, 220, 0.3, 0.5); // ぶぉんっ
    sweep('triangle', 260, 1250, 0.42, 0.22, 18); // 昇る電子音
    sweep('sawtooth', 130, 620, 0.4, 0.05, 8);
    [1046.5, 1568.0, 2093.0, 3136.0].forEach((f, i) => this.bell(f, 0.28 + i * 0.045, 0.8, 0.2 * v));
    // 球の表面が張る、さらさらした広がり
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf(0.6);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(1200, t0);
    bp.frequency.exponentialRampToValueAtTime(7000, t0 + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16 * v, t0 + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t0);
  }

  // バリアが攻撃をはじいた：がきぃんっ（金属の衝突）→ ぴゅいーん（はね返される音）→ ずしんと響く低音
  barrierHit(vol = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    const v = Math.max(0.1, Math.min(1, vol));
    // 金属がぶつかる、ずれた倍音の響き
    [[1, 1], [2.76, 0.7], [5.4, 0.45], [8.93, 0.3]].forEach(([m, gn]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 760 * m;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.2 * gn * v, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55 / m ** 0.4);
      o.connect(g).connect(this.master!);
      o.start(t0);
      o.stop(t0 + 0.7);
    });
    // はね返されて遠ざかる、ぴゅいーん
    const z = ctx.createOscillator();
    const zg = ctx.createGain();
    z.type = 'sawtooth';
    z.frequency.setValueAtTime(3400, t0);
    z.frequency.exponentialRampToValueAtTime(520, t0 + 0.34);
    const zf = ctx.createBiquadFilter();
    zf.type = 'bandpass';
    zf.Q.value = 5;
    zf.frequency.setValueAtTime(3400, t0);
    zf.frequency.exponentialRampToValueAtTime(600, t0 + 0.34);
    zg.gain.setValueAtTime(0.0001, t0);
    zg.gain.exponentialRampToValueAtTime(0.3 * v, t0 + 0.012);
    zg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
    z.connect(zf).connect(zg).connect(this.master);
    z.start(t0);
    z.stop(t0 + 0.45);
    // 衝撃の低音
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(170, t0);
    o.frequency.exponentialRampToValueAtTime(48, t0 + 0.2);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.55 * v, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + 0.3);
    // ぱちっという火花
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf(0.22);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t0);
    ng.gain.exponentialRampToValueAtTime(0.3 * v, t0 + 0.004);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    n.connect(hp).connect(ng).connect(this.master);
    n.start(t0);
    // きらきらの余韻
    [2637.0, 3520.0].forEach((f, i) => this.bell(f, 0.05 + i * 0.06, 0.5, 0.14 * v));
  }

  // バリアが切れた：ガラスが砕ける、ぱりーん（細かい破片のきらきら）→ 下がっていく空気の音
  barrierOff(vol = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    const v = Math.max(0.1, Math.min(1, vol));
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf(0.4);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.32 * v, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.36);
    n.connect(hp).connect(g).connect(this.master);
    n.start(t0);
    for (let i = 0; i < 9; i++) this.bell(2400 + Math.random() * 3600, 0.01 + i * 0.045 + Math.random() * 0.03, 0.22, 0.1 * v);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, t0);
    o.frequency.exponentialRampToValueAtTime(140, t0 + 0.5);
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.2 * v, t0 + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    o.connect(og).connect(this.master);
    o.start(t0);
    o.stop(t0 + 0.55);
  }

  // ミサイル発射：ぼふっという発射の圧 → しゅおおっと、ロケットが噴き出して遠ざかる音
  missileLaunch(vol = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    const v = Math.max(0.08, Math.min(1, vol));
    const out = ctx.createGain();
    out.gain.value = v;
    out.connect(this.master);
    // 発射の圧（低い音が、ぼふっと）
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t0);
    o.frequency.exponentialRampToValueAtTime(42, t0 + 0.28);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.85, t0 + 0.012);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
    o.connect(og).connect(out);
    o.start(t0);
    o.stop(t0 + 0.45);
    // 噴射の音（ざーっという音の明るさが、ぐんと上がって、遠ざかるように小さくなる）
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf(1.6);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(500, t0);
    bp.frequency.exponentialRampToValueAtTime(3200, t0 + 0.55);
    bp.frequency.exponentialRampToValueAtTime(1500, t0 + 1.5);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t0);
    ng.gain.exponentialRampToValueAtTime(0.7, t0 + 0.04);
    ng.gain.exponentialRampToValueAtTime(0.28, t0 + 0.6);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.55);
    n.connect(bp).connect(ng).connect(out);
    n.start(t0);
    // 銃口の破裂（短い高い音）
    const c = ctx.createBufferSource();
    c.buffer = this.noiseBuf(0.1);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.6, t0);
    cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
    c.connect(hp).connect(cg).connect(out);
    c.start(t0);
  }

  // ミサイルにねらわれた：ぴぴぴぴっという警報
  missileAlarm() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + 0.05;
    for (let i = 0; i < 5; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = i % 2 ? 1180 : 1500;
      const t = t0 + i * 0.16;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.12);
    }
  }

  // 大爆発：ぱんっという破裂 → 腹にひびく低い音 → ごろごろ → 破片が落ちる音。vol は遠さ（0..1）
  explosion(vol = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    const v = Math.max(0.05, Math.min(1, vol));
    // 音が大きくなりすぎても、ひずんで割れないよう、まるく潰す
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(1.9 * x) / Math.tanh(1.9);
    }
    shaper.curve = curve;
    const out = ctx.createGain();
    out.gain.value = v;
    out.connect(shaper).connect(this.master);

    // 1) 破裂（高い音がきゅっと）
    const crack = ctx.createBufferSource();
    crack.buffer = this.noiseBuf(0.14);
    const chp = ctx.createBiquadFilter();
    chp.type = 'highpass';
    chp.frequency.value = 900;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(1.0, t0);
    cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
    crack.connect(chp).connect(cg).connect(out);
    crack.start(t0);

    // 2) 爆風の本体（明るい音から、重い音へ落ちていく）
    const body = ctx.createBufferSource();
    body.buffer = this.noiseBuf(1.9);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(5200, t0);
    lp.frequency.exponentialRampToValueAtTime(140, t0 + 1.5);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t0);
    bg.gain.exponentialRampToValueAtTime(1.0, t0 + 0.012);
    bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8);
    body.connect(lp).connect(bg).connect(out);
    body.start(t0);

    // 3) 腹にひびく低い音（どん）
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(125, t0);
    sub.frequency.exponentialRampToValueAtTime(27, t0 + 0.6);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t0);
    sg.gain.exponentialRampToValueAtTime(1.15, t0 + 0.012);
    sg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.95);
    sub.connect(sg).connect(out);
    sub.start(t0);
    sub.stop(t0 + 1);

    // 4) ごろごろと、あとを引く音
    const rum = ctx.createBufferSource();
    rum.buffer = this.noiseBuf(2.7);
    const rl = ctx.createBiquadFilter();
    rl.type = 'lowpass';
    rl.frequency.value = 190;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, t0);
    rg.gain.exponentialRampToValueAtTime(0.55, t0 + 0.18);
    rg.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.6);
    rum.connect(rl).connect(rg).connect(out);
    rum.start(t0);

    // 5) 飛び散った破片が、ぱらぱらと落ちる音
    for (let i = 0; i < 8; i++) {
      const when = t0 + 0.4 + Math.random() * 1.1;
      const tick = ctx.createBufferSource();
      tick.buffer = this.noiseBuf(0.06);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800 + Math.random() * 4200;
      bp.Q.value = 1.4;
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, when);
      tg.gain.exponentialRampToValueAtTime(0.18 + Math.random() * 0.12, when + 0.004);
      tg.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
      tick.connect(bp).connect(tg).connect(out);
      tick.start(when);
    }
  }

  // 「GO!」：高いドミソの和音が、きらっと上がる
  goChime() {
    this.bell(784.0, 0, 0.9, 0.42); // ソ
    this.bell(1046.5, 0.0, 0.9, 0.42); // ド
    this.bell(1318.5, 0.05, 0.9, 0.34); // ミ
    this.bell(1568.0, 0.1, 1.0, 0.3); // ソ
  }
}
