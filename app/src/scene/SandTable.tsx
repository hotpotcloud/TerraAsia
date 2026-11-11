import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { GLOBE_U } from '../data/globe';
import type { FieldPack } from '../data/terrainLoader';
import { useAppStore } from '../state/store';
import { viewState } from './viewState';

/**
 * 沙盘块：亚洲地形被「切」下来放在底座上的实体模型。
 *
 * 为什么不是一块 `BoxGeometry`：沙盘块的顶面必须**贴着地形起伏**走，落到海里就
 * 在水面高度收口。用方盒会得到一块平顶，海岸线与高原会从盒子里戳出来。
 * 这里沿图幅四条边逐点采样地形高度，往下拉到统一的底平面，生成一圈梯形带，
 * 得到的正是「从一块厚岩板上切出来的亚洲」这个形状。
 *
 * 三层结构（自上而下）：
 *   1. 断面岩层 —— 表面高度 → 板底，越深越暗，模拟被切开的岩土
 *   2. 底座台沿 —— 外扩 PAD 的一圈水平环，让模型「坐」在台面上而不是飘着
 *   3. 底座侧壁 —— 再往下 PLINTH_H，比岩层更暗更沉，与背景自然咬合
 *
 * 只做侧壁不做底盖：正射角度下底面永远被遮住，省一半三角形。
 */

/** 岩板厚度（世界单位）。亚洲图幅宽约 305 单位，板厚取 1.7%，
 *  与珠峰（8848 m × 5 × V0 ≈ 5.3 单位）同量级 —— 断面读起来像一截地壳而非一张纸。 */
const DEPTH = 5.2;

/** 底座外扩量与厚度：台沿这一圈是「模型被装裱起来」最直接的视觉线索 */
const PAD = 1.7;
const PLINTH_H = 1.6;

/** 每条边的采样段数。128 段 × 4 边 ≈ 1024 个梯形，侧壁轮廓足够光滑 */
const EDGE_N = 128;

type RGB = [number, number, number];

/** 声明色一律写「屏幕上看的样子」，由 three 的 ColorManagement 转到线性工作空间。
 *  直接往顶点色里塞灰阶数值会被当成线性值，输出时 sRGB 编码再抬亮一档
 *  （0.32 线性 ≈ 0.60 sRGB），断面就会亮得像描了一圈白边。 */
const srgb = (hex: string): RGB => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

/** 顶缘受光的薄唇线：只有 0.9 单位高，模拟被顶光打亮的切边 */
const LIP = 0.9;

/** 断面自上而下：唇线 → 中层岩体 → 沉入暗部的板底 */
const C_LIP = srgb('#7a858f');
const C_ROCK_T = srgb('#55606b');
const C_ROCK_M = srgb('#3b4650');
const C_ROCK_B = srgb('#262f38');

/** 底座：台沿略亮于侧壁（接住顶光的那一圈），侧壁底部几乎融进背景（#060d16） */
const C_STEP = srgb('#39434d');
const C_PLINTH_T = srgb('#242d36');
const C_PLINTH_B = srgb('#080d12');

