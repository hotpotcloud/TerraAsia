import * as THREE from 'three';
import { lerp, smoothstep } from '../data/projection';
import type { Mapping } from '../data/globe';
import type { FieldPack } from '../data/terrainLoader';

/**
 * 地形配色与材质。
 * 光照、投射阴影、水面、等高线全部在片元着色器里完成，CPU 每帧不做任何逐顶点运算。
 */

/** 自遮挡步进次数：40 步 × 0.55 单位 ≈ 22 单位，够跨过任何山体 */
const SHADOW_STEPS = 40;
const STEP_WORLD = 0.55;

/** 分层设色：低地绿 → 丘陵黄 → 高原褐 → 雪线白 */
const RAMP: [number, number, number, number][] = [
  [-300, '#5a4a33'], [0, '#3e7d4e'], [80, '#4a9152'], [200, '#67a35c'], [500, '#94ad5c'],
  [800, '#bfa05c'], [1200, '#b98a45'], [2000, '#ae7c3f'], [3000, '#96602e'], [4000, '#8a5a3c'],
  /* 雪线要与图例一致（5000m 以上是雪）：5200 起转灰白，5900 基本全白。
     原来 5900 才开始发白，但高程被平滑过，峰顶很少摸到 5900，视觉上整片雪山是褐的。 */
  [4800, '#8f6f57'], [5200, '#a89a8e'], [5600, '#d3d8db'], [5900, '#eef2f5'], [9000, '#ffffff'],
].map(([e, hex]) => [
  e as number,
  parseInt((hex as string).slice(1, 3), 16) / 255,
  parseInt((hex as string).slice(3, 5), 16) / 255,
  parseInt((hex as string).slice(5, 7), 16) / 255,
]);

/* 海面三档。shader 输出线性色、由 three 转 sRGB，所以线性值要压得很低。
   亚洲范围浅海（北冰洋陆架、巽他陆架）面积巨大，浅海档位一太亮就整片发青、抢走主体。 */
const W_SHALLOW = [0.042, 0.15, 0.255];
const W_MID = [0.026, 0.095, 0.185];
const W_DEEP = [0.011, 0.042, 0.105];
/** #060d16 的线性值：图幅边缘渐隐到它 = 无缝收边 */
export const BG_LIN: [number, number, number] = [0.0018, 0.0043, 0.0088];

function rampColor(h: number): [number, number, number] {
  if (h <= RAMP[0][0]) return [RAMP[0][1], RAMP[0][2], RAMP[0][3]];
  for (let r = 0; r < RAMP.length - 1; r++) {
    if (h <= RAMP[r + 1][0]) {
      const t = (h - RAMP[r][0]) / (RAMP[r + 1][0] - RAMP[r][0]);
      return [
        lerp(RAMP[r][1], RAMP[r + 1][1], t),
        lerp(RAMP[r][2], RAMP[r + 1][2], t),
        lerp(RAMP[r][3], RAMP[r + 1][3], t),
      ];
    }
  }
  const L = RAMP[RAMP.length - 1];
  return [L[1], L[2], L[3]];
}

/**
 * 顶点色：分层设色 + 境外去饱和压暗 + 海面三段。
 * 图幅边缘渐隐不再烘进颜色，而是拆成独立属性 aEdge —— 地球模式下要把它关掉，
 * 否则球面上会出现一圈暗色矩形边框。
 */
