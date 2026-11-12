import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { GLOBE_U, globeGLSL, lonLatToDir, type Mapping } from '../data/globe';
import type { FieldPack } from '../data/terrainLoader';
import { buildTileGeometry, type TileGeometry, type TileRect } from './tileGeometry';
import { createTerrainMaterial } from './terrainMaterial';
import { useScene } from './SceneContext';
import { useAppStore } from '../state/store';
import { viewState } from './viewState';

/**
 * 分块 LOD 地形（`docs/11 §6.1`）。
 *
 * 与 `TerrainMesh` 的关系：同一份高度场、同一套着色器，区别只在「一张网格」变成
 * 「N 块网格，每块按到相机的距离挑密度」。共存期约束（doc 里写死的那条）是
 * **两者不得同时绘制同一区域**，所以由 `store.tiles` 二选一挂载，不是叠着放。
 *
 * 密度分三级，按块的**中心到相机**的距离选：
 *   near  —— 2 倍源密度（插值补细节），只在很近时启用
 *   mid   —— 与源数据同密度（1 格 1 顶点），默认
 *   far   —— 半密度（2 格 1 顶点），远景与球面模式
 * 换级是逐块重建几何，一帧最多重建一块，避免拖动时连环卡顿。
 */

const COLS = 4;
const ROWS = 4;

/** 密度阈值（世界单位）。按块中心到相机的距离判定。 */
const D_NEAR = 26;
const D_MID = 95;

type Level = 'near' | 'mid' | 'far';

interface Tile {
  rect: TileRect;
  center: [number, number];
  level: Level;
  built: TileGeometry | null;
}

/** 该块在给定密度下每个轴的采样点数 */
function samplesOf(span: number, level: Level): number {
  if (level === 'far') return Math.max(2, Math.floor(span / 2) + 1);
  /* 1.5 倍而不是 2 倍：2 倍时单块 57 万顶点，重建一次要在主线程停 200 ms 上下，
     拖动时能感觉到顿；1.5 倍是 33 万顶点，细节提升在屏幕上几乎看不出差别。 */
  if (level === 'near') return Math.round(span * 1.5) + 1;
  return span + 1;
}

