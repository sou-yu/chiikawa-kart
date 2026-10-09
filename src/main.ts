import { BGM, Music } from './core/Music';
import { Sfx } from './core/Sfx';
import { INTRO_TIME, IntroCam, type CamPose } from './game/IntroCam';
import { refFaceFlat } from './characters/refFace';
import * as THREE from 'three';
import { CHARACTERS } from './config/characters';
import { KART, RACE } from './config/tuning';
import { Input, isTouchDevice } from './core/Input';
import { getControlMode, getGraphicsQuality } from './core/settings';
import { Particles, type FXSystems } from './fx/Particles';
import { ItemSystem } from './game/Items';
import { Race } from './game/Race';
import { Racer } from './game/Racer';
import { buildLandmarks, type Landmarks } from './track/Landmarks';
import { RAINBOW_FOG, RAINBOW_LIGHTS, buildRainbowWorld, rainbowSkyMaterial } from './track/RainbowWorld';
import { RAINBOW } from './track/tracks/rainbow';
import { CANDY } from './track/tracks/candy';
import { CANDY_FOG, CANDY_LIGHTS, buildCandyWorld } from './track/candy/world';
import { candySkyMaterial } from './track/candy/materials';
import { SUNSET } from './track/tracks/sunset';
import { SUNSET_FOG, SUNSET_LIGHTS, buildSunsetWorld } from './track/sunset/world';
import { SUNSET_LIGHT_DIR, sunsetSkyMaterial } from './track/sunset/materials';
import { chooseCourse } from './ui/CourseSelect';
import { chooseCharacter } from './ui/CharacterSelect';
import { showTitle } from './ui/TitleScreen';
import { renderPortraits, type CharArt } from './characters/portraits';
import { loadCharacterModels } from './characters/GltfCharacter';
import { setGroundFx } from './fx/KartFX';
import { buildScenery, skyMaterial } from './track/Scenery';
import { chunkInstances } from './core/chunkInstances';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SUN_DIR, applySoftLight, globalUniforms } from './core/shaders';
import { PAL } from './config/palette';
import { paperTexture } from './core/textures';
import { StorybookPass } from './fx/StorybookPass';
import { Track } from './track/Track';
import { KUSAMUSHIRI } from './track/tracks/kusamushiri';
import { HUD } from './ui/HUD';
import { RearMirror } from './fx/RearMirror';

