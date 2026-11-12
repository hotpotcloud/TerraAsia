import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { globeGLSL, injectGlobe, type Mapping } from '../data/globe';
import type { FieldPack } from '../data/terrainLoader';
import { buildProfile } from '../data/profile';
import { useAppStore } from '../state/store';

/**
 * 地图上的线路：贴着地形走的一条折线。
 *
 * 为什么不用 `THREE.Line` 一口气画完：剖面会遇到数据断点，`Line` 会把断点两端
 * 连成一条直线（等于虚构了一段不存在的地形）。这里改用 `LineSegments`，只为相邻
 * 且两端都有数据的采样点建一段，断点处自然断开。
 *
 * 球面模式复用 `injectGlobe` 改写顶点着色器，与地形同步卷到球面上，
 * 不需要在这里另写一套球面坐标。
 */
const SAMPLES = 240;

/**
 * 抬高一点，避免被地形吃掉。必须用 `pack.sampleHeight`（与地形几何同一份平滑场）
 * 而不是剖面上的原始 `elev`：两者在崎岖处能差上百米，按原始高程画的线会时隐时现。
 * 0.12 世界单位 ≈ 200 m，足够盖过残差又不至于明显浮空。
 */
const LIFT = 0.12;

/** 线路带宽（世界单位）。1 px 的 `Line` 在远景几乎看不见，改用贴地三角形带；
 *  0.9 约等于 1.5 km，大陆尺度上是一眼可辨的细带，放大到省级也不会糊住地形。 */
const WIDTH = 0.9;

export function ProfileLine({ pack, mapping }: { pack: FieldPack; mapping: Mapping }) {
  const profile = useAppStore((s) => s.profile);
  const exag = useAppStore((s) => s.exag);

  const built = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos: number[] = [];
    const idx: number[] = [];

    if (profile && profile.b) {
      const res = buildProfile(profile.a, profile.b, SAMPLES);
      const { proj } = pack;
      const up = exag * proj.V0;

      /* 把采样点变成世界坐标（贴地 + 抬高），同时记下方向，用来向两侧撑开带宽 */
      const line = res.samples
        .filter((s) => s.ok)
        .map((s) => {
          const [x, z] = proj.lonLatToWorld(s.lon, s.lat);
          return { x, z, y: pack.sampleHeight(x, z) * up + LIFT, lon: s.lon };
        });

      /* 断点要断开：经度差一大截就认为跨过了缺口（等距采样下很可靠） */
      const stride = line.length > 1 ? Math.abs(line[1].lon - line[0].lon) : 0;
      const half = WIDTH / 2;
      let strip = 0;
      for (let i = 0; i < line.length; i++) {
        if (i > 0 && stride > 0 && Math.abs(line[i].lon - line[i - 1].lon) > stride * 3) strip = 0;
        const a = line[Math.max(0, i - 1)];
        const b = line[Math.min(line.length - 1, i + 1)];
        /* 水平面内的法向：带宽始终朝向「路的侧边」，不随俯仰角变化 */
        let nx = -(b.z - a.z);
        let nz = b.x - a.x;
        const L = Math.hypot(nx, nz) || 1;
        nx = (nx / L) * half;
        nz = (nz / L) * half;
        const p = line[i];
        pos.push(p.x + nx, p.y, p.z + nz, p.x - nx, p.y, p.z - nz);
        if (strip > 0) {
          const k = (i - 1) * 2;
          idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
        strip++;
      }
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mat = injectGlobe(
      new THREE.MeshBasicMaterial({
        color: 0x9fd8ff,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      globeGLSL(mapping),
      'globe-profile',
    );
    return { geo, mat };
  }, [profile, pack, exag, mapping]);

  useEffect(
    () => () => {
      built.geo.dispose();
      built.mat.dispose();
    },
    [built],
  );

  if (!profile || !profile.b) return null;
  return <mesh geometry={built.geo} material={built.mat} renderOrder={2} frustumCulled={false} />;
}
