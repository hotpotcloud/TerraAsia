import { create } from 'zustand';

export type ViewMode = 'flat' | 'globe';

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

  layers: Record<LayerKey, boolean>;
  labelGroups: Record<LabelGroupKey, boolean>;

  selected: ProvinceInfo | null;
  step: number;
  autoTour: boolean;
  autoRotate: boolean;
  /** 每次点「重播」自增，场景侧监听它重置开场动画 */
  replayKey: number;
  /** 视角快捷键（亚洲全景 / 聚焦中国 / 当前导览），自增 key 让场景侧感知重复点击 */
  flyKind: 'asia' | 'cn' | 'step';
  flyKey: number;
  sideOpen: boolean;

  setPhase(phase: AppState['phase'], stage?: string): void;
  setStage(stage: string): void;
  setError(error: string): void;

  setViewMode(mode: ViewMode): void;
  setExag(ex: number): void;
  setSun(az: number, el: number): void;
  setShadow(on: boolean): void;
  setAO(on: boolean): void;

  toggleLayer(key: LayerKey): void;
  setLayer(key: LayerKey, on: boolean): void;
  toggleLabelGroup(key: LabelGroupKey): void;
  setLabelGroup(key: LabelGroupKey, on: boolean): void;

  select(info: ProvinceInfo | null): void;
  setStep(step: number): void;
  setAutoTour(on: boolean): void;
  setAutoRotate(on: boolean): void;
  replay(): void;
  fly(kind: 'asia' | 'cn' | 'step'): void;
  setSideOpen(open: boolean): void;
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
  exag: 5,
  sunAz: 315,
  sunEl: 40,
  shadow: true,
  ao: true,

  layers: {
    coast: true,
    prov: false,
    cityDiv: false,
    dash: true,
    tierLine: false,
    river: true,
    rail: false,
    road: false,
  },
  // m 山脉 t 地形区 r 河流水体 c 城市 n 国家名 nf 境外山河 s 山峰景区
  // x=阶梯分界标注（默认关） rl/rd=线路名（默认关，随图层开）
  labelGroups: { m: true, t: true, r: true, c: true, n: true, nf: true, s: true, x: false, rl: false, rd: false },

  selected: null,
  step: 0,
  autoTour: false,
  autoRotate: false,
  replayKey: 0,
  flyKind: 'step',
  flyKey: 0,
  sideOpen: true,

  setPhase: (phase, stage) => set((s) => ({ phase, stage: stage ?? s.stage })),
  setStage: (stage) => set({ stage }),
  setError: (error) => set({ phase: 'error', error }),

  setViewMode: (viewMode) => set({ viewMode }),
  setExag: (exag) => set({ exag }),
  setSun: (sunAz, sunEl) => set({ sunAz, sunEl }),
  setShadow: (shadow) => set({ shadow }),
  setAO: (ao) => set({ ao }),

  toggleLayer: (key) => set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),
  setLayer: (key, on) => set((s) => ({ layers: { ...s.layers, [key]: on } })),
  toggleLabelGroup: (key) => set((s) => ({ labelGroups: { ...s.labelGroups, [key]: !s.labelGroups[key] } })),
  setLabelGroup: (key, on) => set((s) => ({ labelGroups: { ...s.labelGroups, [key]: on } })),

  select: (selected) => set({ selected }),
  setStep: (step) => set({ step }),
  setAutoTour: (autoTour) => set({ autoTour }),
  setAutoRotate: (autoRotate) => set({ autoRotate }),
  replay: () => set((s) => ({ replayKey: s.replayKey + 1, step: 0 })),
  fly: (flyKind) => set((s) => ({ flyKind, flyKey: s.flyKey + 1 })),
  setSideOpen: (sideOpen) => set({ sideOpen }),
}));
