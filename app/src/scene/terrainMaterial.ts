import * as THREE from 'three';
import { lerp, smoothstep, DEFAULT_EXAG } from '../data/projection';
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
         压暗必须够狠：去饱和会把绿色推向高亮度灰，只降饱和不降亮度整块大陆会发白发平。
         但也不能狠到把起伏抹掉——放大近景时蒙古高原、中南半岛、朝鲜半岛如果压成
         一片死灰，国境线两侧会强烈断裂，看着像「境外没渲染」。折中：去饱和压到 0.40、
         亮度压到 ~0.78，保留可见的坡向明暗，让它读作「真实但弱化的邻国」而非「空洞」。 */
      const gL = lc[0] * 0.3 + lc[1] * 0.59 + lc[2] * 0.11;
      const ncol: [number, number, number] = [
        lerp(lc[0], gL, 0.40) * 0.80,
        lerp(lc[1], gL, 0.40) * 0.83,
        lerp(lc[2], gL, 0.40) * 0.88,
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
  /** 高度纹理单像素对应 [1/GW, 1/GH]，坡度差分要用 */
  texel: [number, number];
  /** 墨卡托换算常数 [ch/P, (cy0+tyOff)/P]，用于从 vUv 反算纬度 */
  merc: [number, number];
  /** 单像素对应的经度差（度），用于把「米/像素」算出来 */
  lonStep: number;
}

export interface TerrainMaterialResult {
  material: THREE.ShaderMaterial;
  uniforms: Record<string, THREE.IUniform>;
}

