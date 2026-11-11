import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
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
  const derived = useAppStore((s) => s.derived);
  const sandbox = useAppStore((s) => s.sandbox);
  const meshRef = useRef<THREE.Mesh>(null);

  const built = useMemo(() => {
    const geo = buildTerrainGeometry(pack, exag, world, overlayBounds);
    const { material, uniforms } = createTerrainMaterial({
      mapping,
      glsl: globeGLSL(mapping),
      v0: pack.proj.V0,
      isWorld: world,
      texel: [1 / pack.GW, 1 / pack.GH],
      /* 坡度要按真实米数算：mPerTexel = 经度步长 × 111320 × cos(lat)，
         而纬度由墨卡托反解，这两个常数就是反解需要的比例项。 */
      merc: [mapping.ch / mapping.P, (mapping.cy0 + mapping.tyOff) / mapping.P],
      lonStep: (mapping.lon1 - mapping.lon0) / (pack.GW - 1),
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

  /* 派生图只作用在亚洲高精 patch 上：全球底图是 ~39 km 网格，差分出来的坡度
     只反映大陆尺度趋势，把它也切成色块只会让人误读。底图保持自然设色。 */
  useEffect(() => {
    const v = derived === 'slope' ? 1 : derived === 'aspect' ? 2 : derived === 'contour' ? 3 : 0;
    built.uniforms.uDerived.value = world ? 0 : v;
  }, [derived, built, world]);

  /* 等高线线宽要按「一个像素 = 多少米高程」换算，这里给着色器提供像素尺度。
     fov 在 Canvas 里固定 50°，视口高度随窗口变化，所以两个都要读。 */
  const { size, camera } = useThree();
  useEffect(() => {
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
    const k = (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(1, size.height);
    built.uniforms.uPxScale.value = k;
  }, [built, size.height, camera]);

  // 平面模式的对齐偏移：球面模式必须为 0（球面靠各层自己的 lon0/WX 映射对位）
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (flatOffset) {
      const k = 1 - GLOBE_U.value;
      mesh.position.set(flatOffset[0] * k, 0, flatOffset[1] * k);
    }
    if (world) {
      /* 沙盘模式只留亚洲精块。全球底图一旦在场，就会在断面外侧露出一圈
         「没被切掉的地形」，模型立刻变回一张摊开的地图。
         用 GLOBE_U 而不是 viewMode：球面回归时底图要跟着形变一起回来。 */
      const on = !sandbox || GLOBE_U.value > 0.02;
      if (mesh.visible !== on) mesh.visible = on;
    }
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