export function SandTable({ pack }: { pack: FieldPack }) {
  const exag = useAppStore((s) => s.exag);
  const sandbox = useAppStore((s) => s.sandbox);
  const groupRef = useRef<THREE.Group>(null);

  const geo = useMemo(() => {
    const { proj } = pack;
    const hw = proj.WX / 2;
    const hz = proj.WZ / 2;
    const up = exag * proj.V0;

    const pos: number[] = [];
    const col: number[] = [];

    const tri = (
      a: [number, number, number], ca: RGB,
      b: [number, number, number], cb: RGB,
      c: [number, number, number], cc: RGB,
    ) => {
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      col.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
    };

    /* 四条边顺时针绕一圈：内圈（地形图幅）与外圈（底座台沿）用同一套点序，
       保证台沿环首尾相接、转角处不留缝 */
    const loop = (hw: number, hz: number): [number, number][] => [
      ...Array.from({ length: EDGE_N }, (_, i) => [-hw + (2 * hw * i) / EDGE_N, -hz] as [number, number]),
      ...Array.from({ length: EDGE_N }, (_, i) => [hw, -hz + (2 * hz * i) / EDGE_N] as [number, number]),
      ...Array.from({ length: EDGE_N }, (_, i) => [hw - (2 * hw * i) / EDGE_N, hz] as [number, number]),
      ...Array.from({ length: EDGE_N }, (_, i) => [-hw, hz - (2 * hz * i) / EDGE_N] as [number, number]),
    ];

    const inner = loop(hw, hz);
    const outer = loop(hw + PAD, hz + PAD);
    const n = inner.length;

    const surfaceY = inner.map(([x, z]) => pack.sampleHeight(x, z) * up);

    /* 岩板中段的过渡高度：取板厚的 45%，唇线以下的暗岩占断面大半，
       比例上更像真实的地层剖面 */
    const yMid = -DEPTH * 0.45;

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [x0, z0] = inner[i];
      const [x1, z1] = inner[j];
      const y0 = Math.max(surfaceY[i], -DEPTH);
      const y1 = Math.max(surfaceY[j], -DEPTH);
      /* 唇线跟着地形表面走：海面段唇线在 0 附近，高原段随之抬高，
         于是整圈切边像一条连续的受光亮线，而不是忽高忽低的锯齿 */
      const l0 = Math.max(y0 - LIP, yMid);
      const l1 = Math.max(y1 - LIP, yMid);

      /* 1) 岩层断面：唇线（亮）→ 中层岩体 → 板底（暗）
         正反面都画，免得绕行方向写错出现空洞 */
      tri([x0, y0, z0], C_LIP, [x0, l0, z0], C_LIP, [x1, l1, z1], C_LIP);
      tri([x0, y0, z0], C_LIP, [x1, l1, z1], C_LIP, [x1, y1, z1], C_LIP);
      tri([x0, l0, z0], C_ROCK_T, [x0, yMid, z0], C_ROCK_M, [x1, yMid, z1], C_ROCK_M);
      tri([x0, l0, z0], C_ROCK_T, [x1, yMid, z1], C_ROCK_M, [x1, l1, z1], C_ROCK_T);
      tri([x0, yMid, z0], C_ROCK_M, [x0, -DEPTH, z0], C_ROCK_B, [x1, -DEPTH, z1], C_ROCK_B);
      tri([x0, yMid, z0], C_ROCK_M, [x1, -DEPTH, z1], C_ROCK_B, [x1, yMid, z1], C_ROCK_M);

      /* 2) 底座台沿：内圈 → 外圈的水平环，只在俯视时露出这一圈 */
      const [ox0, oz0] = outer[i];
      const [ox1, oz1] = outer[j];
      tri([x0, -DEPTH, z0], C_STEP, [ox0, -DEPTH, oz0], C_STEP, [ox1, -DEPTH, oz1], C_STEP);
      tri([x0, -DEPTH, z0], C_STEP, [ox1, -DEPTH, oz1], C_STEP, [x1, -DEPTH, z1], C_STEP);

      /* 3) 底座侧壁：台沿 → 底座底面，自上而下再压暗一档 */
      const yb = -DEPTH - PLINTH_H;
      tri([ox0, -DEPTH, oz0], C_PLINTH_T, [ox0, yb, oz0], C_PLINTH_B, [ox1, yb, oz1], C_PLINTH_B);
      tri([ox0, -DEPTH, oz0], C_PLINTH_T, [ox1, yb, oz1], C_PLINTH_B, [ox1, -DEPTH, oz1], C_PLINTH_T);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return g;
  }, [pack, exag]);

  /* 断面材质：在顶点色（亮唇线 → 中层岩 → 板底）之上叠一层程序化层理。
     为什么不用贴图：断面是沿图幅四条边生成的梯形带，uv 没有连续含义，
     贴图会在转角处拉伸；而层理本来就是「按绝对高度分带」的东西，用世界坐标算最自然。
     层线加一点沿走向的噪声起伏，避免出现一圈绝对水平的机器感条纹。 */
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uOpacity: { value: 1 } },
        transparent: true,
        side: THREE.DoubleSide,
        vertexShader: `
          attribute vec3 color;
          varying vec3 vC;
          varying vec3 vP;
          void main() {
            vC = color;
            vP = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uOpacity;
          varying vec3 vC;
          varying vec3 vP;

          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
          }
          /* 值噪声：层线起伏与岩面颗粒都用它，比逐像素白噪声更像地质体 */
          float vnoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
              mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
              u.y
            );
          }

          void main() {
            /* 层理沿绝对高度分带，同时被低频噪声扭曲 → 层线略微起伏、不平行 */
            float warp = (vnoise(vP.xz * 0.035) - 0.5) * 1.6
                       + (vnoise(vP.xz * 0.13) - 0.5) * 0.45;
            float band = fract((vP.y + warp) * 0.85);

            /* 层内颗粒：两档噪声叠出粗砂 + 细砂的质感 */
            float grain = vnoise(vP.xz * 3.1 + vP.y * 2.0) * 0.55
                        + vnoise(vP.xz * 9.0 - vP.y * 3.0) * 0.25;

            /* 明暗：带中部略亮、带顶略暗，再回落一档 */
            float shade = 0.80 + 0.26 * band + 0.14 * grain;
            /* 层与层的界面压一道暗缝，这是「有层理」最直接的读法 */
            float seam = smoothstep(0.0, 0.07, band) * smoothstep(1.0, 0.93, band);
            shade *= mix(0.55, 1.0, seam);

            gl_FragColor = vec4(vC * shade, uOpacity);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    [],
  );

  /* 球面模式淡出：星球形态下不该看到一块矩形断面。
     用 GLOBE_U 而不是 viewMode，是因为两种形态之间有 1.6 s 的形变过渡，
     按布尔值切会在过渡途中「啪」地消失。 */
  useFrame(() => {
    const k = 1 - Math.min(1, GLOBE_U.value / 0.12);
    const want = sandbox ? k : 0;
    const u = mat.uniforms.uOpacity as { value: number };
    if (Math.abs(u.value - want) > 0.004) u.value = want;
    const on = want > 0.01;
    if (groupRef.current && groupRef.current.visible !== on) groupRef.current.visible = on;
    viewState.wall = u.value;
  });

  return (
    <group ref={groupRef} name="sandtable">
      <mesh geometry={geo} material={mat} />
    </group>
  );
}
