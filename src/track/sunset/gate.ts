import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bannerTexture } from '../../core/textures';
import { pearlMaterial, shellMaterial } from './materials';
import { driftwoodTexture } from './textures';

const TAU = Math.PI * 2;

// ホタテ貝の扇（うねのある、半円の帯）。xy 平面に立ち、+z が手前（走ってくる側は -z）
// rIn..rOut の帯。うねは ribs 本。色は根元のももいろ → 先のうす紫
// res = [うね 1 本あたりの分割数, 根元から先までのリング数]。大きな貝殻ゲートは細かく（既定）、砂の上の小さな貝殻は粗く
export function scallopFanGeometry(rIn: number, rOut: number, ribs: number, depth: number, thick: number, res: [number, number] = [10, 10]): THREE.BufferGeometry {
  const NT = ribs * res[0], NR = res[1];
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const cA = new THREE.Color('#ffe4ea'), cB = new THREE.Color('#fff6ee'), cC = new THREE.Color('#ead6ff'), cD = new THREE.Color('#d6ecff');
  const c = new THREE.Color();
  const surface = (side: number) => {
    const base = pos.length / 3;
    for (let i = 0; i <= NT; i++) {
      const th = (i / NT) * Math.PI;
      const rib = Math.abs(Math.sin((th * ribs) / 2 + Math.PI / 2)); // 1 = うねの山
      for (let j = 0; j <= NR; j++) {
        const f = j / NR;
        // 外のふちは、うねに合わせて波うつ（ホタテのぎざぎざ）
        const rOuter = rOut * (1 + 0.035 * rib);
        const r = rIn + (rOuter - rIn) * f;
        const z = (rib * rib * depth * (0.3 + 0.7 * f) + thick) * side;
        pos.push(Math.cos(th) * r, Math.sin(th) * r, z);
        c.copy(cA).lerp(cB, f * 0.8);
        c.lerp(i / NT < 0.5 ? cC : cD, Math.abs(i / NT - 0.5) * 0.5 * f);
        const sh = 0.72 + 0.28 * Math.pow(rib, 1.5); // うねの谷は暗く（うねがくっきり見える）
        col.push(c.r * sh, c.g * sh, c.b * sh);
      }
    }
    for (let i = 0; i < NT; i++) {
      for (let j = 0; j < NR; j++) {
        const a = base + i * (NR + 1) + j, b = a + NR + 1;
        if (side > 0) idx.push(a, b, a + 1, a + 1, b, b + 1);
        else idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  };
  surface(1);
  surface(-1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ヒトデ（5 本の腕のふっくらした星）。xy 平面、+z が表
export function starfishGeometry(r = 1): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let k = 0; k < 10; k++) {
    const rr = k % 2 === 0 ? r : r * 0.42;
    const t = (k / 10) * TAU + Math.PI / 2;
    const x = Math.cos(t) * rr, y = Math.sin(t) * rr;
    if (k === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: r * 0.16, bevelEnabled: true, bevelThickness: r * 0.12, bevelSize: r * 0.12, bevelSegments: 3, curveSegments: 1 });
  g.translate(0, 0, -r * 0.08);
  return g;
}

// 2 枚目の絵の「貝殻のゲート」：虹色に光る大きなホタテの扇のアーチ。
// 内側のふちに真珠が並び、ヒトデの飾り、足もとには真珠の玉とサンゴ。
// 道の中心が原点、+z が進む向き（ゲートは道をまたぐ）
export function shellGate(hw: number): THREE.Group {
  const g = new THREE.Group();
  const rIn = hw + 1.6;
  const rOut = hw + 8.5;
  const fan = new THREE.Mesh(scallopFanGeometry(rIn, rOut, 15, 1.1, 0.32), shellMaterial(true));
  fan.castShadow = true;
  g.add(fan);

  // 真珠：内側のふち、外側のふち、足もと
  const pearl = pearlMaterial();
  const sphere = new THREE.SphereGeometry(1, 20, 14);
  const pearls: THREE.Matrix4[] = [];
  const add = (x: number, y: number, z: number, s: number) => pearls.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
  const nIn = 30;
  for (let i = 0; i <= nIn; i++) {
    const th = (i / nIn) * Math.PI;
    for (const z of [-0.55, 0.55]) add(Math.cos(th) * (rIn - 0.15), Math.sin(th) * (rIn - 0.15), z, 0.42);
  }
  for (const s of [-1, 1]) {
    add(s * (rIn + 1.2), 0.9, -0.9, 1.0);
    add(s * (rIn + 3.0), 0.7, -1.4, 0.8);
    add(s * (rIn + 2.0), 0.5, -2.2, 0.55);
    add(s * (rIn + 4.6), 0.6, -0.6, 0.65);
  }
  const pm = new THREE.InstancedMesh(sphere, pearl, pearls.length);
  pearls.forEach((m, i) => pm.setMatrixAt(i, m));
  pm.castShadow = true;
  g.add(pm);

  // ヒトデの飾り（走ってくる側に向ける）
  const starMat = new THREE.MeshStandardMaterial({ color: '#ff8f74', roughness: 0.55, envMapIntensity: 0.8 });
  const starGeo = starfishGeometry(1);
  for (const [th, r, s, rot] of [
    [0.28, rIn + 3.2, 1.25, 0.3],
    [0.62, rIn + 4.6, 1.05, -0.2],
    [0.86, rIn + 2.6, 0.9, 0.6],
  ]) {
    const st = new THREE.Mesh(starGeo, starMat);
    st.position.set(Math.cos(th * Math.PI) * r, Math.sin(th * Math.PI) * r, -1.15);
    st.rotation.set(0, Math.PI, rot);
    st.scale.setScalar(s);
    st.castShadow = true;
    g.add(st);
  }

  // 足もとの岩とサンゴ
  const rock = new THREE.MeshStandardMaterial({ color: '#c9a99a', roughness: 0.85, flatShading: true });
  const coral = new THREE.MeshStandardMaterial({ color: '#ff8fae', roughness: 0.6 });
  for (const s of [-1, 1]) {
    const base = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 0), rock);
    base.position.set(s * (rIn + 3.2), 0.2, 0);
    base.scale.set(1.5, 0.6, 1.1);
    base.castShadow = true;
    g.add(base);
    const branches: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 7; k++) {
      const h = 0.8 + Math.random() * 1.2;
      const b = new THREE.CylinderGeometry(0.1, 0.16, h, 6).translate(0, h / 2, 0);
      b.rotateZ((Math.random() - 0.5) * 0.9);
      b.rotateX((Math.random() - 0.5) * 0.6);
      b.translate((Math.random() - 0.5) * 1.6, 0, (Math.random() - 0.5) * 1.0);
      branches.push(b);
    }
    const cm = new THREE.Mesh(mergeGeometries(branches), coral);
    cm.position.set(s * (rIn + 1.6), 0.6, -1.6);
    g.add(cm);
  }
  return g;
}

