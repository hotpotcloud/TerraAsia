/* TerraAsia · 标注层（CSS2D）
 * 依赖：core, data, static, globe
 * 职责：注册标注、按相机距离分级显隐、按地形高度贴地、球面模式下重定位。
 * 说明：CSS2DRenderer 每帧按 object.visible 重写 display，所以显隐必须走 visible，
 *       改 style.display 会被下一帧覆盖。
 */
(function (TA) {
  'use strict';

  // 图层默认开关：m 山脉 t 地形区 r 河流水体 c 城市 n 国家名 nf 境外山河 s 山峰景区
  // x=阶梯分界标注(默认关) rl/rd=线路名(默认关，随图层开)
  const DEFAULT_VIS = { m: true, t: true, r: true, c: true, n: true, nf: true, s: true, x: false, rl: false, rd: false };

  function create(ctx) {
    const { proj, data, globe, scene, CSS2DObject } = ctx;
    const items = [];
    const vis = Object.assign({}, DEFAULT_VIS);
    let lodT = 0, revealed = false;

    function add(name, lon, lat, type) {
      const el = document.createElement('div');
      el.className = 'lb lb-' + type;
      el.textContent = name;
      const obj = new CSS2DObject(el);
      const w = proj.lonLatToWorld(lon, lat);
      obj.position.set(w[0], 0, w[1]);
      scene.add(obj);
      const S = TA.static;
      items.push({
        obj, el, x: w[0], z: w[1], y: 0,
        group: S.GROUP_OF[type] || 'm',
        lod: S.LOD_OF[type] || 0,
        isWater: type === 'w' || type === 'i',
        shown: true,
      });
    }

    function addAll() {
      const S = TA.static;
      for (const [n, lon, lat, t] of S.LABELS) add(n, lon, lat, t);
      for (const [n, lon, lat, t] of S.CITIES) add(n, lon, lat, t);
      for (const [n, lon, lat] of S.NEIGHBORS) add(n, lon, lat, 'n');
      for (const [n, lon, lat] of S.ASIA_F) add(n, lon, lat, 'nf');
      for (const [n, lon, lat, t] of S.SCENIC) add(n, lon, lat, t);
      // 线路名取弧长比例点：铁路 45% / 公路 62%，避免同走廊两条线名字撞在一起
      for (const [nm, line] of Object.entries(S.RAIL)) {
        const q = S.midOf(line, 0.45);
        add(nm, q[0], q[1], 'rl');
      }
      for (const [nm, line] of Object.entries(S.ROAD)) {
        const q = S.midOf(line, 0.62);
        add(nm, q[0], q[1], 'rd');
      }
    }

    /** 按当前 LOD 与图层开关刷新显隐 */
    function refresh() {
      for (const it of items) {
        const want = vis[it.group] && lodT >= it.lod && revealed;
        if (want !== it.shown) { it.shown = want; it.obj.visible = want; }
      }
    }

    /** 贴地：水面/岛礁标签几乎贴平面，其余按标注级别抬高一点避免被山体吞掉 */
    function updateY(ex) {
      for (const it of items) {
        const off = it.isWater ? 0.25 : (it.lod > 0 ? 0.30 : 0.50);
        it.y = data.sampleHeight(it.x, it.z) * ex * proj.V0 + off;
        if (globe.U.value <= 0.0001) it.obj.position.set(it.x, it.y, it.z);
      }
    }

    /** 球面过渡：把每个标注按同一份映射搬到球面上 */
    let _o = {};
    function applyGlobe(mix) {
      if (mix <= 0.0001) return;                 // 平面模式下 updateY 已经写好位置
      for (const it of items) {
        globe.toGlobe(it.x, it.y, it.z, mix, _o);
        it.obj.position.set(_o.x, _o.y, _o.z);
      }
    }

    function setOpacity(v) {
      revealed = v > 0.5;
      for (const it of items) it.el.style.opacity = v;
      refresh();
    }

    function setLod(v) {
      if (v === lodT) return false;
      lodT = v;
      refresh();
      return true;
    }

    function setGroup(g, on) {
      vis[g] = on;
      refresh();
    }

    return {
      addAll, refresh, updateY, applyGlobe, setOpacity, setLod, setGroup,
      get lod() { return lodT; },
      get revealed() { return revealed; },
      vis,
    };
  }

  TA.labels = { create };
})(window.TA = window.TA || {});
