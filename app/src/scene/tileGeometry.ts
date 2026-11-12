import * as THREE from 'three';
import type { FieldPack } from '../data/terrainLoader';
import { colorOf } from './terrainMaterial';

/**
 * 分块 LOD 的瓦片几何。
 *
 * 为什么不再用一张整幅网格：亚洲精块 1536×1493 ≈ 229 万顶点，一旦想「近处再细一点」，
 * 唯一办法是把整幅加密到 4 倍（918 万顶点，几何内存 ≈ 500 MB），而画面里真正看得清的
 * 只有视点附近那几块。分块之后，密度可以按块给：近处的块补密度，远处的块降采样，
 * 总顶点数反而下降。
 *
 * 三个刻意的设计：
 * 1. **法线解析求解，不用 computeVertexNormals**。分块后每块自己算顶点法线，块边界
 *    处相邻顶点缺失，法线会往块内偏，拼起来是一张能看出格子的亮度网格。改用中心差分
 *    从整幅高度场直接求法线，同一处无论属于哪块、哪级密度，法线完全相同 → 无缝。
 * 2. **裙边（skirt）**。相邻块密度不同时，细块的边缘会在粗块的两个顶点之间鼓起来，
 *    形成裂缝。粗块/细块一律往下拉一圈裙边，鼓出来的部分被裙边挡住。
 * 3. **采样位置按网格坐标算，不按顶点序号**。这样换密度只会改变采样间隔，不会让瓦片
 *    边界平移，拼接处天然对齐。
 */

export interface TileRect {
  i0: number;
  i1: number;
  j0: number;
  j1: number;
}

export interface TileGeometry {
  geometry: THREE.BufferGeometry;
  setExag(ex: number): void;
  /** 顶点数，用于统计 */
  verts: number;
}

/** 裙边下垂量（世界单位）。取 0.8：足以盖住一级密度差的鼓包，又不至于在近距离
 *  从侧面看出来是一条厚边。 */
const SKIRT = 0.8;

/** 法线中心差分的半径（网格格数）。取 2 格 ≈ 22 km，与旧版 3 遍 3×3 邻域平滑的
 *  等效半径接近，能压住 z6 网格的高频法线噪声，又不会把山脊走向抹平。 */
const NORMAL_R = 2;

