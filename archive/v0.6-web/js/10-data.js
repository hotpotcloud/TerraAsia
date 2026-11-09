/* TerraAsia · 地形数据：PNG 解码 → 高程/掩膜/阶梯字段 → 平滑 → 天空遮蔽 → GPU 纹理
 * 依赖：core
 * 说明：这一层只做"把一张编码过的 PNG 变成可用的数值场"，不碰任何渲染对象。
 */
(function (TA) {
  'use strict';

  const { V0 } = TA.core;

  /**
   * 肤色编码解码约定（由 prep_data.py 写入）：
   *   R,G = 16 位高程（米，含海底负高程）
   *   B   = 中国境内×阶梯档位 85/170/255；中国以外陆地 0；海洋水深 0..255
   *   A   = 陆地掩膜（已由 split_mask.py 拆到独立 PNG）
   * 于是 "B≥60 且是陆地" ⟺ 中国境内，一个字节同时编码了阶梯与归属。
   */
  async function loadPixels(GW, GH, b64) {
    const im = new Image();
    await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas');
    c.width = GW; c.height = GH;
    const cc = c.getContext('2d', { willReadFrequently: true });
    cc.drawImage(im, 0, 0);
    return cc.getImageData(0, 0, GW, GH).data;
  }

  /** 高程场轻度平滑：抑制 z6 采样噪声在垂直夸张下产生的"碎面" */
  function smoothField(src, GW, GH) {
    const N = GW * GH;
    const tmp = new Float32Array(N), out = new Float32Array(N);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const n = j * GW + i;
      tmp[n] = src[n] * 0.5 + (src[i > 0 ? n - 1 : n] + src[i < GW - 1 ? n + 1 : n]) * 0.25;
    }
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const n = j * GW + i;
      out[n] = tmp[n] * 0.5 + (tmp[j > 0 ? n - GW : n] + tmp[j < GH - 1 ? n + GW : n]) * 0.25;
    }
    return out;
  }

  /**
   * 天空遮蔽（AO）预计算。
   * 与太阳方位无关，只取决于"四周地形挡住多少天空"，所以加载时算一次即可。
   * 全分辨率 229 万像素逐点投射太慢，按 1/4 分辨率采样（约 14 万），着色器里双线性上采样。
   * 遮蔽强度与垂直夸张相关，按默认 8.5× 标定：换夸张度时只是深浅略变，不会失效。
   */
  function buildAO(T, elevW, proj) {
    const { GW, GH, WX } = proj;
    const DIV = 4, AOW = Math.ceil(GW / DIV), AOH = Math.ceil(GH / DIV);
    const data = new Uint8Array(AOW * AOH);
    const REF_EX = 8.5, pxW = WX / (GW - 1);
    const STEPS = 26, DIRS = 8;
    const dirs = [];
    for (let d = 0; d < DIRS; d++) {
      const a = d / DIRS * Math.PI * 2;
      dirs.push([Math.cos(a), Math.sin(a)]);
    }
    const hAt = (i, j) => (i < 0 || j < 0 || i >= GW || j >= GH) ? 0 : Math.max(0, elevW[j * GW + i]);

    for (let jj = 0; jj < AOH; jj++) for (let ii = 0; ii < AOW; ii++) {
      const i0 = Math.min(GW - 1, ii * DIV), j0 = Math.min(GH - 1, jj * DIV);
      const h0 = hAt(i0, j0);
      let occ = 0;
      for (let d = 0; d < DIRS; d++) {
        let tanMax = 0;
        for (let s = 1; s <= STEPS; s++) {
          const r = s * DIV;                                  // 以全分辨率像素为单位的距离
          const dh = hAt(Math.round(i0 + dirs[d][0] * r), Math.round(j0 + dirs[d][1] * r)) - h0;
          if (dh > 0) {
            const t = dh * REF_EX * V0 / (r * pxW);            // 该方向的地平线仰角正切
            if (t > tanMax) tanMax = t;
          }
        }
        occ += Math.min(1, tanMax / 0.90);
      }
      // 0.58 的遮蔽上限：再狠沟谷会糊成黑块，起伏反而看不清
      const v = 1 - (occ / DIRS) * 0.66;
      data[jj * AOW + ii] = Math.round(Math.max(0, Math.min(1, v)) * 255);
    }

    /* DataTexture 的 v=0 是数组首行，而几何 uv.y 是 "1 - 行号/行数"，
       着色器里统一用 vec2(uv.x, 1.0-uv.y) 采样，两边就对上了。 */
    const tex = new T.DataTexture(data, AOW, AOH, T.RedFormat, T.UnsignedByteType);
    tex.minFilter = tex.magFilter = T.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * 加载并解码全部地形数据。
   * @returns {Promise<object>} 数值场 + 纹理 + sampleHeight()
   */
  async function load(T, DATA, proj) {
    const { GW, GH } = proj;
    const px = await loadPixels(GW, GH, DATA.png);
    const maskPx = await loadPixels(GW, GH, DATA.maskPng);
    const N = GW * GH;

    const elev = new Float32Array(N);      // 米
    const landW = new Float32Array(N);     // 陆地权重 0..1（海岸羽化）
    const tierA = new Float32Array(N);     // 0 水 / 1·2·3 阶梯 / 4 中国以外陆地
    const cnA = new Float32Array(N);       // 1 = 中国境内陆地
    const depth = new Float32Array(N);     // 水深 0..1

    const sm = (v) => { v = Math.min(1, Math.max(0, (v - 0.3) / 0.4)); return v * v * (3 - 2 * v); };
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const k = (j * GW + i) * 4, n = j * GW + i;
      const w = sm(maskPx[k] / 255), b = px[k + 2];
      elev[n] = px[k] * 256 + px[k + 1] - 300;
      landW[n] = w;
      if (w > 0.5) {
        const isCN = b >= 60;
        cnA[n] = isCN ? 1 : 0;
        tierA[n] = isCN ? Math.max(1, Math.min(3, Math.round(b / 85))) : 4;
        depth[n] = 0;
      } else {
        cnA[n] = 0; tierA[n] = 0; depth[n] = b / 255;
      }
    }

    const elevW = new Float32Array(N);     // 显示高程（水面 = 0）
    const cnW = new Float32Array(N);       // 中国境内权重（着色主次）
    for (let n = 0; n < N; n++) {
      const w = landW[n];
      elevW[n] = w > 0.5 ? elev[n] * Math.max(0.5, w) : 0;
      cnW[n] = w > 0.5 ? cnA[n] : 0;
    }
    {
      const es = smoothField(elevW, GW, GH);
      // 平滑强度要与垂直夸张配套：磨太少 + 拉太高，高原边缘会出现锯齿"城墙"
      for (let n = 0; n < N; n++) if (elevW[n] !== 0) elevW[n] = es[n] * 0.64 + elevW[n] * 0.36;
    }

    /** 双线性采样显示高程（世界坐标，米） */
    function sampleHeight(x, z) {
      const gx = (x / proj.WX + 0.5) * (GW - 1), gy = (z / proj.WZ + 0.5) * (GH - 1);
      const i0 = Math.max(0, Math.min(GW - 2, Math.floor(gx)));
      const j0 = Math.max(0, Math.min(GH - 2, Math.floor(gy)));
      const fx = gx - i0, fy = gy - j0;
      const e = (i, j) => elevW[j * GW + i];
      return e(i0, j0) * (1 - fx) * (1 - fy) + e(i0 + 1, j0) * fx * (1 - fy) +
             e(i0, j0 + 1) * (1 - fx) * fy + e(i0 + 1, j0 + 1) * fx * fy;
    }

    const aoTex = buildAO(T, elevW, proj);
    // 高度纹理：供着色器做太阳方向的自遮挡步进；单位米（未夸张），由 uExag 换算
    const heightTex = new T.DataTexture(elevW, GW, GH, T.RedFormat, T.FloatType);
    heightTex.minFilter = heightTex.magFilter = T.NearestFilter;
    heightTex.needsUpdate = true;

    return { GW, GH, N, elev, elevW, landW, tierA, cnA, cnW, depth, aoTex, heightTex, sampleHeight };
  }

  TA.data = { load };
})(window.TA = window.TA || {});
