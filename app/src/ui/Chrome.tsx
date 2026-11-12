import { useEffect, useRef } from 'react';
import { U_PER_DEG } from '../data/projection';
import { CAM_FOV } from '../scene/camera';
import { viewState } from '../scene/viewState';
import { useAppStore, type PanelKind } from '../state/store';

export function LoadingScreen({
  stage,
  error,
  mb = 0,
  pct = 0,
}: {
  stage: string;
  error: string | null;
  mb?: number;
  pct?: number;
}) {
  return (
    <div className="loading">
      {error ? (
        <div className="err">初始化失败：{error}</div>
      ) : (
        <>
          <div className="spin" />
          <div className="txt">
            正在构建三维地形… {stage}
            {mb > 0 && <span className="bytes"> · {mb.toFixed(1)} MB</span>}
          </div>
          {/* 下载进度条：分母来自各文件 Content-Length 之和，分子是真实已下载字节 */}
          {pct > 0 && (
            <div className="bar" aria-label={`已加载 ${pct}%`}>
              <div className="fill" style={{ width: `${pct}%` }} />
              <span className="pct">{pct}%</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * 顶栏：左侧短标题，右侧统一操作入口（视图切换、范围、工具）。
 * 不再展示产品原型徽标和长副标题——那些信息下沉到「数据与说明」展开区。
 */
export function TopBar() {
  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const activePanel = useAppStore((s) => s.activePanel);
  const openPanel = useAppStore((s) => s.openPanel);
  const fly = useAppStore((s) => s.fly);
  const autoTour = useAppStore((s) => s.autoTour);
  const profilePick = useAppStore((s) => s.profilePick);
  const startProfile = useAppStore((s) => s.startProfile);
  const cancelProfile = useAppStore((s) => s.cancelProfile);

  const tool: { kind: PanelKind; label: string }[] = [
    { kind: 'layers', label: '图层' },
    { kind: 'view', label: '画面' },
    { kind: 'tour', label: '导览' },
  ];

  return (
    <div className="topbar">
      <div className="brand">亚洲三维地形沙盘</div>
      <div className="tb-right">
        {/* 视图切换：显示当前选中项 */}
        <div className="tb-seg">
          <button className={`tb ${viewMode === 'flat' ? 'on' : ''}`} onClick={() => setViewMode('flat')}>
            平面
          </button>
          <button className={`tb ${viewMode === 'globe' ? 'on' : ''}`} onClick={() => setViewMode('globe')}>
            地球
          </button>
        </div>

        {/* 范围选择：统一菜单 */}
        <div className="tb-seg">
          <button className="tb" onClick={() => fly('asia')} title="亚洲全景">
            全景
          </button>
          <button className="tb" onClick={() => fly('cn')} title="聚焦中国">
            中国
          </button>
          <button className="tb" onClick={() => fly('step')} title="当前导览机位">
            导览位
          </button>
        </div>

        {/* 剖面：点两下画一条线，读出距离与海拔 */}
        <div className="tb-seg">
          <button
            className={`tb ${profilePick ? 'on' : ''}`}
            onClick={() => (profilePick ? cancelProfile() : startProfile())}
            title="在地图上点两点，读出线路高程剖面"
          >
            {profilePick ? '取点中…' : '剖面'}
          </button>
        </div>

        {/* 工具入口：图层 / 画面 / 导览 */}
        <div className="tb-seg">
          {tool.map((t) => (
            <button
              key={t.kind}
              className={`tb ${activePanel === t.kind ? 'on' : ''}`}
              onClick={() => openPanel(t.kind)}
            >
              {t.kind === 'tour' && autoTour ? '⏸ ' : ''}
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Compass({ innerRef }: { innerRef: React.MutableRefObject<HTMLDivElement | null> }) {
  const mode = useAppStore((s) => s.viewMode);
  if (mode === 'globe') return null;
  return (
    <div className="compass">
      <div className="n" ref={innerRef} />
    </div>
  );
}

export function Hint({ mode }: { mode: string }) {  return (
    <div className="hint">
      {mode === 'globe'
        ? '左键拖动转动星球 · 滚轮缩放 · 点击国家或省份'
        : '左键旋转 · 滚轮缩放 · 右键平移 · 点击省份高亮'}
    </div>
  );
}

/**
 * 右下角紧凑来源入口：默认只显示一句用途提示 + 「数据与说明」展开完整来源。
 * 完整来源与发布限制必须保留，但不再常驻整段长文。
 */
export function Foot() {
  return (
    <details className="foot">
      <summary>
        原型 · 非测绘用途
        <span className="foot-more">数据与说明</span>
      </summary>
      <div className="foot-body">
        范围：东经 25°–180°、南北纬 85° 以内全球地形。<b>中国为主体</b>：境内按三级阶梯分层设色并标注山川江河，
        中国以外的地区保留真实地形但去饱和压暗为底衬，只为交代「中国在哪里、周围是什么」。
        <br />
        数据与合规：中国国界/省级行政区划（含台湾省、香港·澳门特别行政区、南海诸岛）— 阿里云 DataV GeoAtlas；
        十段线 — GMT 中文社区；高程 — SRTM/GDEM（Terrarium，含海底地形）。垂直方向已夸张、横向为真实比例。
        <b>中国以外地区的国界并未绘制</b>，仅以地形与国名示意；正式发布须替换为带审图号（如 GS(2024)0650）的标准地图数据并履行送审程序。
      </div>
    </details>
  );
}

/** 坡度分级色带：与片元着色器的阈值逐条对应，改一边必须改另一边 */
const SLOPE_STOPS: [string, string][] = [
  ['#266151', '<0.5°'],
  ['#458c57', '0.5–1°'],
  ['#b8c25c', '1–2°'],
  ['#e0943d', '2–4°'],
  ['#d14a38', '4–6°'],
  ['#94265c', '6°+'],
];

/** 坡向色环：北→东→南→西→北（下坡方向，北为 0° 顺时针） */
const ASPECT_GRADIENT =
  'linear-gradient(90deg,#ff5a5a,#ffe45a,#5aff8c,#5ae4ff,#5a7bff,#ff5ae4,#ff5a5a)';

/**
 * 派生图图例。
 *
 * 没有图例的专题图等于没做：色块不标阈值，用户只能看出「有深有浅」，
 * 读不出「这段坡大概多少度」。图例贴在底部居中，不占左右面板的位置。
 */
export function DerivedLegend() {
  const derived = useAppStore((s) => s.derived);
  if (derived === 'none') return null;

  return (
    <div className="legend" aria-label="图例">
      {derived === 'slope' && (
        <>
          <div className="lg-title">区域坡度 · 10 km 基线</div>
          <div className="lg-stops">
            {SLOPE_STOPS.map(([c, t]) => (
              <span key={t} className="lg-stop">
                <i style={{ background: c }} />
                {t}
              </span>
            ))}
          </div>
          <div className="lg-foot">1° ≈ 每公里升降 17 m</div>
        </>
      )}
      {derived === 'aspect' && (
        <>
          <div className="lg-title">下坡坡向</div>
          <div className="lg-ramp" style={{ background: ASPECT_GRADIENT }} />
          <div className="lg-axis">
            <span>北</span>
            <span>东</span>
            <span>南</span>
            <span>西</span>
            <span>北</span>
          </div>
        </>
      )}
      {derived === 'contour' && (
        <>
          <div className="lg-title">等高线</div>
          <div className="lg-contour">
            <span>
              <i className="thin" />
              500 m
            </span>
            <span>
              <i className="thick" />
              1000 m
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- 沙盘铭牌与比例尺 ---------------- */

/** 比例尺可选的整数刻度（米）。只取 1/2/5 序列，读起来不用换算 */
const NICE_M = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];

/**
 * 铭牌 + 比例尺。
 *
 * 沙盘是「有比例」的东西——没有比例尺，它就只是个三维模型。这里的换算不能用
 * 相机距离直接乘常数：世界单位是按经度定的（1° = 1.965 单位），而 1° 经度的地面
 * 长度随纬度按 cos(lat) 收缩，漠河与曾母暗沙差 2.3 倍。纬度由桥接层每帧写进
 * viewState，这里只做换算与画线。
 *
 * 用 rAF 直接改 DOM 宽度，不走 zustand：每帧一次 setState 会把整棵 UI 树重渲染。
 */
export function Plate() {
  const exag = useAppStore((s) => s.exag);
  const viewMode = useAppStore((s) => s.viewMode);
  const barRef = useRef<HTMLDivElement | null>(null);
  const numRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const bar = barRef.current;
      const num = numRef.current;
      if (!bar || !num) return;
      const H = window.innerHeight || 1;
      /* 目标平面上一个像素对应多少世界单位 → 再换成地面米数。
         半视角必须用相机真实 FOV（CAM_FOV / 2），写死一个偏小的角度会让
         刻度标称只有实际地面距离的一半 —— 沙盘的比例尺错了就只是模型。 */
      const worldPerPx = (2 * viewState.camDist * Math.tan(((CAM_FOV / 2) * Math.PI) / 180)) / H;
      const mPerWorld = (111320 * Math.cos((viewState.camLat * Math.PI) / 180)) / U_PER_DEG;
      const mPerPx = Math.max(worldPerPx * mPerWorld, 1e-6);
      // 取一个让线长落在 60~140 px 之间的整数刻度
      let pick = NICE_M[0];
      for (const n of NICE_M) if (n / mPerPx <= 140) pick = n;
      const px = Math.max(28, Math.min(140, pick / mPerPx));
      bar.style.width = `${px.toFixed(0)}px`;
      const text = pick >= 1000 ? `${pick / 1000} km` : `${pick} m`;
      if (num.textContent !== text) num.textContent = text;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (viewMode === 'globe') return null;

  return (
    <div className="plate">
      <span className="pl-title">亚洲三维地形沙盘</span>
      <span className="pl-sep" />
      <span className="pl-meta">垂直夸张 {exag}×</span>
      <span className="pl-sep" />
      <span className="pl-scale">
        <span className="pl-barwrap">
          <span className="pl-bar" ref={barRef} />
        </span>
        <span className="pl-num" ref={numRef}>
          —
        </span>
      </span>
    </div>
  );
}
