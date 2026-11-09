import * as THREE from 'three';
import { V0, createProjection, type Projection } from './projection';
import type { Meta, TerrainJSON } from './types';
import { smoothstep } from './projection';

/**
 * 地形数据：PNG 解码 → 高程 / 掩膜 / 阶梯字段 → 平滑 → 天空遮蔽 → GPU 纹理。
 * 这一层只做「把编码过的 PNG 变成可用的数值场」，不碰任何渲染对象。
 *
 * 肤色编码解码约定（由 src/pipeline 写入）：
 *   R,G = 16 位高程（米，含海底负高程，偏移 +300）
 *   B   = 中国境内 × 阶梯档位 85/170/255；中国以外陆地 0；海洋水深 0..255
 *   A   = 陆地掩膜（已拆到独立 PNG）
 * 于是「B≥60 且是陆地」⟺ 中国境内，一个字节同时编码了阶梯与归属。
 * 全球底图不写阶梯，B 全是水深，于是自动落进「境外冷灰」分支 —— 这正是想要的。
 */
export interface FieldPack {
  json: TerrainJSON | null;
  meta: Meta;
  proj: Projection;
  GW: number;
  GH: number;
  N: number;
  elev: Float32Array;
  elevW: Float32Array;
  landW: Float32Array;
  tierA: Float32Array;
  cnA: Float32Array;
  cnW: Float32Array;
  depth: Float32Array;
  aoTex: THREE.DataTexture;
  heightTex: THREE.DataTexture;
  /** 双线性采样显示高程（世界坐标，米） */
  sampleHeight(x: number, z: number): number;
}

async function decodePng(url: string, GW: number, GH: number): Promise<Uint8ClampedArray> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`地形纹理加载失败 ${url} (${res.status})`);
  const bmp = await createImageBitmap(await res.blob());
  const canvas = document.createElement('canvas');
  canvas.width = GW;
  canvas.height = GH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建 2D 画布上下文');
  ctx.drawImage(bmp, 0, 0, GW, GH);
  const data = ctx.getImageData(0, 0, GW, GH).data;
  bmp.close();
  return data;
}

/** 高程场轻度平滑：抑制采样噪声在垂直夸张下产生的「碎面」 */
function smoothField(src: Float32Array, GW: number, GH: number): Float32Array {
  const N = GW * GH;
  const tmp = new Float32Array(N);
  const out = new Float32Array(N);
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const n = j * GW + i;
      tmp[n] = src[n] * 0.5 + (src[i > 0 ? n - 1 : n] + src[i < GW - 1 ? n + 1 : n]) * 0.25;
    }
  }
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const n = j * GW + i;
      out[n] = tmp[n] * 0.5 + (tmp[j > 0 ? n - GW : n] + tmp[j < GH - 1 ? n + GW : n]) * 0.25;
    }
  }
  return out;
}

/**
 * 天空遮蔽（AO）预计算。
 * 与太阳方位无关，只取决于「四周地形挡住多少天空」，所以加载时算一次即可。
 * 全分辨率逐点投射太慢，按 1/4 分辨率采样，着色器里双线性上采样。
 */
