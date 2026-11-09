/* TerraAsia · 装配与主循环
 * 依赖：全部模块
 * 职责：创建渲染环境、按依赖顺序装配模块、驱动每帧调度。
 *       这里只做"接线"，任何具体渲染/几何/交互逻辑都应该在对应模块里。
 */
(function (TA) {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const V0 = TA.core.V0;

  async function start(DATA) {
    /* ---------- Three.js ---------- */
    let T, OrbitControls, CSS2DRenderer, CSS2DObject;
    try {
      ({ THREE: T, OrbitControls, CSS2DRenderer, CSS2DObject } = await TA.core.importThree());
    } catch (e) {
      $('#loadTxt').innerHTML = '<span class="err">' + e.message + '</span>';
      return;
    }

    /* ---------- 渲染环境 ---------- */
    const renderer = new T.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    $('#app').appendChild(renderer.domElement);

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(innerWidth, innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    $('#labels').appendChild(labelRenderer.domElement);

    const scene = new T.Scene();
    scene.background = new T.Color(0x060d16);

    const proj = TA.core.createProjection(DATA.meta);
    scene.fog = new T.Fog(0x060d16, 150 * proj.K, 420 * proj.K);

    const camera = new T.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 1600);
    camera.position.set(50 * proj.K, 80 * proj.K, 95 * proj.K);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 2 * proj.K);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxDistance = 300 * proj.K;
    controls.minDistance = 12;
    controls.maxPolarAngle = Math.PI * 0.495;

    /* ---------- 数据与模块 ---------- */
    const state = { exag: 8.5, mode: 'flat' };
    const data = await TA.data.load(T, DATA, proj);
    const globe = TA.globe.create(T, proj);
    const terrain = TA.terrain.create({ T, proj, data, globe, scene });
    const overlays = TA.overlays.create({ T, proj, data, globe, scene, terrain, CSS2DObject, DATA });
    const flow = TA.flow.create({ T, proj, data, globe, scene, DATA });
    const labels = TA.labels.create({ T, proj, data, globe, scene, CSS2DObject });
    const globeScene = TA.globeScene.create({ T, globe, scene, terrain });

    let ui = null, viewmode = null;
    const tour = TA.tour.create({
      T, proj, data, camera, controls, terrain, flow, state,
      onStep: (i, s) => { if (ui) ui.showStep(i, s); },
    });
    viewmode = TA.viewmode.create({
      T, globe, globeScene, terrain, camera, controls, tour, labels, overlays, scene, state,
      onSunChange: (az, el) => { if (ui) ui.syncSun(az, el); },
    });

    labels.addAll();

    /** 垂直夸张联动：地形、贴地线、标注、动态线一起重建 */
    function applyExag(ex) {
      state.exag = ex;
      terrain.setExag(ex);
      overlays.rebuild(ex);
      labels.updateY(ex);
      flow.rebuild(ex);
    }

    /* ---------- 开场 ---------- */
    let revealT0 = null;
    function replay() {
      revealT0 = performance.now();
      terrain.uniforms.uReveal.value = 0;
      flow.riverGroup.visible = false;
      flow.tierGroup.visible = false;
      labels.setOpacity(0);
      tour.gotoStep(0, true);
    }

    ui = TA.ui.create({
      T, proj, data, terrain, tour, labels, overlays, flow, viewmode, globe, camera, controls, renderer, state,
      hooks: { replay, setExag: applyExag },
    });
    ui.init();

    applyExag(8.5);
    tour.gotoStep(0, true);
    revealT0 = performance.now();
    flow.riverGroup.visible = false;
    flow.tierGroup.visible = false;
    labels.setOpacity(0);

    /* ---------- 主循环 ---------- */
    const clock = new T.Clock();

    function animate() {
      requestAnimationFrame(animate);
      const dt = Math.min(0.05, clock.getDelta());
      const t = clock.elapsedTime;

      terrain.uniforms.uTime.value = t;
      flow.tick(t);
      tour.update();
      viewmode.update(dt, t);
      overlays.tickSelection();

      // 开场：自东向西逐级升起
      if (revealT0 !== null) {
        const k = Math.min(1, (performance.now() - revealT0) / 5200);
        terrain.uniforms.uReveal.value = k;
        if (k >= 1) {
          revealT0 = null;
          flow.riverGroup.visible = true;
          flow.tierGroup.visible = $('#ckTierLine').checked;
          labels.setOpacity(1);
        }
      }

      // 标注分级：相机越近显示越细（大区 → 省会 → 重点城市 → 景区）
      const camD = camera.position.distanceTo(controls.target);
      const lt = camD > 110 ? 0 : (camD > 58 ? 1 : (camD > 34 ? 2 : 3));
      labels.setLod(lt);

      // 地级市界只在拉近后出现：全国视角下几十条市界会变成"乱线"
      const cityRec = overlays.cityCurrent;
      const wantCity = !!cityRec && $('#ckCityDiv').checked && camD < 92 && viewmode.mix < 0.5;
      if (cityRec && overlays.cityCache[cityRec]) {
        const g = overlays.cityCache[cityRec].group;
        if (g.visible !== wantCity) g.visible = wantCity;
      }
      const cityOn = wantCity && labels.revealed && labels.lod >= 1;
      for (const L of overlays.cityLabels()) {
        if (L.obj.visible !== cityOn) L.obj.visible = cityOn;
      }

      const az = T.MathUtils.radToDeg(controls.getAzimuthalAngle());
      const compass = $('#compassN');
      if (compass) compass.style.transform = 'rotate(' + (-az) + 'deg)';

      controls.update();
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    }

    animate();

    addEventListener('resize', () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
      labelRenderer.setSize(innerWidth, innerHeight);
    });

    /* ---------- 控制台调试接口（标定机位用） ---------- */
    window.__info = () => ({
      lod: labels.lod,
      camD: +camera.position.distanceTo(controls.target).toFixed(1),
      mode: viewmode.mode,
      mix: +viewmode.mix.toFixed(3),
      step: tour.stepIdx,
    });
    window.__setCam = (lon, lat, dist, az2, elev) => {
      const c = tour.camAt(lon, lat, dist, az2, elev);
      camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
      controls.target.set(c.tgt[0], c.tgt[1], c.tgt[2]);
      tour.cancelCam();
    };
    window.__flyTo = (lon, lat, dist = 40, az2 = 0.6) => {
      const w = proj.lonLatToWorld(lon, lat);
      controls.target.set(w[0], data.sampleHeight(w[0], w[1]) * state.exag * V0, w[1]);
      camera.position.set(w[0] + Math.sin(az2) * dist, dist * 0.75, w[1] + Math.cos(az2) * dist);
      tour.cancelCam();
    };
    window.__layer = (name, on) => {
      const map = {
        tier: flow.tierGroup, river: flow.riverGroup, rail: flow.railGroup, road: flow.roadGroup,
        prov: overlays.provGroup, dash: overlays.dashGroup, coast: overlays.coast, city: overlays.cityRoot,
        globe: globeScene.root,
      };
      const o = map[name];
      if (!o) return 'unknown:' + name;
      o.visible = on !== false;
      return name + ' -> ' + o.visible + ' children=' + (o.children ? o.children.length : '-');
    };
    window.__view = (m) => { viewmode.setMode(m); return viewmode.mode; };
    // 光照标定：__shadow(false) / __sun(315, 25) / __ao(false)
    // 排查用：暴露内部对象
    window.__dbg = { scene, camera, controls, renderer, proj, data, globe, terrain, overlays, flow, labels, viewmode, globeScene };
    window.__shadow = (on) => { terrain.setShadow(on); return on; };
    window.__ao = (on) => { terrain.setAO(on); return on; };
    window.__sun = (az2, el) => {
      terrain.setSun(az2, el);
      $('#sunAz').value = az2; $('#sunEl').value = el;
      $('#sunAzV').textContent = az2 + '°'; $('#sunElV').textContent = el + '°';
      return [az2, el];
    };
    window.__geo3dReady = true;
    $('#loading').style.display = 'none';
  }

  TA.main = { start };
})(window.TA = window.TA || {});

TA.main.start(DATA).catch((e) => {
  console.error(e);
  const lt = document.getElementById('loadTxt');
  if (lt) lt.innerHTML = '<span class="err">初始化失败：' + (e && e.message ? e.message : e) + '</span>';
});
