import * as THREE from 'three';
import type { FieldPack } from '../data/terrainLoader';
import { buildVertexColors } from './terrainMaterial';

/**
 * 把数值场烘焙成一张网格。
 * 高度先按默认夸张写一次，之后 setExag 只改 Y 坐标 + 重算法线，不重建几何。
 */
export interface TerrainGeometryResult {
  geometry: THREE.BufferGeometry;
  setExag(ex: number): void;
}

export function buildTerrainGeometry(pack: FieldPack, exag: number, isWorld: boolean): TerrainGeometryResult {
  const { GW, GH } = pack;
  const proj = pack.proj;
  const N = GW * GH;

  const pos = new Float32Array(N * 3);
  const uv = new Float32Array(N * 2);
  const aTier = new Float32Array(N);
  const aW = new Float32Array(N);
  const aLon = new Float32Array(N);
  const aElev = new Float32Array(N);
  const { color, edge } = buildVertexColors(pack);

  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const n = j * GW + i;
      const k3 = n * 3;
      pos[k3] = (i / (GW - 1) - 0.5) * proj.WX;
      pos[k3 + 1] = pack.elevW[n] * exag * proj.V0;
      pos[k3 + 2] = (j / (GH - 1) - 0.5) * proj.WZ;
      aTier[n] = pack.tierA[n];
      aW[n] = pack.landW[n];
      // 全球底图不参与「自东向西点亮」的开场动画，直接给满
      aLon[n] = isWorld ? 1 : i / (GW - 1);
      aElev[n] = pack.elev[n];
      uv[n * 2] = i / (GW - 1);
      uv[n * 2 + 1] = 1 - j / (GH - 1);
    }
  }

  const idx = new Uint32Array((GW - 1) * (GH - 1) * 6);
  let p = 0;
  for (let j = 0; j < GH - 1; j++) {
    for (let i = 0; i < GW - 1; i++) {
      const a = j * GW + i;
      const b = a + 1;
      const c = a + GW;
      const d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.setAttribute('aTier', new THREE.BufferAttribute(aTier, 1));
  geometry.setAttribute('aW', new THREE.BufferAttribute(aW, 1));
  geometry.setAttribute('aLon', new THREE.BufferAttribute(aLon, 1));
  geometry.setAttribute('aElev', new THREE.BufferAttribute(aElev, 1));
  geometry.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(idx, 1));

  geometry.computeVertexNormals();

  /* 法线平滑：陡崖处相邻三角形法线的水平分量会左右翻转，直接光照会渲染成
     一排明暗相间的竖条纹（「城墙鳍片」）。两次邻域平均可消除，且不影响大尺度坡向。 */
  const smoothNormals = (passes: number) => {
    const attr = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const nrm = attr.array as Float32Array;
    const tmp = new Float32Array(nrm.length);
    for (let pass = 0; pass < passes; pass++) {
      for (let j = 0; j < GH; j++) {
        for (let i = 0; i < GW; i++) {
          const n = (j * GW + i) * 3;
          let x = nrm[n];
          let y = nrm[n + 1];
          let z = nrm[n + 2];
          let c = 1;
          if (i > 0) { x += nrm[n - 3]; y += nrm[n - 2]; z += nrm[n - 1]; c++; }
          if (i < GW - 1) { x += nrm[n + 3]; y += nrm[n + 4]; z += nrm[n + 5]; c++; }
          if (j > 0) { const m = n - GW * 3; x += nrm[m]; y += nrm[m + 1]; z += nrm[m + 2]; c++; }
          if (j < GH - 1) { const m = n + GW * 3; x += nrm[m]; y += nrm[m + 1]; z += nrm[m + 2]; c++; }
          const L = Math.hypot(x, y, z) || 1;
          tmp[n] = x / L;
          tmp[n + 1] = y / L;
          tmp[n + 2] = z / L;
        }
      }
      nrm.set(tmp);
    }
    attr.needsUpdate = true;
  };
  smoothNormals(2);

  const setExag = (ex: number) => {
    const arr = geometry.getAttribute('position').array as Float32Array;
    for (let n = 0; n < N; n++) arr[n * 3 + 1] = pack.elevW[n] * ex * proj.V0;
    geometry.getAttribute('position').needsUpdate = true;
    geometry.computeVertexNormals();
    smoothNormals(2);
    geometry.computeBoundingSphere();
  };

  return { geometry, setExag };
}