export function createTerrainMaterial(opts: TerrainMaterialOpts): TerrainMaterialResult {
  const { glsl, v0, isWorld, texel, merc, lonStep } = opts;

  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uReveal: { value: isWorld ? 1 : 0 },
    uDim: { value: new THREE.Vector3(1, 1, 1) },
    uSel: { value: null },
    uSelAmt: { value: 0 },
    uSun: { value: sun.dir },
    uShadowOn: { value: isWorld ? 0 : 1 },
    uAOAmt: { value: 1 },
    uExag: { value: DEFAULT_EXAG },
    uAO: { value: null },
    uHeight: { value: null },
    uBg: { value: new THREE.Vector3(...BG_LIN) },
    /* 1 = 图幅边缘渐隐到背景（全球底图）；0 = 不渐隐（亚洲 patch 要无缝压在世界底图上） */
    uEdgeMode: { value: isWorld ? 1 : 0 },
    uGlobe: { value: 0 }, // 由外面替换成共享对象 GLOBE_U
    /* 户外决策派生图：0 自然 / 1 坡度 / 2 坡向 / 3 加密等高线 */
    uDerived: { value: 0 },
    uTexel: { value: new THREE.Vector2(texel[0], texel[1]) },
    uMerc: { value: new THREE.Vector2(merc[0], merc[1]) },
    uLonStep: { value: lonStep },
    uPxScale: { value: 0.001 }, // 由 TerrainMesh 按相机 fov 与视口高度写入
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
      /* 精细层覆盖区标记：全球底图在这些片元上让位，避免两套高程网格穿插 */
      attribute float aOverlay;
      uniform float uReveal;
      varying vec3 vColor; varying vec3 vNormal; varying vec3 vPos;
      varying float vTier; varying float vW; varying float vK; varying vec2 vUv; varying float vElev; varying float vEdge;
      varying float vOverlay;
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
        vOverlay = aOverlay;
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
      uniform float uDerived; uniform vec2 uTexel; uniform vec2 uMerc; uniform float uLonStep;
      /** 一个屏幕像素对应多少世界单位（= 2·tan(fov/2) / 视口高度） */
      uniform float uPxScale;
      uniform sampler2D uSel; uniform sampler2D uAO; uniform sampler2D uHeight;
      varying vec3 vColor; varying vec3 vNormal; varying vec3 vPos;
      varying float vTier; varying float vW; varying float vK; varying vec2 vUv; varying float vElev; varying float vEdge;
      varying float vOverlay;

      const float V0_ = ${v0};
      const float STEP_ = ${STEP_WORLD};

      /* 方位角 → 色环。坡向图用 HSV 直接铺色，比手写六段渐变短且没有接缝 */
      vec3 hsv2rgb(vec3 c){
        vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
        return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
      }

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
        /* 半影要拉得够宽：上限太小时，山地微小的坑洼也被判成硬阴影，
           放大近景出现「花斑/麻面」明暗突变。0.30 → 0.85，把坑洼淡化成
           柔和的坡向过渡，只保留真正的山脊大阴影。 */
        return smoothstep(0.0, 0.85, minD);
      }

      void main(){
        /* 覆盖区地表归属：精细层负责的区域里全球粗底图不写入颜色与深度。
           两层网格分辨率不同（亚洲 ~0.10°/格、全球 ~0.35°/格），粗网格会抹平
           沟谷，在沟谷处高于精细层、山脊处低于精细层 —— 共面时深度归属逐像素
           翻转，放大近景就呈现「泡状孤岛 + 灰色平面沟谷」。
           polygonOffset 只能偏移深度，不能改变这个几何事实；必须由覆盖规则解决。
           aOverlay 按经纬度计算，与平面/球面变形无关，两种视图模式一致生效。 */
        if(vOverlay > 0.5) discard;
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
           粗网格底图 —— 否则世界地图上会出现一个「细节矩形」。
           羽化带要窄：太宽会把中南半岛、印度东北这些本就贴着东经 25° 边缘的
           区域细节也抽掉，放大后出现「边缘一整条地形发虚/脱节」。 */
        float dEdge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
        float detail = mix(smoothstep(0.0, 0.006, dEdge), 1.0, uEdgeMode);

        // ---- 陆地 ----
        float sh = 1.0;
        if(uShadowOn > 0.5 && isWater < 0.5){
          vec2 sunH = vec2(Ll.x, Ll.z);
          float shl = max(length(sunH), 1e-4);
          vec2 duv = vec2(Ll.x / WX_, Ll.z / WZ_) / shl * STEP_;
          float shd = sunShadow(g, max(vElev, 0.0) * uExag * V0_, duv, STEP_ * (Ll.y / shl));
          /* 低海拔平原不参与深度自遮挡：平原没有能投长影的山体，远处微起伏却会
             在 40 步里累积成 minD→0，把华北/长江/东北平原整片压成死灰（放大后
             尤其明显，看起来像「地形没渲染」）。用高程把阴影强度淡出，只在丘陵
             与山区保留沟谷阴影，平原靠光照本身的坡向差异已经足够。 */
          float shadowGate = smoothstep(120.0, 900.0, vElev);
          sh = mix(1.0, shd, detail * shadowGate);
        }
        float ndl = max(dot(n, Lw), 0.0);
        /* 天空半球光：朝上的面吃到更多天光，沟谷与背光坡自然压暗。
           环境光给太多会把坡向差异抹平（整块大陆发灰发平），这里压在 0.2~0.4。 */
        float skyL = 0.24 + 0.20 * (0.5 + 0.5 * n.y);
        /* 反向补光：只补一点点，避免背光面死黑，同时保留主光的明暗方向 */
        vec3 Lfill = normalize(vec3(-Lw.x, 0.55, -Lw.z));
        float fill = max(dot(n, Lfill), 0.0) * 0.09;
        vec3 col = base * (skyL * 0.66 + ndl * 1.08 * sh + fill);
        /* AO 最深处压到 0.80 而非 0.72：沟谷过暗会让山地整体发灰发脏、显「坑洼」，
           稍抬一点保底亮度，保留遮蔽层次的同时不至于糊成灰黑。 */
        col *= mix(0.80, 1.0, ao);
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

        /* ---- 户外决策派生图：坡度 / 坡向 / 加密等高线 ----
           全部由高度纹理差分实时算，不新增任何数据文件。
           关键：坡度用「真实水平距离」，不是屏幕斜率 —— 后者随垂直夸张变化，
           把滑块从 3× 拉到 12× 读数会翻四倍，没有可用性。

           墨卡托是等角投影，同一纬度上 x/y 两向的「米/像素」相同，所以只需
           算一个 mPerTexel；但它随 cos(lat) 变化，必须逐片元反算纬度，
           否则青藏高原（30°N）与东北（48°N）的坡度会被系统性低估。 */
        float slopeDeg = 0.0;
        float aspectDeg = 0.0;
        if(uDerived > 0.5 && isWater < 0.5){
          float hE = texture2D(uHeight, clamp(g + vec2(uTexel.x, 0.0), vec2(0.0), vec2(1.0))).r;
          float hW = texture2D(uHeight, clamp(g - vec2(uTexel.x, 0.0), vec2(0.0), vec2(1.0))).r;
          float hN = texture2D(uHeight, clamp(g + vec2(0.0, -uTexel.y), vec2(0.0), vec2(1.0))).r;
          float hS = texture2D(uHeight, clamp(g + vec2(0.0,  uTexel.y), vec2(0.0), vec2(1.0))).r;
          /* vUv.y = 1 - gy/(GH-1)，墨卡托 y 与 gy 线性相关：
             pyAbs/P = g.y * uMerc.x + uMerc.y，再反解纬度 */
          float latRad = atan(sinh(3.14159265 * (1.0 - 2.0 * (g.y * uMerc.x + uMerc.y))));
          float mPerTexel = max(uLonStep * 111320.0 * cos(latRad), 1.0);
          float gE = (hE - hW) * 0.5 / mPerTexel;
          float gN = (hN - hS) * 0.5 / mPerTexel;
          slopeDeg = degrees(atan(length(vec2(gE, gN))));
          /* 下坡方向的方位角：梯度指向最高处，取反即下坡；x=东、y=北，北为 0° 顺时针 */
          aspectDeg = degrees(atan(-gE, -gN));
          if(aspectDeg < 0.0) aspectDeg += 360.0;
        }

        if(uDerived > 0.5 && isWater < 0.5){
          /* 派生图仍要读得出地形起伏：保留太阳明暗，把色相完全交给主题。
             明暗幅度必须够大 —— 压到 0.84~1.06 时整张专题图会「平掉」，
             山脊和谷地看不出差别，看着像一张色卡而不是地形。 */
          float shade = clamp(skyL * 0.60 + ndl * 0.95 * sh, 0.05, 1.15);
          vec3 theme;
          if(uDerived < 1.5){
            /* 坡度分级必须按这张网格的实际分布来定，不能照搬步道口径。
               11 km 网格上实测：中位 0.3°、p90 1.4°、p99 3.2°、最大 7.8°——
               照 0–45° 那套分级，整个亚洲都会落在最浅一档，图等于没做。
               这里用 0.5 / 1 / 2 / 4 / 6 度分档，图例同时给出对应的 m/km。 */
            theme = vec3(0.15, 0.38, 0.32);
            theme = mix(theme, vec3(0.27, 0.55, 0.34), smoothstep(0.4, 0.7, slopeDeg));
            theme = mix(theme, vec3(0.72, 0.76, 0.36), smoothstep(0.9, 1.3, slopeDeg));
            theme = mix(theme, vec3(0.88, 0.58, 0.24), smoothstep(1.8, 2.4, slopeDeg));
            theme = mix(theme, vec3(0.82, 0.29, 0.22), smoothstep(3.6, 4.6, slopeDeg));
            theme = mix(theme, vec3(0.58, 0.15, 0.36), smoothstep(5.8, 7.4, slopeDeg));
          } else if(uDerived < 2.5){
            theme = hsv2rgb(vec3(aspectDeg / 360.0, 0.52, 0.86));
            /* 近水平面上「下坡方向」是数值噪声，去饱和成灰，避免平原花掉。
               阈值同样按实测压到 1° 以内，否则大片缓坡全被涂灰。 */
            theme = mix(vec3(0.48, 0.53, 0.58), theme, smoothstep(0.2, 0.9, slopeDeg));
          } else {
            /* 等高线：保留分层设色，叠 500 m 细线 + 1000 m 粗线。
               线宽必须按屏幕像素反推 —— 固定用「高程分数带宽」时，
               远景一条线不到 1 像素、看不清；近景又糊成一片粗带。
               这里先算 1 像素对应多少米高程（垂直方向），再把线宽定成约 1.5 像素。
               等高距取 500 m 而不取 100 m：这张网格约 11 km/格，常见视距下
               1 像素已对应 40–70 m 高程，100 m 的线在远景根本分辨不出来。 */
            float dist = distance(cameraPosition, vPos);
            float mPerPx = dist * uPxScale / max(uExag * V0_, 1e-6);
            float bandM = clamp(0.85 * mPerPx, 4.0, 90.0);
            float fp5 = fract(vElev / 500.0);
            float l500 = 1.0 - smoothstep(0.0, bandM, min(fp5, 1.0 - fp5) * 500.0);
            float fp10 = fract(vElev / 1000.0);
            float l1000 = 1.0 - smoothstep(0.0, bandM * 1.5, min(fp10, 1.0 - fp10) * 1000.0);
            theme = col * (1.0 - 0.34 * l500 - 0.34 * l1000);
            shade = 1.0;
          }
          col = theme * mix(0.52, 1.22, clamp(shade, 0.0, 1.0)) * mix(0.84, 1.0, ao);
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
        /* tier 语义：1/2/3 = 中国三级阶梯，4 = 境外陆地，0 = 海洋。
           导览压暗只作用于「中国境内但当前未聚焦的阶梯」——境外（4）不属于任何
           阶梯，不该被压暗；之前把 tier>3.5 一律乘 0.72，等于把境外整片再压暗
           28%，叠加去饱和后境外死灰一片、坡向明暗被抹平，看起来像「没渲染」。 */
        float dim = vTier > 3.5 ? 1.0 : (vTier < 1.5 ? uDim.x : (vTier < 2.5 ? uDim.y : uDim.z));
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
