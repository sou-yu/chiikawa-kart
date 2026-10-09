import * as THREE from 'three';

// カートとキャラの材質を、部品ごとの「らしい」質感にする（スタイライズドな PBR）。
// GLB の材質名で見分ける：Kart_<色>（塗装）・Kart_Gold（金メッキ）・Axle_Metal（金属）・Tire_*（ゴム）・
// Mechanism_Dark（樹脂・機械）・Seat_*（シート）・Headlight_* / RearLamp_*（ライト）・Badge_*（ステッカー）・
// Eye_*（目）・Character_* など（ぬいぐるみの毛並み）。
// 色そのものは変えず、ツヤ・反射・粗さだけを変える（キャラや車体の配色は、そのまま）。
//
// high = true：塗装にクリアコート、毛並みにシーン（やわらかな光沢）を使う MeshPhysicalMaterial
// high = false：軽い MeshStandardMaterial のまま、粗さと金属感だけ整える

type Kind = 'paint' | 'paintLight' | 'gold' | 'metal' | 'dark' | 'seat' | 'tire' | 'groove' | 'lamp' | 'decal' | 'eye' | 'plush' | 'cloth' | 'glossy' | 'ink';

function kindOf(name: string, color: THREE.Color): Kind {
  // 顔の線（目の縁・口）は、毛並みのふんわりした光沢をのせない（灰色っぽくならないよう）
  if (name.startsWith('Face_') && color.r + color.g + color.b < 0.3) return 'ink';
  if (name === 'Kart_Gold' || name === 'Kart_GoldStripes') return 'gold';
  if (name === 'Kart_Ivory') return 'paintLight';
  if (name.startsWith('Kart_')) return 'paint';
  if (name === 'Axle_Metal') return 'metal';
  if (name === 'Mechanism_Dark') return 'dark';
  if (name.startsWith('Seat_')) return 'seat';
  if (name === 'Tire_Rubber') return 'tire';
  if (name === 'Tire_Groove') return 'groove';
  if (name.startsWith('Headlight_') || name.startsWith('RearLamp_')) return 'lamp';
  if (name.startsWith('Badge_')) return 'decal';
  if (name.startsWith('Eye_')) return 'eye';
  if (name.startsWith('Book_') || name === 'Cape_White') return 'cloth';
  if (name === 'Chestnut_Cap') return 'glossy';
  return 'plush'; // Character_*・Face_*・Ear_*・Tail_*・Shisa_* など（顔の線や頬も、体と同じ毛並み）
}

let tireNormal: THREE.Texture | null = null;

// タイヤのゴムの、細かな凹凸（法線マップ）。継ぎ目なしのノイズ
function tireNormalMap(): THREE.Texture {
  if (tireNormal) return tireNormal;
  const S = 128;
  const h = new Float32Array(S * S);
  for (let i = 0; i < h.length; i++) h[i] = Math.random();
  // 少しぼかして、ざらっとした粒にする
  const b = new Float32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += h[((y + dy + S) % S) * S + ((x + dx + S) % S)];
      b[y * S + x] = s / 9;
    }
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = (b[y * S + ((x + 1) % S)] - b[y * S + ((x - 1 + S) % S)]) * 2.5;
      const dy = (b[((y + 1) % S) * S + x] - b[((y - 1 + S) % S) * S + x]) * 2.5;
      const n = new THREE.Vector3(-dx, -dy, 1).normalize();
      const i = (y * S + x) * 4;
      img.data[i] = (n.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  return (tireNormal = t);
}

