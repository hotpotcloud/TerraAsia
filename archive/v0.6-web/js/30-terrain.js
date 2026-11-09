/* TerraAsia · 地形网格与材质
 * 依赖：core, data, globe
 * 职责：把数值场变成一张网格 + 一个着色器；对外只暴露 setExag / setSun / 选中遮罩。
 *       光照、阴影、水面、等高线全部在片元着色器里完成，CPU 每帧不做任何逐顶点运算。
 */
(function (TA) {
  'use strict';

  const { lerp, smoothstep } = TA.core;
  const SHADOW_STEPS = 40;          // 自遮挡步进次数：40 步 × 0.55 单位 ≈ 22 单位，够跨过任何山体
  const STEP_WORLD = 0.55;

  /** 分层设色：低地绿 → 丘陵黄 → 高原褐 → 雪线白 */
  const RAMP = [
    [-300, '#5a4a33'], [0, '#3e7d4e'], [80, '#4a9152'], [200, '#67a35c'], [500, '#94ad5c'],
    [800, '#bfa05c'], [1200, '#b98a45'], [2000, '#ae7c3f'], [3000, '#96602e'], [4000, '#8a5a3c'],
    /* 雪线要与图例一致(5000m 以上是雪): 5400 起转灰白, 5800 基本全白。
       原来 5900 才开始发白, 但 z6 高程被平滑过, 峰顶很少摸到 5900, 视觉上整片雪山是褐的。 */
    [4800, '#8f6f57'], [5200, '#a89a8e'], [5600, '#d3d8db'], [5900, '#eef2f5'], [9000, '#ffffff'],
  ].map((e) => [e[0], parseInt(e[1].slice(1, 3), 16) / 255, parseInt(e[1].slice(3, 5), 16) / 255, parseInt(e[1].slice(5, 7), 16) / 255]);

  /* 海面三档。shader 输出线性色、由 three 转 sRGB，所以线性值要压得很低。
     亚洲范围浅海（北冰洋陆架、巽他陆架）面积巨大，浅海档位一太亮就整片发青、抢走主体。 */
  const W_SHALLOW = [0.042, 0.150, 0.255];
  const W_MID = [0.026, 0.095, 0.185];
  const W_DEEP = [0.011, 0.042, 0.105];
  const BG_LIN = [0.0018, 0.0043, 0.0088];   // #060d16 的线性值：图幅边缘渐隐到它 = 无缝收边

  function rampColor(h) {
    if (h <= RAMP[0][0]) return [RAMP[0][1], RAMP[0][2], RAMP[0][3]];
    for (let r = 0; r < RAMP.length - 1; r++) {
      if (h <= RAMP[r + 1][0]) {
        const t = (h - RAMP[r][0]) / (RAMP[r + 1][0] - RAMP[r][0]);
        return [lerp(RAMP[r][1], RAMP[r + 1][1], t), lerp(RAMP[r][2], RAMP[r + 1][2], t), lerp(RAMP[r][3], RAMP[r + 1][3], t)];
      }
    }
    const L = RAMP[RAMP.length - 1];
    return [L[1], L[2], L[3]];
  }

  /** 顶点色：分层设色 + 境外去饱和压暗 + 海面三段 + 图幅边缘渐隐 */
  function buildVertexColors(ctx) {
    const { proj, data } = ctx;
    const { GW, GH } = proj;
    const { elev, landW, depth, cnW } = data;
    const col = new Float32Array(GW * GH * 3);

    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const n = j * GW + i, k3 = n * 3;
      const lc = rampColor(elev[n]);
      /* 中国以外陆地：保留真实起伏，但去饱和 + 蓝偏 + 压暗 → "冷灰浮雕底衬"。
         压暗必须够狠：去饱和会把绿色推向高亮度灰，只降饱和不降亮度整块大陆会发白发平。 */
      const gL = lc[0] * 0.30 + lc[1] * 0.59 + lc[2] * 0.11;
      const ncol = [
        lerp(lc[0], gL, 0.55) * 0.66,
        lerp(lc[1], gL, 0.55) * 0.72,
        lerp(lc[2], gL, 0.55) * 0.84,
      ];
      /* 海洋三段：陆架 / 海盆 / 深海沟。只做两段渐变会糊成一片均匀的蓝，
         看不出"哪里是浅海"。 */
      const df = Math.min(1, depth[n]);
      const wc = df < 0.42
        ? [lerp(W_SHALLOW[0], W_MID[0], df / 0.42), lerp(W_SHALLOW[1], W_MID[1], df / 0.42), lerp(W_SHALLOW[2], W_MID[2], df / 0.42)]
        : [lerp(W_MID[0], W_DEEP[0], (df - 0.42) / 0.58), lerp(W_MID[1], W_DEEP[1], (df - 0.42) / 0.58), lerp(W_MID[2], W_DEEP[2], (df - 0.42) / 0.58)];

      const isCN = cnW[n];
      const lc0 = lerp(ncol[0], lc[0], isCN);
      const lc1 = lerp(ncol[1], lc[1], isCN);
      const lc2 = lerp(ncol[2], lc[2], isCN);
      const w = landW[n];
      const bl = Math.min(1, Math.max(0, (w - 0.45) / 0.15));      // 水→陆过渡
      let c0 = lerp(wc[0], lc0, bl), c1 = lerp(wc[1], lc1, bl), c2 = lerp(wc[2], lc2, bl);

      /* 图幅边缘渐隐到背景色而不是单纯变暗：亚洲是从地球上切下来的一块，
         硬边会让整个沙盘像贴图。 */
      const ed = Math.min(i, GW - 1 - i, j, GH - 1 - j);
      const ef = smoothstep(0, 1, Math.min(1, ed / (bl > 0.01 ? 0.09 * GW : 0.13 * GW)));
      col[k3] = lerp(BG_LIN[0], c0, ef);
      col[k3 + 1] = lerp(BG_LIN[1], c1, ef);
      col[k3 + 2] = lerp(BG_LIN[2], c2, ef);
    }
    return col;
  }

  function create(ctx) {
    const { T, proj, data, globe, scene } = ctx;
    const { GW, GH } = proj;
    const N = GW * GH;

    /* ---------- 几何 ---------- */
    const geo = new T.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const uv = new Float32Array(N * 2);
    const aTier = new Float32Array(N);
    const aW = new Float32Array(N);
    const aLon = new Float32Array(N);
    const aElev = new Float32Array(N);
    const col = buildVertexColors(ctx);

    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const n = j * GW + i, k3 = n * 3;
      pos[k3] = (i / (GW - 1) - 0.5) * proj.WX;
      pos[k3 + 1] = 0;                                  // 高度由 setExag 填充
      pos[k3 + 2] = (j / (GH - 1) - 0.5) * proj.WZ;
      aTier[n] = data.tierA[n];
      aW[n] = data.landW[n];
      aLon[n] = i / (GW - 1);
      aElev[n] = data.elev[n];
      uv[n * 2] = i / (GW - 1);
      uv[n * 2 + 1] = 1 - j / (GH - 1);
    }
    const idx = new Uint32Array((GW - 1) * (GH - 1) * 6);
    let p = 0;
    for (let j = 0; j < GH - 1; j++) for (let i = 0; i < GW - 1; i++) {
      const a = j * GW + i, b = a + 1, c = a + GW, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.setAttribute('aTier', new T.BufferAttribute(aTier, 1));
    geo.setAttribute('aW', new T.BufferAttribute(aW, 1));
    geo.setAttribute('aLon', new T.BufferAttribute(aLon, 1));
    geo.setAttribute('aElev', new T.BufferAttribute(aElev, 1));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geo.setIndex(new T.BufferAttribute(idx, 1));

    /* ---------- 选中省份遮罩（画布 → 纹理，贴合地形） ---------- */
    const selCanvas = document.createElement('canvas');
    selCanvas.width = GW; selCanvas.height = GH;
    const selCtx = selCanvas.getContext('2d');
    const selTex = new T.CanvasTexture(selCanvas);
    selTex.minFilter = selTex.magFilter = T.LinearFilter;

    /* ---------- 光照状态 ---------- */
    const sun = { az: 315, el: 40, dir: new T.Vector3() };
    const uniforms = {
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uDim: { value: new T.Vector3(1, 1, 1) },
      uSel: { value: selTex },
      uSelAmt: { value: 0 },
      uSun: { value: sun.dir },
      uShadowOn: { value: 1 },
      uAOAmt: { value: 1 },
      uExag: { value: 8.5 },
      uAO: { value: data.aoTex },
      uHeight: { value: data.heightTex },
      uGlobe: globe.U,
    };

    function setSun(az, el) {
      sun.az = az; sun.el = el;
      const a = az * Math.PI / 180, e = el * Math.PI / 180;
      sun.dir.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
    }
    setSun(315, 40);

    /* ---------- 着色器 ---------- */
    const material = new T.ShaderMaterial({
      uniforms,
      vertexShader: `
        ${globe.glsl}
        attribute vec3 color; attribute float aTier; attribute float aW; attribute float aLon; attribute float aElev;
        uniform float uReveal;
        varying vec3 vColor; varying vec3 vNormal; varying vec3 vPos;
        varying float vTier; varying float vW; varying float vK; varying vec2 vUv; varying float vElev;
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
          vColor = color; vTier = aTier; vW = aW; vK = k; vUv = uv; vElev = aElev;
          vNormal = normalize(mix(nf, ng, uGlobe));
          vPos = gp;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(gp, 1.0);
        }`,
      fragmentShader: `
        precision highp float;
        ${globe.glsl}
        uniform float uTime; uniform vec3 uDim;
        uniform vec3 uSun;
        uniform float uShadowOn; uniform float uAOAmt; uniform float uExag; uniform float uSelAmt;
        uniform sampler2D uSel; uniform sampler2D uAO; uniform sampler2D uHeight;
        varying vec3 vColor; varying vec3 vNormal; varying vec3 vPos;
        varying float vTier; varying float vW; varying float vK; varying vec2 vUv; varying float vElev;

        const float V0_ = ${proj.V0};
        const float STEP_ = ${STEP_WORLD};

        float terrainH(vec2 g){
          if(g.x < 0.0 || g.x > 1.0 || g.y < 0.0 || g.y > 1.0) return -1.0;
          return texture2D(uHeight, g).r * uExag * V0_;
        }
        /* 太阳方向的地形自遮挡 —— "高度落差阴影"就靠它：
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

          /* 太阳方向搬到本片元的局部平面系：球面模式下"上"变成径向、方位随经度转。
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

          // ---- 陆地 ----
          float sh = 1.0;
          if(uShadowOn > 0.5 && isWater < 0.5){
            vec2 sunH = vec2(Ll.x, Ll.z);
            float shl = max(length(sunH), 1e-4);
            vec2 duv = vec2(Ll.x / WX_, Ll.z / WZ_) / shl * STEP_;
            sh = sunShadow(g, max(vElev, 0.0) * uExag * V0_, duv, STEP_ * (Ll.y / shl));
          }
          float ndl = max(dot(n, Lw), 0.0);
          /* 天空半球光：朝上的面吃到更多天光，沟谷与背光坡自然压暗。
             环境光给太多会把坡向差异抹平（整块大陆发灰发平），这里压在 0.2~0.4。 */
          float skyL = 0.24 + 0.20 * (0.5 + 0.5 * n.y);
          /* 反向补光：只补一点点，避免背光面死黑，同时保留主光的明暗方向 */
          vec3 Lfill = normalize(vec3(-Lw.x, 0.55, -Lw.z));
          float fill = max(dot(n, Lfill), 0.0) * 0.09;
          vec3 col = vColor * (skyL * 0.66 + ndl * 1.08 * sh + fill);
          col *= mix(0.72, 1.0, ao);
          col *= (1.0 - slope * 0.20);
          // 高海拔按坡度分雪与岩：陡壁挂不住雪，露出深色岩体，山体才有"重量"
          float high = smoothstep(4600.0, 5600.0, vElev);
          if(high > 0.001){
            vec3 rock = vColor * vec3(0.80, 0.75, 0.71);
            col = mix(col, mix(rock, col * 1.05, 1.0 - smoothstep(0.30, 0.62, slope)), high * 0.5);
          }
          // 每 500m 一条淡等高带 —— 让"多少米"读得出来
          float fr = fract(vElev / 500.0);
          float line = 1.0 - smoothstep(0.0, 0.055, min(fr, 1.0 - fr));
          col *= (1.0 - line * 0.10);
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
            vec3 wcol = vColor * (0.62 + 0.38 * max(dot(wn, Lw), 0.0));
            wcol += vec3(0.10, 0.22, 0.36) * fres * 0.55;      // 天光反射，让海面"起镜"
            wcol += vec3(1.00, 0.94, 0.80) * spec * 0.55;      // 太阳反光带
            float foam = smoothstep(0.50, 0.60, vW) * (1.0 - smoothstep(0.60, 0.70, vW));
            wcol += vec3(0.55, 0.68, 0.78) * foam * 0.32;
            wcol *= mix(0.80, 1.0, ao);
            col = mix(col, wcol, isWater);
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

    const mesh = new T.Mesh(geo, material);
    scene.add(mesh);

    /* ---------- 法线与高程 ---------- */
    /* 法线平滑：陡崖处相邻三角形法线的水平分量会左右翻转，直接光照会渲染成
       一排明暗相间的竖条纹（"城墙鳍片"）。两次邻域平均可消除，且不影响大尺度坡向。 */
    function smoothNormals(passes) {
      const nrm = geo.attributes.normal.array;
      const tmp = new Float32Array(nrm.length);
      for (let p = 0; p < passes; p++) {
        for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
          const n = (j * GW + i) * 3;
          let x = nrm[n], y = nrm[n + 1], z = nrm[n + 2], c = 1;
          if (i > 0) { x += nrm[n - 3]; y += nrm[n - 2]; z += nrm[n - 1]; c++; }
          if (i < GW - 1) { x += nrm[n + 3]; y += nrm[n + 4]; z += nrm[n + 5]; c++; }
          if (j > 0) { const m = n - GW * 3; x += nrm[m]; y += nrm[m + 1]; z += nrm[m + 2]; c++; }
          if (j < GH - 1) { const m = n + GW * 3; x += nrm[m]; y += nrm[m + 1]; z += nrm[m + 2]; c++; }
          const L = Math.hypot(x, y, z) || 1;
          tmp[n] = x / L; tmp[n + 1] = y / L; tmp[n + 2] = z / L;
        }
        nrm.set(tmp);
      }
      geo.attributes.normal.needsUpdate = true;
    }

    /** 设置垂直夸张：只改 Y 坐标 + 重算法线，不重建几何 */
    function setExag(ex) {
      const arr = geo.attributes.position.array;
      for (let n = 0; n < N; n++) arr[n * 3 + 1] = data.elevW[n] * ex * proj.V0;
      geo.attributes.position.needsUpdate = true;
      geo.computeVertexNormals();
      smoothNormals(2);
      uniforms.uExag.value = ex;
    }

    return {
      mesh, material, uniforms, geo, setExag, setSun, smoothNormals,
      getSun() { return { az: sun.az, el: sun.el }; },
      sel: { canvas: selCanvas, ctx: selCtx, texture: selTex },
      setShadow(on) { uniforms.uShadowOn.value = on ? 1 : 0; },
      setAO(on) { uniforms.uAOAmt.value = on ? 1 : 0; },
    };
  }

  TA.terrain = { create };
})(window.TA = window.TA || {});
