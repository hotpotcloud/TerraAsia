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

/**
 * 精细层的覆盖范围（经纬度）。全球粗底图在该范围内让位给精细层，
 * 避免两套分辨率不同的高程网格共面穿插（放大近景会呈现「泡状孤岛 + 灰斑沟谷」）。
 */
export interface OverlayBounds {
  lon0: number;
  lon1: number;
  lat0: number;
  lat1: number;
  /** 让位区内缩（度）：留一圈粗底图垫在精细层边缘下方，避免边界空洞 */
  inset?: number;
}

export function buildTerrainGeometry(
  pack: FieldPack,
  exag: number,
  isWorld: boolean,
  overlay?: OverlayBounds,
): TerrainGeometryResult {
  const { GW, GH } = pack;
  const proj = pack.proj;
  const N = GW * GH;

  const pos = new Float32Array(N * 3);
  const uv = new Float32Array(N * 2);
  const aTier = new Float32Array(N);
  const aW = new Float32Array(N);
  const aLon = new Float32Array(N);
  const aElev = new Float32Array(N);
  /** 仅全球底图使用：1 = 落在精细层覆盖区内，本层应让位（片元 discard） */
  const aOverlay = new Float32Array(N);
  const inset = overlay?.inset ?? 0.5;
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
      if (isWorld && overlay) {
        // 用底图自己的网格反解经纬度，与精细层矩形比较；内缩一圈留作边界过渡。
        const [lon, lat] = proj.gridToLonLat(i, j);
        aOverlay[n] =
          lon >= overlay.lon0 + inset && lon <= overlay.lon1 - inset &&
          lat >= overlay.lat0 + inset && lat <= overlay.lat1 - inset ? 1 : 0;
      }
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
  geometry.setAttribute('aOverlay', new THREE.BufferAttribute(aOverlay, 1));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(idx, 1));

  geometry.computeVertexNormals();

  /* 法线平滑：陡崖处相邻三角形法线的水平分量会左右翻转，直接光照会渲染成
     一排明暗相间的竖条纹（「城墙鳍片」）。这里用 8 邻域（含对角）+ 中心高权重
     做多次平均：横断山脉等 z6 网格 + 8.5× 夸张下，相邻格高差可达数百米，法线在
     每个格上剧烈抖动，光照下就是密集的「花斑/麻面」——只有把邻域半径和迭代次数
     都提上去，才能把高频法线噪声压平，而大尺度坡向（山脊走向）不受影响。 */
  const smoothNormals = (passes: number) => {
    const attr = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const nrm = attr.array as Float32Array;
    const tmp = new Float32Array(nrm.length);
    for (let pass = 0; pass < passes; pass++) {
      for (let j = 0; j < GH; j++) {
        for (let i = 0; i < GW; i++) {
          const n = (j * GW + i) * 3;
          // 中心权重 4：让平滑收敛到邻域平均，而不是把法线糊成一团
          let x = nrm[n] * 4;
          let y = nrm[n + 1] * 4;
          let z = nrm[n + 2] * 4;
          let c = 4;
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
              if (di === 0 && dj === 0) continue;
              const ni = i + di;
              const nj = j + dj;
              if (ni < 0 || ni >= GW || nj < 0 || nj >= GH) continue;
              const m = (nj * GW + ni) * 3;
              // 对角距离更远，权重减半
              const w = di !== 0 && dj !== 0 ? 0.5 : 1;
              x += nrm[m] * w;
              y += nrm[m + 1] * w;
              z += nrm[m + 2] * w;
              c += w;
            }
          }
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
  smoothNormals(3);

  const setExag = (ex: number) => {
    const arr = geometry.getAttribute('position').array as Float32Array;
    for (let n = 0; n < N; n++) arr[n * 3 + 1] = pack.elevW[n] * ex * proj.V0;
    geometry.getAttribute('position').needsUpdate = true;
    geometry.computeVertexNormals();
    smoothNormals(3);
    geometry.computeBoundingSphere();
  };

  return { geometry, setExag };
}
