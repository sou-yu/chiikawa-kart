import * as THREE from 'three';
import { globalUniforms } from '../../core/shaders';
import { ROAD_TILE, sandRoadTextures, sandTextures } from './textures';

// 夕焼け海岸の素材。夕日・海・ぬれた砂は、なるべく本物らしく

// 見た目の夕日（水平線のすぐ上）。光や影の向きは、もう少し高いところから（低すぎると地面が暗くなるため）
export const SUNSET_SUN = new THREE.Vector3(-1, 0.075, 0.42).normalize();
export const SUNSET_LIGHT_DIR = new THREE.Vector3(-1, 0.62, 0.42).normalize();
export const SEA_Y = 0.1; // 海面の高さ（道は 0.02。浅瀬ではタイヤが少し水につかる）

// 空の色（空の球と、海に映る空で共有）。dir は正規化された向き
const SKY_GLSL = /* glsl */ `
  uniform vec3 uSun;
  vec3 skyBase(vec3 d) {
    float y = d.y;
    vec3 zenith = vec3(0.56, 0.47, 0.74);
    vec3 upper = vec3(0.97, 0.63, 0.72);
    vec3 low = vec3(1.0, 0.72, 0.58);
    vec3 horizon = vec3(1.0, 0.84, 0.62);
    vec3 col = mix(horizon, low, smoothstep(0.0, 0.08, y));
    col = mix(col, upper, smoothstep(0.06, 0.32, y));
    col = mix(col, zenith, smoothstep(0.3, 0.9, y));
    // 夕日のある側は明るく暖かく、反対側は紫に
    float side = dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), normalize(vec3(uSun.x, 0.0, uSun.z)));
    col = mix(col * vec3(0.82, 0.8, 1.02), col * vec3(1.08, 1.0, 0.92), side * 0.5 + 0.5);
    float c = max(dot(d, uSun), 0.0);
    // 夕日のまわりの光（大きなにじみ＋近くの強い輪）
    col += vec3(1.0, 0.6, 0.3) * pow(c, 6.0) * 0.35;
    col += vec3(1.0, 0.78, 0.45) * pow(c, 60.0) * 0.45;
    return col;
  }
  vec3 sunDisc(vec3 d) {
    float c = dot(d, uSun);
    float disc = smoothstep(0.99935, 0.99965, c);
    return vec3(1.0, 0.86, 0.62) * disc * 1.9;
  }
`;

const NOISE_GLSL = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return s;
  }
`;

// ---------- 空：夕焼けのグラデーション・大きな夕日・金色にふちどられたピンクの雲 ----------
export function sunsetSkyMaterial(withClouds = true): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uSun: { value: SUNSET_SUN }, uTime: globalUniforms.uTime },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vDir;
      ${SKY_GLSL}
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = skyBase(d);
        if (d.y < 0.0) {
          // 水平線より下（海のずっと向こう）は、暗い夕暮れの海の色
          col = mix(vec3(1.0, 0.7, 0.5), vec3(0.32, 0.26, 0.45), smoothstep(0.0, 0.08, -d.y));
        }
        ${
          withClouds
            ? `
        // 雲：空を平面に見立てて、もこもこのノイズ。水平線の近くに多く、高いところは薄く
        if (d.y > 0.0) {
          vec2 p = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.004, 0.0);
          float n = fbm(p * 1.3) * 0.75 + fbm(p * 4.0) * 0.25;
          float band = smoothstep(0.0, 0.05, d.y) * (1.0 - smoothstep(0.22, 0.6, d.y));
          float dens = smoothstep(0.48, 0.72, n) * band;
          float c = max(dot(d, uSun), 0.0);
          float toSun = pow(c, 3.0);
          vec3 cloudShadow = vec3(0.84, 0.52, 0.62);
          vec3 cloudLit = vec3(1.0, 0.7, 0.66);
          vec3 cc = mix(cloudShadow, cloudLit, smoothstep(0.5, 0.9, n) * 0.6 + toSun * 0.4);
          // ふち（薄いところ）が金色に光る。夕日に近いほど強く
          float rim = smoothstep(0.48, 0.56, n) * (1.0 - smoothstep(0.56, 0.7, n));
          cc += vec3(1.0, 0.78, 0.35) * rim * (0.6 + toSun * 2.4);
          col = mix(col, cc, dens * 0.92);
        }`
            : ''
        }
        col += sunDisc(d) * step(0.0, d.y + 0.004);
        gl_FragColor = vec4(pow(col, vec3(2.2)), 1.0);
      }`,
  });
}

