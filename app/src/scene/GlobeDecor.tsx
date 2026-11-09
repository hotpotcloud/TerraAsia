import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { EARTH_R, GLOBE_U } from '../data/globe';
import { sun } from './terrainMaterial';

/**
 * 球面装饰层：经纬网、大气辉光、星空、极冠。
 * 全部只在球面模式下可见 —— 可见性直接读 GLOBE_U，不走 React 状态，
 * 否则过渡的 100 帧会把整棵树重渲染 100 次。
 */
export function GlobeDecor() {
  const root = useRef<THREE.Group>(null);
  const starsRef = useRef<THREE.Points>(null);

  /** 经纬网：15° 间隔。必须与地形对齐，所以不能跟着星空转 */
  const graticule = useMemo(() => {
    const pts: number[] = [];
    const rr = EARTH_R * 1.0008;
    for (let lat = -75; lat <= 75; lat += 15) {
      const la = (lat * Math.PI) / 180;
      for (let lon = -180; lon < 180; lon += 3) {
        const a = (lon * Math.PI) / 180;
        const b = ((lon + 3) * Math.PI) / 180;
        pts.push(
          rr * Math.cos(la) * Math.sin(a), rr * Math.sin(la), rr * Math.cos(la) * Math.cos(a),
          rr * Math.cos(la) * Math.sin(b), rr * Math.sin(la), rr * Math.cos(la) * Math.cos(b),
        );
      }
    }
    for (let lon = -180; lon < 180; lon += 15) {
      const a = (lon * Math.PI) / 180;
      for (let lat = -90; lat < 90; lat += 3) {
        const la = (lat * Math.PI) / 180;
        const lb = ((lat + 3) * Math.PI) / 180;
        pts.push(
          rr * Math.cos(la) * Math.sin(a), rr * Math.sin(la), rr * Math.cos(la) * Math.cos(a),
          rr * Math.cos(lb) * Math.sin(a), rr * Math.sin(lb), rr * Math.cos(lb) * Math.cos(a),
        );
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    return g;
  }, []);

  /** 星空：球面均匀采样。后续可换成耶鲁亮星星表（真实星座），接口不变 */
  const stars = useMemo(() => {
    const COUNT = 2200;
    const rr = 900;
    const pos = new Float32Array(COUNT * 3);
    const col = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = rr * r * Math.cos(th);
      pos[i * 3 + 1] = rr * u;
      pos[i * 3 + 2] = rr * r * Math.sin(th);
      const t = 0.55 + Math.random() * 0.45;
      col[i * 3] = t;
      col[i * 3 + 1] = t;
      col[i * 3 + 2] = t * (0.92 + Math.random() * 0.08);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({
      size: 1.6,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    return p;
  }, []);

  /** 大气辉光：背面球 + 菲涅尔，边缘亮、正对视线处透明 */
  const atmoMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uSun: { value: sun.dir } },
        vertexShader: `
          varying vec3 vN; varying vec3 vW;
          void main(){
            vN = normalize(mat3(modelMatrix) * normal);
            vec4 w = modelMatrix * vec4(position, 1.0);
            vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: `
          precision highp float;
          uniform vec3 uSun;
          varying vec3 vN; varying vec3 vW;
          void main(){
            vec3 V = normalize(cameraPosition - vW);
            float rim = pow(1.0 - abs(dot(normalize(vN), V)), 2.2);
            float lit = 0.42 + 0.58 * max(dot(normalize(vN), uSun), 0.0);
            gl_FragColor = vec4(vec3(0.22, 0.52, 0.92) * rim * lit, rim * 0.85);
          }`,
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );

  /* 极冠：墨卡托数据只到 ±85°，两极各补一个球冠，否则球面上会缺两个洞。
     北极为北冰洋（深蓝），南极为南极冰盖（近白）。 */
  const capArc = ((90 - 85.05) * Math.PI) / 180;

  useFrame((state) => {
    const mix = GLOBE_U.value;
    const visible = mix > 0.001;
    if (root.current && root.current.visible !== visible) root.current.visible = visible;
    if (starsRef.current) starsRef.current.rotation.y = state.clock.elapsedTime * 0.006;
  });

  useEffect(() => () => {
    graticule.dispose();
    stars.geometry.dispose();
    (stars.material as THREE.Material).dispose();
    atmoMat.dispose();
  }, [graticule, stars, atmoMat]);

  return (
    <group ref={root} visible={false}>
      {/* 两极补洞 */}
      <mesh>
        <sphereGeometry args={[EARTH_R * 0.999, 64, 8, 0, Math.PI * 2, 0, capArc]} />
        <meshBasicMaterial color={0x0d2338} />
      </mesh>
      <mesh>
        <sphereGeometry args={[EARTH_R * 0.999, 64, 8, 0, Math.PI * 2, Math.PI - capArc, capArc]} />
        <meshBasicMaterial color={0xd8e4ec} />
      </mesh>

      <lineSegments geometry={graticule}>
        <lineBasicMaterial color={0x1f4468} transparent opacity={0.55} />
      </lineSegments>

      <mesh>
        <sphereGeometry args={[EARTH_R * 1.045, 64, 48]} />
        <primitive object={atmoMat} attach="material" />
      </mesh>

      <primitive object={stars} ref={starsRef} />
    </group>
  );
}