export function TerrainTiles({ pack, mapping }: { pack: FieldPack; mapping: Mapping }) {
  const { handles } = useScene();
  const exag = useAppStore((s) => s.exag);
  const derived = useAppStore((s) => s.derived);
  const { size, camera } = useThree();

  const material = useMemo(() => {
    const { material: mat, uniforms } = createTerrainMaterial({
      mapping,
      glsl: globeGLSL(mapping),
      v0: pack.proj.V0,
      isWorld: false,
      texel: [1 / pack.GW, 1 / pack.GH],
      merc: [mapping.ch / mapping.P, (mapping.cy0 + mapping.tyOff) / mapping.P],
      lonStep: (mapping.lon1 - mapping.lon0) / (pack.GW - 1),
    });
    uniforms.uGlobe = GLOBE_U;
    /* 同 TerrainMesh：切分块开关会重建材质，初值要对齐已完成的点亮进度 */
    uniforms.uReveal.value = viewState.revealed ? 1 : 0;
    mat.uniforms = uniforms;
    uniforms.uAO.value = pack.aoTex;
    uniforms.uHeight.value = pack.heightTex;
    mat.side = THREE.FrontSide;
    return mat;
  }, [pack, mapping]);

  // 与 TerrainMesh 一样把 uniforms 交给桥接层（太阳、选中高亮、夸张比都要用）
  useEffect(() => {
    handles.asiaUniforms = material.uniforms;
    return () => {
      handles.asiaUniforms = null;
    };
  }, [handles, material]);

  useEffect(() => {
    material.uniforms.uExag.value = exag;
  }, [exag, material]);

  useEffect(() => {
    const v = derived === 'slope' ? 1 : derived === 'aspect' ? 2 : derived === 'contour' ? 3 : 0;
    material.uniforms.uDerived.value = v;
  }, [derived, material]);

  useEffect(() => {
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
    material.uniforms.uPxScale.value = (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(1, size.height);
  }, [material, size.height, camera]);

  const tiles = useRef<Tile[]>([]);
  const [, force] = useState(0);

  /* 建块：初始一律 mid。真正的分级交给首帧之后的调度，避免挂载瞬间同时建 16 块高密度 */
  useEffect(() => {
    const { GW, GH } = pack;
    const rects: Tile[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i0 = Math.round((c * (GW - 1)) / COLS);
        const i1 = Math.round(((c + 1) * (GW - 1)) / COLS);
        const j0 = Math.round((r * (GH - 1)) / ROWS);
        const j1 = Math.round(((r + 1) * (GH - 1)) / ROWS);
        const [x, z] = pack.proj.gridToWorld((i0 + i1) / 2, (j0 + j1) / 2);
        rects.push({ rect: { i0, i1, j0, j1 }, center: [x, z], level: 'mid', built: null });
      }
    }
    tiles.current = rects;
    force((n) => n + 1);

    return () => {
      for (const t of tiles.current) {
        t.built?.geometry.dispose();
        t.built = null;
      }
      tiles.current = [];
    };
  }, [pack]);

  // 夸张度变化：逐块重算 Y 与法线（不重建几何）
  const exagRef = useRef(exag);
  useEffect(() => {
    if (exagRef.current === exag) return;
    exagRef.current = exag;
    for (const t of tiles.current) t.built?.setExag(exag);
  }, [exag]);

  /* ---------- 分级调度 ----------
     这是全工程最容易把帧率打穿的地方，四条约束缺一不可：
     1. **不在每帧重算**：变化只在 260 ms 的评估节拍上判断一次，拖动时不会每帧扫一遍。
     2. **滞回**：升级与降级用不同的阈值（`*1.25` / `/1.15`），否则相机停在阈值附近时
        一块瓦片会在两档之间反复重建，看起来就是持续卡顿。
     3. **节流**：任意两次重建之间至少隔 200 ms；单块 near 有 57 万顶点，连环重建必然掉帧。
     4. **near 只给最近的一块**：两块同时 2 倍密度就是 115 万顶点，收益却看不出来。 */
  const rebuildCursor = useRef(0);
  const lastEval = useRef(0);
  const lastBuild = useRef(0);

  useFrame(() => {
    const list = tiles.current;
    if (!list.length) return;
    const now = performance.now();
    const booting = list.some((t) => !t.built);
    if (!booting && now - lastEval.current < 260) return;
    lastEval.current = now;

    const globe = GLOBE_U.value > 0.5;
    const cam = camera.position;

    /** 到块中心的距离（球面模式按球面坐标量，平面世界坐标在那里没有意义） */
    const distOf = (t: Tile): number => {
      if (!globe) return Math.hypot(cam.x - t.center[0], cam.z - t.center[1]);
      const [lon, lat] = pack.proj.worldToLonLat(t.center[0], t.center[1]);
      const dir = lonLatToDir(lon, lat);
      return Math.hypot(cam.x - dir[0] * 110, cam.y - dir[1] * 110, cam.z - dir[2] * 110);
    };

    const dists = list.map(distOf);
    let nearest = 0;
    for (let i = 1; i < dists.length; i++) if (dists[i] < dists[nearest]) nearest = i;

    /** 带滞回的目标档位 */
    const wantAt = (i: number): Level => {
      const d = dists[i];
      const cur = list[i].level;
      if (cur === 'near') {
        if (d > D_NEAR * 1.25) return d > D_MID * 1.1 ? 'far' : 'mid';
        return 'near';
      }
      if (cur === 'far') {
        if (d < D_MID / 1.15) return d < D_NEAR / 1.25 ? 'near' : 'mid';
        return 'far';
      }
      if (i === nearest && d < D_NEAR / 1.25) return 'near';
      if (d > D_MID * 1.1) return 'far';
      return 'mid';
    };

    let builtChanged = false;
    for (let k = 0; k < list.length; k++) {
      if (!booting && now - lastBuild.current < 200) break;
      const i = (rebuildCursor.current + k) % list.length;
      const t = list[i];
      const want = wantAt(i);
      /* near 只允许最近的一块：其它块即使落进 near 区间也压回 mid */
      const level: Level = want === 'near' && i !== nearest ? 'mid' : want;
      if (level === t.level && t.built) continue;

      const nx = samplesOf(t.rect.i1 - t.rect.i0, level);
      const ny = samplesOf(t.rect.j1 - t.rect.j0, level);
      t.built?.geometry.dispose();
      t.built = buildTileGeometry(pack, exagRef.current, t.rect, nx, ny);
      t.level = level;
      rebuildCursor.current = (i + 1) % list.length;
      lastBuild.current = now;
      builtChanged = true;
      break;
    }

    // 统计（回归脚本与铭牌读这里，不额外造状态）
    if (builtChanged || viewState.tilesDone !== list.filter((t) => t.built).length) {
      viewState.tilesDone = list.filter((t) => t.built).length;
      let near = 0;
      let mid = 0;
      let far = 0;
      let verts = 0;
      for (const t of list) {
        if (!t.built) continue;
        if (t.level === 'near') near++;
        else if (t.level === 'mid') mid++;
        else far++;
        verts += t.built.verts;
      }
      viewState.tilesNear = near;
      viewState.tilesMid = mid;
      viewState.tilesFar = far;
      viewState.tilesVerts = verts;
      force((n) => n + 1);
    }
  });

  return (
    <group name="asia-terrain">
      {tiles.current.map((t, i) =>
        t.built ? (
          <mesh
            key={i}
            /* 沿用单网格的对象名：__ta.frames() 与合规回归按这个名字找亚洲层 */
            name="asia-terrain"
            geometry={t.built.geometry}
            material={material}
            renderOrder={1}
            frustumCulled
          />
        ) : null,
      )}
    </group>
  );
}
