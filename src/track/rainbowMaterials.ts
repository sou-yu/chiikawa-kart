import * as THREE from 'three';
import { makeCanvas, toTexture } from '../core/textures';
import { mulberry32 } from '../core/random';
import { globalUniforms } from '../core/shaders';

// レインボーロード用の素材（道・ふちの光・水晶・金）

// 道の横方向に並ぶ虹の帯。v（進行方向）は繰り返し
export const RAINBOW_BANDS = ['#ff3f86', '#ff8a3a', '#ffd23a', '#5fd94a', '#2ccfc4', '#3d8cff', '#8a5cff', '#d85cff'];

export function rainbowRoadTexture(): THREE.CanvasTexture {
  const W = 512, H = 512;
  const [c, g] = makeCanvas(W, H);
  // 帯どうしの境目はやわらかくにじませる
  const grd = g.createLinearGradient(0, 0, W, 0);
  RAINBOW_BANDS.forEach((col, i) => {
    grd.addColorStop(i / RAINBOW_BANDS.length, col);
    grd.addColorStop((i + 0.82) / RAINBOW_BANDS.length, col);
  });
  grd.addColorStop(1, RAINBOW_BANDS[RAINBOW_BANDS.length - 1]);
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  const rand = mulberry32(7);
  // 進行方向に流れる、白い光のすじ（つやつやした光沢）
  for (let i = 0; i < 46; i++) {
    const x = rand() * W, y = rand() * H, len = 40 + rand() * 160, w = 1 + rand() * 3;
    for (const oy of [-H, 0, H]) {
      const lg = g.createLinearGradient(0, y + oy, 0, y + oy + len);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, `rgba(255,255,255,${0.18 + rand() * 0.25})`);
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg;
      g.fillRect(x, y + oy, w, len);
    }
  }
  // ラメ（細かいきらきら）
  for (let i = 0; i < 1100; i++) {
    const x = rand() * W, y = rand() * H, r = rand() < 0.92 ? 0.5 + rand() * 0.6 : 1.1 + rand() * 0.8;
    g.fillStyle = `rgba(255,255,255,${0.25 + rand() * 0.5})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = toTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

// 道の素材：虹色に自分で光り、細かいラメがまたたく
export function rainbowRoadMaterial(): THREE.MeshStandardMaterial {
  const map = rainbowRoadTexture();
  const mat = new THREE.MeshStandardMaterial({
    map,
    emissive: '#ffffff',
    emissiveMap: map,
    emissiveIntensity: 0.42,
    roughness: 0.16,
    metalness: 0.18,
    envMapIntensity: 1.6, // つやつやの道に、空のオーロラが映り込む
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlitW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGlitW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vGlitW;\nfloat glitH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          // 光の帯が道の先へ流れていく（虹がきらめきながら脈打つ）
          float sweep = 0.5 + 0.5 * sin(vMapUv.y * 5.0 - uTime * 2.4);
          totalEmissiveRadiance *= 1.0 + 0.55 * pow(sweep, 3.0);
          // 3つの大きさのきらめき：小さな点、中くらいの星、大きな十字の星
          vec3 glint = vec3(0.0);
          for (int k = 0; k < 3; k++) {
            float cs = k == 0 ? 4.0 : (k == 1 ? 1.4 : 0.55);          // 1m あたりの区画の数
            float dens = k == 0 ? 0.9 : (k == 1 ? 0.86 : 0.8);
            vec2 g = vGlitW.xz * cs + float(k) * 17.3;
            vec2 cell = floor(g);
            float h = glitH(cell);
            vec2 f = fract(g) - 0.5 - (vec2(glitH(cell + 3.7), glitH(cell + 9.1)) - 0.5) * 0.4;
            vec2 a = abs(f);
            float core = smoothstep(k == 0 ? 0.2 : 0.14, 0.0, length(f));
            float cross = (exp(-a.x * 60.0 - a.y * 7.0) + exp(-a.y * 60.0 - a.x * 7.0)) * (k == 0 ? 0.0 : (k == 1 ? 0.8 : 1.6));
            // 斜めの小さな十字も足して、八方に光る星にする
            vec2 r = vec2(f.x + f.y, f.x - f.y) * 0.7071;
            vec2 ra = abs(r);
            float diag = (exp(-ra.x * 70.0 - ra.y * 9.0) + exp(-ra.y * 70.0 - ra.x * 9.0)) * (k == 2 ? 0.7 : 0.0);
            float tw = pow(0.5 + 0.5 * sin(uTime * (2.0 + h * 5.0) + h * 40.0), 4.0);
            vec3 tint = mix(vec3(1.0, 0.97, 0.92), mix(vec3(0.75, 0.92, 1.0), vec3(1.0, 0.8, 0.95), step(0.5, fract(h * 11.0))), step(0.5, fract(h * 5.0)));
            glint += tint * (core * 1.4 + cross + diag) * tw * step(dens, h);
          }
          totalEmissiveRadiance += glint * 2.2;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'rainbowRoad';
  return mat;
}

// 道のふちの、白く光る細い線
export function edgeGlowMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: '#fff6dc', toneMapped: false });
}

// 金の手すり・柱
export function goldMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#ffd56e', metalness: 0.55, roughness: 0.3, emissive: '#d99a2a', emissiveIntensity: 0.55 });
}

// 水晶（浮島・お城・ジャンプ台）
export function crystalMaterial(color: THREE.ColorRepresentation, emissive: THREE.ColorRepresentation, intensity = 0.35): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity * 1.25, metalness: 0.2, roughness: 0.1, flatShading: true, envMapIntensity: 1.8 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <opaque_fragment>',
        `{
          // 見る角度で色が変わるふち光（シャボン玉のような虹色）と、ゆっくり脈打つ輝き
          float fr = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
          float hue = fr * 2.2 + uTime * 0.08 + vViewPosition.x * 0.004;
          vec3 irid = 0.5 + 0.5 * cos(6.2832 * (hue + vec3(0.0, 0.33, 0.67)));
          outgoingLight += irid * pow(fr, 2.2) * 0.9;
          outgoingLight += diffuseColor.rgb * (0.12 + 0.08 * sin(uTime * 0.9 + vViewPosition.y * 0.05));
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'crystalIrid';
  return mat;
}

// 光の玉（ランプ）
export function lampMaterial(color: THREE.ColorRepresentation = '#fff1c4'): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, toneMapped: false });
}
