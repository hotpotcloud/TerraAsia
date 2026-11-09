import type * as THREE from 'three';
import type { Projection } from './projection';

/**
 * 平面沙盘 ↔ 地球的映射。
 *
 * 设计：所有几何仍然在「平面世界坐标」里构建，顶点着色器用同一份函数把坐标卷到球面。
 * 这样国界、河流、交通、标注都不需要各写一套球面版本，只靠一个 uGlobe 系数过渡。
 * 经纬度可以从平面 x,z 反解 —— 平面 z 就是墨卡托纵坐标的线性裁剪，常数全部已知。
 *
 * GLSL 与 CPU 两份实现必须严格一致，否则标注会和地形错位。改动时两边一起改 ——
 * 这是本工程唯一允许的「重复代码」。
 */

export const EARTH_R = 110;

/** 全局共享的过渡系数：0 = 平面，1 = 球面。所有材质引用同一个对象。 */
export const GLOBE_U = { value: 0 };

/** 一份平面网格的墨卡托映射常数（亚洲窗口与全球底图各有一套） */
export interface Mapping {
  WX: number;
  WZ: number;
  lon0: number;
  lon1: number;
  P: number;
  tyOff: number;
  cy0: number;
  ch: number;
  R: number;
}

/** 从投影推出映射常数 */
export function mappingOf(proj: Projection, R: number = EARTH_R): Mapping {
  return {
    WX: proj.WX,
    WZ: proj.WZ,
    lon0: proj.lon0,
    lon1: proj.lon1,
    P: proj.MAP.P,
    tyOff: proj.MAP.tyOff,
    cy0: proj.MAP.cy0,
    ch: proj.MAP.ch,
    R,
  };
}

/** 生成该映射对应的 GLSL 片段（含 globePos / sphereFrame / morphToGlobe 与 uGlobe 声明） */
export function globeGLSL(m: Mapping): string {
  return `
const float WX_ = ${m.WX.toFixed(5)};
const float WZ_ = ${m.WZ.toFixed(5)};
const float LON0_ = ${m.lon0.toFixed(4)};
const float LON1_ = ${m.lon1.toFixed(4)};
const float GP_ = ${m.P.toFixed(1)};
const float GTY_ = ${m.tyOff.toFixed(1)};
const float GCY_ = ${m.cy0.toFixed(4)};
const float GCH_ = ${m.ch.toFixed(4)};
const float GR_ = ${m.R.toFixed(3)};
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
   用来把平面法线与太阳方向「平行移动」到球面，避免光照错位 */
void sphereFrame(vec3 p, out vec3 e, out vec3 r, out vec3 s){
  float lo = radians(lonOfX(p.x)), la = radians(latOfZ(p.z));
  e = vec3(cos(lo), 0.0, -sin(lo));
  r = vec3(cos(la) * sin(lo), sin(la), cos(la) * cos(lo));
  s = vec3(sin(la) * sin(lo), -cos(la), sin(la) * cos(lo));
}
vec3 morphToGlobe(vec3 p){ return mix(p, globePos(p), uGlobe); }
`;
}



/**
 * 给 three 内置材质注入球面形变：改写 begin_vertex 即可覆盖线 / 点 / 基础材质。
 * cacheKey 必须区分映射（亚洲窗口 vs 全球底图），否则两份着色器会互相覆盖。
 */
export function injectGlobe<T extends THREE.Material>(mat: T, glsl: string, key = 'globe'): T {
  mat.onBeforeCompile = ((shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uGlobe = GLOBE_U;
    shader.vertexShader = glsl + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  transformed = morphToGlobe(transformed);',
    );
  }) as THREE.Material['onBeforeCompile'];
  mat.customProgramCacheKey = () => key;
  return mat;
}

const RAD = Math.PI / 180;

/** 平面世界坐标 → 球面坐标（CPU 版，供标注、拾取、实例矩阵用） */
export function toGlobe(
  m: Mapping,
  x: number,
  y: number,
  z: number,
  mix: number,
  out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): { x: number; y: number; z: number } {
  const gv = z / m.WZ + 0.5;
  const yn = (gv * m.ch + m.cy0 + m.tyOff) / m.P;
  const la = Math.atan(Math.sinh(Math.PI * (1 - 2 * yn)));
  const lo = ((x / m.WX + 0.5) * (m.lon1 - m.lon0) + m.lon0) * RAD;
  const r = m.R + y;
  const gx = r * Math.cos(la) * Math.sin(lo);
  const gy = r * Math.sin(la);
  const gz = r * Math.cos(la) * Math.cos(lo);
  out.x = x + (gx - x) * mix;
  out.y = y + (gy - y) * mix;
  out.z = z + (gz - z) * mix;
  return out;
}

/** 经纬度 → 单位球面方向（拾取、机位换算用） */
export function lonLatToDir(lon: number, lat: number): [number, number, number] {
  const lo = lon * RAD;
  const la = lat * RAD;
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
}
