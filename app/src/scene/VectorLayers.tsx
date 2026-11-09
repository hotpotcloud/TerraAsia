import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { GLOBE_U, globeGLSL, injectGlobe, toGlobe } from '../data/globe';
import { indexProvinces } from '../data/geo';
import { useFrame } from '@react-three/fiber';
import { useScene } from './SceneContext';
import { useAppStore } from '../state/store';
import { drapedLine, drapedSegments } from './layers/polyline';

const PROV_BASE = 0x7f9bb0;
const PROV_SEL = 0xffa64d;
const CITY_COLOR = 0xc2e4fa;

/** 海岸 / 国界线、省级行政区、地级市界、十段线、南海岛礁 */
export function VectorLayers() {
  const { data, handles } = useScene();
  const { asia: pack, asiaMap } = data;
  const json = pack.json!;
  const exag = useAppStore((s) => s.exag);
  const layers = useAppStore((s) => s.layers);
  const selected = useAppStore((s) => s.selected);

  const glsl = useMemo(() => globeGLSL(asiaMap), [asiaMap]);
  const provinces = useMemo(() => indexProvinces(json.provinces), [json.provinces]);

  /* ---------- 海岸 / 国界 ---------- */
  const coastGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(drapedSegments(json.coast, pack, exag, 0.2), 3));
    g.computeBoundingSphere();
    return g;
  }, [json.coast, pack, exag]);

  const coastMat = useMemo(
    () =>
      injectGlobe(
        new THREE.LineBasicMaterial({ color: 0xcfe0ec, transparent: true, opacity: 0.95 }),
        glsl,
        'globe-asia',
      ),
    [glsl],
  );

  /* ---------- 省界：每省一个对象，可单独改色 ---------- */
  const provObjs = useMemo(
    () =>
      provinces.map((pv) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute(
          'position',
          new THREE.BufferAttribute(drapedSegments(pv.rings, pack, exag, 0.3), 3),
        );
        g.computeBoundingSphere();
        const m = injectGlobe(
          new THREE.LineBasicMaterial({ color: PROV_BASE, transparent: true, opacity: 0.45 }),
          glsl,
          'globe-asia',
        );
        return { pv, geo: g, mat: m };
      }),
    [provinces, pack, exag, glsl],
  );

  /* ---------- 十段线（虚线，需连续折线） ---------- */
  const dashLines = useMemo(
    () =>
      json.dash.map((seg) => {
        const pts = drapedLine(seg, pack, exag, 0.35);
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        const m = injectGlobe(
          new THREE.LineDashedMaterial({
            color: 0xffd35c,
            dashSize: 0.85,
            gapSize: 0.5,
            transparent: true,
          }),
          glsl,
          'globe-asia',
        );
        const line = new THREE.Line(g, m);
        line.computeLineDistances();
        line.frustumCulled = false;
        return line;
      }),
    [json.dash, pack, exag, glsl],
  );

  /* ---------- 南海岛礁：实例化小球 ---------- */
  const markers = useMemo(() => {
    const list = json.markers.map(([lon, lat]) => {
      const w = pack.proj.lonLatToWorld(lon, lat);
      return { x: w[0], y: 0.14, z: w[1] };
    });
    const mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.14, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xd9b34a }),
      list.length,
    );
    mesh.frustumCulled = false;
    return { mesh, list };
  }, [json.markers, pack]);

  /* ---------- 地级市界：点选省份后按需构建 ---------- */
  const cityGeo = useMemo(() => {
    if (!selected || !json.cities) return null;
    const rows = json.cities[selected.name];
    if (!rows || !rows.length) return null;
    const rings = rows.flatMap((row) => row[3] ?? []);
    if (!rings.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(drapedSegments(rings, pack, exag, 0.36), 3));
    g.computeBoundingSphere();
    return g;
  }, [selected, json.cities, pack, exag]);

  const cityMat = useMemo(
    () => injectGlobe(new THREE.LineBasicMaterial({ color: CITY_COLOR, transparent: true, opacity: 0.78 }), glsl, 'globe-asia'),
    [glsl],
  );

  /* ---------- 选中态：改色 + 画遮罩 ---------- */
  useEffect(() => {
    for (const o of provObjs) {
      o.mat.color.setHex(PROV_BASE);
      o.mat.opacity = 0.45;
    }
    const hit = selected ? provObjs.find((o) => o.pv.name === selected.name) : null;
    if (hit) {
      hit.mat.color.setHex(PROV_SEL);
      hit.mat.opacity = 1;
    }

    // 遮罩画到画布纹理上 → 地形着色器把它染成暖橙色，自动贴合起伏
    const c = handles.selCtx;
    const { GW, GH } = pack;
    c.clearRect(0, 0, GW, GH);
    if (hit) {
      c.fillStyle = '#fff';
      for (const ring of hit.pv.rings) {
        c.beginPath();
        ring.forEach((pt, i) => {
          const g = pack.proj.lonLatToGrid(pt[0], pt[1]);
          if (i) c.lineTo(g[0], g[1]);
          else c.moveTo(g[0], g[1]);
        });
        c.closePath();
        c.fill();
      }
    }
    handles.selTex.needsUpdate = true;
  }, [selected, provObjs, handles, pack]);

  /* ---------- 岛礁在球面过渡时重定位 ----------
     InstancedMesh 的矩阵在顶点形变之后生效，不能靠着色器注入，只能 CPU 搬 */
  const lastMix = useRef(-1);
  useFrame(() => {
    const mix = GLOBE_U.value;
    if (Math.abs(mix - lastMix.current) < 0.0005) return;
    lastMix.current = mix;
    const m = new THREE.Matrix4();
    if (mix <= 0.0001) {
      markers.list.forEach((p, i) => {
        m.setPosition(p.x, p.y, p.z);
        markers.mesh.setMatrixAt(i, m);
      });
    } else {
      const o = { x: 0, y: 0, z: 0 };
      markers.list.forEach((p, i) => {
        toGlobe(asiaMap, p.x, p.y, p.z, mix, o);
        m.setPosition(o.x, o.y, o.z);
        markers.mesh.setMatrixAt(i, m);
      });
    }
    markers.mesh.instanceMatrix.needsUpdate = true;
  });

  // 卸载释放
  useEffect(
    () => () => {
      coastGeo.dispose();
      provObjs.forEach((o) => {
        o.geo.dispose();
        o.mat.dispose();
      });
      cityGeo?.dispose();
      dashLines.forEach((l) => {
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
      });
    },
    [coastGeo, provObjs, cityGeo, dashLines],
  );

  const provVisible = layers.prov || !!selected;

  return (
    <group>
      {layers.coast && <lineSegments geometry={coastGeo} material={coastMat} frustumCulled={false} />}

      <group visible={provVisible}>
        {provObjs.map((o) => (
          <lineSegments
            key={o.pv.name}
            geometry={o.geo}
            material={o.mat}
            frustumCulled={false}
          />
        ))}
      </group>

      {layers.cityDiv && cityGeo && (
        <lineSegments geometry={cityGeo} material={cityMat} frustumCulled={false} />
      )}

      {layers.dash && dashLines.map((l, i) => <primitive key={i} object={l} />)}

      <primitive object={markers.mesh} />
    </group>
  );
}
