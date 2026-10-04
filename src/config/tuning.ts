// カートの操作感パラメータ（速度は m/s、角度は rad/s）
export const KART = {
  maxSpeed: 24,
  accel: 16,
  brake: 32,
  reverseMax: 7,
  coast: 6, // アクセルを離したときの減速
  overspeedDecel: 18, // 最高速を超えているときの減速
  offroadMax: 10, // 草の上での最高速

  steerRate: 2.0,
  steerFullSpeed: 6, // この速度未満ではハンドルが効きにくい
  grip: 12,
  driftGrip: 4,
  driftMinSpeed: 12,
  autoDriftSteer: 0.7, // これ以上ハンドルを切ると…
  autoDriftDelay: 0.15, // …この秒数続いたらドリフト開始
  autoDriftRelease: 0.15, // ハンドルがこれ未満（ほぼ真ん中）になると…
  autoDriftReleaseDelay: 0.12, // …この秒数でミニターボ発動
  // ドリフト中の旋回：まんなかなら base。内側に切ると base + driftTurnIn、外側に切る（カウンター）と base - driftTurnOut。
  // カウンターは強く効き、外へいっぱい切ると逆向きに回って車体を立て直す
  driftTurnBase: 1.15,
  driftTurnIn: 0.95,
  driftTurnOut: 1.7,
  driftCounterGrip: 9, // カウンターを当てているときに増える横滑りの収まりやすさ
  driftVisualYaw: 0.4,

  // ミニターボ（青 → 橙 → 紫）。ドリフトを続けた時間（溜まり）が長いほど、ダッシュの速さも長さも増える
  driftLevelTimes: [0.65, 1.4, 2.2], // 色が変わる溜まりの時間
  driftChargeMax: 3.0, // この時間で、ダッシュの強さが最大になる
  driftBoostTime: [0.55, 2.0], // ダッシュの長さ（秒）：最小の溜まり → 最大の溜まり
  driftBoostPower: [5, 13], // ダッシュで増える最高速（m/s）
  boostSpeed: 9, // ダッシュ板・キノコなど、ふつうのダッシュ
  boostAccel: 45,
  starSpeed: 6,
  dashBoost: 1.0, // ダッシュ板
  coinSpeed: 0.12, // コイン1枚あたりの最高速アップ（最大10枚）

  hopVelocity: 4.5,
  jumpVelocity: 9.5, // ジャンプボタン
  trickBoost: 0.7, // 1回転して着地したときのブースト
  gravity: 26,
  glideGravity: 5, // グライダー中の重力
  glideSink: 2.2, // グライダー中に落ちる速さの上限 (m/s)
  glideSpeed: 4, // グライダー中の最高速アップ

  wallBounce: 0.4,
};

export const DRIFT_COLORS = ['#5ab4ff', '#ffa53a', '#ff6ad5'];

export const RACE = {
  laps: 3,
  cpus: 4, // 相手の人数。えらばなかったキャラの中から、毎回ランダムに決まる
};