// スタートゲート：流木の柱と横木、横断幕。柱の上に貝殻
export function beachStartGate(hw: number, title: string): THREE.Group {
  const g = new THREE.Group();
  const tex = driftwoodTexture().clone();
  tex.repeat.set(1, 3);
  tex.needsUpdate = true;
  const wood = new THREE.MeshStandardMaterial({ map: tex, color: '#e2c6a4', roughness: 0.88 });
  for (const s of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 8.2, 10).translate(0, 4.1, 0), wood);
    pole.position.set(s * (hw + 1.3), 0, 0);
    pole.rotation.z = s * 0.04;
    pole.castShadow = true;
    g.add(pole);
    const shell = new THREE.Mesh(scallopFanGeometry(0.15, 1.5, 9, 0.18, 0.06), shellMaterial(true));
    shell.position.set(s * (hw + 1.3), 8.2, -0.3);
    shell.rotation.z = s * -0.25;
    g.add(shell);
    // ロープの巻きつけ（柱のまわりの輪）
    for (let k = 0; k < 3; k++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.07, 6, 14), new THREE.MeshStandardMaterial({ color: '#d9c49e', roughness: 0.9 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(s * (hw + 1.3), 1.2 + k * 0.22, 0);
      g.add(ring);
    }
  }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, hw * 2 + 4.6, 10), wood);
  beam.rotation.z = Math.PI / 2;
  beam.position.set(0, 7.6, 0);
  beam.castShadow = true;
  g.add(beam);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(hw * 2 + 1.4, 1.9),
    new THREE.MeshLambertMaterial({ map: bannerTexture(title), side: THREE.DoubleSide }),
  );
  banner.position.set(0, 6.25, 0);
  banner.rotation.y = Math.PI; // 走ってくる側に文字を向ける
  g.add(banner);
  return g;
}
