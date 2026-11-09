/* TerraAsia · UI 绑定层
 * 依赖：全部业务模块（只调用其公开方法，不直接改内部状态）
 * 职责：DOM 事件 → 模块调用；模块状态 → DOM 展示。渲染细节一律不在这里做。
 */
(function (TA) {
  'use strict';

  const $ = (s) => document.querySelector(s);

  function create(ctx) {
    const { T, proj, data, terrain, tour, labels, overlays, flow, viewmode, globe, camera, controls, renderer, state, hooks } = ctx;
    const rayc = new T.Raycaster(), ndc = new T.Vector2();
    const TIER_NAME = TA.static.TIER_NAME;

    /* ---------- 拾取：平面模式迭代求交，地球模式求球面交点 ---------- */
    function pickLonLat(ev) {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
      rayc.setFromCamera(ndc, camera);
      const o = rayc.ray.origin, d = rayc.ray.direction;

      if (viewmode.mix > 0.5) {
        const R = globe.R;
        const b = o.dot(d), c = o.lengthSq() - R * R;
        const disc = b * b - c;
        if (disc < 0) return null;
        const t = -b - Math.sqrt(disc);
        if (t < 0) return null;
        const p = o.clone().addScaledVector(d, t);
        const lat = Math.asin(Math.max(-1, Math.min(1, p.y / p.length()))) * 180 / Math.PI;
        const lon = Math.atan2(p.x, p.z) * 180 / Math.PI;
        return [lon, lat];
      }

      if (Math.abs(d.y) < 1e-6) return null;
      // 与地形求交：把"命中点的高度"当作平面重新求 t，迭代收敛
      let t = (0 - o.y) / d.y;
      for (let k = 0; k < 14; k++) {
        const x = o.x + d.x * t, z = o.z + d.z * t;
        const h = data.sampleHeight(x, z) * state.exag * proj.V0;
        const t2 = (h - o.y) / d.y;
        if (!isFinite(t2)) break;
        if (Math.abs(t2 - t) < 0.02) { t = t2; break; }
        t = t2;
      }
      const x = o.x + d.x * t, z = o.z + d.z * t;
      const gx = (x / proj.WX + 0.5) * (proj.GW - 1), gy = (z / proj.WZ + 0.5) * (proj.GH - 1);
      if (gx < 0 || gx > proj.GW - 1 || gy < 0 || gy > proj.GH - 1) return null;
      return proj.gridToLonLat(gx, gy);
    }

    let down = null;
    function bindPicking() {
      renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
      renderer.domElement.addEventListener('pointerup', (e) => {
        if (!down) return;
        const dx = e.clientX - down[0], dy = e.clientY - down[1];
        down = null;
        if (dx * dx + dy * dy > 36) return;          // 拖拽旋转不算点击
        const ll = pickLonLat(e);
        if (!ll) return;
        const pv = overlays.findProvince(ll[0], ll[1]);
        const info = overlays.selectProvince(pv);
        showProvince(info);
        if (pv) overlays.showCityLayer(pv.name, state.exag, $('#ckCityDiv').checked);
      });
    }

    /* ---------- 省份信息卡 ---------- */
    function showProvince(info) {
      if (!info) { $('#provCard').style.display = 'none'; return; }
      $('#provCard').style.display = '';
      $('#provName').textContent = info.name;
      const cap = TA.static.PROV_CAPITAL[info.name] || '';
      $('#provMeta').innerHTML = '平均海拔 <b>' + info.avg.toLocaleString() + ' m</b><br>主体属 <b>'
        + (TIER_NAME[info.tier] || '—') + '</b>' + (cap ? '<br>省会/首府 <b>' + cap + '</b>' : '');
    }

    /* ---------- 步骤文案 ---------- */
    function showStep(i, s) {
      $('#stepName').textContent = (i + 1) + ' / ' + tour.STEPS.length + ' · ' + s.name;
      $('#stepText').textContent = s.text;
    }

    /* ---------- 图层开关 ---------- */
    function bindLayers() {
      const layer = (id, obj, group) => {
        $(id).onchange = (e) => {
          if (obj) obj.visible = e.target.checked;
          if (group) labels.setGroup(group, e.target.checked);
        };
      };
      layer('#ckDash', overlays.dashGroup);
      layer('#ckRail', flow.railGroup, 'rl');
      layer('#ckRoad', flow.roadGroup, 'rd');
      layer('#ckTierLine', flow.tierGroup, 'x');
      $('#ckProv').onchange = (e) => { overlays.provGroup.visible = e.target.checked; };

      const group = (id, g) => { $(id).onchange = (e) => labels.setGroup(g, e.target.checked); };
      group('#ckM', 'm'); group('#ckT', 't'); group('#ckR', 'r');
      group('#ckCity', 'c'); group('#ckNb', 'n'); group('#ckNbF', 'nf'); group('#ckScenic', 's');

      $('#ckCityDiv').onchange = (e) => {
        const rec = overlays.cityCurrent;
        if (rec && overlays.cityCache[rec]) overlays.cityCache[rec].group.visible = e.target.checked;
      };
    }

    /* ---------- 光照控件 ---------- */
    function bindLight() {
      const az = $('#sunAz'), el = $('#sunEl');
      const apply = () => {
        $('#sunAzV').textContent = az.value + '°';
        $('#sunElV').textContent = el.value + '°';
        terrain.setSun(parseFloat(az.value), parseFloat(el.value));
      };
      az.oninput = apply; el.oninput = apply;
      $('#ckShadow').onchange = (e) => terrain.setShadow(e.target.checked);
      $('#ckAO').onchange = (e) => terrain.setAO(e.target.checked);
      apply();
    }

    /* ---------- 视图模式 ---------- */
    function setModeButtons(mode) {
      $('#btnFlat').classList.toggle('on', mode === 'flat');
      $('#btnGlobe').classList.toggle('on', mode === 'globe');
      $('#viewHint').textContent = mode === 'globe'
        ? '地球模式：左键拖动转动星球，滚轮缩放。亚洲地形以真实起伏贴在球面上，其余部分为暗面球体与经纬网。'
        : '平面模式适合读阶梯与省界；地球模式可自由转动整颗星球，看中国在亚洲、亚洲在世界的位置。';
      $('#compass').style.display = mode === 'globe' ? 'none' : '';
    }
    function bindMode() {
      $('#btnFlat').onclick = () => { viewmode.setMode('flat'); setModeButtons('flat'); };
      $('#btnGlobe').onclick = () => { viewmode.setMode('globe'); setModeButtons('globe'); };
    }

    function bindTour() {
      $('#btnPrev').onclick = () => {
        if (viewmode.isGlobe) { viewmode.setMode('flat'); setModeButtons('flat'); }
        tour.gotoStep(tour.stepIdx - 1);
      };
      $('#btnNext').onclick = () => {
        if (viewmode.isGlobe) { viewmode.setMode('flat'); setModeButtons('flat'); }
        tour.gotoStep(tour.stepIdx + 1);
      };
      $('#btnAuto').onclick = (e) => {
        if (viewmode.isGlobe) { viewmode.setMode('flat'); setModeButtons('flat'); }
        tour.setAuto(!tour.autoOn);
        e.target.classList.toggle('on', tour.autoOn);
      };
      $('#btnReplay').onclick = () => {
        if (viewmode.isGlobe) { viewmode.setMode('flat'); setModeButtons('flat'); }
        hooks.replay();
      };
      $('#btnViewAsia').onclick = () => {
        if (viewmode.isGlobe) { viewmode.setMode('flat'); setModeButtons('flat'); }
        tour.flyCam(tour.VIEW_ASIA);
      };
      $('#btnViewCN').onclick = () => {
        if (viewmode.isGlobe) { viewmode.setMode('flat'); setModeButtons('flat'); }
        tour.flyCam(tour.VIEW_CN);
      };
      $('#btnViewStep').onclick = () => {
        if (viewmode.isGlobe) { viewmode.setMode('flat'); setModeButtons('flat'); }
        tour.gotoStep(tour.stepIdx);
      };
      $('#btnClearProv').onclick = () => {
        overlays.selectProvince(null);
        showProvince(null);
        overlays.showCityLayer(null, state.exag, false);
      };
    }

    function bindMisc() {
      $('#exag').oninput = (e) => { $('#exagV').textContent = e.target.value + '×'; };
      $('#exag').onchange = (e) => hooks.setExag(parseFloat(e.target.value));
      $('#ckAutoRot').onchange = (e) => { controls.autoRotate = e.target.checked; };
      $('#sideToggle').onclick = () => {
        const hidden = $('#side').classList.toggle('hidden');
        document.body.classList.toggle('nopanel', hidden);
      };
    }

    function init() {
      bindLayers(); bindLight(); bindMode(); bindTour(); bindMisc(); bindPicking();
      controls.autoRotate = false;
      controls.autoRotateSpeed = 0.6;
      setModeButtons('flat');
    }

    /** 视图模式会移动光源以便照亮当前半球，滑块要跟着同步 */
    function syncSun(az, el) {
      $('#sunAz').value = az;
      $('#sunEl').value = el;
      $('#sunAzV').textContent = az + '°';
      $('#sunElV').textContent = el + '°';
    }

    return { init, showStep, showProvince, pickLonLat, syncSun };
  }

  TA.ui = { create };
})(window.TA = window.TA || {});
