import * as THREE from 'three';
import { globalUniforms } from '../../core/shaders';
import {
  biscuitTexture,
  cakeSideTextures,
  candyCaneTexture,
  candyGroundTextures,
  candyRoadTextures,
  cookieTexture,
  repeatTex,
  sugarNormal,
  towerWallTexture,
  waffleTextures,
} from './textures';

// スイーツパラダイスの素材。つやつやの「おもちゃのお菓子」に見えるよう、光沢は強め

// ビスケットの道：焼き色・アイシング・スプリンクルの絵と、つやの強さの絵（アイシングはつるつる）
export function candyRoadMaterial(): THREE.MeshPhysicalMaterial {
  const { map, normal, rough } = candyRoadTextures();
  return new THREE.MeshPhysicalMaterial({
    map,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: rough,
    roughness: 1,
    metalness: 0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.26,
    envMapIntensity: 1.25,
    // 暖かい色を掛けて、金色を濃く（強い光で白っぽく飛ばないように）
    color: new THREE.Color('#ffd898'),
  });
}

export function candyGroundMaterial(): THREE.MeshStandardMaterial {
  const { map, normal } = candyGroundTextures();
  return new THREE.MeshStandardMaterial({ map, normalMap: normal, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.5, envMapIntensity: 0.7 });
}

// 崖の上の面（クリーム）。色は頂点の色で変える
export function candyTopMaterial(): THREE.MeshStandardMaterial {
  const { map, normal } = candyGroundTextures();
  const t = repeatTex(map.clone(), 1, 1);
  const n = repeatTex(normal.clone(), 1, 1);
  t.needsUpdate = n.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map: t, normalMap: n, normalScale: new THREE.Vector2(0.7, 0.7), vertexColors: true, roughness: 0.5, side: THREE.DoubleSide, envMapIntensity: 0.7 });
}

export function chocolateMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: '#5c2b12', roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.14, envMapIntensity: 0.65 });
}

export function creamMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: '#fff9f0', roughness: 0.34, clearcoat: 0.55, clearcoatRoughness: 0.25, envMapIntensity: 0.9 });
}

// 色は instanceColor（または頂点色）で変える、つやのあるアイシング
export function glazeMaterial(vertexColors = false): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors, roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.18, envMapIntensity: 1.1 });
}

export function candyMatMaterial(vertexColors = true): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors, roughness: 0.4, envMapIntensity: 0.9 });
}

export function gumdropMaterial(): THREE.MeshPhysicalMaterial {
  const n = repeatTex(sugarNormal().clone(), 5, 3);
  n.needsUpdate = true;
  return new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.38, normalMap: n, normalScale: new THREE.Vector2(0.6, 0.6), clearcoat: 0.5, clearcoatRoughness: 0.35, envMapIntensity: 1.1 });
}

export function biscuitMaterial(tile = 5): THREE.MeshStandardMaterial {
  const t = repeatTex(biscuitTexture().clone(), 1 / tile, 1 / tile);
  t.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, envMapIntensity: 0.8 });
}

export function cookieMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: cookieTexture(), roughness: 0.6, envMapIntensity: 0.6 });
}

export function towerMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: towerWallTexture(), roughness: 0.55, envMapIntensity: 0.7 });
}

// キャンディケーン（赤白のしま）
export function caneMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ map: candyCaneTexture(), roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.3 });
}

export function waffleMaterial(across: number, along: number): THREE.MeshStandardMaterial {
  const { map, normal } = waffleTextures();
  const m = repeatTex(map.clone(), across, along);
  const n = repeatTex(normal.clone(), across, along);
  m.needsUpdate = n.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map: m, normalMap: n, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.55, envMapIntensity: 0.8 });
}

// ケーキの側面：スポンジの色は instanceColor で変え、クリームとジャムの層は白いまま
export function cakeMaterial(vertexColors = false): THREE.MeshStandardMaterial {
  const { map, mask } = cakeSideTextures();
  const m = new THREE.MeshStandardMaterial({ map, vertexColors, roughness: 0.62, envMapIntensity: 0.55, side: vertexColors ? THREE.DoubleSide : THREE.FrontSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.tMask = { value: mask };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tMask;')
      .replace(
        '#include <color_fragment>',
        `#if defined( USE_COLOR )
          diffuseColor.rgb *= mix( vColor.rgb, vec3( 1.0 ), texture2D( tMask, vMapUv ).r );
        #endif`,
      );
  };
  m.customProgramCacheKey = () => (vertexColors ? 'cakeMaskV' : 'cakeMask');
  return m;
}

// ---------- 空 ----------
// 青空 → 地平線のももいろ。太陽のまわりはあたたかい光の輪
export function candySkyMaterial(sun: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSun: { value: sun },
      uTime: globalUniforms.uTime,
      uTop: { value: new THREE.Color('#2f7fe0') },
      uMid: { value: new THREE.Color('#7ebdf6') },
      uLow: { value: new THREE.Color('#ffd9d2') },
      uHorizon: { value: new THREE.Color('#ffc6d6') },
      uGlow: { value: new THREE.Color('#fff0c8') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun, uTop, uMid, uLow, uHorizon, uGlow;
      uniform float uTime;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(uHorizon, uLow, smoothstep(0.0, 0.12, h));
        col = mix(col, uMid, smoothstep(0.08, 0.38, h));
        col = mix(col, uTop, smoothstep(0.3, 0.95, h));
        float s = max(dot(d, normalize(uSun)), 0.0);
        // 太陽の方向は、ももいろ〜金色にあたたかく染まる
        col = mix(col, vec3(1.0, 0.8, 0.78), pow(s, 6.0) * 0.55);
        col += uGlow * (smoothstep(0.9992, 0.9997, s) * 1.2 + pow(s, 80.0) * 0.5 + pow(s, 8.0) * 0.16);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
