import * as THREE from 'three';

// 太陽の方向（ライト・空・環境マップで共有）
export const SUN_DIR = new THREE.Vector3(-30, 55, -20).normalize();

// 全体で共有する時間（風・水面など）
export const globalUniforms = {
  uTime: { value: 0 },
};

// 草や葉を風で揺らす（高さが高いほど大きく揺れる）。
// strength: 揺れ幅, height: この高さで最大
// axis: 揺れの大きさを決める軸（葉っぱのように横に伸びる形は 'z'）
export function applyWind<T extends THREE.Material>(mat: T, strength = 0.25, height = 1, axis: 'y' | 'z' = 'y'): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev?.call(mat, shader, r);
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #endif
          ip += modelMatrix[3].xyz;
          float h = clamp(position.${axis} / ${height.toFixed(3)}, 0.0, 1.5);
          float w = sin(uTime * 1.6 + ip.x * 0.23 + ip.z * 0.17) * 0.7 + sin(uTime * 3.7 + ip.x * 0.9) * 0.3;
          transformed.x += w * ${strength.toFixed(3)} * h * h;
          transformed.z += w * ${(strength * 0.5).toFixed(3)} * h * h;
        }`,
      );
  };
  mat.customProgramCacheKey = () => `wind_${strength}_${height}_${axis}`;
  return mat;
}

// 光が回り込むやわらかい陰影（Lambert 用）。影の境目がやさしくなる
export function applySoftLight(mat: THREE.MeshLambertMaterial, wrap = 0.6): void {
  if (mat.userData.softLight) return;
  mat.userData.softLight = true;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  const chunk = THREE.ShaderChunk.lights_lambert_pars_fragment.replace(
    'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
    `float dotNL = saturate( ( dot( geometryNormal, directLight.direction ) + ${wrap.toFixed(2)} ) / ${(1 + wrap).toFixed(2)} );`,
  );
  mat.onBeforeCompile = (shader, r) => {
    prev?.call(mat, shader, r);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_lambert_pars_fragment>', chunk);
  };
  mat.customProgramCacheKey = () => `soft_${prevKey ? prevKey() : ''}`;
}

// ぬいぐるみっぽいふち光（輪郭がふんわり明るくなる）
export function applyRim<T extends THREE.MeshStandardMaterial>(mat: T, color: THREE.ColorRepresentation = '#ffffff', intensity = 0.35, power = 2.2): T {
  const rimColor = new THREE.Color(color);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: rimColor };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;')
      .replace(
        '#include <opaque_fragment>',
        `{
          float rim = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
          outgoingLight += uRimColor * pow(rim, ${power.toFixed(2)}) * ${intensity.toFixed(3)};
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => `rim_${intensity}_${power}`;
  return mat;
}
