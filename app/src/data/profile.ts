import type { FieldPack } from './terrainLoader';
import type { ProfilePoint } from '../state/store';

/**
 * 线路高程剖面（`docs/10` R03b）。
 *
 * 三条硬约束，都写在这一层，UI 不许另算：
 * 1. **用真实高程**：取 `pack.elev`（原始米）而不是 `elevW`（为几何平滑过的场），
 *    也不乘任何垂直夸张——剖面上的 5000 m 必须真的是 5000 m。
 * 2. **不虚构高程**：采样点落在数据覆盖范围外一律记为断点（`ok = false`），
 *    宁可断开一段，也不拿边界值外推。
 * 3. **距离按球面算**：剖面横轴是地面里程，不是屏幕长度，与镜头距离无关。
 */

/** 采样的一个点。`ok=false` 表示该处没有数据（断点） */
export interface ProfileSample {
  /** 距起点的累计地面距离（米） */
  dist: number;
  /** 海拔（米）；断点时为 NaN */
  elev: number;
  lon: number;
  lat: number;
  ok: boolean;
}

export interface ProfileResult {
  samples: ProfileSample[];
  /** 线路总长（米） */
  totalM: number;
  /** 累计爬升 / 下降（米），只统计连续段的差值 */
  gain: number;
  loss: number;
  maxE: number;
  minE: number;
  /** 断点数量 */
  gaps: number;
  a: ProfilePoint;
  b: ProfilePoint;
}

let PACK: FieldPack | null = null;

/** 场景装载完数据后调用；剖面采样不经过 React，避免每帧传 pack */
export function setProfilePack(pack: FieldPack | null): void {
  PACK = pack;
}

const R_EARTH = 6371008.8;

/** 两点球面距离（米） */
export function haversineM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 双线性取原始高程；越界返回 NaN（= 没有数据） */
function elevAt(lon: number, lat: number): number {
  if (!PACK) return NaN;
  const { GW, GH, proj, elev } = PACK;
  const [gx, gy] = proj.lonLatToGrid(lon, lat);
  if (!(gx >= 0 && gx <= GW - 1 && gy >= 0 && gy <= GH - 1)) return NaN;
  const i0 = Math.min(GW - 2, Math.floor(gx));
  const j0 = Math.min(GH - 2, Math.floor(gy));
  const fx = gx - i0;
  const fy = gy - j0;
  const e = (i: number, j: number) => elev[j * GW + i];
  return (
    e(i0, j0) * (1 - fx) * (1 - fy) +
    e(i0 + 1, j0) * fx * (1 - fy) +
    e(i0, j0 + 1) * (1 - fx) * fy +
    e(i0 + 1, j0 + 1) * fx * fy
  );
}

/**
 * 沿大圆线采样。`n` 是采样点数（最小 2）。
 * 沿线取经纬度线性插值即可：线路尺度在几百公里内，与大圆弧的偏差远小于数据网格
 * （~11 km）本身的分辨率，不值得为此引入向量插值。
 */
export function buildProfile(a: ProfilePoint, b: ProfilePoint, n = 240): ProfileResult {
  const count = Math.max(2, Math.round(n));
  const samples: ProfileSample[] = [];
  let dist = 0;
  let prev: ProfileSample | null = null;
  let gain = 0;
  let loss = 0;
  let maxE = -Infinity;
  let minE = Infinity;
  let gaps = 0;

  for (let k = 0; k < count; k++) {
    const t = k / (count - 1);
    const lon = a.lon + (b.lon - a.lon) * t;
    const lat = a.lat + (b.lat - a.lat) * t;
    if (k > 0) dist += haversineM(samples[k - 1].lon, samples[k - 1].lat, lon, lat);

    const e = elevAt(lon, lat);
    const ok = Number.isFinite(e);
    if (!ok) gaps++;
    else {
      maxE = Math.max(maxE, e);
      minE = Math.min(minE, e);
      /* 爬升/下降只在连续段内累计：跨断点求差就是虚构 */
      if (prev && prev.ok) {
        const d = e - prev.elev;
        if (d > 0) gain += d;
        else loss -= d;
      }
    }
    const s: ProfileSample = { dist, elev: e, lon, lat, ok };
    samples.push(s);
    prev = s;
  }

  return {
    samples,
    totalM: dist,
    gain,
    loss,
    maxE: Number.isFinite(maxE) ? maxE : 0,
    minE: Number.isFinite(minE) ? minE : 0,
    gaps,
    a,
    b,
  };
}
