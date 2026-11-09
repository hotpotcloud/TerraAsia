/* TerraAsia · 球面映射（平面沙盘 ↔ 地球）
 * 依赖：core
 * 设计：所有几何仍然在"平面世界坐标"里构建，顶点着色器用同一份函数把坐标卷到球面。
 *       这样国界、河流、交通、标注都不需要各写一套球面版本，只靠一个 uGlobe 系数过渡。
 *       经纬度可以从平面 x,z 反解 —— 平面 z 就是墨卡托纵坐标的线性裁剪，常数全部已知。
 */
(function (TA) {
  'use strict';

  const RAD = Math.PI / 180;

  function create(T, proj) {
    const R = 110;                              // 地球半径（世界单位）
    const U = { value: 0 };                     // 全局共享的过渡系数 0=平面 1=球面
    const M = proj.MAP;

    /* GLSL 与 JS 两份实现必须严格一致，否则标注会和地形错位。
       改动时两边一起改 —— 这是本工程唯一允许的"重复代码"。 */
    const glsl = `
const float WX_ = ${proj.WX.toFixed(5)};
const float WZ_ = ${proj.WZ.toFixed(5)};
const float LON0_ = ${proj.lon0.toFixed(4)};
const float LON1_ = ${proj.lon1.toFixed(4)};
const float GP_ = ${M.P.toFixed(1)};
const float GTY_ = ${M.tyOff.toFixed(1)};
const float GCY_ = ${M.cy0.toFixed(4)};
const float GCH_ = ${M.ch.toFixed(4)};
const float GR_ = ${R.toFixed(3)};
uniform float uGlobe;

float lonOfX(float x){ return LON0_ + (x / WX_ + 0.5) * (LON1_ - LON0_); }
float latOfZ(float z){
  float yn = ((z / WZ_ + 0.5) * GCH_ + GCY_ + GTY_) / GP_;
  return degrees(atan(sinh(3.141592653589793 * (1.0 - 2.0 * yn))));
}
vec3 globePos(vec3 p){
  float lo = radians(lonOfX(p.x)), la = radians(latOfZ(p.z));
  float r = GR_ + p.y;                        // 地形起伏叠加在半径上
  return vec3(r * cos(la) * sin(lo), r * sin(la), r * cos(la) * cos(lo));
}
/* 平面坐标的 (东, 天, 南) 在球面上对应的基向量：
   用来把平面法线与太阳方向"平行移动"到球面，避免光照错位 */
void sphereFrame(vec3 p, out vec3 e, out vec3 r, out vec3 s){
  float lo = radians(lonOfX(p.x)), la = radians(latOfZ(p.z));
  e = vec3(cos(lo), 0.0, -sin(lo));
  r = vec3(cos(la) * sin(lo), sin(la), cos(la) * cos(lo));
  s = vec3(sin(la) * sin(lo), -cos(la), sin(la) * cos(lo));
}
vec3 morphToGlobe(vec3 p){ return mix(p, globePos(p), uGlobe); }
`;

    /** 给 three 内置材质注入球面形变：改写 begin_vertex 即可覆盖线/点/基础材质 */
    function inject(mat) {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uGlobe = U;
        sh.vertexShader = glsl + sh.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n  transformed = morphToGlobe(transformed);'
        );
      };
      mat.customProgramCacheKey = () => 'globe';
      return mat;
    }

    /** 平面世界坐标 → 球面坐标（CPU 版，供 CSS 标注与拾取） */
    function toGlobe(x, y, z, mix, out) {
      const gv = z / proj.WZ + 0.5;
      const yn = (gv * M.ch + M.cy0 + M.tyOff) / M.P;
      const la = Math.atan(Math.sinh(Math.PI * (1 - 2 * yn)));
      const lo = ((x / proj.WX + 0.5) * (proj.lon1 - proj.lon0) + proj.lon0) * RAD;
      const r = R + y;
      const gx = r * Math.cos(la) * Math.sin(lo);
      const gy = r * Math.sin(la);
      const gz = r * Math.cos(la) * Math.cos(lo);
      out = out || {};
      out.x = x + (gx - x) * mix;
      out.y = y + (gy - y) * mix;
      out.z = z + (gz - z) * mix;
      return out;
    }

    return { R, U, glsl, inject, toGlobe };
  }

  TA.globe = { create };
})(window.TA = window.TA || {});
