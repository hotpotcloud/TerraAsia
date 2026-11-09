import { STEPS } from '../data/tour';
import { PROV_CAPITAL, TIER_NAME } from '../data/static';
import { useAppStore, type LabelGroupKey, type LayerKey } from '../state/store';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="sec">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

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
      {children}
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

const LABEL_KEYS: [LabelGroupKey, string][] = [
  ['m', '山脉标注'],
  ['t', '地形区标注'],
  ['r', '河流·水体标注'],
  ['c', '城市标注（放大分级）'],
  ['s', '山峰·景区标注（近景）'],
  ['n', '亚洲国家名（弱化）'],
  ['nf', '境外山脉·河流名（弱化）'],
];

const LAYER_KEYS: [LayerKey, string][] = [
  ['prov', '省级行政区界（可点选）'],
  ['cityDiv', '地级市界（点选省份后）'],
  ['rail', '铁路干线（可标注线名）'],
  ['road', '公路干线（G 字头高速）'],
  ['tierLine', '阶梯分界线（教学辅助）'],
  ['dash', '十段线'],
  ['river', '河流（流动光效）'],
];

export function SidePanel() {
  const s = useAppStore();

  return (
    <div className="panel side">
      {s.selected && (
        <Section title="已选省级行政区">
          <div className="prov-name">{s.selected.name}</div>
          <div className="prov-meta">
            平均海拔 <b>{s.selected.avg.toLocaleString()} m</b>
            <br />
            主体属 <b>{TIER_NAME[s.selected.tier] ?? '—'}</b>
            {PROV_CAPITAL[s.selected.name] ? (
              <>
                <br />
                省会/首府 <b>{PROV_CAPITAL[s.selected.name]}</b>
              </>
            ) : null}
          </div>
          <div className="btnrow">
            <button className="b" onClick={() => s.select(null)}>
              取消选择
            </button>
          </div>
        </Section>
      )}

      <Section title="阶梯导览">
        <div className="step-name">
          {s.step + 1} / {STEPS.length} · {STEPS[s.step % STEPS.length].name}
        </div>
        <div className="step-text">{STEPS[s.step % STEPS.length].text}</div>
        <div className="btnrow">
          <button className="b" onClick={() => s.setStep((s.step - 1 + STEPS.length) % STEPS.length)}>
            上一步
          </button>
          <button className="b" onClick={() => s.setStep((s.step + 1) % STEPS.length)}>
            下一步
          </button>
          <button className={`b ${s.autoTour ? 'on' : ''}`} onClick={() => s.setAutoTour(!s.autoTour)}>
            自动演示
          </button>
          <button className="b" onClick={() => s.replay()}>
            重播开场
          </button>
        </div>
      </Section>

      <Section title="图例">
        <div className="legend">
          <div className="sw" style={{ background: '#8a5a3c' }} />
          <div>第一阶梯 · 平均海拔 4000m+（青藏高原）</div>
          <div className="sw" style={{ background: '#c2a25b' }} />
          <div>第二阶梯 · 1000–2000m（高原·盆地）</div>
          <div className="sw" style={{ background: '#4a9152' }} />
          <div>第三阶梯 · 500m 以下（平原·丘陵）</div>
          <div className="sw" style={{ background: '#e8ebee' }} />
          <div>雪线 · 5000m 以上（雪山冰川）</div>
          <div className="sw" style={{ background: '#43494d' }} />
          <div>中国以外地区 · 去饱和冷灰（保留真实起伏，退为底衬）</div>
          <div className="sw" style={{ background: '#dfe8f2' }} />
          <div>铁路干线（银白，标注线名）</div>
          <div className="sw" style={{ background: '#ff6b8a' }} />
          <div>公路干线（玫瑰红，G 字头国家高速）</div>
        </div>
      </Section>

      <Section title="视图模式">
        <div className="btnrow seg" style={{ marginTop: 0 }}>
          <button
            className={`b ${s.viewMode === 'flat' ? 'on' : ''}`}
            style={{ flex: 1 }}
            onClick={() => s.setViewMode('flat')}
          >
            平面沙盘
          </button>
          <button
            className={`b ${s.viewMode === 'globe' ? 'on' : ''}`}
            style={{ flex: 1 }}
            onClick={() => s.setViewMode('globe')}
          >
            地球 3D
          </button>
        </div>
        <div className="view-hint">
          {s.viewMode === 'globe'
            ? '地球模式：左键拖动转动星球，滚轮缩放。全球地形以真实起伏贴在球面上，中国所在的亚洲部分叠加高精度网格。'
            : '平面模式适合读阶梯与省界；地球模式可自由转动整颗星球，看中国在亚洲、亚洲在世界的位置。'}
        </div>
      </Section>

      <Section title="视角">
        <div className="btnrow">
          <button className="b" onClick={() => s.fly('asia')}>
            亚洲全景
          </button>
          <button className="b" onClick={() => s.fly('cn')}>
            聚焦中国
          </button>
          <button className="b" onClick={() => s.fly('step')}>
            当前导览
          </button>
        </div>
      </Section>

      <Section title="光照">
        <Slider label="太阳方位" value={s.sunAz} min={0} max={360} step={1} suffix="°" onChange={(v) => s.setSun(v, s.sunEl)} />
        <Slider label="太阳高度" value={s.sunEl} min={6} max={82} step={1} suffix="°" onChange={(v) => s.setSun(s.sunAz, v)} />
        <Check checked={s.shadow} onChange={s.setShadow}>
          地形投射阴影（自遮挡）
        </Check>
        <Check checked={s.ao} onChange={s.setAO}>
          天空遮蔽（沟谷压暗）
        </Check>
      </Section>

      <Section title="控制">
        <Slider label="立体感" value={s.exag} min={1} max={16} step={0.5} suffix="×" onChange={s.setExag} />
        <Check checked={s.autoRotate} onChange={s.setAutoRotate}>
          自动旋转
        </Check>
        {LABEL_KEYS.map(([k, label]) => (
          <Check key={k} checked={s.labelGroups[k]} onChange={() => s.toggleLabelGroup(k)}>
            {label}
          </Check>
        ))}
        {LAYER_KEYS.map(([k, label]) => (
          <Check key={k} checked={s.layers[k]} onChange={() => s.toggleLayer(k)}>
            {label}
          </Check>
        ))}
        <Check checked={s.layers.coast} onChange={() => s.toggleLayer('coast')}>
          海岸 · 国界线
        </Check>
      </Section>
    </div>
  );
}