/** 双线性采样一个数值场（gx/gy 为网格坐标，可为小数） */
function bilinear(arr: ArrayLike<number>, GW: number, GH: number, gx: number, gy: number): number {
  const x = Math.min(GW - 1, Math.max(0, gx));
  const y = Math.min(GH - 1, Math.max(0, gy));
  const i0 = Math.min(GW - 2, Math.floor(x));
  const j0 = Math.min(GH - 2, Math.floor(y));
  const fx = x - i0;
  const fy = y - j0;
  const a = arr[j0 * GW + i0];
  const b = arr[j0 * GW + i0 + 1];
  const c = arr[(j0 + 1) * GW + i0];
  const d = arr[(j0 + 1) * GW + i0 + 1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

/**
 * 构建一块瓦片。
 * `nx/ny` 是该块的采样点数：等于 span+1 时与源数据同密度，小于则是降采样，
 * 大于则是插值补密（近处补细节块）。
 */
export function buildTileGeometry(
  pack: FieldPack,
  exag: number,
  rect: TileRect,
  nx: number,
  ny: number,
): TileGeometry {
  const { GW, GH, proj } = pack;
  const spanI = rect.i1 - rect.i0;
  const spanJ = rect.j1 - rect.j0;
  const cx = proj.WX / (GW - 1);
  const cz = proj.WZ / (GH - 1);
  const up = exag * proj.V0;

  const n = nx * ny;
  const border = 2 * nx + 2 * (ny - 2); // 一圈边界的顶点数（四角不重复计）
  const total = n + border;

  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const aTier = new Float32Array(total);
  const aW = new Float32Array(total);
  const aLon = new Float32Array(total);
  const aElev = new Float32Array(total);
  const aEdge = new Float32Array(total);
  const aOverlay = new Float32Array(total);

  /* 梯度缓存：法线只取决于「坡度 × 夸张比」，而坡度本身与夸张无关。
     建块时用整幅高度场把 ∂h/∂x、∂h/∂z（1× 夸张下）算一遍存下来，之后拖「地形起伏」
     滑块只需乘一个系数再归一化 —— 从每顶点 4 次双线性采样降到 2 乘 1 开方，
     滑块才拖得动（否则 16 块 × 230 万顶点 ≈ 900 万次纹理采样，一拖就卡住）。 */
  const ghx = new Float32Array(n);
  const ghz = new Float32Array(n);
  const src = new Uint32Array(total); // 顶点 → 网格序号（裙边顶点复用其源顶点）

  for (let jj = 0; jj < ny; jj++) {
    const gy = rect.j0 + (spanJ * jj) / (ny - 1);
    for (let ii = 0; ii < nx; ii++) {
      const gx = rect.i0 + (spanI * ii) / (nx - 1);
      const k = jj * nx + ii;
      src[k] = k;

      const elev = bilinear(pack.elevW, GW, GH, gx, gy);
      pos[k * 3] = (gx / (GW - 1) - 0.5) * proj.WX;
      pos[k * 3 + 1] = elev * up;
      pos[k * 3 + 2] = (gy / (GH - 1) - 0.5) * proj.WZ;

      /* 配色走「先把四项地表数值插值、再求色」，密度变化时同一点的颜色不变 */
      const s = {
        elev: bilinear(pack.elev, GW, GH, gx, gy),
        landW: bilinear(pack.landW, GW, GH, gx, gy),
        depth: bilinear(pack.depth, GW, GH, gx, gy),
        cnW: bilinear(pack.cnW, GW, GH, gx, gy),
      };
      const c = colorOf(pack, s, gx, gy);
      col[k * 3] = c.rgb[0];
      col[k * 3 + 1] = c.rgb[1];
      col[k * 3 + 2] = c.rgb[2];
      aEdge[k] = c.edge;

      aTier[k] = bilinear(pack.tierA, GW, GH, gx, gy);
      aW[k] = s.landW;
      aElev[k] = s.elev;
      /* 开场「自西向东点亮」按图幅全局位置算，分块后仍要连续 */
      aLon[k] = gx / (GW - 1);
      uv[k * 2] = gx / (GW - 1);
      uv[k * 2 + 1] = 1 - gy / (GH - 1);
    }
  }

  /* 裙边：把一圈边界顶点复制一份沉下去，与原件之间拉一圈竖直的带 */
  let v = n;
  const skirtOf: number[] = [];
  const ring: number[] = [];
  for (let ii = 0; ii < nx; ii++) ring.push(ii);
  for (let jj = 1; jj < ny; jj++) ring.push(jj * nx + nx - 1);
  for (let ii = nx - 2; ii >= 0; ii--) ring.push((ny - 1) * nx + ii);
  for (let jj = ny - 2; jj >= 1; jj--) ring.push(jj * nx);

  for (const k of ring) {
    skirtOf.push(v);
    src[v] = k;
    pos[v * 3] = pos[k * 3];
    pos[v * 3 + 1] = pos[k * 3 + 1];
    pos[v * 3 + 2] = pos[k * 3 + 2];
    col[v * 3] = col[k * 3];
    col[v * 3 + 1] = col[k * 3 + 1];
    col[v * 3 + 2] = col[k * 3 + 2];
    aEdge[v] = aEdge[k];
    aTier[v] = aTier[k];
    aW[v] = aW[k];
    aLon[v] = aLon[k];
    aElev[v] = aElev[k];
    uv[v * 2] = uv[k * 2];
    uv[v * 2 + 1] = uv[k * 2 + 1];
    v++;
  }

  /* 索引：主网格 + 裙边。主网格绕序与旧版一致（a c b / b c d） */
  const idx: number[] = [];
  for (let jj = 0; jj < ny - 1; jj++) {
    for (let ii = 0; ii < nx - 1; ii++) {
      const a = jj * nx + ii;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  for (let r = 0; r < ring.length; r++) {
    const r2 = (r + 1) % ring.length;
    const a = ring[r];
    const b = ring[r2];
    const a2 = skirtOf[r];
    const b2 = skirtOf[r2];
    idx.push(a, a2, b, b, a2, b2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('aTier', new THREE.BufferAttribute(aTier, 1));
  geometry.setAttribute('aW', new THREE.BufferAttribute(aW, 1));
  geometry.setAttribute('aLon', new THREE.BufferAttribute(aLon, 1));
  geometry.setAttribute('aElev', new THREE.BufferAttribute(aElev, 1));
  geometry.setAttribute('aEdge', new THREE.BufferAttribute(aEdge, 1));
  geometry.setAttribute('aOverlay', new THREE.BufferAttribute(aOverlay, 1));
  geometry.setIndex(idx);

  /* 坡度（1× 夸张下的 ∂h/∂x、∂h/∂z）：从整幅高度场取中心差分，与分块方式、
     采样密度都无关 —— 同一处无论属于哪块、哪一级密度，梯度完全相同，拼接无缝。 */
  {
    const dx = 2 * NORMAL_R * cx;
    const dz = 2 * NORMAL_R * cz;
    const v0 = proj.V0;
    for (let k = 0; k < n; k++) {
      const r = src[k];
      const gx = rect.i0 + (spanI * (r % nx)) / (nx - 1);
      const gy = rect.j0 + (spanJ * Math.floor(r / nx)) / (ny - 1);
      const hE = bilinear(pack.elevW, GW, GH, gx + NORMAL_R, gy) * v0;
      const hW = bilinear(pack.elevW, GW, GH, gx - NORMAL_R, gy) * v0;
      const hS = bilinear(pack.elevW, GW, GH, gx, gy + NORMAL_R) * v0;
      const hN = bilinear(pack.elevW, GW, GH, gx, gy - NORMAL_R) * v0;
      ghx[k] = (hE - hW) / dx;
      ghz[k] = (hS - hN) / dz;
    }
  }

  /** 法线 = normalize(-ex·∂h/∂x, 1, -ex·∂h/∂z)，只随夸张比线性变化 */
  const writeNormals = (ex: number) => {
    for (let k = 0; k < n; k++) {
      const nxv = -ghx[k] * ex;
      const nzv = -ghz[k] * ex;
      const L = Math.hypot(nxv, 1, nzv) || 1;
      nrm[k * 3] = nxv / L;
      nrm[k * 3 + 1] = 1 / L;
      nrm[k * 3 + 2] = nzv / L;
    }
    /* 裙边顶点沿用源顶点的法线，侧壁才不会突然变亮 */
    for (let r = 0; r < ring.length; r++) {
      const k = src[skirtOf[r]];
      const d = skirtOf[r];
      nrm[d * 3] = nrm[k * 3];
      nrm[d * 3 + 1] = nrm[k * 3 + 1];
      nrm[d * 3 + 2] = nrm[k * 3 + 2];
    }
    geometry.getAttribute('normal').needsUpdate = true;
  };

  const writeHeights = (ex: number) => {
    const yUp = ex * proj.V0;
    for (let k = 0; k < n; k++) pos[k * 3 + 1] = aElev[k] * yUp;
    for (let r = 0; r < ring.length; r++) {
      const k = ring[r];
      const d = skirtOf[r];
      pos[d * 3 + 1] = pos[k * 3 + 1] - SKIRT;
    }
    geometry.getAttribute('position').needsUpdate = true;
  };

  writeHeights(exag);
  writeNormals(exag);
  geometry.computeBoundingSphere();

  return {
    geometry,
    verts: total,
    setExag(ex: number) {
      writeHeights(ex);
      writeNormals(ex);
      geometry.computeBoundingSphere();
    },
  };
}
