import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { FieldPack } from '../data/terrainLoader';
import { mappingOf } from '../data/globe';
import { shotAt } from '../data/tour';
import { SceneContext, type SceneHandles } from './SceneContext';
import { CAM_FOV } from './camera';
import { TerrainMesh } from './TerrainMesh';
import { TerrainTiles } from './TerrainTiles';
import { SandTable } from './SandTable';
import { VectorLayers } from './VectorLayers';
import { FlowLayers } from './FlowLayers';
import { GlobeDecor } from './GlobeDecor';
import { LabelLayer } from './LabelLayer';
import { SceneBridge, type OrbitLike } from './SceneBridge';
import { useAppStore } from '../state/store';

interface Props {
  asia: FieldPack;
  world: FieldPack;
  compassRef: React.MutableRefObject<HTMLDivElement | null>;
}

/** 场景装配：Canvas 里只挂图层，调度全在 SceneBridge */
export function SceneView({ asia, world, compassRef }: Props) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const controls = useRef<OrbitLike | null>(null);
  const exag = useAppStore((s) => s.exag);
  const tiles = useAppStore((s) => s.tiles);

  const data = useMemo(
    () => ({
      asia,
      world,
      asiaMap: mappingOf(asia.proj),
      worldMap: mappingOf(world.proj),
    }),
    [asia, world],
  );

  const handles = useMemo<SceneHandles>(() => {
    const canvas = document.createElement('canvas');
    canvas.width = asia.GW;
    canvas.height = asia.GH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('无法创建选中遮罩画布');
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return { asiaUniforms: null, worldUniforms: null, selCanvas: canvas, selCtx: ctx, selTex: tex };
  }, [asia]);

  const initial = useMemo(() => shotAt(asia, exag, 0), [asia, exag]);

  /**
   * 全球底图在平面模式下的对齐偏移：底图自己以「本初子午线/赤道」为原点，
   * 亚洲层以自己图幅中心（东经 102.5°）为原点，两者差了约 102°。
   * 把底图搬到亚洲层的坐标系里，两层才真正叠在一起（球面模式不用搬，各自映射）。
   */
  const worldOffset = useMemo<[number, number]>(() => asia.proj.lonLatToWorld(0, 0), [asia]);
  /** 精细层覆盖范围：全球底图在此区域内让位，避免两套高程网格穿插 */
  const overlayBounds = useMemo(
    () => ({
      lon0: asia.proj.lon0,
      lon1: asia.proj.lon1,
      lat0: asia.proj.lat0,
      lat1: asia.proj.lat1,
      inset: 0.5,
    }),
    [asia],
  );

  return (
    <SceneContext.Provider value={{ data, handles }}>
      <div className="scene-root">
        <Canvas
          dpr={[1, 2]}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          camera={{ fov: CAM_FOV, near: 0.5, far: 4000, position: initial.pos }}
          onCreated={({ camera }) => camera.lookAt(new THREE.Vector3(...initial.tgt))}
        >
          <color attach="background" args={[0x060d16]} />

          <TerrainMesh pack={world} mapping={data.worldMap} world flatOffset={worldOffset} overlayBounds={overlayBounds} />
          {/* 分块 LOD 与单网格二选一：两者同时绘制同一区域会重新引入共面穿插 */}
          {tiles ? <TerrainTiles pack={asia} mapping={data.asiaMap} /> : <TerrainMesh pack={asia} mapping={data.asiaMap} />}
          <SandTable pack={asia} />
          <VectorLayers />
          <FlowLayers />
          <GlobeDecor />

          <OrbitControls
            ref={controls as never}
            enableDamping
            dampingFactor={0.08}
            makeDefault
            target={initial.tgt}
          />

          <SceneBridge controls={controls} compassRef={compassRef} />
          {host && <LabelLayer host={host} />}
        </Canvas>
        <div className="labels-layer" ref={setHost} />
      </div>
    </SceneContext.Provider>
  );
}
