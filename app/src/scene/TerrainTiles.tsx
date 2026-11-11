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
  if (level === 'near') return span * 2 + 1;
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

  /* 逐块挑密度。每帧最多重建一块：单块 near 级有 50 万顶点，
     连环重建会直接把帧率打穿。 */
  const rebuildCursor = useRef(0);
  useFrame(() => {
    const list = tiles.current;
    if (!list.length) return;
    const globe = GLOBE_U.value > 0.5;
    const cam = camera.position;

    const wantOf = (t: Tile): Level => {
      let d: number;
      if (globe) {
        // 球面模式要按球面坐标量距离，平面世界坐标在那里没有意义
        const [lon, lat] = pack.proj.worldToLonLat(t.center[0], t.center[1]);
        const dir = lonLatToDir(lon, lat);
        d = Math.hypot(
          cam.x - dir[0] * 110,
          cam.y - dir[1] * 110,
          cam.z - dir[2] * 110,
        );
      } else {
        d = Math.hypot(cam.x - t.center[0], cam.z - t.center[1]);
      }
      return d < D_NEAR ? 'near' : d < D_MID ? 'mid' : 'far';
    };

    let builtChanged = false;
    for (let k = 0; k < list.length; k++) {
      const t = list[(rebuildCursor.current + k) % list.length];
      const want = wantOf(t);
      if (want === t.level && t.built) continue;

      const nx = samplesOf(t.rect.i1 - t.rect.i0, want);
      const ny = samplesOf(t.rect.j1 - t.rect.j0, want);
      t.built?.geometry.dispose();
      t.built = buildTileGeometry(pack, exagRef.current, t.rect, nx, ny);
      t.level = want;
      rebuildCursor.current = (rebuildCursor.current + k + 1) % list.length;
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
