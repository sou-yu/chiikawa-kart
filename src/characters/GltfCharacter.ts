import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { CharacterSpec } from '../config/characters';
import { createCharacter, type CharacterModel } from './Character';

// キャラとカートの 3D モデル（public/models/*.glb）。キャラの id ごとに 1 つ。
//   shirokuma（ちいかわ）      chiikawa_kart.glb   … 腕は骨つき。Banzai アニメーションつき（v3）
//   neko（ハチワレ）           hachiware_kart.glb  … 同上
//   usagi（うさぎ）            usagi_kart.glb      … 同上
//   kurimanju（くりまんじゅう） kurimanju_kart.glb  … 同上
//   shisa（シーサー）          shisa_kart.glb      … 同上
//   momonga（モモンガ）        momonga_kart.glb    … 同上（しっぽ <名前>_Tail つき）
//   kani（カニちゃん）         kani_kart.glb       … 同上（本の束 Book_Bundle つき）
// 部品の名前はどれも同じ：<名前>_Driver（キャラ）・Kart_Body・Steering_Wheel・Steer_FL/FR（前輪の向き）・Wheel_FL/FR/RL/RR（タイヤ）
// 骨つきのものは、さらに <名前>_ArmRig（腕の骨と、肩から手までのメッシュ 2 つ）
// GLB は Y が上・+Z が前・地面が高さ 0。ゲームのカートと同じ向きなので、大きさだけ合わせる。

const FILES: Record<string, string> = {
  shirokuma: 'chiikawa_kart.glb',
  neko: 'hachiware_kart.glb',
  usagi: 'usagi_kart.glb',
  kurimanju: 'kurimanju_kart.glb',
  shisa: 'shisa_kart.glb',
  momonga: 'momonga_kart.glb',
  kani: 'kani_kart.glb',
};

// どのモデルも、カートの大きさは同じ（幅約 2m）。今までの手作りのカートと同じ見た目の大きさになるよう、全部に同じ倍率をかける
const GLB_SCALE = 1.386;

interface Source {
  scene: THREE.Group;
  banzai: THREE.AnimationClip | null; // 腕を上げるアニメーション（骨つきのモデルだけ）
}
const sources = new Map<string, Source>();

// 起動時に全部まとめて読み込む（キャラやコースを選んでいる間に終わる）。失敗したキャラは、今までの手作りモデルで走る
export async function loadCharacterModels(): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    Object.entries(FILES).map(async ([id, file]) => {
      try {
        const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${file}`);
        sources.set(id, { scene: gltf.scene, banzai: gltf.animations.find((a) => a.name === 'Banzai') ?? gltf.animations[0] ?? null });
      } catch (e) {
        console.warn(`${id} の3Dモデルを読み込めませんでした。手作りのモデルで続けます。`, e);
      }
    }),
  );
}

export function hasCharacterModel(id: string): boolean {
  return sources.has(id);
}

// 頭の高さ。Racer が head.position.y にこの値（＋弾み）を入れる
const HEAD_Y = 1.8;

export function createGltfCharacter(spec: CharacterSpec): CharacterModel {
  const src = sources.get(spec.id)!;
  // グライダーは、今までの手作りモデルから借りる
  const base = createCharacter(spec);
  const glider = base.glider;
  base.root.remove(glider);

  const model = cloneSkinned(src.scene) as THREE.Group;
  const root = new THREE.Group();
  root.add(model);
  model.scale.setScalar(GLB_SCALE);
  root.updateMatrixWorld(true);

  const node = (name: string) => {
    const o = model.getObjectByName(name);
    if (!o) throw new Error(`モデルに ${name} がありません`);
    return o;
  };
  const find = (test: (name: string) => boolean) => {
    let hit: THREE.Object3D | null = null;
    model.traverse((o) => {
      if (!hit && test(o.name)) hit = o;
    });
    return hit as THREE.Object3D | null;
  };

  // キャラは 1 つの部品。座っている位置（部品の原点）を中心に傾けられるよう、入れ物に入れる。
  // 腕の骨があるモデルは、骨とメッシュも同じ入れ物に入れて、体といっしょに揺れるようにする
  const driverNode = find((n) => n.endsWith('_Driver'))!;
  const rig = find((n) => n.endsWith('_ArmRig'));
  const seat = driverNode.getWorldPosition(new THREE.Vector3());
  const driver = new THREE.Group();
  driver.position.y = seat.y - HEAD_Y;
  root.add(driver);
  const head = new THREE.Group();
  head.position.set(0, HEAD_Y, seat.z);
  driver.add(head);
  root.updateMatrixWorld(true);
  head.attach(driverNode); // 見た目の位置は変えずに、入れ物の子にする
  if (rig) head.attach(rig);
  // しっぽ（<名前>_Tail）は体の一部なので、体といっしょに揺らす
  const tail = find((n) => n.endsWith('_Tail'));
  if (tail) head.attach(tail);
  const restPos = driverNode.position.clone();
  const restRot = driverNode.rotation.clone();
  const driverScale = driverNode.scale.clone();

  const spinWheels = ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'].map(node);
  const steerWheels = ['Steer_FL', 'Steer_FR'].map(node);
  const rearWheelPos = ['Wheel_RL', 'Wheel_RR'].map((n) => {
    const p = node(n).getWorldPosition(new THREE.Vector3());
    return new THREE.Vector3(p.x, 0.08, p.z);
  });

  // 材質：影を落とす・受ける。無敵の発光から戻すための元の色を覚える
  // （キャラと腕は入れ物 driver の中に移したので、model ではなく root から探す）
  const materials: THREE.MeshStandardMaterial[] = [];
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    // 腕を上げると、最初の形の範囲の外に出る。画面のはしで消えないよう、範囲での判定はしない
    if (m.isSkinnedMesh) m.frustumCulled = false;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const sm = mat as THREE.MeshStandardMaterial;
      if (sm.isMeshStandardMaterial && !materials.includes(sm)) {
        sm.userData.baseEmissive = sm.emissive.clone();
        materials.push(sm);
      }
    }
  });

  root.add(glider);

  let setPose: (amount: number) => void;
  if (rig && src.banzai) {
    // 骨つきのモデル：Banzai アニメーションの「腕を上げるまで」の部分を、amount（0..1）に合わせて進める。
    // 0 = 運転の姿勢（ハンドルを握る）、1 = バンザイ。amount が下がれば、逆に戻る
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(src.banzai);
    action.play();
    action.paused = true;
    // クリップは 1〜72 フレーム（24fps）。24 フレーム目で腕が上がりきる
    const raiseT = Math.min(src.banzai.duration, (src.banzai.duration * 23) / 71);
    let last = -1;
    const apply = (amount: number) => {
      last = amount;
      action.time = Math.min(1, Math.max(0, amount)) * raiseT;
      mixer.update(0);
    };
    apply(0);
    setPose = (amount) => {
      if (Math.abs(amount - last) > 1e-3) apply(amount);
    };
  } else {
    // 腕が体と一体のモデル：バンザイの代わりに、体をぴょんと伸ばして少し反らせて喜ぶ
    setPose = (amount) => {
      driverNode.position.set(restPos.x, restPos.y + amount * 0.16, restPos.z);
      driverNode.rotation.set(restRot.x - amount * 0.16, restRot.y, restRot.z);
      const s = 1 + amount * 0.05;
      driverNode.scale.set(driverScale.x / s, driverScale.y * s, driverScale.z / s);
    };
  }

  return { root, head, driver, spinWheels, steerWheels, rearWheelPos, materials, setPose, glider };
}