// ---------- 海：波のきらめき・空の映り込み・夕日の光の帯・浅瀬の透け・打ち寄せる泡 ----------
// aDepth（その点の水深 m）を頂点に持たせる。浅いほど透けて砂が見え、岸では白い泡が寄せては返す
export function oceanMaterial(): THREE.ShaderMaterial {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  uniforms.uSun = { value: SUNSET_SUN };
  uniforms.uTime = globalUniforms.uTime; // 全体の時間をそのまま使う（コピーしない）
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aDepth;
      attribute float aShore;
      varying vec3 vWorld;
      varying float vDepth;
      varying float vShore;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vDepth = aDepth;
        vShore = aShore;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld;
      varying float vDepth;
      varying float vShore;
      ${SKY_GLSL}
      ${NOISE_GLSL}
      #include <fog_pars_fragment>
      // 向き・波長・高さ・速さのちがう波をいくつも重ねて、面の傾き（法線）を作る
      vec2 waveGrad(vec2 p, float t) {
        vec2 g = vec2(0.0);
        vec4 W[6];
        W[0] = vec4(normalize(vec2(1.0, 0.25)), 0.21, 0.06);
        W[1] = vec4(normalize(vec2(0.8, -0.6)), 0.37, 0.035);
        W[2] = vec4(normalize(vec2(0.3, 1.0)), 0.61, 0.022);
        W[3] = vec4(normalize(vec2(-0.7, 0.7)), 1.13, 0.012);
        W[4] = vec4(normalize(vec2(0.95, -0.2)), 2.1, 0.006);
        W[5] = vec4(normalize(vec2(-0.2, -1.0)), 3.7, 0.0035);
        for (int i = 0; i < 6; i++) {
          float k = W[i].z;
          float ph = dot(W[i].xy, p) * k + t * sqrt(9.8 * k);
          g += W[i].xy * (W[i].w * k * cos(ph));
        }
        return g;
      }
      void main() {
        float depth = vDepth;
        // 水深が 0 より浅い（陸の上）ところは描かない。水ぎわはなめらかに
        float edge = smoothstep(-0.01, 0.03, depth);
        if (edge <= 0.0) discard;
        vec2 p = vWorld.xz;
        float calm = mix(0.6, 1.0, smoothstep(0.1, 2.5, depth)); // 浅いところは波が小さい
        vec2 g = waveGrad(p, uTime) * calm;
        // 細かいさざなみ（ノイズ）
        g += (vec2(vnoise(p * 1.7 + uTime * 0.6), vnoise(p * 1.7 - uTime * 0.5 + 7.0)) - 0.5) * 0.12 * calm;
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 R = reflect(-V, n);
        R.y = abs(R.y);
        float cosT = max(dot(n, V), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
        vec3 refl = skyBase(normalize(R));
        // 夕日の光の帯（細かくきらめく）
        float sd = max(dot(normalize(R), uSun), 0.0);
        float glint = pow(sd, 1200.0) * 6.0 + pow(sd, 160.0) * 0.9 + pow(sd, 18.0) * 0.12;
        float sparkle = step(0.88, vnoise(p * 9.0 + uTime * 2.0)) * pow(sd, 40.0) * 2.2;
        // 水の色：浅いところは青緑（夕日で少し金色がかる）、深いところは濃い青紫
        vec3 shallow = vec3(0.34, 0.84, 0.82);
        vec3 mid = vec3(0.2, 0.5, 0.62);
        vec3 deep = vec3(0.13, 0.17, 0.36);
        vec3 body = mix(shallow, mid, smoothstep(0.15, 1.2, depth));
        body = mix(body, deep, smoothstep(1.2, 6.0, depth));
        body *= mix(vec3(1.0), vec3(1.15, 0.85, 0.75), 0.35); // 夕方の光
        vec3 col = mix(body, refl, fres) + vec3(1.0, 0.82, 0.55) * (glint + sparkle);
        // 浅いところは、水底に光の網目（コースティクス）がゆらめく
        float shallowK = 1.0 - smoothstep(0.1, 1.6, depth);
        float cz = 1.0 - abs(vnoise(p * 0.8 + vec2(uTime * 0.22, uTime * 0.17)) * 2.0 - 1.0);
        float cz2 = 1.0 - abs(vnoise(p * 1.3 - vec2(uTime * 0.19, -uTime * 0.23) + 5.0) * 2.0 - 1.0);
        col += vec3(1.0, 0.95, 0.8) * pow(cz * cz2, 6.0) * shallowK * 0.9;
        // 打ち寄せる泡：岸のすぐそばの白い帯と、寄せては返す白い線
        float nz = vnoise(p * 0.35 + vec2(uTime * 0.05, 0.0));
        float shore = 1.0 - smoothstep(0.0, 0.06 + nz * 0.04, depth);
        // 寄せる波の白い線は、岸からの距離（vShore）で決める（道の下の砂の州では出さない）
        float wv = sin(vShore * 1.1 + uTime * 1.3 + nz * 5.0);
        float lines = smoothstep(0.8, 0.97, wv) * smoothstep(-14.0, -3.0, vShore) * (1.0 - smoothstep(-1.0, 1.0, vShore)) * (1.0 - smoothstep(0.05, 0.9, depth));
        float speck = vnoise(p * 3.5 + vec2(uTime * 0.4, -uTime * 0.3));
        float foam = clamp(max(shore, lines) * (0.55 + speck * 0.6), 0.0, 1.0);
        col = mix(col, vec3(1.0, 0.95, 0.9), foam);
        // 透けぐあい：浅いところは下の砂が見え、深いところや斜めから見るところは不透明に
        float alpha = mix(0.5, 0.97, smoothstep(0.1, 2.0, depth));
        alpha = max(alpha, fres * 0.95);
        alpha = max(alpha, foam * 0.95);
        gl_FragColor = vec4(pow(col, vec3(2.2)), alpha * edge);
        #include <fog_fragment>
      }`,
  });
}

// ---------- 砂の地面：aWet（ぬれ具合 0..1）で、色を濃くしてつるつるに（夕日が映る）----------
export function sandGroundMaterial(): THREE.MeshStandardMaterial {
  const { map, normal } = sandTextures();
  const m = new THREE.MeshStandardMaterial({ map, normalMap: normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.93, envMapIntensity: 0.7, color: '#ffffff', vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWet;\nvarying float vWet;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWet = aWet;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWet;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= mix(1.0, 0.62, vWet);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, vWet * vWet);');
  };
  m.customProgramCacheKey = () => 'sunsetSand';
  return m;
}

// 砂の道（わだち・貝殻つき）
export function sandRoadMaterial(): THREE.MeshStandardMaterial {
  const { map, normal } = sandRoadTextures();
  return new THREE.MeshStandardMaterial({ map, normalMap: normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.92, envMapIntensity: 0.7 });
}
export { ROAD_TILE };

// 貝殻：見る角度で色が変わる、つやのある真珠のような材質
export function shellMaterial(vertexColors = true): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    vertexColors,
    roughness: 0.26,
    metalness: 0,
    iridescence: 1,
    iridescenceIOR: 1.45,
    iridescenceThicknessRange: [180, 520],
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    sheen: 0.4,
    sheenColor: new THREE.Color('#ffd6ee'),
    envMapIntensity: 1.3,
    side: THREE.DoubleSide,
  });
}

export function pearlMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: '#fff6f2',
    roughness: 0.16,
    iridescence: 0.7,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [250, 600],
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.5,
  });
}
