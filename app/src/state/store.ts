import { create } from 'zustand';
import { DEFAULT_EXAG } from '../data/projection';
import type { Poi } from '../data/poi';

export type ViewMode = 'flat' | 'globe';

/**
 * 地形派生显示模式（户外决策用）。
 *   none   —— 自然分层设色
 *   slope  —— 坡度分级（真实水平距离，非屏幕像素）
 *   aspect —— 坡向方位（下坡方向，按罗盘配色）
 *   contour—— 加密等高线（100 m 间隔）
 */
export type DerivedMode = 'none' | 'slope' | 'aspect' | 'contour';

/** 工作面板：一次只处理一类任务。null = 面板关闭。 */
export type PanelKind = 'layers' | 'view' | 'tour' | 'province';

export type LayerKey =
  | 'coast'
  | 'prov'
  | 'cityDiv'
  | 'dash'
  | 'tierLine'
  | 'river'
  | 'rail'
  | 'road';

export type LabelGroupKey = 'm' | 't' | 'r' | 'c' | 'n' | 'nf' | 's' | 'x' | 'rl' | 'rd';

export interface ProvinceInfo {
  name: string;
  avg: number;
  tier: number;
}

/**
 * 只放「离散 UI 状态」。每帧都在变的东西（uGlobe 过渡系数、LOD、相机）不进 store，
 * 否则一帧一个 setState，React 会把整棵 UI 树重渲染几百次。
 */
interface AppState {
  phase: 'loading' | 'ready' | 'error';
  stage: string;
  error: string | null;

  viewMode: ViewMode;
  exag: number;
  sunAz: number;
  sunEl: number;
  shadow: boolean;
  ao: boolean;
  /**
   * 沙盘模式：只留亚洲精块，四周立断面侧壁，作为一件实体模型摆在暗色台面上。
   * 关掉则退回「地形图」形态——全球底图在场，图幅边缘渐隐到背景。
   * 球面模式不受影响，始终渲染完整星球。
   */
  sandbox: boolean;

  /**
   * 分块 LOD：亚洲精块按 4×4 切成瓦片，近处的块用 2 倍密度（插值补细节），
   * 远处的块降采样。关掉退回单张网格（`docs/11 §6.1` 的回退路径）。
   */
  tiles: boolean;

  layers: Record<LayerKey, boolean>;
  labelGroups: Record<LabelGroupKey, boolean>;

  /** 地形派生显示：坡度 / 坡向 / 等高线，null 语义交给 'none' */
  derived: DerivedMode;

  /** 当前打开的 POI 详情卡；null = 关闭 */
  poi: Poi | null;
  /** 最近一次「定位到」的坐标，focusKey 自增让场景侧感知重复点击 */
  focus: { lon: number; lat: number } | null;
  focusKey: number;

  selected: ProvinceInfo | null;
  step: number;
  autoTour: boolean;
  autoRotate: boolean;
  /** 每次点「重播」自增，场景侧监听它重置开场动画 */
  replayKey: number;
  /** 视角快捷键（亚洲全景 / 聚焦中国 / 当前导览），自增 key 让场景侧感知重复点击 */
  flyKind: 'asia' | 'cn' | 'step';
  flyKey: number;
  /** 当前打开的工作面板；null = 关闭。替代旧的 sideOpen 布尔。 */
  activePanel: PanelKind | null;
  /** 进入省份详情前所在的面板，返回时恢复 */
  prevPanel: PanelKind | null;

  setPhase(phase: AppState['phase'], stage?: string): void;
  setStage(stage: string): void;
  setError(error: string): void;

  setViewMode(mode: ViewMode): void;
  setExag(ex: number): void;
  setSun(az: number, el: number): void;
  setShadow(on: boolean): void;
  setAO(on: boolean): void;
  setSandbox(on: boolean): void;
  setTiles(on: boolean): void;

  toggleLayer(key: LayerKey): void;
  setLayer(key: LayerKey, on: boolean): void;
  toggleLabelGroup(key: LabelGroupKey): void;
  setLabelGroup(key: LabelGroupKey, on: boolean): void;

  setDerived(mode: DerivedMode): void;
  /** 打开 POI 详情；传 null 关闭 */
  openPoi(poi: Poi | null): void;
  /** 把镜头定位到某个坐标（POI 详情卡的「定位」按钮） */
  focusOn(lon: number, lat: number): void;

  select(info: ProvinceInfo | null): void;
  setStep(step: number): void;
  setAutoTour(on: boolean): void;
  setAutoRotate(on: boolean): void;
  replay(): void;
  fly(kind: 'asia' | 'cn' | 'step'): void;
  /** 打开/切换工作面板；再点同一入口则关闭 */
  openPanel(kind: PanelKind): void;
  /** 关闭面板（不取消省份选择、不关图层、不停导览） */
  closePanel(): void;
  /** 打开省份详情，记录当前面板以便返回 */
  openProvince(): void;
  /** 从省份详情返回之前的面板 */
  backFromProvince(): void;
}

