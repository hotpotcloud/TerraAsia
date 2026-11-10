import { useState } from 'react';
import { STEPS } from '../data/tour';
import { PROV_CAPITAL, TIER_NAME } from '../data/static';
import { useAppStore, type LabelGroupKey, type LayerKey } from '../state/store';

/* ---------- 基础控件 ---------- */
function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="chk">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="ctl">
      <label>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="val">
        {value}
        {suffix}
      </span>
    </div>
  );
}

/* ---------- 分组折叠容器 ---------- */
function Group({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details className="grp" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="grp-body">{children}</div>
    </details>
  );
}

/* ---------- 图层面板 ---------- */
const ADMIN_LAYERS: [LayerKey, string][] = [
  ['coast', '海岸 · 国界'],
  ['prov', '省界（可点选）'],
  ['cityDiv', '地级市界'],
  ['dash', '十段线'],
];
const NATURE_LAYERS: [LayerKey, string][] = [
  ['river', '河流'],
  ['tierLine', '阶梯分界'],
];
const TRANSIT_LAYERS: [LayerKey, string][] = [
  ['rail', '铁路'],
  ['road', '公路'],
];
const LABEL_KEYS: [LabelGroupKey, string][] = [
  ['m', '山脉'],
  ['t', '地形区'],
  ['r', '河流·水体'],
  ['c', '城市'],
  ['s', '山峰·景区'],
  ['n', '亚洲国家名'],
  ['nf', '境外山河'],
];

function LayersPanel() {
  const s = useAppStore();
  return (
    <>
      <Group title="行政区划">
        {ADMIN_LAYERS.map(([k, label]) => {
          const cityDivHint = k === 'cityDiv' && !s.selected;
          return (
            <Check key={k} checked={s.layers[k]} onChange={(v) => s.setLayer(k, v)}>
              {label}
              {cityDivHint ? <em className="hint-inline">选中省份后可查看</em> : ''}
            </Check>
          );
        })}
      </Group>
      <Group title="自然地理">
        {NATURE_LAYERS.map(([k, label]) => (
          <Check key={k} checked={s.layers[k]} onChange={(v) => s.setLayer(k, v)}>
            {label}
          </Check>
        ))}
      </Group>
      <Group title="交通" defaultOpen={false}>
        {TRANSIT_LAYERS.map(([k, label]) => (
          <Check key={k} checked={s.layers[k]} onChange={(v) => s.setLayer(k, v)}>
            {label}
          </Check>
        ))}
      </Group>
      <Group title="地名标注" defaultOpen={false}>
        {LABEL_KEYS.map(([k, label]) => (
          <Check key={k} checked={s.labelGroups[k]} onChange={() => s.toggleLabelGroup(k)}>
            {label}
          </Check>
        ))}
      </Group>
    </>
  );
}

/* ---------- 画面面板 ---------- */
function ViewPanel() {
  const s = useAppStore();
  return (
    <>
      <Group title="常用">
        <Slider label="地形起伏" value={s.exag} min={1} max={16} step={0.5} suffix="×" onChange={s.setExag} />
        <p className="note">数值越大，山体高低越明显；横向为真实比例，纵向已放大以便读地形。</p>
      </Group>
      <Group title="光照与阴影" defaultOpen={false}>
        <Slider label="太阳方位" value={s.sunAz} min={0} max={360} step={1} suffix="°" onChange={(v) => s.setSun(v, s.sunEl)} />
        <Slider label="太阳高度" value={s.sunEl} min={6} max={82} step={1} suffix="°" onChange={(v) => s.setSun(s.sunAz, v)} />
        <Check checked={s.shadow} onChange={s.setShadow}>
          地形阴影
        </Check>
        <Check checked={s.ao} onChange={s.setAO}>
          环境遮蔽
        </Check>
      </Group>
      <Group title="运动" defaultOpen={false}>
        <Check checked={s.autoRotate} onChange={s.setAutoRotate}>
          {s.autoRotate ? '停止旋转' : '自动旋转'}
        </Check>
      </Group>
    </>
  );
}

/* ---------- 导览面板 ---------- */
function TourPanel() {
  const s = useAppStore();
  const cur = STEPS[s.step % STEPS.length];
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <div className="step-name">
        {s.step + 1} / {STEPS.length} · {cur.name}
      </div>
      <p className="step-summary">{cur.text.slice(0, 80)}…</p>
      <div className="btnrow">
        <button className="b" onClick={() => s.setStep((s.step - 1 + STEPS.length) % STEPS.length)}>
          上一段
        </button>
        <button className="b" onClick={() => s.setStep((s.step + 1) % STEPS.length)}>
          下一段
        </button>
        <button className={`b ${s.autoTour ? 'on' : ''}`} onClick={() => s.setAutoTour(!s.autoTour)}>
          {s.autoTour ? '暂停' : '播放'}
        </button>
      </div>
      <div className="btnrow">
        <button className="b" onClick={() => setExpanded(!expanded)}>
          {expanded ? '收起讲解' : '展开讲解'}
        </button>
        <button className="b" onClick={() => s.replay()}>
          重播开场
        </button>
      </div>
      {expanded && <div className="step-text">{cur.text}</div>}
    </>
  );
}

/* ---------- 省份详情面板 ---------- */
function ProvincePanel() {
  const s = useAppStore();
  if (!s.selected) return <p className="note">未选择省份，点击地图上的省份即可查看详情。</p>;
  return (
    <>
      <div className="prov-name">{s.selected.name}</div>
      <div className="prov-meta">
        平均海拔 <b>{s.selected.avg.toLocaleString()} m</b>
        <br />
        主体属 <b>{TIER_NAME[s.selected.tier] ?? '暂无数据'}</b>
        {PROV_CAPITAL[s.selected.name] ? (
          <>
            <br />
            省会/首府 <b>{PROV_CAPITAL[s.selected.name]}</b>
          </>
        ) : null}
      </div>
      <div className="btnrow">
        <button className="b" onClick={() => s.backFromProvince()}>
          返回
        </button>
        <button className="b" onClick={() => s.select(null)}>
          取消选择
        </button>
      </div>
    </>
  );
}

/* ---------- 共享工作面板容器 ---------- */
export function WorkPanel() {
  const activePanel = useAppStore((s) => s.activePanel);
  const closePanel = useAppStore((s) => s.closePanel);
  if (!activePanel) return null;

  const title = { layers: '图层', view: '画面', tour: '导览', province: '省份详情' }[activePanel];

  return (
    <div className="panel work" role="dialog" aria-label={title}>
      <div className="work-head">
        <h3>{title}</h3>
        <button className="b x" onClick={closePanel} aria-label="关闭面板">
          ×
        </button>
      </div>
      <div className="work-body">
        {activePanel === 'layers' && <LayersPanel />}
        {activePanel === 'view' && <ViewPanel />}
        {activePanel === 'tour' && <TourPanel />}
        {activePanel === 'province' && <ProvincePanel />}
      </div>
    </div>
  );
}
