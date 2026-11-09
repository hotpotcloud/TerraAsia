import * as THREE from 'three';
import type { FieldPack } from '../../data/terrainLoader';
import type { Ring } from '../../data/types';

/** 抬升量随垂直夸张缩放：夸张越大，线要抬得越高才不穿山 */
export function drapeOff(base: number, ex: number): number {
  return base * Math.max(0.6, Math.min(2.2, ex / 8.5));
}

/**
 * 折线贴地：按采样点插值地形高度再抬高一点点，否则高原段的线会整条埋进山体里看不见。
 * 输出的是 LineSegments 用的成对顶点（每两个点一段）。
 */
export function drapedSegments(
  rings: Ring[],
  pack: FieldPack,
  exag: number,
  offset: number,
): Float32Array {
  let count = 0;
  for (const ring of rings) count += Math.max(0, ring.length - 1) * 2;
  const arr = new Float32Array(count * 3);
  const off = drapeOff(offset, exag);
  const { proj } = pack;
  let p = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      for (let k = 0; k < 2; k++) {
        const [lon, lat] = ring[i + k];
        const w = proj.lonLatToWorld(lon, lat);
        arr[p++] = w[0];
        arr[p++] = pack.sampleHeight(w[0], w[1]) * exag * proj.V0 + off;
        arr[p++] = w[1];
      }
    }
  }
  return arr;
}

/** 单条折线贴地（不拆段），用于十段线这种需要连续线型（虚线）的场合 */
export function drapedLine(
  line: Ring,
  pack: FieldPack,
  exag: number,
  offset: number,
): THREE.Vector3[] {
  const off = drapeOff(offset, exag);
  const { proj } = pack;
  return line.map(([lon, lat]) => {
    const w = proj.lonLatToWorld(lon, lat);
    return new THREE.Vector3(w[0], pack.sampleHeight(w[0], w[1]) * exag * proj.V0 + off, w[1]);
  });
}

/**
 * 贴地样条：先平滑 XZ，再密集重采样逐点吸附地形高度。
 * 直接用稀疏控制点建样条会「穿山」，线条会断成虚线 —— 必须重采样。
 */
export function drapeCurve(
  pts: THREE.Vector3[],
  pack: FieldPack,
  exag: number,
  offset: number,
): THREE.CatmullRomCurve3 {
  const off = drapeOff(offset, exag);
  const base = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.15);
  const len = base.getLength();
  const n = Math.max(32, Math.min(900, Math.round(len / 0.2)));
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const p = base.getPoint(i / n);
    out.push(
      new THREE.Vector3(
        p.x,
        pack.sampleHeight(p.x, p.z) * exag * pack.proj.V0 + off,
        p.z,
      ),
    );
  }
  return new THREE.CatmullRomCurve3(out, false, 'centripetal');
}