export const useAppStore = create<AppState>((set) => ({
  phase: 'loading',
  stage: '准备中',
  error: null,

  viewMode: 'flat',
  /* 默认夸张比 8.5 → 5：z6 网格（11.2 km/格）在横断山等岭谷地貌下相邻格高差
     可达数百米，8.5× 把这些真实起伏放大成密集的「疙瘩/坑洼麻面」，近景尤其
     明显、像渲染坏了一样。降到 5× 仍能清晰展示中国三级阶梯（分层设色不受夸张
     影响），但把格点级高频起伏压回自然的坡面，用户仍可用滑块在 1–16× 间调整。 */
  exag: DEFAULT_EXAG,
  sunAz: 315,
  sunEl: 40,
  shadow: true,
  ao: true,
  sandbox: true,
  tiles: true,

  layers: {
    coast: true,
    prov: false,
    /* 地级市界默认可见：用户反馈「城市划分没有」——旧实现要选中省份才构建，
       等于把地级市这一层藏在了两级菜单后面。市界全量构建（446 个单元、
       约 4.5 万点）成本可控，默认打开才能一眼看出省内的城市格局。 */
    cityDiv: true,
    dash: true,
    tierLine: false,
    river: true,
    rail: false,
    road: false,
  },
  // m 山脉 t 地形区 r 河流水体 c 城市 n 国家名 nf 境外山河 s 山峰景区
  // x=阶梯分界标注（默认关） rl/rd=线路名（默认关，随图层开）
  labelGroups: { m: true, t: true, r: true, c: true, n: true, nf: true, s: true, x: false, rl: false, rd: false },

  derived: 'none',
  poi: null,
  focus: null,
  focusKey: 0,

  selected: null,
  step: 0,
  autoTour: false,
  autoRotate: false,
  replayKey: 0,
  flyKind: 'step',
  flyKey: 0,
  activePanel: null,
  prevPanel: null,

  setPhase: (phase, stage) => set((s) => ({ phase, stage: stage ?? s.stage })),
  setStage: (stage) => set({ stage }),
  setError: (error) => set({ phase: 'error', error }),

  setViewMode: (viewMode) => set({ viewMode }),
  setExag: (exag) => set({ exag }),
  setSun: (sunAz, sunEl) => set({ sunAz, sunEl }),
  setShadow: (shadow) => set({ shadow }),
  setAO: (ao) => set({ ao }),
  setSandbox: (sandbox) => set({ sandbox }),
  setTiles: (tiles) => set({ tiles }),

  toggleLayer: (key) => set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),
  setLayer: (key, on) => set((s) => ({ layers: { ...s.layers, [key]: on } })),
  toggleLabelGroup: (key) => set((s) => ({ labelGroups: { ...s.labelGroups, [key]: !s.labelGroups[key] } })),
  setLabelGroup: (key, on) => set((s) => ({ labelGroups: { ...s.labelGroups, [key]: on } })),

  setDerived: (derived) => set({ derived }),
  openPoi: (poi) => set({ poi }),
  focusOn: (lon, lat) => set((s) => ({ focus: { lon, lat }, focusKey: s.focusKey + 1 })),

  select: (selected) =>
    set((s) => ({
      selected,
      // 自动导览中主动点选省份，先暂停导览再显示详情
      autoTour: selected ? false : s.autoTour,
      // 点选省份时自动切到省份详情面板（记录当前面板以便返回）；取消选择则返回原面板
      ...(selected
        ? { prevPanel: s.activePanel, activePanel: 'province' as PanelKind }
        : { activePanel: s.prevPanel ?? s.activePanel, prevPanel: null }),
    })),
  setStep: (step) => set({ step }),
  setAutoTour: (autoTour) => set({ autoTour }),
  setAutoRotate: (autoRotate) => set({ autoRotate }),
  replay: () => set((s) => ({ replayKey: s.replayKey + 1, step: 0 })),
  fly: (flyKind) => set((s) => ({ flyKind, flyKey: s.flyKey + 1 })),
  openPanel: (kind) => set((s) => ({ activePanel: s.activePanel === kind ? null : kind })),
  closePanel: () => set({ activePanel: null }),
  openProvince: () => set((s) => ({ prevPanel: s.activePanel, activePanel: 'province' })),
  backFromProvince: () => set((s) => ({ activePanel: s.prevPanel ?? null, prevPanel: null })),
}));