async function boot() {
  // 縦持ち（スマホ・タブレットの縦画面）用の配置に切り替える。選ぶ画面から効くよう、最初に付ける
  const syncPortrait = () => document.body.classList.toggle('portrait', window.innerHeight > window.innerWidth);
  syncPortrait();
  window.addEventListener('resize', syncPortrait);

  // 看板の文字などをキャンバスに描く前にフォントを待つ（最大2.5秒）
  try {
    await Promise.race([
      Promise.all([document.fonts.load('900 40px "M PLUS Rounded 1c"'), document.fonts.load('800 40px "M PLUS Rounded 1c"')]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    /* フォントが無くても続行 */
  }

  // キャラの 3D モデルは、キャラやコースを選んでいるあいだに読み込んでおく。
  // 読み込めたら、キャラ選択の画面に出す絵（モデルを撮ったもの）を作る
  const playerModelReady = loadCharacterModels();
  const portraits = playerModelReady
    .then(() => renderPortraits(CHARACTERS.filter((c) => c.pickable).map((c) => c.id)))
    .catch((e) => {
      console.warn('キャラの絵を作れませんでした。', e);
      return {} as Record<string, CharArt>;
    });

  // --- タイトル画面（モデルを読み込んでいる間に見せる）→ キャラをえらぶ。「もどる」ならタイトルへ ---
  // タイトル・キャラ選択・コース選択のBGM。最初のタップ／キー入力の「中」で鳴らし始める（iPhone の Safari はこうしないと鳴らない）。
  // コースがきまったら、ゆっくり消す（ゲームの BGM は、ゲームの中の最初のタップで始まる）
  const menuMusic = new Music(BGM.menu, 0.6);
  if (import.meta.env.DEV) Object.assign(window, { __menuMusic: menuMusic });
  const startMenuMusic = () => {
    menuMusic.start();
    for (const ev of ['pointerdown', 'keydown']) window.removeEventListener(ev, startMenuMusic, true);
  };
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, startMenuMusic, true);

  // 「もどる」：キャラ選択 → タイトル、コース選択 → キャラ選択
  let lastChar: string | undefined;
  let lastCourse: string | undefined;
  const pickable = CHARACTERS.filter((c) => c.pickable);
  let charId: string | null = null;
  let courseId: string | null = null;
  let withTitle = true;
  while (courseId === null) {
    if (charId === null) {
      if (withTitle) await showTitle();
      charId = await chooseCharacter(
        pickable.map((c) => ({ id: c.id, name: c.name, blurb: c.blurb ?? '', tint: c.tint ?? '#ffe3ec', stats: c.stats })),
        portraits,
        lastChar,
      );
      if (charId === null) {
        withTitle = true; // もどる → タイトルへ
        continue;
      }
      lastChar = charId;
    }
    // --- コースをえらぶ ---
    courseId = await chooseCourse(
      [
        { id: 'meadow', name: KUSAMUSHIRI.name },
        { id: 'rainbow', name: RAINBOW.name },
        { id: 'candy', name: CANDY.name },
        { id: 'sunset', name: SUNSET.name },
      ],
      lastCourse,
    );
    if (courseId === null) {
      charId = null; // もどる → キャラ選択へ（タイトルは出さない）
      withTitle = false;
    } else {
      lastCourse = courseId;
    }
  }
  for (const ev of ['pointerdown', 'keydown']) window.removeEventListener(ev, startMenuMusic, true);
  menuMusic.stop(0.8);
  // 顔アイコン（観客・ミニマップ・けっか）は、モデルから作るので、できあがるのを待つ
  await portraits;
  const courseDef = courseId === 'rainbow' ? RAINBOW : courseId === 'candy' ? CANDY : courseId === 'sunset' ? SUNSET : KUSAMUSHIRI;
  const isRainbow = courseDef.theme === 'rainbow';
  const isCandy = courseDef.theme === 'candy';
  const isSunset = courseDef.theme === 'sunset';
  // 夕焼け海岸は、西の海の上の低い夕日から光が来る（影も長く、東へのびる）
  if (isSunset) SUN_DIR.copy(SUNSET_LIGHT_DIR);
  setGroundFx(courseDef.theme ?? 'meadow');

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const fpsEl = document.getElementById('fps')!;
  const uiRoot = document.getElementById('ui')!;

  // --- 画質（iPhone 16 以上を想定。重ければ自動で1段ずつ下げる）---
  const QUALITY = [
    { name: 'ultra', dpr: isTouchDevice ? 2.5 : 2, bloom: true, lines: true, shadow: 2048 },
    { name: 'high', dpr: 2, bloom: true, lines: true, shadow: 2048 },
    { name: 'mid', dpr: 1.6, bloom: false, lines: true, shadow: 1024 },
    { name: 'low', dpr: 1.2, bloom: false, lines: false, shadow: 0 },
  ];
  // ?q=ultra|high|mid|low で画質を固定（自動調整しない）
  const forced = QUALITY.findIndex((x) => x.name === new URLSearchParams(location.search).get('q'));
  // タイトル画面で「標準」をえらんだときは、ブルームなしの軽い段（mid）から始める（重ければ、さらに下がる）
  let qi = forced >= 0 ? forced : getGraphicsQuality() === 'standard' ? 2 : 0;
  const q = () => QUALITY[qi];

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q().dpr));
  // Neutral は白が白のまま残る（ACES だとちいかわの白が灰色っぽくなる）
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  // 遠くほど淡い空色に溶ける
  // レインボーロードは、遠くの城まで見えるよう霧を遠めに
  scene.fog = isRainbow
    ? new THREE.Fog(RAINBOW_FOG, 320, 1700)
    : isCandy
      ? new THREE.Fog(CANDY_FOG, 330, 1800)
      : isSunset
        ? new THREE.Fog(SUNSET_FOG, 280, 1500)
        : new THREE.Fog(PAL.fog, 150, 650);

  const camera = new THREE.PerspectiveCamera(66, 1, 0.3, 2000);

  // 空側はクリーム、地面側は薄紫（影がくすまず色づく）。レインボーロードは夜の紫
  const L = isRainbow ? RAINBOW_LIGHTS : isCandy ? CANDY_LIGHTS : isSunset ? SUNSET_LIGHTS : { sky: '#fff8ec', ground: '#b7a8d8', hemi: 1.45, sun: '#fff0da', sunI: 2.2 };
  scene.add(new THREE.HemisphereLight(L.sky, L.ground, L.hemi));
  const sun = new THREE.DirectionalLight(L.sun, L.sunI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(q().shadow, q().shadow);
  const sc = sun.shadow.camera;
  sc.left = -26;
  sc.right = 26;
  sc.top = 26;
  sc.bottom = -26;
  sc.near = 1;
  sc.far = 130;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 5;
  sun.shadow.intensity = 0.75; // 影は真っ黒にしない
  scene.add(sun, sun.target);
  const SUN_OFFSET = SUN_DIR.clone().multiplyScalar(66);

  // 空から環境マップを作る（キャラやカートのツヤに空が映る）
  const skyMat = isRainbow ? rainbowSkyMaterial() : isCandy ? candySkyMaterial(SUN_DIR) : isSunset ? sunsetSkyMaterial(false) : skyMaterial();
  const groundCol = new THREE.Color(isRainbow ? '#d9b8f0' : isCandy ? '#ffe0e8' : isSunset ? '#c9927a' : '#c9cfb8');
  let studioEnv: THREE.Texture | null = null;
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat));
    const groundDisc = new THREE.Mesh(new THREE.CircleGeometry(49, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: groundCol }));
    groundDisc.position.y = -2;
    envScene.add(groundDisc);
    scene.environment = pmrem.fromScene(envScene, 0.02, 0.1, 200).texture;
    scene.environmentIntensity = isCandy ? 0.9 : isSunset ? 0.8 : 0.55; // お菓子のつやつやに、空がくっきり映る

    // カートの塗装・金属・ライト・目に映す「撮影スタジオ」の環境マップ（高画質のときだけ）。
    // 同じ空に、地面を少し暗くして水平線をはっきりさせ、太陽と、やわらかい光の窓（上の大きな窓・左右の細長い窓）を足す。
    // 光の窓は 1 を超える明るさ（HDR）なので、ツルツルの面にだけ、曲面にそったくっきりした光の筋が出る。
    // 全体の明るさ（拡散のまわり込み）は、ふつうの環境マップとほぼ同じ
    if (getGraphicsQuality() === 'high') {
      const ground = groundDisc.clone();
      ground.material = new THREE.MeshBasicMaterial({ color: groundCol.clone().multiplyScalar(0.55) });
      const studio = new THREE.Scene();
      studio.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat), ground);
      const glow = (color: THREE.ColorRepresentation, k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide, fog: false });
      const add = (mesh: THREE.Mesh, dir: THREE.Vector3, r = 40) => {
        mesh.position.copy(dir).normalize().multiplyScalar(r);
        mesh.lookAt(0, 0, 0);
        studio.add(mesh);
      };
      add(new THREE.Mesh(new THREE.CircleGeometry(4, 24), glow(L.sun, isRainbow ? 3 : 7)), SUN_DIR.clone());
      const win = isRainbow ? '#efe4ff' : '#ffffff';
      add(new THREE.Mesh(new THREE.PlaneGeometry(34, 14), glow(win, isRainbow ? 2.2 : 3.6)), new THREE.Vector3(0.15, 1, 0.25));
      for (const sx of [-1, 1]) {
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(60, 2.6), glow(win, isRainbow ? 2.4 : 4.2));
        add(strip, new THREE.Vector3(sx, 0.32, 0.15));
      }
      add(new THREE.Mesh(new THREE.PlaneGeometry(40, 2.2), glow(win, isRainbow ? 1.8 : 3)), new THREE.Vector3(0, 0.3, -1));
      studioEnv = pmrem.fromScene(studio, 0, 0.1, 200).texture;
    }
    pmrem.dispose();
  }

  // --- 光のにじみ（ブルーム）とアンチエイリアス ---
  // 深度テクスチャーは絵本パスの景色のふち（ふんわり）に使う
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(1, 1) });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const storybook = new StorybookPass(scene, camera, paperTexture());
  composer.addPass(storybook);
  if (isCandy) storybook.uniforms.uSat.value = 1.1; // お菓子の世界は、色をあざやかに
  if (isSunset) storybook.uniforms.uSat.value = 1.08;
  // レインボーロードは、道やランプの光がふんわりにじむよう強め
  const bloom = isRainbow
    ? new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.6, 0.88)
    : isCandy
      ? new UnrealBloomPass(new THREE.Vector2(1, 1), 0.28, 0.55, 0.92)
      : isSunset
        ? new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.5, 0.92) // 夕日と海のきらめきがにじむ
      : new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.6, 0.95);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // --- コース ---
  const track = new Track(courseDef);
  scene.add(track.group);
  const noChunk = import.meta.env.DEV && location.search.includes('nochunk'); // ?nochunk は比較用
  let landmarks: Landmarks;
  if (isRainbow) {
    const world = buildRainbowWorld(track);
    if (!noChunk) chunkInstances(world.static);
    scene.add(world.group);
    landmarks = world;
  } else if (isSunset) {
    const world = buildSunsetWorld(track);
    if (!noChunk) chunkInstances(world.static, 15000);
    scene.add(world.group);
    landmarks = world;
  } else if (isCandy) {
    const world = buildCandyWorld(track);
    if (!noChunk) chunkInstances(world.static, 15000); // 小さな物も区画に分けて、画面外は描かない
    scene.add(world.group);
    landmarks = world;
  } else {
    const scenery = buildScenery(track);
    // 草・花・柵・木を地面の区画に分け、画面や影の範囲外の区画は描かないようにする
    if (!noChunk) chunkInstances(scenery);
    scene.add(scenery);
    landmarks = buildLandmarks(track);
    scene.add(landmarks.group);
  }
  // 景色の Lambert 素材はまとめて「光が回り込むやわらかい陰影」に
  scene.traverse((o) => {
    const mats = (o as THREE.Mesh).material;
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      if ((m as THREE.MeshLambertMaterial).isMeshLambertMaterial) applySoftLight(m as THREE.MeshLambertMaterial);
    }
  });

  // 火花は明るい地面でも色が飛ばないよう通常合成＋中心だけ白く光らせる
  const fx: FXSystems = { sparks: new Particles(1400, false, false, 0.7), dust: new Particles(900, false) };
  scene.add(fx.dust.points, fx.sparks.points);

  const items = new ItemSystem(track, fx);
  scene.add(items.group);

  // --- レーサー（プレイヤーは最後尾スタート）---
  await playerModelReady;
  const input = new Input(uiRoot);
  if (import.meta.env.DEV) Object.assign(window, { __input: input });
  // えらんだキャラが主人公。ほかのキャラが相手になる
  const playerSpec = CHARACTERS.find((c) => c.id === charId) ?? CHARACTERS[0];
  // 相手は、えらばなかったキャラの中から毎回ランダムに（スタートの並び順もランダム）
  const cpuSpecs = CHARACTERS.filter((c) => c !== playerSpec)
    .map((c) => ({ c, k: Math.random() }))
    .sort((a, b) => a.k - b.k)
    .slice(0, RACE.cpus)
    .map((e) => e.c);
  const racers = cpuSpecs.map((s) => new Racer(s, false, fx));
  const player = new Racer(playerSpec, true, fx);
  racers.push(player);
  for (const r of racers) scene.add(r.obj);
  // カートのツヤ：塗装・金属などに、撮影スタジオの環境マップ（明るさは、景色の環境の強さにそろえる）
  if (studioEnv) {
    for (const r of racers)
      r.model.root.traverse((o) => {
        const mats = (o as THREE.Mesh).material;
        for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
          const sm = m as THREE.MeshStandardMaterial;
          if (!sm.isMeshStandardMaterial || !sm.userData.studio || sm.envMap) continue;
          sm.envMap = studioEnv;
          sm.envMapIntensity *= scene.environmentIntensity;
        }
      });
  }
  const race = new Race(track, racers, player, items);
  player.fx.warm(renderer, camera, rt); // 絶対バリアのシェーダーを、先に用意しておく
  const hud = new HUD(uiRoot, track);
  // ばくだんの爆発は、自分のうしろで起きるので、バックミラーで見えるようにする
  const mirror = new RearMirror(renderer, scene, uiRoot, fx);

  race.onLap = (r) => {
    if (!r.isPlayer) return;
    if (r.lapCount === RACE.laps) hud.flash('ファイナルラップ！', true);
    else if (r.lapCount > 1) hud.flash(`ラップ ${r.lapCount}/${RACE.laps}`);
  };

  const IDLE_INPUT = { steer: 0, throttle: true, brake: false, item: false, jump: false };
  if (import.meta.env.DEV) Object.assign(window, { __refFaceFlat: refFaceFlat, __game: { race, player, track, camera, renderer, scene, items, fx, hud, mirror, landmarks, composer, storybook, step: (dt: number) => { race.update(dt, IDLE_INPUT); updateRaceUI(); for (const r of racers) r.updateVisual(dt); updateCamera(dt); composer.render(dt); }, finishCamTime: () => finishCam } });

  // 開発中の確認用：ループを止めて、好きな位置から撮る（画面に重ねて表示するので、スクリーンショットで見られる）
  if (import.meta.env.DEV) {
    const dev = (window as unknown as { __game: Record<string, unknown> }).__game;
    const shot = () => {
      composer.render(0);
      let el = document.getElementById('shotimg') as HTMLImageElement | null;
      if (!el) {
        el = document.createElement('img');
        el.id = 'shotimg';
        el.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:99999;object-fit:cover';
        document.body.appendChild(el);
      }
      el.src = renderer.domElement.toDataURL('image/jpeg', 0.9);
      return 'ok';
    };
    const view = (px: number, py: number, pz: number, lx: number, ly: number, lz: number, fov = 66) => {
      camera.position.set(px, py, pz);
      camera.lookAt(lx, ly, lz);
      camera.fov = toVFov(fov);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      landmarks.update(0.016, camera);
      return shot();
    };
    Object.assign(dev, {
      shot,
      view,
      // コース上の t の位置の後ろ back m・高さ up から、前を見る。lat で横にずらす
      viewT: (t: number, back = 6, up = 2.6, fov = 66, pitch = 1.3, lat = 0, ahead = 0.02) => {
        const p = track.pointAt(t), tan = track.tangentAt(t), nrm = track.normalAt(t), q = track.pointAt(t + ahead);
        return view(p.x - tan.x * back + nrm.x * lat, up, p.z - tan.z * back + nrm.z * lat, q.x + nrm.x * lat, pitch, q.z + nrm.z * lat, fov);
      },
      // 複数の視点を 1 枚にならべて撮る。views の各行は [t, back, up, fov, pitch, lat]
      gridT: (views: number[][], cols = 2) => {
        const W = Math.floor(1600 / cols), H = Math.round((W * renderer.domElement.height) / renderer.domElement.width);
        const rows = Math.ceil(views.length / cols);
        const c = document.createElement('canvas');
        c.width = W * cols;
        c.height = H * rows;
        const g2 = c.getContext('2d')!;
        views.forEach(([t, back = 6, up = 2.6, fov = 66, pitch = 1.3, lat = 0, ahead = 0.02], i) => {
          const p = track.pointAt(t), tan = track.tangentAt(t), nrm = track.normalAt(t), q = track.pointAt(t + ahead);
          camera.position.set(p.x - tan.x * back + nrm.x * lat, up, p.z - tan.z * back + nrm.z * lat);
          camera.lookAt(q.x + nrm.x * lat, pitch, q.z + nrm.z * lat);
          camera.fov = toVFov(fov);
          camera.updateProjectionMatrix();
          camera.updateMatrixWorld();
          composer.render(0);
          g2.drawImage(renderer.domElement, (i % cols) * W, Math.floor(i / cols) * H, W, H);
        });
        let el = document.getElementById('shotimg') as HTMLImageElement | null;
        if (!el) {
          el = document.createElement('img');
          el.id = 'shotimg';
          el.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:99999;object-fit:contain;background:#222';
          document.body.appendChild(el);
        }
        el.style.objectFit = 'contain';
        el.src = c.toDataURL('image/jpeg', 0.88);
        return 'ok';
      },
      // スタート前のカメラ演出で、カメラがカートにいちばん近づいたときの距離（m）と、その時刻
      introMinDist: () => {
        const ps: CamPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 66 };
        let best = [1e9, 0];
        for (let t = 0; t <= INTRO_TIME; t += 0.05) {
          intro.pose(t, 0, ps);
          for (const r of racers) best = Math.hypot(ps.pos.x - r.kart.pos.x, ps.pos.z - r.kart.pos.z) < best[0] && ps.pos.y < 4 && r.kart.pos.distanceTo(ps.pos) > 0 ? [Math.hypot(ps.pos.x - r.kart.pos.x, ps.pos.z - r.kart.pos.z), t] : best;
        }
        return best;
      },
      // スタート前のカメラ演出を、いくつかの時刻（秒。-1 はタイトルの構図）で 1 枚にならべて撮る
      gridIntro: (times: number[], cols = 2) => {
        const W = Math.floor(1600 / cols), H = Math.round((W * renderer.domElement.height) / renderer.domElement.width);
        const rows = Math.ceil(times.length / cols);
        const c = document.createElement('canvas');
        c.width = W * cols;
        c.height = H * rows;
        const g2 = c.getContext('2d')!;
        const ps: CamPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 66 };
        times.forEach((t, i) => {
          intro.pose(t, 0, ps);
          camera.position.copy(ps.pos);
          camera.lookAt(ps.look);
          camera.fov = toVFov(ps.fov);
          camera.updateProjectionMatrix();
          camera.updateMatrixWorld();
          sunFocus.lerpVectors(intro.center, player.kart.pos, t > 0 ? ease(t / INTRO_TIME) : 0);
          sun.position.copy(sunFocus).add(SUN_OFFSET);
          sun.target.position.copy(sunFocus);
          landmarks.update(0.016, camera);
          composer.render(0);
          g2.drawImage(renderer.domElement, (i % cols) * W, Math.floor(i / cols) * H, W, H);
        });
        let el = document.getElementById('shotimg') as HTMLImageElement | null;
        if (!el) {
          el = document.createElement('img');
          el.id = 'shotimg';
          el.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:99999;object-fit:contain;background:#222';
          document.body.appendChild(el);
        }
        el.style.objectFit = 'contain';
        el.src = c.toDataURL('image/jpeg', 0.88);
        return 'ok';
      },
      freeze: () => {
        renderer.setAnimationLoop(null);
        document.getElementById('ui')!.style.display = 'none';
        document.getElementById('fps')!.style.display = 'none';
      },
    });
  }

  // --- タイトル → カウントダウン ---
  const howTo = !isTouchDevice
    ? '↑アクセル ←→ハンドル（切り続けるとドリフト）\nZ でジャンプ・Space でアイテム'
    : getControlMode() === 'thumb'
      ? '親指を置いて、左右にスライドでハンドル\n（大きく切るとドリフト）\n↑にはじくとジャンプ　↓でアイテム'
      : '左下〜まんなかを左右になぞってハンドル\n（大きく切るとドリフト）\n右下のボタンでジャンプ・アイテム';
  hud.showCenter(`${howTo}\n<span class="tap">${isTouchDevice ? 'タップしてスタート' : 'キーを押してスタート'}</span>`, 'title');
  let lastCount = -1;
  let resultsShown = false;

  // コースごとの BGM：最初のタップ／キー入力の「中」で再生を始める（iPhone の Safari はこうしないと鳴らない）
  const music = new Music(courseId === 'rainbow' ? BGM.rainbow : courseId === 'candy' ? BGM.candy : courseId === 'sunset' ? BGM.sunset : BGM.meadow);
  if (import.meta.env.DEV) Object.assign(window, { __music: music });
  const sfx = new Sfx();
  if (import.meta.env.DEV) Object.assign(window, { __sfx: sfx });
  let musicStarted = false;
  const startMusic = () => {
    if (musicStarted) return;
    musicStarted = true;
    music.start();
    sfx.unlock(); // 効果音も、同じタップの中で使えるようにしておく
    for (const ev of ['pointerdown', 'touchend', 'keydown']) window.removeEventListener(ev, startMusic, true);
  };
  for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, startMusic, true);

  // スタート前は、順位や地図などの表示を消して、キャラたちの絵だけを見せる（カウントダウンでふわっと出す）
  uiRoot.classList.add('intro');
  // 押した回数（演出を飛ばす「もう一度タップ」の判定用）
  let presses = 0;
  let introPress = 0;
  for (const ev of ['pointerdown', 'keydown']) {
    window.addEventListener(ev, (e) => {
      if (!(e instanceof KeyboardEvent && e.repeat)) presses++;
    }, true);
  }
  const beginCountdown = () => {
    race.countdown = 3; // 演出がそのまま「用意」の間なので、「3」からすぐ数える
    race.start();
  };

  function updateRaceUI() {
    if (race.state === 'ready' && introT < 0 && input.anyPressed) {
      // タップ → カメラの演出（前 → 横 → 後ろ）。終わりぎわにカウントダウンへ
      introT = 0;
      introPress = presses;
      intro.begin({ pos: camPos, look: camLook, fov: designFov });
      hud.showCenter('');
    }
    if (race.state === 'ready' && introT >= 0) {
      if (presses !== introPress) {
        if (introT > 0.4) {
          introT = INTRO_TIME; // 演出の途中でもう一度タップ：飛ばす
          camBlend = 1.2;
        }
        else introPress = presses; // 最初のタップの続き（指が 2 本など）は数えない
      }
      if (introT >= INTRO_TIME - 0.5) beginCountdown();
    }
    if (race.state !== 'ready') uiRoot.classList.remove('intro');
    if (race.state === 'countdown') {
      const n = Math.ceil(race.countdown);
      if (n !== lastCount && n <= 3) {
        lastCount = n;
        hud.showCenter(String(n), 'count');
        sfx.countBeep();
      }
    } else if (race.state === 'racing' && lastCount !== 0) {
      lastCount = 0;
      hud.showCenter('GO!', 'count go');
      sfx.goChime();
      setTimeout(() => race.state === 'racing' && hud.showCenter(''), 900);
    }
    if (race.state === 'finished' && !resultsShown) {
      resultsShown = true;
      hud.showCenter('ゴール！', 'count go');
      finishCam = 0.0001;
      music.duck(0.55); // ゴールしたら少し音を下げ、結果画面ではもっと静かに
      setTimeout(() => hud.showCenter(''), 1800);
      setTimeout(() => {
        music.duck(0.3, 2);
        hud.showResults(race, () => location.reload());
      }, FINISH_CAM_TIME * 1000);
    }
  }

  // --- カメラ ---
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let camInit = false;
  let shake = 0;
  // ゴール後のカメラワーク：後ろ → 横 → 前へ回り込む
  const FINISH_CAM_TIME = 7;
  let finishCam = 0; // 0 = 通常。ゴール後は経過秒
  const camGoal = new THREE.Vector3();
  const lookGoal = new THREE.Vector3();
  // 各カットの（回り込む角度[度]、距離、高さ、見る高さ、画角）。角度0 = 真後ろ、90 = 進行方向の右横、180 = 正面
  const CUTS: [number, number, number, number, number, number][] = [
    // 時刻, 角度, 距離, 高さ, 見る高さ, 画角
    [0.0, 0, 5.8, 2.6, 1.3, 68],
    [1.6, 55, 7.0, 2.2, 1.3, 58],
    [3.4, 110, 6.6, 1.1, 1.5, 50],
    [5.2, 165, 7.2, 2.0, 1.5, 40],
    [7.0, 185, 5.6, 1.9, 1.6, 32],
  ];
  const ease = (x: number) => x * x * (3 - 2 * x);
  let boostCam = 0; // ダッシュ中は強さに応じて、少し引いて広く見せる（0..1）
  let fovKick = 0; // ミニターボが出た瞬間の、ぐっと広がる画角
  let lastDriftBoost = 0;
  let lastDriftLevel = 0;
  let glideCam = 0; // グライダー中は少し引いて高い位置から
  let lastGlide = 0;
  let lastDrop = 0; // ばくだんを落とした回数（演出のきっかけ）
  let lastStarUse = 0; // スターを使った回数
  let lastStomp = 0; // 踏みつぶした回数
  let starWasOn = false;
  let recoverPlayed = false; // 起き上がりの「ぼよよーん」を、1 回だけ鳴らす
  let stepTimer = 0; // 巨大なカートの足音の間隔
  let lastLaunch = 0; // ミサイルを撃った回数
  let lastBlast = 0; // ばくだん・ミサイルが爆発した回数
  let exposureKick = 0; // 爆発のまぶしさ（画面全体が一瞬、明るくなる）
  let lastBarrier = 0; // 絶対バリアを張った回数
  let lastRepel = 0; // バリアが攻撃をはじいた回数（全員ぶん）
  let lastPlayerHits = 0; // 自分のバリアがはじいた回数
  let barrierWasOn = false;
  let lastBump = 0; // カート同士が強くぶつかった回数
  const BUMP_SPARK = new THREE.Color('#ffd27a');
  const BUMP_WHITE = new THREE.Color('#ffffff');

  // 縦長の画面（スマホ・タブレットの縦持ち）か
  const isPortrait = () => window.innerHeight > window.innerWidth;
  // カメラの画角は「横長の画面で見せたい画角」(designFov) で決め、ここで実際の縦の画角に直す。
  // 縦長の画面では、そのままだと左右がほとんど見えないので、横の見える範囲がおよそ designFov × 1.14 になるよう縦を広げる（上限 100°）
  let designFov = 66;
  const toVFov = (f: number) => {
    const a = camera.aspect;
    if (a >= 1) return f;
    const h = THREE.MathUtils.degToRad(f * 1.14);
    return Math.min(100, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / a)));
  };
  const applyFov = () => {
    camera.fov = toVFov(designFov);
    camera.updateProjectionMatrix();
  };

  // ふだんの（うしろから追いかける）カメラの、行きたい位置と見る先。
  // 縦持ちでは少し後ろ・上に引き、見る先も前へ（自分のカートは画面の下のほう、前の道を広く見せる）
  function chaseGoal(k: Racer['kart'], glide: number, pos: THREE.Vector3, look: THREE.Vector3) {
    const fx_ = Math.sin(k.heading), fz = Math.cos(k.heading);
    const pt = isPortrait();
    const back = 5.6 + glide * 2.6 + boostCam * 1.4 + (pt ? 1.5 : 0), up = 2.5 + glide * 1.8 + boostCam * 0.35 + (pt ? 1.0 : 0);
    const ahead = pt ? 7 : 4;
    pos.set(k.pos.x - fx_ * back, k.y * 0.6 + up, k.pos.z - fz * back);
    look.set(k.pos.x + fx_ * ahead, 1.35 + k.y * 0.5, k.pos.z + fz * ahead);
  }

  // スタート前のカメラ演出。タイトルの間は、並んだキャラたちを正面から見る。タップすると、横を通って後ろ（ふだんのカメラ）へ回り込み、
  // そのままカウントダウンに入る。演出の途中でもう一度タップすれば飛ばせる
  const introEnd: CamPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 66 };
  chaseGoal(player.kart, 0, introEnd.pos, introEnd.look);
  const intro = new IntroCam(player, racers, introEnd, isPortrait());
  const introPose: CamPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 66 };
  let introT = -1; // -1 = タイトル中。0 以上 = 演出の経過秒。INTRO_TIME で終わり
  let titleClock = 0;
  let camBlend = 0; // 演出を飛ばしたあと、ゆっくり追いつく残り秒
  const sunFocus = new THREE.Vector3();

  function updateCamera(dt: number) {
    const k = player.kart;
    const h = k.heading;
    if (finishCam <= 0 && (introT >= 0 ? introT < INTRO_TIME : race.state === 'ready')) {
      if (introT >= 0) introT = Math.min(INTRO_TIME, introT + dt);
      else titleClock += dt;
      intro.pose(introT, titleClock, introPose);
      camPos.copy(introPose.pos);
      camLook.copy(introPose.look);
      camera.position.copy(camPos);
      camera.lookAt(camLook);
      designFov = introPose.fov;
      applyFov();
      camInit = true;
      // 影は、並んだカートのまんなかから、だんだんプレイヤーのまわりへ
      const e = introT > 0 ? ease(introT / INTRO_TIME) : 0;
      sunFocus.lerpVectors(intro.center, k.pos, e);
      sun.position.copy(sunFocus).add(SUN_OFFSET);
      sun.target.position.copy(sunFocus);
      return;
    }
    const fx_ = Math.sin(h), fz = Math.cos(h);
    if (finishCam > 0) {
      finishCam += dt;
      // カットの間をなめらかにつなぐ
      let i = 0;
      while (i < CUTS.length - 2 && finishCam > CUTS[i + 1][0]) i++;
      const a = CUTS[i], b = CUTS[i + 1];
      const f = ease(Math.min(1, Math.max(0, (finishCam - a[0]) / (b[0] - a[0]))));
      const mix = (j: number) => a[j] + (b[j] - a[j]) * f;
      const ang = (mix(1) * Math.PI) / 180;
      const dist = mix(2);
      // 車体の向きを基準に、後ろ(0°)から横へ回り込む（右まわり）
      camGoal.set(k.pos.x - Math.sin(h - ang) * dist, k.y * 0.5 + mix(3), k.pos.z - Math.cos(h - ang) * dist);
      // 見る先は車体の少し上（走り続けるので追従）。距離が近づくほど顔（頭の高さ）へ
      // 縦持ちでは、けっかが画面の下に出るので、後半はキャラが画面の上のほうに映るよう、見る先を少し下げる
      const lift = isPortrait() ? 1.9 * ease(Math.min(1, Math.max(0, (finishCam - 2.5) / 2.5))) : 0;
      lookGoal.set(k.pos.x, k.y + mix(4) - lift, k.pos.z);
      camPos.lerp(camGoal, 1 - Math.exp(-9 * dt));
      camLook.lerp(lookGoal, 1 - Math.exp(-12 * dt));
      camera.position.copy(camPos);
      camera.position.y = Math.max(camera.position.y, 0.6);
      camera.lookAt(camLook);
      // 縦持ちは横幅がせまいので、画角を広げて、キャラ全体が入るように
      designFov += (mix(5) * (isPortrait() ? 1.3 : 1) - designFov) * (1 - Math.exp(-6 * dt));
      applyFov();
      sun.position.copy(k.pos).add(SUN_OFFSET);
      sun.target.position.copy(k.pos);
      return;
    }
    glideCam += ((k.gliding ? 1 : 0) - glideCam) * (1 - Math.exp(-2.5 * dt));
    boostCam += ((k.boostTime > 0 ? Math.min(1, k.boostPower / KART.driftBoostPower[1]) : 0) - boostCam) * (1 - Math.exp(-4 * dt));
    chaseGoal(k, glideCam, camGoal, lookGoal);
    // 巨大になったら、カメラを引いて高くする（大きなカートが、画面からはみ出さないように）
    const g01 = k.giant01;
    if (g01 > 0.001) {
      const pull = 1 + 0.5 * g01; // 引きすぎると、大きく見えなくなる。大きさの 2 割ほどは、画面にも出す
      camGoal.x = k.pos.x + (camGoal.x - k.pos.x) * pull;
      camGoal.z = k.pos.z + (camGoal.z - k.pos.z) * pull;
      camGoal.y += 2.4 * g01;
      lookGoal.y += 1.1 * g01;
    }
    // 演出を飛ばした直後は、カメラがいきなり振り回されないよう、ゆっくりめに追いつく
    const follow = camBlend > 0 ? 0.4 : 1;
    camBlend = Math.max(0, camBlend - dt);
    camPos.lerp(camGoal, camInit ? 1 - Math.exp(-8 * follow * dt) : 1);
    camLook.lerp(lookGoal, camInit ? 1 - Math.exp(-14 * follow * dt) : 1);
    camInit = true;

    if (k.landed) shake = Math.max(shake, 0.25);
    if (k.wallHit) shake = Math.max(shake, 0.2);
    if (k.spinTime > 1.2) shake = Math.max(shake, 0.3);
    shake = Math.max(0, shake - dt);
    camera.position.copy(camPos);
    camera.position.y = Math.max(camera.position.y, 0.8);
    if (shake > 0) camera.position.add(tmp.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0));
    camera.lookAt(camLook);
    camera.rotateZ(k.driftDir * 0.03);

    // ダッシュが強いほど（ドリフトを長く続けたほど）画角が広がり、スピード感が出る
    const boostFov = k.boostTime > 0 ? 5 + 8 * Math.min(1, k.boostPower / KART.driftBoostPower[1]) : 0;
    const targetFov = 66 + Math.max(boostFov, k.starTime > 0 ? 12 : 0) + Math.max(0, k.forwardSpeed / KART.maxSpeed) * 4 + fovKick;
    fovKick *= Math.exp(-5 * dt);
    designFov += (targetFov - designFov) * (1 - Math.exp(-5 * dt));
    applyFov();

    // 影はプレイヤーの周りだけ
    sun.position.copy(k.pos).add(SUN_OFFSET);
    sun.target.position.copy(k.pos);
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    camera.aspect = w / h;
    applyFov();
  }

  // 画質を1段下げる
  function applyQuality() {
    const Q = q();
    bloom.enabled = Q.bloom;
    storybook.uniforms.uLines.value = Q.lines ? 1 : 0;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, Q.dpr));
    if (Q.shadow === 0) {
      renderer.shadowMap.enabled = false;
      sun.castShadow = false;
    } else if (sun.shadow.mapSize.x !== Q.shadow) {
      sun.shadow.mapSize.set(Q.shadow, Q.shadow);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    // 中画質以下は草原の本数を減らす（並びはランダムなので先頭から使えば均一に減る）
    const grassK = Q.name === 'low' ? 0.35 : Q.name === 'mid' ? 0.65 : 1;
    scene.traverse((o) => {
      if (o.name === 'grassField' && (o as THREE.InstancedMesh).isInstancedMesh) {
        const im = o as THREE.InstancedMesh;
        im.count = Math.floor((im.userData.fullCount ?? 22000) * grassK);
      }
    });
    resize();
    console.info(`画質: ${Q.name}`);
  }
  window.addEventListener('resize', resize);
  applyQuality(); // 初期の画質（ブルーム・輪郭線・解像度）を反映して resize

  // --- ループ（固定タイムステップ 1/60）---
  const STEP = 1 / 60;
  let acc = 0;
  let last = performance.now();
  let frames = 0;
  let fpsTime = last;
  let slowStreak = 0;
  document.addEventListener('visibilitychange', () => (last = performance.now()));

  // 1フレームの中でエラーが起きても、ゲーム全体が止まらないようにする
  // （three.js のループは、中で例外が出ると次のフレームを予約しなくなる）
  let errorCount = 0;
  renderer.setAnimationLoop(() => {
    try {
      frame();
    } catch (e) {
      if (errorCount++ < 5) console.error('frame error', e);
    }
  });
  // 開発中の確認用：ブラウザが描画を止めているとき（非表示のとき）に、1 コマずつ進める
  if (import.meta.env.DEV) Object.assign(window, { __frameOnce: () => frame() });

  function frame() {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 6) {
      race.update(STEP, input.update());
      acc -= STEP;
      steps++;
    }
    if (steps === 6) acc = 0;

    updateRaceUI();
    if (player.kart.glideCount !== lastGlide) {
      lastGlide = player.kart.glideCount;
      hud.flash('グライダー！', true);
    }
    // ドリフトで溜まった段階が上がる音。終えたら、ミニターボの演出（画面のゆれ・画角・文字・音）
    const pk = player.kart;
    const dl = pk.drifting && pk.grounded ? pk.driftLevel : 0;
    if (dl > lastDriftLevel) sfx.driftLevel(dl);
    lastDriftLevel = dl;
    if (pk.driftBoostCount !== lastDriftBoost) {
      lastDriftBoost = pk.driftBoostCount;
      const L = pk.driftBoostLevel;
      fovKick = 4 + 3 * L;
      shake = Math.max(shake, 0.1 + 0.08 * L);
      hud.flash(['ミニターボ！', 'スーパーターボ！', 'ウルトラターボ！！'][L - 1], L >= 2, ['#7fc8ff', '#ffb04a', '#ff7ad9'][L - 1]);
      sfx.driftBoost(L);
    }
    // ばくだん：落とした音と導火線の音（自分で落としたら、バックミラーも出す）。爆発の音・ゆれ・まぶしさ・フラッシュ
    if (items.dropCount !== lastDrop) {
      lastDrop = items.dropCount;
      const d = items.lastDrop!;
      const near = Math.max(0.25, 1 - pk.pos.distanceTo(d.pos) / 90);
      sfx.bombDrop(near);
      sfx.bombFuse(near);
      if (d.owner === player) mirror.show(3.4);
    }
    // スター：使った瞬間（ファンファーレ・ゆれ・まぶしさ）、終わり、足音、踏みつぶし、起き上がり
    if (items.starCount !== lastStarUse) {
      lastStarUse = items.starCount;
      const o = items.lastStar!.owner;
      if (o === player) {
        sfx.starUse(1);
        hud.flash('スター！ きょだいか！', true, '#ffe66b');
        shake = Math.max(shake, 0.4);
        fovKick += 8;
        exposureKick = Math.max(exposureKick, 0.22);
      } else sfx.starUse(Math.max(0.15, 0.8 - pk.pos.distanceTo(o.kart.pos) / 140));
    }
    if (starWasOn && pk.starTime <= 0) sfx.starEnd();
    starWasOn = pk.starTime > 0;
    // 絶対バリア：張った瞬間、はじいた瞬間（自分が／ほかの人が）、切れた瞬間
    if (items.barrierCount !== lastBarrier) {
      lastBarrier = items.barrierCount;
      const o = items.lastBarrier!.owner;
      if (o === player) {
        sfx.barrierOn(1);
        hud.flash('絶対バリア！', true, '#8fe6ff');
        shake = Math.max(shake, 0.2);
        fovKick += 5;
        exposureKick = Math.max(exposureKick, 0.18);
        hud.blastFlash(0.22, true);
      } else sfx.barrierOn(Math.max(0.12, 0.7 - pk.pos.distanceTo(o.kart.pos) / 130));
    }
    if (pk.barrierHits !== lastPlayerHits) {
      lastPlayerHits = pk.barrierHits;
      const pw = Math.min(1.4, pk.barrierHitPower);
      sfx.barrierHit(0.8 + 0.2 * pw);
      shake = Math.max(shake, 0.3 + 0.25 * pw);
      fovKick += 4 + 3 * pw;
      exposureKick = Math.max(exposureKick, 0.12 + 0.1 * pw);
      hud.blastFlash(0.22 + 0.1 * pw, true);
      hud.flash('バリアで はじいた！', true, '#8fe6ff');
    }
    if (race.repelCount !== lastRepel) {
      lastRepel = race.repelCount;
      const rp = race.lastRepel!;
      if (rp.racer !== player) {
        const d = pk.pos.distanceTo(rp.racer.kart.pos);
        sfx.barrierHit(Math.max(0.12, 0.9 - d / 110));
        shake = Math.max(shake, 0.12 * Math.max(0, 1 - d / 60));
      }
    }
    if (barrierWasOn && !pk.barrier) {
      sfx.barrierOff(1);
      if (race.state !== 'finished') hud.flash('バリアが 切れた！', false, '#bfe9ff');
    }
    barrierWasOn = pk.barrier;
    // カート同士のぶつかり：その場に火花。自分がぶつかったら、軽く画面がゆれて、ごつんと鳴る
    if (race.bumpCount !== lastBump) {
      lastBump = race.bumpCount;
      const bp = race.lastBump!;
      for (let i = 0; i < 10 + Math.round(16 * bp.power); i++) {
        const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(4 + Math.random() * 7 * (0.6 + bp.power));
        v.addScaledVector(bp.a.kart.vel, 0.5).addScaledVector(bp.b.kart.vel, 0.5);
        fx.sparks.emit(bp.pos, v, i % 3 ? BUMP_SPARK : BUMP_WHITE, { size: 0.18 + Math.random() * 0.2, life: 0.22 + Math.random() * 0.25, gravity: 14, drag: 1.5 });
      }
      if (bp.a === player || bp.b === player) {
        shake = Math.max(shake, 0.12 + 0.2 * bp.power);
        sfx.bump(0.5 + 0.5 * bp.power);
      }
    }
    if (pk.giantScale > 1.5 && pk.grounded && pk.forwardSpeed > 4) {
      stepTimer -= dt;
      if (stepTimer <= 0) {
        stepTimer = 0.3;
        sfx.giantStep(0.5 + 0.5 * pk.giant01);
        shake = Math.max(shake, 0.05 + 0.08 * pk.giant01);
      }
    } else stepTimer = 0;
    if (race.stompCount !== lastStomp) {
      lastStomp = race.stompCount;
      const s = race.lastStomp!;
      const d = pk.pos.distanceTo(s.pos);
      sfx.stomp(Math.max(0.2, 1 - d / 120));
      shake = Math.max(shake, 0.2 + 0.55 * Math.max(0, 1 - d / 70));
      if (s.by === player) {
        hud.flash('ふみつぶし！', true, '#ffd23a');
        hud.blastFlash(0.25);
      } else if (s.victim === player) {
        hud.flash('ふみつぶされた！', true, '#ff8a4a');
        hud.blastFlash(0.45);
      }
    }
    if (pk.squashTime > 0 && pk.squashTime < 0.56) {
      if (!recoverPlayed) {
        recoverPlayed = true;
        sfx.squashRecover(1);
      }
    } else if (pk.squashTime <= 0) recoverPlayed = false;

    // ミサイル：発射の音。自分がねらわれたら、警報とバックミラー（うしろから近づいてくるので）
    if (items.launchCount !== lastLaunch) {
      lastLaunch = items.launchCount;
      const l = items.lastLaunch!;
      sfx.missileLaunch(Math.max(0.2, 1 - pk.pos.distanceTo(l.pos) / 110));
      if (l.target === player) {
        sfx.missileAlarm();
        hud.flash('ミサイル接近！ うしろ！', true, '#ff5a40');
        mirror.show(Math.min(8, l.eta + 2.6));
      }
    }
    if (items.blastCount !== lastBlast) {
      lastBlast = items.blastCount;
      const b = items.lastBlast!;
      const missile = b.kind === 'missile';
      const dist = pk.pos.distanceTo(b.pos);
      const prox = Math.max(0, 1 - dist / 80) * (missile ? 0.75 : 1); // 近いほど 1 に近い（ミサイルは、ばくだんより小さめ）
      sfx.explosion(Math.max(0.15, Math.min(1, (missile ? 0.95 : 1.1) - dist / 150)));
      shake = Math.max(shake, (missile ? 0.25 : 0.3) + 0.8 * prox);
      fovKick += 9 * prox;
      exposureKick = Math.max(exposureKick, 0.2 + 0.9 * prox);
      if (b.shielded.includes(player)) {
        // 自分のバリアがはじいた（文字・音・閃光は、バリアの演出で出している）
      } else if (b.blocked.includes(player)) {
        // スターが爆風を無効にした
        sfx.starShield(1);
        hud.flash('スターで 無効！', true, '#ffe66b');
      } else if (b.owner === player) {
        hud.blastFlash(0.55);
        const bounced = b.victims.length === 0 && b.shielded.length > 0;
        hud.flash(
          missile
            ? b.victims.length ? 'ミサイル命中！' : bounced ? 'バリアに はじかれた…' : 'ミサイルは はずれた…'
            : b.victims.length ? `ばくはつ！ ${b.victims.length}台 スピン！` : bounced ? 'バリアに はじかれた…' : 'ばくはつ！',
          true,
          '#ffa23c',
        );
      } else if (b.victims.includes(player)) {
        hud.blastFlash(1);
        hud.flash(missile ? 'ミサイル直撃！' : 'ふきとばされた！', true, '#ff6a4a');
      } else if (prox > 0.35) hud.blastFlash(0.35 * prox);
    }
    exposureKick *= Math.exp(-6 * dt);
    renderer.toneMappingExposure = 1.05 + exposureKick;
    for (const r of racers) r.updateVisual(dt);
    fx.sparks.update(dt);
    fx.dust.update(dt);
    updateCamera(dt);
    landmarks.update(dt, camera);
    fx.sparks.setViewport(renderer.domElement.height, camera.fov);
    fx.dust.setViewport(renderer.domElement.height, camera.fov);
    hud.update(dt, race);
    mirror.update(dt);
    globalUniforms.uTime.value += dt;
    composer.render(dt);
    mirror.render(pk, player.fx.insideObjects);

    frames++;
    if (now - fpsTime >= 1000) {
      const fps = Math.round((frames * 1000) / (now - fpsTime));
      fpsEl.textContent = `${fps} fps · ${q().name}`;
      frames = 0;
      fpsTime = now;
      // 50fps を切る状態が3秒続いたら画質を1段下げる
      slowStreak = fps < 50 && !document.hidden ? slowStreak + 1 : 0;
      if (forced < 0 && slowStreak >= 3 && qi < QUALITY.length - 1) {
        qi++;
        slowStreak = 0;
        applyQuality();
      }
    }
  }
}

boot();