export function buildVertexColors(pack: FieldPack): { color: Float32Array; edge: Float32Array } {
  const { GW, GH } = pack;
  const { elev, landW, depth, cnW } = pack;
  const col = new Float32Array(GW * GH * 3);
  const edge = new Float32Array(GW * GH);

  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const n = j * GW + i;
      const k3 = n * 3;
      const lc = rampColor(elev[n]);
      /* 中国以外陆地：保留真实起伏，但去饱和 + 蓝偏 + 压暗 → 「冷灰浮雕底衬」。
         压暗必须够狠：去饱和会把绿色推向高亮度灰，只降饱和不降亮度整块大陆会发白发平。 */
      const gL = lc[0] * 0.3 + lc[1] * 0.59 + lc[2] * 0.11;
      const ncol: [number, number, number] = [
        lerp(lc[0], gL, 0.55) * 0.66,
        lerp(lc[1], gL, 0.55) * 0.72,
        lerp(lc[2], gL, 0.55) * 0.84,
      ];
      /* 海洋三段：陆架 / 海盆 / 深海沟。只做两段渐变会糊成一片均匀的蓝，
         看不出「哪里是浅海」。 */
      const df = Math.min(1, depth[n]);
      const wc: [number, number, number] =
        df < 0.42
          ? [
              lerp(W_SHALLOW[0], W_MID[0], df / 0.42),
              lerp(W_SHALLOW[1], W_MID[1], df / 0.42),
              lerp(W_SHALLOW[2], W_MID[2], df / 0.42),
            ]
          : [
              lerp(W_MID[0], W_DEEP[0], (df - 0.42) / 0.58),
              lerp(W_MID[1], W_DEEP[1], (df - 0.42) / 0.58),
              lerp(W_MID[2], W_DEEP[2], (df - 0.42) / 0.58),
            ];

      const isCN = cnW[n];
      const w = landW[n];
      const bl = Math.min(1, Math.max(0, (w - 0.45) / 0.15)); // 水→陆过渡
      col[k3] = lerp(wc[0], lerp(ncol[0], lc[0], isCN), bl);
      col[k3 + 1] = lerp(wc[1], lerp(ncol[1], lc[1], isCN), bl);
      col[k3 + 2] = lerp(wc[2], lerp(ncol[2], lc[2], isCN), bl);

      /* 边缘渐隐宽度：陆地窄一点（保住大陆轮廓），水面宽一点（让图幅边界消失） */
      const ed = Math.min(i, GW - 1 - i, j, GH - 1 - j);
      const span = bl > 0.01 ? 0.09 * GW : 0.13 * GW;
      edge[n] = smoothstep(0, 1, Math.min(1, ed / span));
    }
  }
  return { color: col, edge };
}

/** 太阳：方位角 / 高度角（度）→ 世界方向。所有材质共用同一盏灯。 */
export const sun = { az: 315, el: 40, dir: new THREE.Vector3() };

export function setSun(az: number, el: number): void {
  sun.az = az;
  sun.el = el;
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  sun.dir.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
}
setSun(315, 40);

export interface TerrainMaterialOpts {
  mapping: Mapping;
  glsl: string;
  v0: number;
  /** 全球底图：不投射阴影、不做图幅边缘渐隐 */
  isWorld?: boolean;
}

export interface TerrainMaterialResult {
  material: THREE.ShaderMaterial;
  uniforms: Record<string, THREE.IUniform>;
}

