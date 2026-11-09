import { useAppStore } from '../state/store';

export function TitleCard() {
  return (
    <div className="panel title-card">
      <span className="badge">产 品 原 型</span>
      <h1>亚洲三维地形沙盘</h1>
      <div className="sub">中国为主体 · 三级阶梯 · 山川江河 · 全球地形</div>
    </div>
  );
}

export function SideToggle() {
  const open = useAppStore((s) => s.sideOpen);
  const setOpen = useAppStore((s) => s.setSideOpen);
  return (
    <button className="b side-toggle" onClick={() => setOpen(!open)}>
      {open ? '× 收起面板' : '☰ 展开面板'}
    </button>
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

export function Hint({ mode }: { mode: string }) {
  return (
    <div className="hint">
      {mode === 'globe'
        ? '左键拖动转动星球 · 滚轮缩放 · 点击国家或省份'
        : '左键旋转 · 滚轮缩放 · 右键平移 · 点击省份高亮'}
    </div>
  );
}

export function Foot() {
  return (
    <div className="foot">
      范围：东经 25°–180°、南北纬 85° 以内全球地形。<b>中国为主体</b>：境内按三级阶梯分层设色并标注山川江河，
      中国以外的地区保留真实地形但去饱和压暗为底衬，只为交代「中国在哪里、周围是什么」。
      <br />
      数据与合规：中国国界/省级行政区划（含台湾省、香港·澳门特别行政区、南海诸岛）— 阿里云 DataV GeoAtlas；
      十段线 — GMT 中文社区；高程 — SRTM/GDEM（Terrarium，含海底地形）。垂直方向已夸张、横向为真实比例。
      <b>中国以外地区的国界并未绘制</b>，仅以地形与国名示意；正式发布须替换为带审图号（如 GS(2024)0650）的标准地图数据并履行送审程序。
    </div>
  );
}

export function LoadingScreen({ stage, error }: { stage: string; error: string | null }) {
  return (
    <div className="loading">
      {error ? (
        <div className="err">初始化失败：{error}</div>
      ) : (
        <>
          <div className="spin" />
          <div className="txt">正在构建三维地形… {stage}</div>
        </>
      )}
    </div>
  );
}