function buildAO(elevW: Float32Array, proj: Projection): THREE.DataTexture {
  const { GW, GH, WX } = proj;
  const DIV = 4;
  const AOW = Math.ceil(GW / DIV);
  const AOH = Math.ceil(GH / DIV);
  const data = new Uint8Array(AOW * AOH);
  const REF_EX = 8.5;
  const pxW = WX / (GW - 1);
  const STEPS = 26;
  const DIRS = 8;
  const dirs: [number, number][] = [];
  for (let d = 0; d < DIRS; d++) {
    const a = (d / DIRS) * Math.PI * 2;
    dirs.push([Math.cos(a), Math.sin(a)]);
  }
  const hAt = (i: number, j: number) =>
    i < 0 || j < 0 || i >= GW || j >= GH ? 0 : Math.max(0, elevW[j * GW + i]);

  for (let jj = 0; jj < AOH; jj++) {
    for (let ii = 0; ii < AOW; ii++) {
      const i0 = Math.min(GW - 1, ii * DIV);
      const j0 = Math.min(GH - 1, jj * DIV);
      const h0 = hAt(i0, j0);
      let occ = 0;
      for (let d = 0; d < DIRS; d++) {
        let tanMax = 0;
        for (let s = 1; s <= STEPS; s++) {
          const r = s * DIV; // 以全分辨率像素为单位的距离
          const dh = hAt(Math.round(i0 + dirs[d][0] * r), Math.round(j0 + dirs[d][1] * r)) - h0;
          if (dh > 0) {
            const t = (dh * REF_EX * V0) / (r * pxW); // 该方向的地平线仰角正切
            if (t > tanMax) tanMax = t;
          }
        }
        occ += Math.min(1, tanMax / 0.9);
      }
      // 遮蔽上限：再狠沟谷会糊成黑块，起伏反而看不清
      const v = 1 - (occ / DIRS) * 0.66;
      data[jj * AOW + ii] = Math.round(Math.max(0, Math.min(1, v)) * 255);
    }
  }

  const tex = new THREE.DataTexture(data, AOW, AOH, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export interface LoadOptions {
  /** 有 json 就是完整图层包（亚洲），只有 meta 就是纯底图（世界） */
  jsonUrl?: string;
  metaUrl?: string;
  pngUrl: string;
  maskUrl: string;
  onStage?: (stage: string) => void;
}

export async function loadFieldPack(opts: LoadOptions): Promise<FieldPack> {
  const report = opts.onStage ?? (() => {});
  report('读取元数据');
  let json: TerrainJSON | null = null;
  let meta: Meta;
  if (opts.jsonUrl) {
    const res = await fetch(opts.jsonUrl);
    if (!res.ok) throw new Error(`数据索引加载失败 ${opts.jsonUrl} (${res.status})`);
    json = (await res.json()) as TerrainJSON;
    meta = json.meta;
  } else {
    const res = await fetch(opts.metaUrl!);
    if (!res.ok) throw new Error(`元数据加载失败 (${res.status})`);
    meta = (await res.json()) as Meta;
  }

  const proj = createProjection(meta);
  const { GW, GH } = proj;
  const N = GW * GH;

  report('解码地形纹理');
  const px = await decodePng(opts.pngUrl, GW, GH);
  report('解码陆地掩膜');
  const maskPx = await decodePng(opts.maskUrl, GW, GH);

  const elev = new Float32Array(N);
  const landW = new Float32Array(N);
  const tierA = new Float32Array(N);
  const cnA = new Float32Array(N);
  const cnW = new Float32Array(N);
  const depth = new Float32Array(N);
  const elevW = new Float32Array(N);

  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const k = (j * GW + i) * 4;
      const n = j * GW + i;
      const w = smoothstep(0.3, 0.7, maskPx[k] / 255);
      const b = px[k + 2];
      elev[n] = px[k] * 256 + px[k + 1] - 300;
      landW[n] = w;
      if (w > 0.5) {
        const isCN = b >= 60;
        cnA[n] = isCN ? 1 : 0;
        tierA[n] = isCN ? Math.max(1, Math.min(3, Math.round(b / 85))) : 4;
        depth[n] = 0;
      } else {
        cnA[n] = 0;
        tierA[n] = 0;
        depth[n] = b / 255;
      }
    }
  }

  for (let n = 0; n < N; n++) {
    const w = landW[n];
    elevW[n] = w > 0.5 ? elev[n] * Math.max(0.5, w) : 0;
    cnW[n] = w > 0.5 ? cnA[n] : 0;
  }
  {
    const es = smoothField(elevW, GW, GH);
    // 平滑强度要与垂直夸张配套：磨太少 + 拉太高，高原边缘会出现锯齿「城墙」
    for (let n = 0; n < N; n++) if (elevW[n] !== 0) elevW[n] = es[n] * 0.64 + elevW[n] * 0.36;
  }

  report('计算天空遮蔽');
  const aoTex = buildAO(elevW, proj);

  // 高度纹理：供着色器做太阳方向的自遮挡步进；单位米（未夸张），由 uExag 换算
  const heightTex = new THREE.DataTexture(elevW, GW, GH, THREE.RedFormat, THREE.FloatType);
  heightTex.minFilter = THREE.NearestFilter;
  heightTex.magFilter = THREE.NearestFilter;
  heightTex.needsUpdate = true;

  const sampleHeight = (x: number, z: number): number => {
    const gx = (x / proj.WX + 0.5) * (GW - 1);
    const gy = (z / proj.WZ + 0.5) * (GH - 1);
    const i0 = Math.max(0, Math.min(GW - 2, Math.floor(gx)));
    const j0 = Math.max(0, Math.min(GH - 2, Math.floor(gy)));
    const fx = gx - i0;
    const fy = gy - j0;
    const e = (i: number, j: number) => elevW[j * GW + i];
    return (
      e(i0, j0) * (1 - fx) * (1 - fy) +
      e(i0 + 1, j0) * fx * (1 - fy) +
      e(i0, j0 + 1) * (1 - fx) * fy +
      e(i0 + 1, j0 + 1) * fx * fy
    );
  };

  return {
    json,
    meta,
    proj,
    GW,
    GH,
    N,
    elev,
    elevW,
    landW,
    tierA,
    cnA,
    cnW,
    depth,
    aoTex,
    heightTex,
    sampleHeight,
  };
}
