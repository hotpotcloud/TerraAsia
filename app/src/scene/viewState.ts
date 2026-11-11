/**
 * 每帧都在变的视图状态。
 * 刻意不进 zustand：一帧一个 setState 会把 UI 树重渲染几百次。
 * 桥接层写，标注 / 相机 / 图层读，单向流动。
 */
export const viewState = {
  /** 相机到目标的距离（世界单位） */
  camDist: 0,
  /** 相机目标点的纬度（度）：比例尺要按 cos(lat) 折算地面米数 */
  camLat: 0,
  /** 标注分级 0..3 */
  lod: 0,
  /** 开场动画是否结束（结束后才显示标注） */
  revealed: false,
  /** 球面过渡系数（与 GLOBE_U 同步，方便与 React 侧比较） */
  mix: 0,
  /** 省份选中高亮的淡入量 0..1 */
  selAmt: 0,
  /** 沙盘断面侧壁的当前不透明度 0..1（球面过渡时淡出，回归脚本据此判断） */
  wall: 0,
  /** 分块 LOD 的实时统计：已建块数 / 各级块数 / 总顶点数（铭牌与回归脚本读） */
  tilesDone: 0,
  tilesNear: 0,
  tilesMid: 0,
  tilesFar: 0,
  tilesVerts: 0,
};
