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

/** 网络层错误（fetch 直接 reject，如 Failed to fetch / 连接被重置）才重试，HTTP 状态错不重试 */
const RETRIES = 2;

function isNetError(e: unknown): boolean {
  return e instanceof TypeError;
}

function netHint(url: string): string {
  return (
    `网络请求失败（重试 ${RETRIES} 次仍失败）：${url} —— ` +
    '多半是连接被中间设备重置（大文件 + 低带宽常见），请刷新；反复出现则查本机代理/网关'
  );
}

async function fetchBlob(
  url: string,
  what: string,
  onChunk?: (delta: number) => void,
): Promise<Blob> {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${what}加载失败 ${url} (HTTP ${res.status})`);
      // 拿不到流（或不需要进度）就直接 blob()
      if (!onChunk || !res.body) return await res.blob();

      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        onChunk(value.length);
      }
      return new Blob(chunks as BlobPart[], { type: res.headers.get('content-type') ?? '' });
    } catch (e) {
      if (!isNetError(e)) throw e; // HTTP 状态错误直接报，不重试
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw new Error(netHint(url));
}

async function fetchJson<T>(url: string, what: string): Promise<T> {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${what}加载失败 ${url} (HTTP ${res.status})`);
      return (await res.json()) as T;
    } catch (e) {
      if (!isNetError(e)) throw e;
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw new Error(netHint(url));
}

async function decodeImage(blob: Blob, GW: number, GH: number, what: string): Promise<Uint8ClampedArray> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    throw new Error(`${what}解码失败：此浏览器不支持该图片格式（数据是无损 WebP，需要 2020 年后的浏览器）`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = GW;
  canvas.height = GH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建 2D 画布上下文');
  ctx.drawImage(bmp, 0, 0, GW, GH);
  const data = ctx.getImageData(0, 0, GW, GH).data;
  bmp.close();
  if (data.length < GW * GH * 4) throw new Error(`${what}解码尺寸不对（期望 ${GW}×${GH}）`);
  return data;
}

/** 高程场轻度平滑：抑制采样噪声在垂直夸张下产生的「碎面」。
 *  多遍 3×3 高斯（含对角）——横断山等 z6 网格 + 8.5× 夸张下，相邻格高差可达
 *  数百米，几何表面每个格就是一个「疙瘩」，放大近景呈现密集坑洼/麻面。单次
 *  4 邻域抹不掉，这里用多遍含对角的核把高频格点噪声磨平，保留山脊走向。 */
function smoothField(src: Float32Array, GW: number, GH: number): Float32Array {
  const N = GW * GH;
  const tmp = new Float32Array(N);
  const out = new Float32Array(N);
  const PASSES = 2;
  for (let pass = 0; pass < PASSES; pass++) {
    const cur = pass === 0 ? src : out;
    const dst = pass === 0 ? out : tmp;
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        const n = j * GW + i;
        let sum = cur[n] * 4;
        let c = 4;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (di === 0 && dj === 0) continue;
            const ni = i + di;
            const nj = j + dj;
            if (ni < 0 || ni >= GW || nj < 0 || nj >= GH) continue;
            const w = di !== 0 && dj !== 0 ? 0.5 : 1;
            sum += cur[nj * GW + ni] * w;
            c += w;
          }
        }
        dst[n] = sum / c;
      }
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
  /** 已下载字节数的增量（用于加载页显示真实进度，不估算百分比） */
  onBytes?: (delta: number) => void;
}

/** 只下载、不解码：网络阶段。两个包可以先并行拉，再按顺序解码 */
export interface RawPack {
  json: TerrainJSON | null;
  meta: Meta;
  png: Blob;
  mask: Blob;
}

/**
 * 拉取一个包的全部字节。元数据、地形图、掩膜三路并发 —— 串行拉的话
 * 3 Mbps 上白白多花一整轮 RTT。
 */
export async function fetchFieldPack(opts: LoadOptions): Promise<RawPack> {
  const metaReq = (async () => {
    const url = opts.jsonUrl ?? opts.metaUrl!;
    return await fetchJson<Meta | TerrainJSON>(url, '数据索引');
  })();

  const [doc, png, mask] = await Promise.all([
    metaReq,
    fetchBlob(opts.pngUrl, '地形纹理', opts.onBytes),
    fetchBlob(opts.maskUrl, '陆地掩膜', opts.onBytes),
  ]);

  if (opts.jsonUrl) {
    const json = doc as TerrainJSON;
    return { json, meta: json.meta, png, mask };
  }
  return { json: null, meta: doc as Meta, png, mask };
}

/** 纯 CPU 阶段：解码 PNG/WebP → 数值场 → GPU 纹理 */
export async function decodeFieldPack(raw: RawPack, onStage?: (stage: string) => void): Promise<FieldPack> {
  const report = onStage ?? (() => {});
  const { json, meta } = raw;

  const proj = createProjection(meta);
  const { GW, GH } = proj;
  const N = GW * GH;

  report('解码地形纹理');
  const px = await decodeImage(raw.png, GW, GH, '地形纹理');
  report('解码陆地掩膜');
  const maskPx = await decodeImage(raw.mask, GW, GH, '陆地掩膜');

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
    // 平滑强度要与垂直夸张配套：磨太少 + 拉太高，高原边缘会出现锯齿「城墙」；
    // 磨太多又会把真实山脊磨秃。0.64→0.80：横断山的格点高频噪声比想象中强，
    // 只取 64% 平滑值时坑洼麻面仍在，提到 80% 才能把「疙瘩」磨成连续坡面。
    for (let n = 0; n < N; n++) if (elevW[n] !== 0) elevW[n] = es[n] * 0.80 + elevW[n] * 0.20;
  }

  report('计算天空遮蔽');
  const aoTex = buildAO(elevW, proj);

  // 高度纹理：供着色器做太阳方向的自遮挡步进；单位米（未夸张），由 uExag 换算
  // 必须用双线性：最近邻会让 sunShadow 每一步采到离散像素的跳变高程，高海拔山地
  // 放大后形成密集的「花斑/麻面」明暗突变（坑洼感）。双线性把步进路径平滑化。
  const heightTex = new THREE.DataTexture(elevW, GW, GH, THREE.RedFormat, THREE.FloatType);
  heightTex.minFilter = THREE.LinearFilter;
  heightTex.magFilter = THREE.LinearFilter;
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
