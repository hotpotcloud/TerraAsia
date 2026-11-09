/* TerraAsia · 视图模式（平面沙盘 ↔ 地球）
 * 依赖：globe, globescene, tour, labels, overlays
 * 职责：维护 uGlobe 过渡系数、相机约束、雾与各图层的球面重定位。
 *       所有几何共用同一个系数，所以过渡是一次统一形变，不会有"地形飞了线还在原地"的错位。
 */
(function (TA) {
  'use strict';

  function create(ctx) {
    const { T, globe, globeScene, terrain, camera, controls, tour, labels, overlays, scene, state } = ctx;
    const R = globe.R;
    const fogFlat = scene.fog;
    let mode = 'flat';
    let mix = 0, target = 0;
    /* 过渡按时间推进而不是按帧插值：帧率一低（无头渲染、弱显卡）指数插值会走不完，
       地形会卡在"半平面半球面"的中间态。 */
    let tween = { from: 0, to: 0, t0: 0, dur: 1600 };
    let flatLimits = { min: controls.minDistance, max: controls.maxDistance, polar: controls.maxPolarAngle };
    let flatSun = { az: 315, el: 40 };

    /* 平面模式的布光是制图传统（西北高位），但球面模式下"西北"只是世界坐标里的一个方向：
       亚洲这一面正好背光，整块地形会黑掉。切到地球时把光源移到能照亮亚洲的位置，
       切回来再还原 —— 太阳滑块的数值会同步，用户看到的始终是同一盏灯。 */
    const GLOBE_SUN = { az: 79, el: 34 };

    /** 地球机位：俯视亚洲上空（经度 100°E、北纬 35° 的法线方向） */
    function globeCam() {
      const lo = 100 * Math.PI / 180, la = 30 * Math.PI / 180, d = R * 3.0;
      return {
        pos: [Math.cos(la) * Math.sin(lo) * d, Math.sin(la) * d + R * 0.15, Math.cos(la) * Math.cos(lo) * d],
        tgt: [0, 0, 0],
      };
    }

    function setMode(next, silent) {
      if (next === mode) return;
      mode = next;
      state.mode = next;
      target = next === 'globe' ? 1 : 0;
      tween = { from: mix, to: target, t0: performance.now(), dur: 1600 };

      if (next === 'globe') {
        flatLimits = { min: controls.minDistance, max: controls.maxDistance, polar: controls.maxPolarAngle };
        flatSun = terrain.getSun();
        controls.minDistance = R * 1.16;
        controls.maxDistance = R * 8;
        controls.maxPolarAngle = Math.PI * 0.92;
        scene.fog = null;
        terrain.setSun(GLOBE_SUN.az, GLOBE_SUN.el);
        if (ctx.onSunChange) ctx.onSunChange(GLOBE_SUN.az, GLOBE_SUN.el);
        if (!silent) tour.flyCam(globeCam(), 1500);
      } else {
        controls.minDistance = flatLimits.min;
        controls.maxDistance = flatLimits.max;
        controls.maxPolarAngle = flatLimits.polar;
        scene.fog = fogFlat;
        terrain.setSun(flatSun.az, flatSun.el);
        if (ctx.onSunChange) ctx.onSunChange(flatSun.az, flatSun.el);
        if (!silent) tour.gotoStep(tour.stepIdx, false);
      }
    }

    /** 每帧推进形变与球面元素 */
    function update(dt, t) {
      if (mix !== target) {
        const u = Math.min(1, (performance.now() - tween.t0) / tween.dur);
        const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;   // ease-in-out
        mix = tween.from + (tween.to - tween.from) * e;
        if (u >= 1) mix = target;
        globe.U.value = mix;
        overlays.applyGlobeMarkers(mix);
        labels.applyGlobe(mix);
      }
      globeScene.update(mix, t);
    }

    return {
      setMode, update, globeCam,
      get mode() { return mode; },
      get mix() { return mix; },
      get isGlobe() { return mode === 'globe'; },
    };
  }

  TA.viewmode = { create };
})(window.TA = window.TA || {});
