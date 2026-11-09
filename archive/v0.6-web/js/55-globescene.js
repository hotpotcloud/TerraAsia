/* TerraAsia · 地球场景元素
 * 依赖：core, globe
 * 职责：地球模式下补齐"星球感"——暗色球体（带晨昏线）、经纬网、大气辉光、星空。
 *       地形patch 只覆盖亚洲，其余球面用这层暗球补上，视觉上才是一颗完整星球。
 */
(function (TA) {
  'use strict';

  function create(ctx) {
    const { T, globe, scene, terrain } = ctx;
    const R = globe.R;
    const sunU = terrain.uniforms.uSun;

    const root = new T.Group();
    root.visible = false;
    scene.add(root);

    /* ---------- 基础球体：夜面 → 晨昏 → 昼面 ---------- */
    const baseMat = new T.ShaderMaterial({
      uniforms: { uSun: sunU },
      vertexShader: `
        varying vec3 vN; varying vec3 vW;
        void main(){
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        precision highp float;
        uniform vec3 uSun;
        varying vec3 vN; varying vec3 vW;
        void main(){
          float d = dot(normalize(vN), uSun);
          vec3 night = vec3(0.0055, 0.0110, 0.0200);
          vec3 dusk  = vec3(0.0210, 0.0410, 0.0760);
          vec3 day   = vec3(0.0290, 0.0600, 0.1010);
          vec3 c = mix(night, dusk, smoothstep(-0.45, 0.02, d));
          c = mix(c, day, smoothstep(-0.02, 0.40, d));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const base = new T.Mesh(new T.SphereGeometry(R * 0.998, 96, 64), baseMat);
    root.add(base);

    /* ---------- 经纬网 ---------- */
    {
      const pts = [];
      const rr = R * 1.0008;
      for (let lat = -75; lat <= 75; lat += 15) {
        const la = lat * Math.PI / 180;
        for (let lon = -180; lon < 180; lon += 3) {
          const a = lon * Math.PI / 180, b = (lon + 3) * Math.PI / 180;
          pts.push(
            rr * Math.cos(la) * Math.sin(a), rr * Math.sin(la), rr * Math.cos(la) * Math.cos(a),
            rr * Math.cos(la) * Math.sin(b), rr * Math.sin(la), rr * Math.cos(la) * Math.cos(b)
          );
        }
      }
      for (let lon = -180; lon < 180; lon += 15) {
        const a = lon * Math.PI / 180;
        for (let lat = -90; lat < 90; lat += 3) {
          const la = lat * Math.PI / 180, lb = (lat + 3) * Math.PI / 180;
          pts.push(
            rr * Math.cos(la) * Math.sin(a), rr * Math.sin(la), rr * Math.cos(la) * Math.cos(a),
            rr * Math.cos(lb) * Math.sin(a), rr * Math.sin(lb), rr * Math.cos(lb) * Math.cos(a)
          );
        }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(new Float32Array(pts), 3));
      const m = new T.LineBasicMaterial({ color: 0x1f4468, transparent: true, opacity: 0.55 });
      root.add(new T.LineSegments(g, m));
    }

    /* ---------- 大气辉光：背面球 + 菲涅尔 ---------- */
    const atmoMat = new T.ShaderMaterial({
      uniforms: { uSun: sunU },
      vertexShader: `
        varying vec3 vN; varying vec3 vW;
        void main(){
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        precision highp float;
        uniform vec3 uSun;
        varying vec3 vN; varying vec3 vW;
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          float rim = pow(1.0 - abs(dot(normalize(vN), V)), 2.2);
          float lit = 0.42 + 0.58 * max(dot(normalize(vN), uSun), 0.0);
          gl_FragColor = vec4(vec3(0.22, 0.52, 0.92) * rim * lit, rim * 0.85);
        }`,
      side: T.BackSide,
      transparent: true,
      blending: T.AdditiveBlending,
      depthWrite: false,
    });
    root.add(new T.Mesh(new T.SphereGeometry(R * 1.045, 64, 48), atmoMat));

    /* ---------- 星空 ---------- */
    let stars = null;
    {
      const COUNT = 1600, rr = 900;
      const pos = new Float32Array(COUNT * 3);
      const col = new Float32Array(COUNT * 3);
      for (let i = 0; i < COUNT; i++) {
        // 球面均匀采样
        const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
        const r = Math.sqrt(1 - u * u);
        pos[i * 3] = rr * r * Math.cos(th);
        pos[i * 3 + 1] = rr * u;
        pos[i * 3 + 2] = rr * r * Math.sin(th);
        const t = 0.55 + Math.random() * 0.45;
        col[i * 3] = t; col[i * 3 + 1] = t; col[i * 3 + 2] = t * (0.92 + Math.random() * 0.08);
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      g.setAttribute('color', new T.BufferAttribute(col, 3));
      const m = new T.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85 });
      stars = new T.Points(g, m);
      stars.frustumCulled = false;
      root.add(stars);
    }

    /** mix>0 时显示地球层；星空缓慢自转（只转星空，经纬网必须与地形对齐） */
    function update(mix, t) {
      root.visible = mix > 0.001;
      if (stars) stars.rotation.y = t * 0.006;
    }

    return { root, update, base, atmosphere: atmoMat };
  }

  TA.globeScene = { create };
})(window.TA = window.TA || {});
