import type { ProvinceRec, Ring } from './types';

export interface IndexedProvince extends ProvinceRec {
  bbox: [number, number, number, number];
}

/** 射线法判断点是否在环内（环是 [lon,lat] 闭合或非闭合都行） */
export function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** 给每个省算外接矩形：点选时先做矩形剔除，再逐环判断，33 个省也不用每次全遍历 */
export function indexProvinces(list: ProvinceRec[]): IndexedProvince[] {
  return list.map((pv) => {
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const ring of pv.rings) {
      for (const pt of ring) {
        if (pt[0] < minLon) minLon = pt[0];
        if (pt[0] > maxLon) maxLon = pt[0];
        if (pt[1] < minLat) minLat = pt[1];
        if (pt[1] > maxLat) maxLat = pt[1];
      }
    }
    return { ...pv, bbox: [minLon, minLat, maxLon, maxLat] };
  });
}

export function findProvince(
  list: IndexedProvince[],
  lon: number,
  lat: number,
): IndexedProvince | null {
  for (const o of list) {
    const b = o.bbox;
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    for (const ring of o.rings) if (inRing(lon, lat, ring)) return o;
  }
  return null;
}

/** 平面模式下的射线 / 地形迭代求交：把「命中点的高度」当作平面重新求 t，迭代收敛 */
export function raycastFlat(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  sampleHeight: (x: number, z: number) => number,
  scale: number,
): [number, number, number] | null {
  if (Math.abs(dir.y) < 1e-6) return null;
  let t = -origin.y / dir.y;
  for (let k = 0; k < 14; k++) {
    const x = origin.x + dir.x * t;
    const z = origin.z + dir.z * t;
    const h = sampleHeight(x, z) * scale;
    const t2 = (h - origin.y) / dir.y;
    if (!Number.isFinite(t2)) break;
    if (Math.abs(t2 - t) < 0.02) {
      t = t2;
      break;
    }
    t = t2;
  }
  return [origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t];
}
