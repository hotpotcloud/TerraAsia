import type { Meta } from './types';

/**
 * 全工程尺度只在这里定义一次。垂直夸张、线宽、相机 LOD 阈值都以此为基准。
 *
 * v4（中国版）标定：124 世界单位 / 63.1° = 1.965 单位每经度。
 * 亚洲版与世界版沿用同一比例，于是换了范围也不用重标夸张比与线宽。
 */
export const U_PER_DEG = 1.965;

/** 1 米海拔在 1× 夸张下的世界高度 */
export const V0 = 0.00012;

/** 默认垂直夸张比。AO 预计算、材质 uniform 初值、store 初始值三处共用，
 *  避免 AO 的遮蔽强度与几何夸张脱节（曾硬编码 8.5，改默认后 AO 系统性偏强）。 */
export const DEFAULT_EXAG = 5;

export interface Projection {
  GW: number;
  GH: number;
  MAP: Meta['map'];
  WX: number;
  WZ: number;
  V0: number;
  /** 相对 v4 的世界尺度倍数：相机距离 / 雾 / 远裁面按此缩放 */
  K: number;
  lon0: number;
  lon1: number;
  lat0: number;
  lat1: number;
  lonLatToGrid(lon: number, lat: number): [number, number];
  gridToWorld(gx: number, gy: number): [number, number];
  gridToLonLat(gx: number, gy: number): [number, number];
  lonLatToWorld(lon: number, lat: number): [number, number];
  /** 世界坐标 → 经纬度（平面模式拾取用） */
  worldToLonLat(x: number, z: number): [number, number];
  /** 世界坐标是否落在图幅内 */
  insideWorld(x: number, z: number): boolean;
}

/**
 * 构建平面投影换算器。
 * 内部数据是墨卡托裁剪，所以经纬度 ↔ 网格 ↔ 世界坐标三者可互转。
 */
export function createProjection(meta: Meta): Projection {
  const GW = meta.gw;
  const GH = meta.gh;
  const MAP = meta.map;
  const WX = (meta.lon1 - meta.lon0) * U_PER_DEG;
  const WZ = (WX * GH) / GW;

  const lonLatToGrid = (lon: number, lat: number): [number, number] => {
    const x = ((((lon + 180) / 360) * MAP.P - MAP.txOff - MAP.cx0) / MAP.cw) * (GW - 1);
    const yn = (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2;
    const y = ((yn * MAP.P - MAP.tyOff - MAP.cy0) / MAP.ch) * (GH - 1);
    return [x, y];
  };

  const gridToWorld = (gx: number, gy: number): [number, number] => [
    (gx / (GW - 1) - 0.5) * WX,
    (gy / (GH - 1) - 0.5) * WZ,
  ];

  const gridToLonLat = (gx: number, gy: number): [number, number] => {
    const lon = meta.lon0 + (gx / (GW - 1)) * (meta.lon1 - meta.lon0);
    const pyAbs = (gy / (GH - 1)) * MAP.ch + MAP.cy0 + MAP.tyOff;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * pyAbs) / MAP.P))) * 180) / Math.PI;
    return [lon, lat];
  };

  const lonLatToWorld = (lon: number, lat: number): [number, number] => {
    const g = lonLatToGrid(lon, lat);
    return gridToWorld(g[0], g[1]);
  };

  const worldToLonLat = (x: number, z: number): [number, number] => {
    const gx = (x / WX + 0.5) * (GW - 1);
    const gy = (z / WZ + 0.5) * (GH - 1);
    return gridToLonLat(gx, gy);
  };

  const insideWorld = (x: number, z: number): boolean =>
    Math.abs(x) <= WX / 2 && Math.abs(z) <= WZ / 2;

  return {
    GW,
    GH,
    MAP,
    WX,
    WZ,
    V0,
    K: WX / 124,
    lon0: meta.lon0,
    lon1: meta.lon1,
    lat0: meta.lat0,
    lat1: meta.lat1,
    lonLatToGrid,
    gridToWorld,
    gridToLonLat,
    lonLatToWorld,
    worldToLonLat,
    insideWorld,
  };
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