export function createTerrainMaterial(opts: TerrainMaterialOpts): TerrainMaterialResult {
  const { glsl, v0, isWorld } = opts;

  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uReveal: { value: isWorld ? 1 : 0 },
    uDim: { value: new THREE.Vector3(1, 1, 1) },
    uSel: { value: null },
    uSelAmt: { value: 0 },
    uSun: { value: sun.dir },
    uShadowOn: { value: isWorld ? 0 : 1 },
    uAOAmt: { value: 1 },
    uExag: { value: 8.5 },
    uAO: { value: null },
    uHeight: { value: null },
    uBg: { value: new THREE.Vector3(...BG_LIN) },
    /* 1 = 图幅边缘渐隐到背景（全球底图）；0 = 不渐隐（亚洲 patch 要无缝压在世界底图上） */
    uEdgeMode: { value: isWorld ? 1 : 0 },
    uGlobe: { value: 0 }, // 由外面替换成共享对象 GLOBE_U
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      ${glsl}
      attribute vec3 color;
      attribute float aTier;
      attribute float aW;
      attribute float aLon;
      attribute float aElev;
      attribute float aEdge;
      uniform float uReveal;
      varying vec3 vColor; varying vec3 vNormal; varying vec3 vPos;
      varying float vTier; varying float vW; varying float vK; varying vec2 vUv; varying float vElev; varying float vEdge;
      void main(){
        vec3 p = position;
        float k = clamp((uReveal * 1.3 - (1.0 - aLon)) / 0.3, 0.0, 1.0);
        p.y *= k;
        /* 法线要跟着卷到球面：平面法线的 (东,天,南) 分量在球面上分别对应
           切向东、径向、切向南，用这组基搬运相当于把法线做平行移动。 */
        vec3 nf = normalize(normal);
        vec3 e, r, s; sphereFrame(p, e, r, s);
        vec3 ng = normalize(e * nf.x + r * nf.y + s * nf.z);
        vec3 gp = mix(p, globePos(p), uGlobe);
        vColor = color; vTier = aTier; vW = aW; vK = k; vUv = uv; vElev = aElev; vEdge = aEdge;
        vNormal = normalize(mix(nf, ng, uGlobe));
        vPos = gp;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(gp, 1.0);
      }`,
    fragmentShader: `
      precision highp float;
      ${glsl}
      uniform float uTime; uniform vec3 uDim; uniform vec3 uBg;
      uniform vec3 uSun;
      uniform float uShadowOn; uniform float uAOAmt; uniform float uExag; uniform float uSelAmt; uniform float uEdgeMode;
      uniform sampler2D uSel; uniform sampler2D uAO; uniform sampler2D uHeight;
      varying vec3 vColor; varying vec3 vNormal; varying vec3 vPos;
      varying float vTier; varying float vW; varying float vK; varying vec2 vUv; varying float vElev; varying float vEdge;

      const float V0_ = ${v0};
      const float STEP_ = ${STEP_WORLD};

      float terrainH(vec2 g){
        if(g.x < 0.0 || g.x > 1.0 || g.y < 0.0 || g.y > 1.0) return -1.0;
        return texture2D(uHeight, g).r * uExag * V0_;
      }
      /* 太阳方向的地形自遮挡 —— 「高度落差阴影」就靠它：
         沿太阳水平投影在网格空间步进，每一步把射线抬高 tan(高度角)×步长，
         与地形高度比较。全程最小间隙用来做半影 —— 山脊擦光时出现自然的软边，
         而不是硬邦邦的锯齿块。 */
      float sunShadow(vec2 g, float h0, vec2 duv, float rise){
        float minD = 1.0;
        vec2 p = g; float h = h0;
        for(int i = 0; i < ${SHADOW_STEPS}; i++){
          p += duv; h += rise;
          float t = terrainH(p);
          if(t < -0.5) break;                  // 出图幅
          float d = h - t;
          if(d < minD) minD = d;
          if(minD < 0.0) break;                // 已被挡住，后面的采样没意义
        }
        return smoothstep(0.0, 0.30, minD);
      }

      void main(){
        vec2 g = vec2(vUv.x, 1.0 - vUv.y);
        vec3 n = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vPos);

        /* 太阳方向搬到本片元的局部平面系：球面模式下「上」变成径向、方位随经度转。
           陆地着色用世界空间，高度场步进用局部系 —— 两边必须一致才不会错位。 */
        float fx = (vUv.x - 0.5) * WX_, fz = ((1.0 - vUv.y) - 0.5) * WZ_;
        vec3 e, r, s; sphereFrame(vec3(fx, 0.0, fz), e, r, s);
        /* 两个空间的太阳要分开：
           Lw(世界) 用于法线点乘 —— vNormal 已经卷到球面，是世界空间；
           Ll(局部平面) 只用于高度场步进 —— 高度纹理是平面网格的坐标。
           混用会得到一个恒为负的点乘，整块地形变黑。 */
        vec3 Lw = normalize(uSun);
        vec3 Ll = normalize(mix(Lw, vec3(dot(Lw, e), dot(Lw, r), dot(Lw, s)), uGlobe));

        float isWater = 1.0 - smoothstep(0.42, 0.58, vW);
        float slope = 1.0 - clamp(n.y, 0.0, 1.0);
        float ao = mix(1.0, texture2D(uAO, g).r, uAOAmt);

        // 图幅边缘渐隐到背景色（全球底图需要；亚洲 patch 不需要，它要压在世界底图上无缝衔接）
        vec3 base = mix(uBg, vColor, mix(1.0, vEdge, uEdgeMode));
        /* 细节羽化：亚洲 patch 的外圈逐渐撤掉阴影与等高线，让高精度区平滑过渡到
           粗网格底图 —— 否则世界地图上会出现一个「细节矩形」。 */
        float dEdge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
        float detail = mix(smoothstep(0.0, 0.022, dEdge), 1.0, uEdgeMode);

        // ---- 陆地 ----
        float sh = 1.0;
        if(uShadowOn > 0.5 && isWater < 0.5){
          vec2 sunH = vec2(Ll.x, Ll.z);
          float shl = max(length(sunH), 1e-4);
          vec2 duv = vec2(Ll.x / WX_, Ll.z / WZ_) / shl * STEP_;
          sh = mix(1.0, sunShadow(g, max(vElev, 0.0) * uExag * V0_, duv, STEP_ * (Ll.y / shl)), detail);
        }
        float ndl = max(dot(n, Lw), 0.0);
        /* 天空半球光：朝上的面吃到更多天光，沟谷与背光坡自然压暗。
           环境光给太多会把坡向差异抹平（整块大陆发灰发平），这里压在 0.2~0.4。 */
        float skyL = 0.24 + 0.20 * (0.5 + 0.5 * n.y);
        /* 反向补光：只补一点点，避免背光面死黑，同时保留主光的明暗方向 */
        vec3 Lfill = normalize(vec3(-Lw.x, 0.55, -Lw.z));
        float fill = max(dot(n, Lfill), 0.0) * 0.09;
        vec3 col = base * (skyL * 0.66 + ndl * 1.08 * sh + fill);
        col *= mix(0.72, 1.0, ao);
        col *= (1.0 - slope * 0.20);
        // 高海拔按坡度分雪与岩：陡壁挂不住雪，露出深色岩体，山体才有「重量」
        float high = smoothstep(4600.0, 5600.0, vElev);
        if(high > 0.001){
          vec3 rock = base * vec3(0.80, 0.75, 0.71);
          col = mix(col, mix(rock, col * 1.05, 1.0 - smoothstep(0.30, 0.62, slope)), high * 0.5);
        }
        // 每 500m 一条淡等高带 —— 让「多少米」读得出来
        float fr = fract(vElev / 500.0);
        float line = 1.0 - smoothstep(0.0, 0.055, min(fr, 1.0 - fr));
        col *= (1.0 - line * 0.10 * detail);
        col *= (0.95 + 0.08 * clamp(vElev / 4500.0, 0.0, 1.0));

        // ---- 水面：菲涅尔 + 太阳镜面 + 微波纹 + 岸边泡沫 ----
        if(isWater > 0.001){
          /* 波纹频率必须远低于像素采样率：用 260 周期会直接混叠成一片大亮斑
             （摩尔纹），远看像海面长了霉点。这里压到 40 周期量级，并按距离衰减。 */
          float ripFade = clamp(1.0 - distance(cameraPosition, vPos) / 620.0, 0.0, 1.0);
          vec2 rip = vec2(
            sin(g.x * 44.0 + uTime * 0.55) + sin(g.y * 27.0 - uTime * 0.42 + g.x * 9.0),
            cos(g.y * 39.0 + uTime * 0.48) + cos(g.x * 31.0 + uTime * 0.36 + g.y * 8.0));
          vec3 wn = normalize(n + vec3(rip.x, 0.0, rip.y) * 0.032 * ripFade);
          float fres = pow(1.0 - clamp(dot(wn, V), 0.0, 1.0), 4.0);
          vec3 Hv = normalize(Lw + V);
          float spec = pow(max(dot(wn, Hv), 0.0), 90.0) * ripFade;
          vec3 wcol = base * (0.62 + 0.38 * max(dot(wn, Lw), 0.0));
          wcol += vec3(0.10, 0.22, 0.36) * fres * 0.55;      // 天光反射，让海面「起镜」
          wcol += vec3(1.00, 0.94, 0.80) * spec * 0.55;      // 太阳反光带
          float foam = smoothstep(0.50, 0.60, vW) * (1.0 - smoothstep(0.60, 0.70, vW));
          wcol += vec3(0.55, 0.68, 0.78) * foam * 0.32 * detail;
          wcol *= mix(0.80, 1.0, ao);
          col = mix(col, wcol, isWater);
        }

        // ---- 地球模式：晨昏线。球面靠法线与太阳夹角分昼夜 ----
        if(uGlobe > 0.001){
          /* 晨昏线：太硬会让半个地球死黑，教学沙盘里看不成东西。
             过渡带拉到 -0.55..0.35，夜面保底 0.34 并偏冷蓝。 */
          float dayl = smoothstep(-0.55, 0.35, dot(n, Lw));
          vec3 nightTint = vec3(0.34, 0.42, 0.58);
          col *= mix(nightTint, vec3(1.0), dayl);
        }

        // ---- 导览压暗 / 省份选中 / 开场升降 ----
        float dim = vTier > 3.5 ? 0.72 : (vTier < 1.5 ? uDim.x : (vTier < 2.5 ? uDim.y : uDim.z));
        col *= mix(0.30, 1.0, dim);
        col *= (0.22 + 0.78 * vK);
        float smk = texture2D(uSel, vUv).r * uSelAmt;
        col = mix(col, vec3(1.0, 0.55, 0.22), smk * 0.40);
        col += vec3(0.07, 0.030, 0.0) * smk;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });

  return { material, uniforms };
}
