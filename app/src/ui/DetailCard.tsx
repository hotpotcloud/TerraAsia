import { EFFORT_NAME, GRADE_NAME, KIND_NAME } from '../data/poi';
import { useAppStore } from '../state/store';

/**
 * POI 详情卡。
 *
 * 位置固定在左上（顶栏之下），与右侧工作面板左右对称，互不遮挡。
 * 只显示「已知且可靠」的字段 —— 缺字段就整行不渲染，不留「暂无数据」占位，
 * 免得一屏里全是空行。
 */
export function DetailCard() {
  const poi = useAppStore((s) => s.poi);
  const openPoi = useAppStore((s) => s.openPoi);
  const focusOn = useAppStore((s) => s.focusOn);
  if (!poi) return null;

  const rows: [string, React.ReactNode][] = [];
  rows.push(['类别', `${KIND_NAME[poi.kind]} · ${GRADE_NAME[poi.grade]}`]);
  if (poi.elev != null) {
    rows.push([
      '海拔',
      <>
        <b>{poi.elev.toLocaleString()}</b> m
        {poi.elevNote ? <em className="dc-note">（{poi.elevNote}）</em> : null}
      </>,
    ]);
  }
  if (poi.region) rows.push(['位置', poi.region]);
  if (poi.range) rows.push([poi.kind === 'river' ? '水系' : '山系', poi.range]);
  if (poi.season) rows.push(['季节', poi.season]);
  if (poi.effort) rows.push(['强度', `${EFFORT_NAME[poi.effort]}（${poi.effort}/5）`]);

  return (
    <div className="panel detail" role="dialog" aria-label={`${poi.name} 详情`}>
      <div className="dc-head">
        <div className="dc-title">
          <h3>{poi.name}</h3>
          <span className={`dc-badge g${poi.grade}`}>{GRADE_NAME[poi.grade]}</span>
        </div>
        <button className="b x" onClick={() => openPoi(null)} aria-label="关闭详情">
          ×
        </button>
      </div>

      <div className="dc-body">
        <dl className="dc-meta">
          {rows.map(([k, v]) => (
            <div key={k} className="dc-row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          <div className="dc-row">
            <dt>坐标</dt>
            <dd className="dc-coord">
              {poi.lon.toFixed(2)}°E · {poi.lat.toFixed(2)}°N
            </dd>
          </div>
        </dl>

        <p className="dc-desc">{poi.desc}</p>

        {poi.tags?.length ? (
          <div className="dc-tags">
            {poi.tags.map((t) => (
              <span key={t} className="dc-tag">
                {t}
              </span>
            ))}
          </div>
        ) : null}

        <div className="btnrow">
          <button className="b" onClick={() => focusOn(poi.lon, poi.lat)}>
            定位到这里
          </button>
          <button className="b" onClick={() => openPoi(null)}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
