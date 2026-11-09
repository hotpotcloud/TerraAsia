/**
 * 每帧都在变的视图状态。
 * 刻意不进 zustand：一帧一个 setState 会把 UI 树重渲染几百次。
 * 桥接层写，标注 / 相机 / 图层读，单向流动。
 */
export const viewState = {
  /** 相机到目标的距离（世界单位） */
  camDist: 0,
  /** 标注分级 0..3 */
  lod: 0,
  /** 开场动画是否结束（结束后才显示标注） */
  revealed: false,
  /** 球面过渡系数（与 GLOBE_U 同步，方便与 React 侧比较） */
  mix: 0,
  /** 省份选中高亮的淡入量 0..1 */
  selAmt: 0,
};