function convert(src: THREE.MeshStandardMaterial, high: boolean): THREE.MeshStandardMaterial {
  const kind = kindOf(src.name, src.color);
  const p: THREE.MeshPhysicalMaterialParameters = {
    name: src.name,
    color: src.color.clone(),
    side: src.side,
    transparent: src.transparent,
    opacity: src.opacity,
    map: src.map,
    normalMap: src.normalMap,
    emissive: src.emissive.clone(),
    emissiveIntensity: src.emissiveIntensity,
    roughness: src.roughness,
    metalness: src.metalness,
  };
  switch (kind) {
    case 'paint': // 自動車の塗装：下地はほどよい粗さ、その上にツルツルのクリアコート
      Object.assign(p, { roughness: 0.34, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.0 });
      break;
    case 'paintLight':
      Object.assign(p, { roughness: 0.4, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.1, envMapIntensity: 0.95 });
      break;
    case 'gold': // 金メッキ：はっきりした金属の反射（メッキっぽくなりすぎないよう、少し粗く）
      Object.assign(p, { roughness: 0.27, metalness: 1, envMapIntensity: 1.1 });
      p.color = new THREE.Color().setRGB(0.95, 0.62, 0.2);
      break;
    case 'metal': // ホイールの軸・金属部品：明るい銀
      Object.assign(p, { roughness: 0.22, metalness: 1, envMapIntensity: 1.15 });
      p.color = new THREE.Color().setRGB(0.72, 0.74, 0.78);
      break;
    case 'dark': // 樹脂・機械部分：塗装より粗く、反射はひかえめ
      Object.assign(p, { roughness: 0.5, metalness: 0.25, envMapIntensity: 0.8 });
      break;
    case 'seat':
      Object.assign(p, { roughness: 0.55, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.8 });
      break;
    case 'tire': // マットなゴム：真っ黒にせず、細かな凹凸。プラスチックのようなツヤは出さない
      Object.assign(p, { roughness: 0.86, metalness: 0, envMapIntensity: 0.6, sheen: 0.35, sheenRoughness: 0.85, sheenColor: new THREE.Color(0.32, 0.32, 0.36) });
      p.color = src.color.clone().lerp(new THREE.Color(0.022, 0.022, 0.026), 0.6);
      if (high) {
        p.normalMap = tireNormalMap();
        p.normalScale = new THREE.Vector2(0.45, 0.45);
      }
      break;
    case 'groove':
      Object.assign(p, { roughness: 0.95, metalness: 0, envMapIntensity: 0.4 });
      break;
    case 'lamp': // ライト：ガラスのツヤと、ほんのり光る
      Object.assign(p, { roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.2 });
      p.emissive = src.color.clone().multiplyScalar(0.55);
      break;
    case 'decal': // 塗装の上のステッカー（クリアコートの下）
      Object.assign(p, { roughness: 0.42, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.06, envMapIntensity: 0.95 });
      break;
    case 'eye': // うるっとした目
      Object.assign(p, { roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.1 });
      break;
    case 'ink':
      Object.assign(p, { roughness: 0.5, metalness: 0, envMapIntensity: 0.6 });
      break;
    case 'glossy':
      Object.assign(p, { roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2 });
      break;
    case 'cloth':
      Object.assign(p, { roughness: 0.78, metalness: 0, sheen: 0.6, sheenRoughness: 0.6, sheenColor: src.color.clone().lerp(new THREE.Color(1, 1, 1), 0.5) });
      break;
    case 'plush': // ぬいぐるみの毛並み：マットで、ふちがふんわり明るい（シーン）
      Object.assign(p, {
        roughness: 0.72,
        metalness: 0,
        envMapIntensity: 0.9,
        sheen: 0.8,
        sheenRoughness: 0.55,
        sheenColor: src.color.clone().lerp(new THREE.Color(1, 1, 1), 0.55).multiplyScalar(0.8),
      });
      break;
  }
  // 車体・金属・ライト・目は、ツヤを見せるための「撮影スタジオ」の環境マップを使う（main が差しこむ）
  const studio = kind !== 'plush' && kind !== 'cloth' && kind !== 'ink' && kind !== 'tire' && kind !== 'groove';
  if (high) {
    const m = new THREE.MeshPhysicalMaterial(p);
    m.userData.studio = studio;
    return m;
  }
  // 標準画質：クリアコート・シーンは使わず、粗さと金属感だけ
  const s = { ...p } as Record<string, unknown>;
  for (const k of ['clearcoat', 'clearcoatRoughness', 'sheen', 'sheenRoughness', 'sheenColor']) delete s[k];
  const m = new THREE.MeshStandardMaterial(s as THREE.MeshStandardMaterialParameters);
  m.userData.studio = studio;
  return m;
}

// モデル全体の材質を差しかえる（同じ材質を使う部品は、同じ新しい材質を共有する）。元の材質は、ほかの複製が使うので残す
export function upgradeKartMaterials(root: THREE.Object3D, high: boolean) {
  const done = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const swap = (mat: THREE.Material) => {
      const sm = mat as THREE.MeshStandardMaterial;
      if (!sm.isMeshStandardMaterial) return mat;
      let n = done.get(mat);
      if (!n) {
        n = convert(sm, high);
        done.set(mat, n);
      }
      return n;
    };
    m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
  });
}
