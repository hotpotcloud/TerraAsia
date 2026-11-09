import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { GLOBE_U, globeGLSL } from '../data/globe';
import type { Mapping } from '../data/globe';
import { useScene } from './SceneContext';
import { useAppStore } from '../state/store';
import { drapeCurve } from './layers/polyline';
import { RAIL, ROAD } from '../data/static';
import { STEPS } from '../data/tour';
import type { FieldPack } from '../data/terrainLoader';

const RIVER_FRAG = `
  precision highp float;
  uniform float uTime; uniform vec3 uColor; uniform float uGlow; uniform float uSpeed;
  varying vec2 vUv;
  void main(){
    // 高频强虚化会让线体本身消失、只剩亮点 = 视觉上变成断线；降低频率与白点强度
    float dash = smoothstep(0.62, 0.98, fract(vUv.x * 18.0 - uTime * uSpeed));
    vec3 col = uColor * (0.80 + 0.10 * sin(uTime * 0.7)) + vec3(0.75, 0.88, 0.95) * dash * 0.22;
    col *= (0.78 + uGlow * 1.6);
    gl_FragColor = vec4(col, 1.0);
  }`;

const TRANS_FRAG = (speed: number, base: number, amp: number) => `
  precision highp float; uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
  void main(){
    // 连续线体 + 缓慢行波高光：高频 fract 在近景会碎成「串珠」
    float d = 0.5 + 0.5 * sin(uTime * ${speed.toFixed(2)} - vUv.x * 11.0);
    vec3 col = uColor * (${base.toFixed(2)} + ${amp.toFixed(2)} * d) + vec3(0.04, 0.06, 0.08);
    gl_FragColor = vec4(col, 1.0);
  }`;

const TIER_FRAG = `
  precision highp float; uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
  void main(){
    // 低频行波：保持线条连续可读，只让光晕缓慢流动
    float pulse = 0.74 + 0.26 * sin(uTime * 1.8 - vUv.x * 5.0);
    gl_FragColor = vec4(uColor * pulse * 1.42, 1.0);
  }`;

/** 片元里按 uv.x 做饭流动画；顶点里卷到球面 */
function flowMaterial(glsl: string, hex: number, speed: number, fragment: string): THREE.ShaderMaterial {
  const c = new THREE.Color();
  c.r = ((hex >> 16) & 255) / 255;
  c.g = ((hex >> 8) & 255) / 255;
  c.b = (hex & 255) / 255;
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: c },
      uGlow: { value: 0 },
      uSpeed: { value: speed },
      uGlobe: GLOBE_U,
    },
    vertexShader: `
      ${glsl}
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(morphToGlobe(position), 1.0);
      }`,
    fragmentShader: fragment,
    side: THREE.DoubleSide,
  });
}

function toPts(line: [number, number][], pack: FieldPack): THREE.Vector3[] {
  return line.map(([lon, lat]) => {
    const w = pack.proj.lonLatToWorld(lon, lat);
    return new THREE.Vector3(w[0], 0, w[1]);
  });
}

interface Built {
  group: THREE.Group;
  mats: THREE.ShaderMaterial[];
}

function buildTubes(
  glsl: string,
  pack: FieldPack,
  exag: number,
  items: { line: [number, number][]; rad: number; hex: number; speed: number; frag: string; offset: number }[],
  radiusOf?: (i: number) => number,
): Built {
  const group = new THREE.Group();
  const mats: THREE.ShaderMaterial[] = [];
  const byKey = new Map<string, THREE.ShaderMaterial>();
  items.forEach((it, i) => {
    const key = `${it.hex}-${it.speed}-${it.frag.length}`;
    let mat = byKey.get(key);
    if (!mat) {
      mat = flowMaterial(glsl, it.hex, it.speed, it.frag);
      byKey.set(key, mat);
      mats.push(mat);
    }
    const curve = drapeCurve(toPts(it.line, pack), pack, exag, it.offset);
    const rad = radiusOf ? radiusOf(i) : it.rad;
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 240, rad, 6, false), mat);
    mesh.frustumCulled = false;
    group.add(mesh);
  });
  return { group, mats };
}

/** 河流 / 铁路 / 公路 / 阶梯分界：管道几何贴地，流动感由着色器按 uv 推进，不占 CPU */
export function FlowLayers() {
  const { data } = useScene();
  const { asia: pack, asiaMap } = data;
  const json = pack.json!;
  const exag = useAppStore((s) => s.exag);
  const layers = useAppStore((s) => s.layers);
  const step = useAppStore((s) => s.step);

  const glsl = useMemo(() => globeGLSL(asiaMap as Mapping), [asiaMap]);

  const rivers = useMemo(() => {
    const items: Parameters<typeof buildTubes>[3] = [];
    Object.entries(json.rivers).forEach(([name, lines]) => {
      const main = name === '长江' || name === '黄河' || name === '黑龙江';
      const hex = name === '黄河' ? 0xf3b62e : name === '长江' ? 0x38bdf8 : 0x3d9fd1;
      for (const line of lines) {
        if (line.length < 2) continue;
        items.push({
          line,
          rad: name === '黄河' ? 0.105 : main ? 0.088 : 0.06,
          hex,
          speed: main ? 0.5 : 0.32,
          frag: RIVER_FRAG,
          offset: 0.26,
        });
      }
    });
    return buildTubes(glsl, pack, exag, items);
  }, [json.rivers, pack, exag, glsl]);

  const tier = useMemo(() => {
    const items = Object.values(json.tierlines).map((line) => ({
      line,
      rad: 0.115,
      hex: 0xff8f5a,
      speed: 1,
      frag: TIER_FRAG,
      offset: 0.3,
    }));
    return buildTubes(glsl, pack, exag, items);
  }, [json.tierlines, pack, exag, glsl]);

  const rail = useMemo(
    () =>
      buildTubes(
        glsl,
        pack,
        exag,
        Object.values(RAIL).map((line) => ({
          line,
          rad: 0.085,
          hex: 0xdfe8f2,
          speed: 1.5,
          frag: TRANS_FRAG(1.5, 0.62, 0.52),
          offset: 0.26,
        })),
      ),
    [pack, exag, glsl],
  );

  const road = useMemo(
    () =>
      buildTubes(
        glsl,
        pack,
        exag,
        Object.values(ROAD).map((line) => ({
          line,
          rad: 0.052,
          hex: 0xff6b8a,
          speed: 1,
          frag: TRANS_FRAG(1, 0.46, 0.4),
          offset: 0.24,
        })),
      ),
    [pack, exag, glsl],
  );

  // 导览第 6 步「江河东流」把河流点亮一点
  useEffect(() => {
    const glow = STEPS[step % STEPS.length]?.glow ?? 0;
    for (const m of rivers.mats) m.uniforms.uGlow.value = glow;
  }, [step, rivers]);

  const all = useMemo(() => [rivers, tier, rail, road], [rivers, tier, rail, road]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (const b of all) {
      for (const m of b.mats) m.uniforms.uTime.value = t;
    }
  });

  useEffect(
    () => () => {
      for (const b of all) {
        b.group.traverse((o) => {
          const mesh = o as THREE.Mesh;
          mesh.geometry?.dispose?.();
        });
        b.mats.forEach((m) => m.dispose());
      }
    },
    [all],
  );

  return (
    <group>
      {layers.river && <primitive object={rivers.group} />}
      {layers.tierLine && <primitive object={tier.group} />}
      {layers.rail && <primitive object={rail.group} />}
      {layers.road && <primitive object={road.group} />}
    </group>
  );
}
