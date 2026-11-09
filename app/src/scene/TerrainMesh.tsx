import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { GLOBE_U, globeGLSL } from '../data/globe';
import type { FieldPack } from '../data/terrainLoader';
import type { Mapping } from '../data/globe';
import { buildTerrainGeometry } from './terrainGeometry';
import { createTerrainMaterial } from './terrainMaterial';
import { useScene } from './SceneContext';
import { useAppStore } from '../state/store';

interface Props {
  pack: FieldPack;
  mapping: Mapping;
  /** 全球底图：参与图幅渐隐、不投射阴影、不参与开场动画 */
  world?: boolean;
}

/**
 * 一张地形网格。亚洲高精 patch 与全球粗底图共用同一套着色器，
 * 差别只在映射常数与几个开关：底图铺满球面，patch 压在上面无缝衔接。
 */
export function TerrainMesh({ pack, mapping, world = false }: Props) {
  const { handles } = useScene();
  const exag = useAppStore((s) => s.exag);

  const built = useMemo(() => {
    const geo = buildTerrainGeometry(pack, exag, world);
    const { material, uniforms } = createTerrainMaterial({
      mapping,
      glsl: globeGLSL(mapping),
      v0: pack.proj.V0,
      isWorld: world,
    });
    // 所有人共用同一个 uGlobe 对象，一次改值全体同步
    uniforms.uGlobe = GLOBE_U;
    material.uniforms = uniforms;
    uniforms.uAO.value = pack.aoTex;
    uniforms.uHeight.value = pack.heightTex;
    if (!world) {
      uniforms.uSel.value = handles.selTex;
    }
    material.side = THREE.FrontSide;
    if (world) {
      /* 底图往后推一点：亚洲 patch 与它几乎共面，靠深度偏移决定谁在上层，避免 z-fighting */
      material.polygonOffset = true;
      material.polygonOffsetFactor = 1;
      material.polygonOffsetUnits = 1;
    }
    return { geometry: geo.geometry, setExag: geo.setExag, material, uniforms };
    // 夸张度只影响初始顶点高度，之后的调整走 setExag，所以不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack, mapping, world, handles]);

  // 句柄交给桥接层（相机贴地、太阳、模式切换都要用）
  useEffect(() => {
    if (world) handles.worldUniforms = built.uniforms;
    else handles.asiaUniforms = built.uniforms;
    return () => {
      if (world) handles.worldUniforms = null;
      else handles.asiaUniforms = null;
    };
  }, [built.uniforms, handles, world]);

  // 垂直夸张变化 → 重算 Y 与法线（不重建几何）
  useEffect(() => {
    built.setExag(exag);
  }, [exag, built]);

  // 卸载时释放 GPU 资源
  useEffect(
    () => () => {
      built.geometry.dispose();
      built.material.dispose();
    },
    [built],
  );

  return (
    <mesh
      geometry={built.geometry}
      material={built.material}
      renderOrder={world ? 0 : 1}
      frustumCulled
    />
  );
}
