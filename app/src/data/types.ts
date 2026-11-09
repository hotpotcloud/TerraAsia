/** 数据层的类型契约。改这里的字段就必须同步改 src/pipeline 的产出，两边是一份契约。 */

/** 墨卡托裁剪参数：整幅世界图有多少像素、从哪里裁的、裁了多大 */
export interface MapMeta {
  P: number;
  txOff: number;
  tyOff: number;
  cx0: number;
  cy0: number;
  cw: number;
  ch: number;
}

export interface Meta {
  lon0: number;
  lon1: number;
  lat0: number;
  lat1: number;
  gw: number;
  gh: number;
  min_elev: number;
  max_elev: number;
  map: MapMeta;
}

export interface ProvinceRec {
  name: string;
  avg: number;
  tier: number;
  /** 每个环是 [lon, lat] 的数组，可能多环（飞地/岛屿） */
  rings: [number, number][][];
}

/** [name, lon, lat, rings] */
export type CityRow = [string, number, number, [number, number][][] | null];

export interface TerrainJSON {
  meta: Meta;
  coast: [number, number][][];
  markers: [number, number][];
  provinces: ProvinceRec[];
  dash: [number, number][][];
  rivers: Record<string, [number, number][][]>;
  tierlines: Record<string, [number, number][]>;
  /** 省名 → 地级市行；由 prep_cities.py 产出，可能缺省 */
  cities?: Record<string, CityRow[]>;
}

export type LonLat = [number, number];
export type Ring = [number, number][];
