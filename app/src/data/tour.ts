import type { FieldPack } from './terrainLoader';
import { EARTH_R } from './globe';

/**
 * 导览讲稿与机位。
 *
 * 相机用「经纬度 + 距离 + 方位角/俯角」描述，不写死世界坐标 ——
 * 重跑数据、改 bbox 之后机位仍然对着同一个地理位置。
 * 机位在运行时按当前数据与夸张系数换算，所以夸张度滑块不会把镜头甩到地下。
 */
export interface Shot {
  name: string;
  text: string;
  dim: [number, number, number];
  glow: number;
  lon: number;
  lat: number;
  dist: number;
  az: number;
  elev: number;
}

export interface CamPose {
  pos: [number, number, number];
  tgt: [number, number, number];
}

export const STEPS: Shot[] = [
  {
    name: '亚洲格局 · 中国在什么位置',
    dim: [1, 1, 1],
    glow: 0,
    lon: 101, lat: 50, dist: 286, az: 0.3, elev: 48,
    text: '先把整个亚洲铺开来看：西起红海与地中海东岸，东到白令海峡，北抵北冰洋，南到印尼群岛。亚洲地势中部最高——青藏高原、帕米尔高原、喜马拉雅山连成一片，号称「世界屋脊」，再向四周逐级降低：往北是西西伯利亚平原，往南是印度河—恒河平原，往东是中国的三级阶梯与环太平洋岛弧。中国位于亚洲东部、太平洋西岸，拥有这块最高高原的绝大部分。图中彩色部分为中国，中国以外的亚洲地区保留真实起伏，但压暗为冷灰底衬。',
  },
  {
    name: '总览 · 中国三级阶梯',
    dim: [1, 1, 1],
    glow: 0,
    lon: 104, lat: 35, dist: 150, az: 0.49, elev: 38,
    text: '把镜头收进中国：中国地势西高东低，呈三级阶梯状分布。开场动画正从东向西逐级「点亮」：第三阶梯（绿色平原）→ 第二阶梯（黄色高原）→ 第一阶梯（青藏高原）。拖拽旋转、滚轮缩放可自由观察；放大后会自动出现省会与城市标注；开启「省级行政区界」后，可直接点击任一省份高亮查看。',
  },
  {
    name: '第一阶梯 · 青藏高原',
    dim: [1, 0.3, 0.42],
    glow: 0,
    lon: 88.8, lat: 34, dist: 62, az: 0.64, elev: 30,
    text: '第一阶梯：青藏高原，平均海拔 4000 米以上，号称「世界屋脊」。喜马拉雅山、昆仑山、祁连山、横断山等巨大山系环绕周边；珠穆朗玛峰 8848.86 米为世界最高峰。高原上雪山连绵、冰川广布，是长江、黄河、澜沧江等大江大河的发源地。',
  },
  {
    name: '第二阶梯 · 高原与盆地',
    dim: [0.35, 1, 0.4],
    glow: 0,
    lon: 101, lat: 38.6, dist: 65, az: 0.71, elev: 32,
    text: '第二阶梯：平均海拔 1000–2000 米，分布着内蒙古高原、黄土高原、云贵高原，以及塔里木盆地、准噶尔盆地、四川盆地；吐鲁番盆地的艾丁湖甚至低于海平面约 154 米。一、二阶梯交界处落差巨大，蕴藏着丰富的水能资源。',
  },
  {
    name: '第三阶梯 · 平原与丘陵',
    dim: [0.35, 0.3, 1],
    glow: 0,
    lon: 116.3, lat: 35, dist: 53, az: 0.97, elev: 29,
    text: '第三阶梯：海拔多在 500 米以下。东北平原、华北平原、长江中下游平原三大平原连片分布，土壤肥沃、人口与城市密集，是我国主要的农业和工业分布区；东南丘陵点缀其间，海岸线漫长，近海岛屿众多。',
  },
  {
    name: '江河东流 · 跨越阶梯',
    dim: [1, 1, 1],
    glow: 1,
    lon: 102, lat: 30, dist: 110, az: 0.26, elev: 40,
    text: '受西高东低的地势控制，长江、黄河、黑龙江等大河自西向东跨越三级阶梯奔流入海，沟通东西交通、孕育中华文明；阶梯交界处落差集中，水能资源特别丰富（如长江三峡、黄河上游梯级电站）。图中光点沿河顺流而下。',
  },
];

export const VIEW_ASIA = { lon: 101, lat: 50, dist: 286, az: 0.3, elev: 48 };
export const VIEW_CN = { lon: 104, lat: 35, dist: 150, az: 0.49, elev: 38 };

/** 经纬度 + 距离 + 方位/俯角 → 世界坐标机位 */
export function camAt(
  pack: FieldPack,
  exag: number,
  lon: number,
  lat: number,
  dist: number,
  az = 0.45,
  elevDeg = 40,
): CamPose {
  const proj = pack.proj;
  const w = proj.lonLatToWorld(lon, lat);
  const y = pack.sampleHeight(w[0], w[1]) * exag * proj.V0;
  const er = (elevDeg * Math.PI) / 180;
  const ce = Math.cos(er);
  return {
    pos: [w[0] + Math.sin(az) * ce * dist, y + Math.sin(er) * dist, w[1] + Math.cos(az) * ce * dist],
    tgt: [w[0], y, w[1]],
  };
}

export function shotAt(pack: FieldPack, exag: number, step: number): CamPose {
  const s = STEPS[((step % STEPS.length) + STEPS.length) % STEPS.length];
  return camAt(pack, exag, s.lon, s.lat, s.dist, s.az, s.elev);
}

/** 地球机位：俯视亚洲上空（经度 100°E、北纬 30° 的法线方向），距离 3R */
export function globeCam(d = EARTH_R * 3.0): CamPose {
  const lo = (100 * Math.PI) / 180;
  const la = (30 * Math.PI) / 180;
  return {
    pos: [
      Math.cos(la) * Math.sin(lo) * d,
      Math.sin(la) * d + EARTH_R * 0.15,
      Math.cos(la) * Math.cos(lo) * d,
    ],
    tgt: [0, 0, 0],
  };
}
