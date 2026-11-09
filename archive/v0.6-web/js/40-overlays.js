/* TerraAsia · 叠加图层（线状要素）
 * 依赖：core, data, globe
 * 职责：海岸/国界、省级行政区、地级市界、十段线、南海岛礁标记。
 * 约定：所有线都"贴地"——按采样点插值地形高度再抬高一点点，
 *       否则高原段的线会整条埋进山体里看不见。
 */
(function (TA) {
  'use strict';

  const PROV_BASE = 0x7f9bb0, PROV_SEL = 0xffa64d, CITY_COLOR = 0xc2e4fa;

  /** 抬升量随垂直夸张缩放：夸张越大，线要抬得越高才不穿山 */
  function drapeOff(base, ex) {
    return base * Math.max(0.6, Math.min(2.2, ex / 8.5));
  }

  function create(ctx) {
    const { T, proj, data, globe, scene, terrain, DATA: D } = ctx;
    const group = new T.Group();
    scene.add(group);

    /* ---------- 贴地折线通用构件 ---------- */
    function buildDrapedLine(rings, color, opacity) {
      const segs = [];
      for (const ring of rings) for (let i = 0; i < ring.length - 1; i++) segs.push(ring[i], ring[i + 1]);
      const pos = new Float32Array(segs.length * 3);
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      const mat = globe.inject(new T.LineBasicMaterial({ color, transparent: true, opacity }));
      const line = new T.LineSegments(g, mat);
      line.frustumCulled = false;
      line.userData.update = (ex, off) => {
        for (let s = 0; s < segs.length; s++) {
          const w = proj.lonLatToWorld(segs[s][0], segs[s][1]);
          pos[s * 3] = w[0];
          pos[s * 3 + 2] = w[1];
          pos[s * 3 + 1] = data.sampleHeight(w[0], w[1]) * ex * proj.V0 + drapeOff(off, ex);
        }
        g.attributes.position.needsUpdate = true;
        g.computeBoundingSphere();
      };
      group.add(line);
      return line;
    }

    /* 国界 + 海岸线必须贴地：亚洲版里"中国=彩色 / 境外=冷灰"的色差边界正好落在这条线上，
       若像 v4 那样画在 y=0.2 的平面上，高原段会整条埋进山体。 */
    const coast = buildDrapedLine(D.coast, 0xcfe0ec, 0.95);

    /* ---------- 省级行政区：每省独立对象，可点选 ---------- */
    const provGroup = new T.Group();
    provGroup.visible = false;
    group.add(provGroup);
    const provObjs = [];
    for (const pv of D.provinces) {
      const segs = [];
      for (const ring of pv.rings) for (let i = 0; i < ring.length - 1; i++) segs.push(ring[i], ring[i + 1]);
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(new Float32Array(segs.length * 3), 3));
      const mat = globe.inject(new T.LineBasicMaterial({ color: PROV_BASE, transparent: true, opacity: 0.45 }));
      const line = new T.LineSegments(g, mat);
      line.frustumCulled = false;
      provGroup.add(line);
      let minLon = 1e9, maxLon = -1e9, minLat = 1e9, maxLat = -1e9;
      for (const ring of pv.rings) for (const pt of ring) {
        if (pt[0] < minLon) minLon = pt[0];
        if (pt[0] > maxLon) maxLon = pt[0];
        if (pt[1] < minLat) minLat = pt[1];
        if (pt[1] > maxLat) maxLat = pt[1];
      }
      provObjs.push({ name: pv.name, rings: pv.rings, avg: pv.avg, tier: pv.tier,
        line, mat, segs, bbox: [minLon, minLat, maxLon, maxLat] });
    }

    function updateProvLines(ex) {
      for (const o of provObjs) {
        const arr = o.line.geometry.attributes.position.array, segs = o.segs;
        for (let s = 0; s < segs.length; s++) {
          const w = proj.lonLatToWorld(segs[s][0], segs[s][1]);
          arr[s * 3] = w[0];
          arr[s * 3 + 2] = w[1];
          arr[s * 3 + 1] = data.sampleHeight(w[0], w[1]) * ex * proj.V0 + drapeOff(0.30, ex);
        }
        o.line.geometry.attributes.position.needsUpdate = true;
        o.line.geometry.computeBoundingSphere();
      }
    }

    /* ---------- 点选：经纬度落点 → 省份 ---------- */
    function inRing(lon, lat, ring) {
      let ins = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) ins = !ins;
      }
      return ins;
    }
    function findProvince(lon, lat) {
      for (const o of provObjs) {
        const b = o.bbox;
        if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
        for (const ring of o.rings) if (inRing(lon, lat, ring)) return o;
      }
      return null;
    }

    /** 把选中省份填充进地形材质的遮罩纹理（自动贴合起伏） */
    function drawSelMask(pv) {
      const c = terrain.sel.ctx, GW = proj.GW, GH = proj.GH, MAP = proj.MAP;
      c.clearRect(0, 0, GW, GH);
      if (pv) {
        c.fillStyle = '#fff';
        for (const ring of pv.rings) {
          c.beginPath();
          ring.forEach((pt, i) => {
            const g = proj.lonLatToGrid(pt[0], pt[1]);
            i ? c.lineTo(g[0], g[1]) : c.moveTo(g[0], g[1]);
          });
          c.closePath(); c.fill();
        }
      }
      terrain.sel.texture.needsUpdate = true;
    }

    /* ---------- 选中状态 ---------- */
    let selected = null, selTarget = 0;

    /** 选中/取消选中一个省份；返回展示信息，视觉细节留在这里，UI 只管渲染 */
    function selectProvince(o) {
      selected = o || null;
      for (const q of provObjs) {
        q.mat.color.setHex(PROV_BASE);
        q.mat.opacity = 0.45;
      }
      if (o) {
        o.mat.color.setHex(PROV_SEL);
        o.mat.opacity = 1.0;
        provGroup.visible = true;
      }
      drawSelMask(selected);
      selTarget = o ? 1 : 0;
      return o ? { name: o.name, avg: o.avg, tier: o.tier, rings: o.rings } : null;
    }

    /** 每帧淡入淡出选中高亮 */
    function tickSelection() {
      const u = terrain.uniforms.uSelAmt;
      u.value += (selTarget - u.value) * 0.12;
      if (Math.abs(selTarget - u.value) < 0.002) u.value = selTarget;
    }

    /* ---------- 地级市界：点选省份后按需构建 ---------- */
    const cityRoot = new T.Group();
    scene.add(cityRoot);
    const cityCache = {};
    let cityCur = null;

    function buildCityLayer(provName) {
      const rows = (D.cities || {})[provName];
      if (!rows || !rows.length) return null;
      const mat = globe.inject(new T.LineBasicMaterial({ color: CITY_COLOR, transparent: true, opacity: 0.78 }));
      const g = new T.Group();
      g.visible = false;
      cityRoot.add(g);
      const segs = [];
      for (const row of rows) {
        const seg = [];
        for (const ring of (row[3] || [])) for (let i = 0; i < ring.length - 1; i++) seg.push(ring[i], ring[i + 1]);
        if (!seg.length) continue;
        segs.push(seg);
        const bg = new T.BufferGeometry();
        bg.setAttribute('position', new T.BufferAttribute(new Float32Array(seg.length * 3), 3));
        const ln = new T.LineSegments(bg, mat);
        ln.frustumCulled = false;
        g.add(ln);
      }
      const labels = [];
      for (const row of rows) {
        const el = document.createElement('div');
        el.className = 'lb lb-cc';
        el.textContent = row[0];
        const obj = new ctx.CSS2DObject(el);
        const w = proj.lonLatToWorld(row[1], row[2]);
        obj.position.set(w[0], 0, w[1]);
        obj.visible = false;
        cityRoot.add(obj);
        labels.push({ obj, x: w[0], z: w[1] });
      }
      const rec = { group: g, mat, segs, labels };
      cityCache[provName] = rec;
      return rec;
    }

    function updateCityY(rec, ex) {
      for (let k = 0; k < rec.segs.length; k++) {
        const seg = rec.segs[k];
        const mesh = rec.group.children[k];
        const arr = mesh.geometry.attributes.position.array;
        for (let i = 0; i < seg.length; i++) {
          const w = proj.lonLatToWorld(seg[i][0], seg[i][1]);
          arr[i * 3] = w[0];
          arr[i * 3 + 2] = w[1];
          arr[i * 3 + 1] = data.sampleHeight(w[0], w[1]) * ex * proj.V0 + drapeOff(0.36, ex);
        }
        mesh.geometry.attributes.position.needsUpdate = true;
      }
      for (const L of rec.labels) L.obj.position.y = data.sampleHeight(L.x, L.z) * ex * proj.V0 + drapeOff(0.46, ex);
    }

    function showCityLayer(provName, ex, visible) {
      if (cityCur && cityCache[cityCur]) {
        cityCache[cityCur].group.visible = false;
        for (const L of cityCache[cityCur].labels) L.obj.visible = false;
      }
      cityCur = provName || null;
      if (!cityCur) return null;
      const rec = cityCache[cityCur] || buildCityLayer(cityCur);
      if (!rec) { cityCur = null; return null; }
      updateCityY(rec, ex);
      if (visible !== undefined) rec.group.visible = visible;
      return rec;
    }

    /* ---------- 十段线 ---------- */
    const dashGroup = new T.Group();
    group.add(dashGroup);
    for (const seg of D.dash) {
      const pts = seg.map((pt) => {
        const w = proj.lonLatToWorld(pt[0], pt[1]);
        return new T.Vector3(w[0], 0.07, w[1]);
      });
      const g = new T.BufferGeometry().setFromPoints(pts);
      const m = globe.inject(new T.LineDashedMaterial({ color: 0xffd35c, dashSize: 0.85, gapSize: 0.5, transparent: true, opacity: 1.0 }));
      const l = new T.Line(g, m);
      l.computeLineDistances();
      dashGroup.add(l);
    }

    /* ---------- 南海岛礁标记 ---------- */
    const markerPos = D.markers.map((pt) => {
      const w = proj.lonLatToWorld(pt[0], pt[1]);
      return { x: w[0], z: w[1], y: 0.12 };
    });
    const markers = new T.InstancedMesh(
      new T.SphereGeometry(0.14, 8, 8),
      new T.MeshBasicMaterial({ color: 0xd9b34a }),
      markerPos.length
    );
    markers.frustumCulled = false;
    group.add(markers);
    const _mtx = new T.Matrix4();
    /** 球面过渡时更新岛礁实例位置（InstancedMesh 的矩阵在顶点形变之后生效，不能靠注入） */
    function applyGlobeMarkers(mix) {
      if (mix <= 0.0001) {
        markerPos.forEach((p, i) => { _mtx.setPosition(p.x, p.y, p.z); markers.setMatrixAt(i, _mtx); });
      } else {
        const o = {};
        markerPos.forEach((p, i) => {
          globe.toGlobe(p.x, p.y, p.z, mix, o);
          _mtx.setPosition(o.x, o.y, o.z);
          markers.setMatrixAt(i, _mtx);
        });
      }
      markers.instanceMatrix.needsUpdate = true;
    }
    applyGlobeMarkers(0);

    return {
      group, coast, provGroup, provObjs, cityRoot, dashGroup, markers,
      findProvince, drawSelMask, selectProvince, tickSelection, cityCache,
      get selected() { return selected; },
      get cityCurrent() { return cityCur; },
      cityLayerVisible() { return cityCur && cityCache[cityCur] ? cityCache[cityCur].group.visible : false; },
      showCityLayer, updateCityY, applyGlobeMarkers,
      updateProvLines,
      cityLabels() { return cityCur && cityCache[cityCur] ? cityCache[cityCur].labels : []; },
      rebuild(ex) {
        coast.userData.update(ex, 0.20);
        updateProvLines(ex);
        for (const k in cityCache) updateCityY(cityCache[k], ex);
      },
    };
  }

  TA.overlays = { create, drapeOff };
})(window.TA = window.TA || {});
