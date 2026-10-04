import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { PAL } from '../config/palette';

// 画面全体を「ふんわり絵本」にする後処理：
// ・キャラには輪郭線を引かない
// ・花や木などの景色は、その色の少し濃い色で、ふんわり縁どり（色鉛筆で軽くなぞったような淡い縁）
// ・暗部は薄紫・明部はクリームへの色調整、紙のざらざら、周辺減光
export class StorybookPass extends Pass {
  private quad: FullScreenQuad;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, paper: THREE.Texture) {
    super();
    this.uniforms = {
      tDiffuse: { value: null },
      tDepth: { value: null },
      tPaper: { value: paper },
      uRes: { value: new THREE.Vector2(1, 1) },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      uLines: { value: 1 },
      uSat: { value: 0.96 }, // 色の濃さ（1 より大きいと鮮やか）
      uLineW: { value: 1.5 },
      uShadow: { value: new THREE.Color(PAL.shadow) },
      uHighlight: { value: new THREE.Color('#fff4de') },
    };
    this.quad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D tDiffuse, tDepth, tPaper;
          uniform vec2 uRes;
          uniform float uNear, uFar, uLines, uLineW, uSat;
          uniform vec3 uShadow, uHighlight;
          varying vec2 vUv;
          float lin(vec2 uv) {
            float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
            return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
          }
          float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
          void main() {
            vec3 col = texture2D(tDiffuse, vUv).rgb;
            float soft = 0.0;   // 景色のふんわり縁どり
            if (uLines > 0.5) {
              vec2 px = uLineW / uRes;
              float d0 = lin(vUv);
              float dl = lin(vUv - vec2(px.x, 0.0)), dr = lin(vUv + vec2(px.x, 0.0));
              float du = lin(vUv + vec2(0.0, px.y)), dd = lin(vUv - vec2(0.0, px.y));
              // 手前にある側だけに縁を描く（奥との差が大きい所＝シルエット）
              float edgeD = (max(max(dl, dr), max(du, dd)) - d0) / d0;
              float e = smoothstep(0.015, 0.06, edgeD);
              float fade = 1.0 - smoothstep(35.0, 170.0, d0);
              soft = e * fade * 0.32;
            }
            // 色調整：少し彩度を落とし、暗部は薄紫・明部はクリームへ
            float l = lum(col);
            col = mix(vec3(l), col, uSat);
            // 暗い所ほど薄紫に色づける（置き換えず、色味だけ乗せる）
            float dark = 1.0 - smoothstep(0.02, 0.35, l);
            vec3 tint = uShadow / max(lum(uShadow), 0.01);
            col *= mix(vec3(1.0), tint, dark * 0.22);
            col += uShadow * 0.025 * dark; // 真っ黒を少し持ち上げる
            col = mix(col, col * uHighlight, smoothstep(0.5, 1.2, l) * 0.15);
            // 景色の縁：同じ色を少し濃く・少し紫寄りに（色鉛筆でなぞったような淡い縁）
            col = mix(col, col * vec3(0.84, 0.8, 0.9), soft);
            // 紙のざらざら
            float p = texture2D(tPaper, vUv * uRes / 512.0).r;
            col *= 1.0 - (1.0 - p) * 0.14;
            // 周辺減光（少し温かい色で）
            float v = smoothstep(0.95, 0.35, length((vUv - 0.5) * vec2(1.1, 1.0)));
            col *= mix(vec3(0.8, 0.76, 0.82), vec3(1.0), v);
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
  }

  setSize(w: number, h: number) {
    (this.uniforms.uRes.value as THREE.Vector2).set(w, h);
    // 解像度が高いほど縁も太く（見た目の太さをそろえる）
    this.uniforms.uLineW.value = Math.max(1, h / 700);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}
