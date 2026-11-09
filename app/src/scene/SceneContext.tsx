import { createContext, useContext } from 'react';
import * as THREE from 'three';
import type { FieldPack } from '../data/terrainLoader';
import type { Mapping } from '../data/globe';

/** 场景里所有组件共享的数据与可变句柄（等价于旧版的 create(ctx) 依赖注入） */
export interface SceneData {
  /** 亚洲窗口高精网格（含省界、河流等矢量数据） */
  asia: FieldPack;
  /** 全球粗网格底图，铺满整个球面 */
  world: FieldPack;
  asiaMap: Mapping;
  worldMap: Mapping;
}

export interface SceneHandles {
  asiaUniforms: Record<string, THREE.IUniform> | null;
  worldUniforms: Record<string, THREE.IUniform> | null;
  /** 选中省份的遮罩画布：画一次 → 贴到地形材质上，自动贴合起伏 */
  selCanvas: HTMLCanvasElement;
  selCtx: CanvasRenderingContext2D;
  selTex: THREE.CanvasTexture;
}

export interface SceneContextValue {
  data: SceneData;
  handles: SceneHandles;
}

export const SceneContext = createContext<SceneContextValue | null>(null);

export function useScene(): SceneContextValue {
  const v = useContext(SceneContext);
  if (!v) throw new Error('useScene 必须在 SceneProvider 内使用');
  return v;
}
