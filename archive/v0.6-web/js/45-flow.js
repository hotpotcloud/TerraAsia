/* TerraAsia · 线状动态要素：河流 / 铁路 / 公路 / 阶梯分界
 * 依赖：core, data, globe, static, overlays(drapeOff)
 * 说明：这些线用管道几何贴地，随垂直夸张重建；流动感由着色器按 uv 推进，不占用 CPU。
 */
(function (TA) {
  'use strict';

  const { drapeOff } = TA.overlays;

  function create(ctx) {
    const { T, proj, data, globe, scene, DATA: D } = ctx;
    const rawColor = (hex) => TA.core.rawColor(T, hex);

    /* 贴地样条：先平滑 XZ，再密集重采样逐点吸附地形高度。
       直接用稀疏控制点建样条会"穿山"，线条会断成虚线 —— 必须重采样。 */
    function drapeCurve(pts, ex, offset) {
      const off = drapeOff(offset, ex);
      const base = new T.CatmullRomCurve3(pts, false, 'catmullrom', 0.15);
      const len = base.getLength();
      const n = Math.max(32, Math.min(900, Math.round(len / 0.20)));
      const out = [];
      for (let i = 0; i <= n; i++) {
        const p = base.getPoint(i / n);
        out.push(new T.Vector3(p.x, data.sampleHeight(p.x, p.z) * ex * proj.V0 + off, p.z));
      }
      return new T.CatmullRomCurve3(out, false, 'centripetal');
    }

    /** 管道材质：片元里按 uv.x 做饭流动画；顶点里卷到球面 */
    function flowMaterial(hex, opts) {
      return new T.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: rawColor(hex) },
          uGlow: { value: 0 },
          uSpeed: { value: opts.speed },
          uGlobe: globe.U,
        },
        vertexShader: `
          ${globe.glsl}
          varying vec2 vUv;
          void main(){
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(morphToGlobe(position), 1.0);
          }`,
        fragmentShader: opts.fragment,
        side: T.DoubleSide,
      });
    }

    /* ---------- 河流 ---------- */
    const riverGroup = new T.Group();
    scene.add(riverGroup);
    const riverMats = [];
    const RIVER_FRAG = `
      precision highp float;
      uniform float uTime; uniform vec3 uColor; uniform float uGlow; uniform float uSpeed;
      varying vec2 vUv;
      void main(){
        // 高频强虚化会让线体本身消失、只剩亮点 = 视觉上变成断线；降低频率与白点强度
        float dash = smoothstep(0.62, 0.98, fract(vUv.x * 18.0 - uTime * uSpeed));
        vec3 col = uColor * (0.80 + 0.10 * sin(uTime * 0.7)) + vec3(0.75, 0.88, 0.95) * dash * 0.22;
        col *= (0.78 + uGlow * 1.6);
        gl_FragColor = vec4(col, 1.0);
      }`;

    function buildRivers(ex) {
      while (riverGroup.children.length) riverGroup.remove(riverGroup.children[0]);
      riverMats.length = 0;
      for (const [name, lines] of Object.entries(D.rivers)) {
        const main = name === '长江' || name === '黄河' || name === '黑龙江';
        const hex = name === '黄河' ? 0xf3b62e : (name === '长江' ? 0x38bdf8 : 0x3d9fd1);
        const mat = flowMaterial(hex, { speed: main ? 0.5 : 0.32, fragment: RIVER_FRAG });
        riverMats.push(mat);
        for (const line of lines) {
          const pts = line.map((pt) => {
            const w = proj.lonLatToWorld(pt[0], pt[1]);
            return new T.Vector3(w[0], 0, w[1]);
          });
          if (pts.length < 2) continue;
          const curve = drapeCurve(pts, ex, 0.26);
          const rad = name === '黄河' ? 0.105 : (main ? 0.088 : 0.060);
          riverGroup.add(new T.Mesh(new T.TubeGeometry(curve, 240, rad, 6, false), mat));
        }
      }
    }

    /* ---------- 交通：铁路 / 公路分开成两组，可分别开关与标注 ---------- */
    const TRANS_FRAG = (speed, base, amp) => `
      precision highp float; uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
      void main(){
        // 连续线体 + 缓慢行波高光：高频 fract 在近景会碎成"串珠"
        float d = 0.5 + 0.5 * sin(uTime * ${speed.toFixed(2)} - vUv.x * 11.0);
        vec3 col = uColor * (${base.toFixed(2)} + ${amp.toFixed(2)} * d) + vec3(0.04, 0.06, 0.08);
        gl_FragColor = vec4(col, 1.0);
      }`;

    const railMat = flowMaterial(0xdfe8f2, { speed: 1.5, fragment: TRANS_FRAG(1.5, 0.62, 0.52) });
    const roadMat = flowMaterial(0xff6b8a, { speed: 1.0, fragment: TRANS_FRAG(1.0, 0.46, 0.40) });
    const railGroup = new T.Group(); railGroup.visible = false; scene.add(railGroup);
    const roadGroup = new T.Group(); roadGroup.visible = false; scene.add(roadGroup);

    function buildTransport(ex) {
      while (railGroup.children.length) railGroup.remove(railGroup.children[0]);
      while (roadGroup.children.length) roadGroup.remove(roadGroup.children[0]);
      for (const line of Object.values(TA.static.RAIL)) {
        const pts = line.map((pt) => {
          const w = proj.lonLatToWorld(pt[0], pt[1]);
          return new T.Vector3(w[0], 0, w[1]);
        });
        railGroup.add(new T.Mesh(new T.TubeGeometry(drapeCurve(pts, ex, 0.26), 240, 0.085, 6, false), railMat));
      }
      for (const line of Object.values(TA.static.ROAD)) {
        const pts = line.map((pt) => {
          const w = proj.lonLatToWorld(pt[0], pt[1]);
          return new T.Vector3(w[0], 0, w[1]);
        });
        roadGroup.add(new T.Mesh(new T.TubeGeometry(drapeCurve(pts, ex, 0.24), 240, 0.052, 6, false), roadMat));
      }
    }

    /* ---------- 阶梯分界线（脉冲光带，默认关） ---------- */
    const tierGroup = new T.Group();
    tierGroup.visible = false;
    scene.add(tierGroup);
    const tierMats = [];
    const TIER_FRAG = `
      precision highp float; uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
      void main(){
        // 低频行波：保持线条连续可读，只让光晕缓慢流动
        float pulse = 0.74 + 0.26 * sin(uTime * 1.8 - vUv.x * 5.0);
        gl_FragColor = vec4(uColor * pulse * 1.42, 1.0);
      }`;

    function buildTierLines(ex) {
      while (tierGroup.children.length) tierGroup.remove(tierGroup.children[0]);
      tierMats.length = 0;
      for (const pts0 of Object.values(D.tierlines)) {
        const mat = flowMaterial(0xff8f5a, { speed: 1.0, fragment: TIER_FRAG });
        tierMats.push(mat);
        const pts = pts0.map((pt) => {
          const w = proj.lonLatToWorld(pt[0], pt[1]);
          return new T.Vector3(w[0], 0, w[1]);
        });
        tierGroup.add(new T.Mesh(new T.TubeGeometry(drapeCurve(pts, ex, 0.30), 260, 0.115, 6, false), mat));
      }
    }

    function rebuild(ex) {
      buildRivers(ex);
      buildTierLines(ex);
      buildTransport(ex);
    }

    let glow = 0;
    function setGlow(v) {
      glow = v;
      for (const m of riverMats) m.uniforms.uGlow.value = v;
    }

    function tick(t) {
      for (const m of riverMats) { m.uniforms.uTime.value = t; m.uniforms.uGlow.value = glow; }
      for (const m of tierMats) m.uniforms.uTime.value = t;
      railMat.uniforms.uTime.value = t;
      roadMat.uniforms.uTime.value = t;
    }

    return { riverGroup, railGroup, roadGroup, tierGroup, railMat, roadMat, riverMats, tierMats, rebuild, drapeCurve, tick, setGlow };
  }

  TA.flow = { create };
})(window.TA = window.TA || {});
