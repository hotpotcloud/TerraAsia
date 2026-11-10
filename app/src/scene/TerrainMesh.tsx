import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { GLOBE_U, globeGLSL } from '../data/globe';
import type { FieldPack } from '../data/terrainLoader';
import type { Mapping } from '../data/globe';
import { buildTerrainGeometry, type OverlayBounds } from './terrainGeometry';
import { createTerrainMaterial } from './terrainMaterial';
import { useScene } from './SceneContext';
import { useAppStore } from '../state/store';

interface Props {
  pack: FieldPack;
  mapping: Mapping;
  /** 全球底图：参与图幅渐隐、不投射阴影、不参与开场动画 */
  world?: boolean;
  /**
   * 平面模式下把本层搬到共享坐标系所需的世界坐标偏移。
   * 两层各自以自己的图幅中心为原点（底图中心经度 0°，亚洲层中心经度 102.5°），
   * 不搬的话平面上会整体错位 ~102°，底图的地形会从下面顶穿亚洲层。
   * 球面模式下各层自带 lon0/WX 映射，不需要偏移，所以按 uGlobe 淡出。
   */
  flatOffset?: [number, number];
  /** 仅全球底图传入：精细层覆盖区，底图在此让位 */
  overlayBounds?: OverlayBounds;
}

/**
 * 一张地形网格。亚洲高精 patch 与全球粗底图共用同一套着色器，
 * 差别只在映射常数与几个开关：底图铺满球面，patch 压在上面无缝衔接。
 */
export function TerrainMesh({ pack, mapping, world = false, flatOffset, overlayBounds }: Props) {
  const { handles } = useScene();
  const exag = useAppStore((s) => s.exag);
  const meshRef = useRef<THREE.Mesh>(null);

  const built = useMemo(() => {
    const geo = buildTerrainGeometry(pack, exag, world, overlayBounds);
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
      /* 覆盖区内地表归属已由 aOverlay 决定（底图让位）；这里的深度偏移只用于
         覆盖区边界那一圈过渡带，避免两层恰好共面时的细微闪烁。
         它不能替代覆盖规则，也不能靠加大它来消除穿插。 */
      material.polygonOffset = true;
      material.polygonOffsetFactor = 1;
      material.polygonOffsetUnits = 1;
    }
    return { geometry: geo.geometry, setExag: geo.setExag, material, uniforms };
    // 夸张度只影响初始顶点高度，之后的调整走 setExag，所以不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack, mapping, world, handles, overlayBounds]);

  // 句柄交给桥接层（相机贴地、太阳、模式切换都要用）
  useEffect(() => {
    if (world) handles.worldUniforms = built.uniforms;
    else handles.asiaUniforms = built.uniforms;
    return () => {
      if (world) handles.worldUniforms = null;
      else handles.asiaUniforms = null;
    };
  }, [built.uniforms, handles, world]);

  // 垂直夸张变化 → 重算 Y 与法线（不重建几何），并同步片元着色器的 uExag。
  // uExag 只在材质里给过初值 8.5，从不跟随 store 更新——阴影步进 sunShadow 用
  // 它按 8.5× 算高度场射线，一旦默认夸张改成 5×，射线高度会被系统性高估 70%，
  // 阴影方向会错。这里必须和几何的 setExag 一起同步。
  useEffect(() => {
    built.setExag(exag);
    built.uniforms.uExag.value = exag;
  }, [exag, built]);

  // 平面模式的对齐偏移：球面模式必须为 0（球面靠各层自己的 lon0/WX 映射对位）
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || !flatOffset) return;
    const k = 1 - GLOBE_U.value;
    mesh.position.set(flatOffset[0] * k, 0, flatOffset[1] * k);
  });

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
      ref={meshRef}
      name={world ? 'world-terrain' : 'asia-terrain'}
      geometry={built.geometry}
      material={built.material}
      renderOrder={world ? 0 : 1}
      frustumCulled
    />
  );
}
