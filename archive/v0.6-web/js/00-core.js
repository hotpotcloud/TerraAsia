/* TerraAsia · 核心：命名空间、尺度标定、投影换算、通用数学
 * 依赖：无
 * 说明：全工程的尺度只在这里定义一次。垂直夸张、线宽、相机 LOD 阈值都以此为基准。
 */
(function (TA) {
  'use strict';

  /* v4(中国版)标定：124 世界单位 / 63.1° = 1.965 单位每经度。
     亚洲版沿用同一比例，于是 WX≈305；换了范围也不用重标夸张比与线宽。 */
  const U_PER_DEG = 1.965;
  const V0 = 0.00012;               // 1 米海拔在 1× 夸张下的世界高度

  /**
   * 构建平面投影换算器。
   * 内部数据是墨卡托裁剪，所以经纬度 ↔ 网格 ↔ 世界坐标三者可互转。
   * @param {object} meta build/data.json 里的 meta
   */
  function createProjection(meta) {
    const GW = meta.gw, GH = meta.gh, MAP = meta.map;
    const WX = (meta.lon1 - meta.lon0) * U_PER_DEG;
    const WZ = WX * GH / GW;

    const lonLatToGrid = (lon, lat) => {
      const x = ((lon + 180) / 360 * MAP.P - MAP.txOff - MAP.cx0) / MAP.cw * (GW - 1);
      const yn = (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2;
      const y = (yn * MAP.P - MAP.tyOff - MAP.cy0) / MAP.ch * (GH - 1);
      return [x, y];
    };
    const gridToWorld = (gx, gy) => [
      (gx / (GW - 1) - 0.5) * WX,
      (gy / (GH - 1) - 0.5) * WZ,
    ];
    const gridToLonLat = (gx, gy) => {
      const lon = meta.lon0 + gx / (GW - 1) * (meta.lon1 - meta.lon0);
      const pyAbs = gy / (GH - 1) * MAP.ch + MAP.cy0 + MAP.tyOff;
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * pyAbs / MAP.P))) * 180 / Math.PI;
      return [lon, lat];
    };
    const lonLatToWorld = (lon, lat) => {
      const g = lonLatToGrid(lon, lat);
      return gridToWorld(g[0], g[1]);
    };

    return {
      GW, GH, MAP, WX, WZ, V0,
      K: WX / 124,                  // 相对 v4 的世界尺度倍数：相机距离/雾/远裁面按此缩放
      lon0: meta.lon0, lon1: meta.lon1,
      lat0: meta.lat0, lat1: meta.lat1,
      lonLatToGrid, gridToWorld, gridToLonLat, lonLatToWorld,
    };
  }

  /** 三维坐标 → 世界坐标（经纬度 + 海拔米 → Vector3 用） */
  function lonLatToVec3(proj, lon, lat, height) {
    const w = proj.lonLatToWorld(lon, lat);
    return [w[0], height || 0, w[1]];
  }

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function smoothstep(a, b, x) {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  /**
   * 自定义 ShaderMaterial 直接写 framebuffer，不经过 three 的 sRGB 输出转换。
   * 用 new Color(hex) 会先转线性色空间，渲染色明显变暗偏橙；这里取原始分量。
   */
  function rawColor(T, hex) {
    const c = new T.Color();
    c.r = ((hex >> 16) & 255) / 255;
    c.g = ((hex >> 8) & 255) / 255;
    c.b = (hex & 255) / 255;
    return c;
  }

  /* ============ Three.js 加载（多 CDN 回退） ============ */
  async function importThree() {
    const bases = [
      'https://cdn.jsdelivr.net/npm/three@0.160.0',
      'https://unpkg.com/three@0.160.0',
      'https://esm.sh/three@0.160.0',
    ];
    for (const b of bases) {
      try {
        const THREE = await import(b + '/build/three.module.js');
        const fix = (s) => s
          .replaceAll("from 'three'", "from '" + b + "/build/three.module.js'")
          .replaceAll('from "three"', 'from "' + b + '/build/three.module.js"');
        const mk = async (p) => {
          const src = await (await fetch(b + p)).text();
          const url = URL.createObjectURL(new Blob([fix(src)], { type: 'text/javascript' }));
          return await import(url);
        };
        const oc = await mk('/examples/jsm/controls/OrbitControls.js');
        const c2 = await mk('/examples/jsm/renderers/CSS2DRenderer.js');
        return {
          THREE, OrbitControls: oc.OrbitControls,
          CSS2DRenderer: c2.CSS2DRenderer, CSS2DObject: c2.CSS2DObject,
        };
      } catch (e) {
        console.warn('Three.js 源不可用:', b, e && e.message);
      }
    }
    throw new Error('Three.js 全部源加载失败（需联网）');
  }

  TA.core = {
    U_PER_DEG, V0, createProjection, lonLatToVec3,
    lerp, clamp, smoothstep, rawColor, importThree,
  };
})(window.TA = window.TA || {});
