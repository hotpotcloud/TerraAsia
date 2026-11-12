import { useMemo } from 'react';
import { buildProfile } from '../data/profile';
import { useAppStore } from '../state/store';

/**
 * 线路高程剖面板（`docs/10` R03b）。
 *
 * 只做展示，所有数值由 `data/profile.buildProfile` 算好：
 * 横轴是地面里程（球面距离累计），纵轴是真实海拔，与垂直夸张、镜头距离都无关。
 * 断点（数据覆盖范围外）会在曲线上断开，而不是画成 0 —— 不虚构高程是需求里的硬约束。
 */

const W = 520;
const H = 118;
const PAD_L = 38;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 18;

export function ProfilePanel() {
  const profile = useAppStore((s) => s.profile);
  const pick = useAppStore((s) => s.profilePick);
  const cancel = useAppStore((s) => s.cancelProfile);
  const clear = useAppStore((s) => s.clearProfile);

  const res = useMemo(
    () => (profile && profile.b ? buildProfile(profile.a, profile.b) : null),
    [profile],
  );

  /* 取点阶段只给一条提示，不占版面 */
  if (pick > 0) {
    return (
      <div className="pf-hint">
        <span className="pf-dot" />
        {pick === 1 ? '点击地图选择线路起点' : '再点一处选择终点'}
        <button className="pf-x" onClick={cancel} title="退出取点">
          ×
        </button>
      </div>
    );
  }

  if (!res) return null;

  const { samples, totalM, gain, loss, maxE, minE, gaps } = res;
  const spanE = Math.max(1, maxE - minE);
  const xOf = (d: number) => PAD_L + (totalM > 0 ? (d / totalM) * (W - PAD_L - PAD_R) : 0);
  const yOf = (e: number) => PAD_T + (1 - (e - minE) / spanE) * (H - PAD_T - PAD_B);

  /* 按断点切段：一段断点就断开一笔，避免把「没有数据」连成一条直线 */
  const segments: string[] = [];
  let cur: string[] = [];
  for (const s of samples) {
    if (!s.ok) {
      if (cur.length > 1) segments.push(cur.join(' '));
      cur = [];
      continue;
    }
    cur.push(`${cur.length ? 'L' : 'M'}${xOf(s.dist).toFixed(1)},${yOf(s.elev).toFixed(1)}`);
  }
  if (cur.length > 1) segments.push(cur.join(' '));

  const area =
    segments.length === 1
      ? `${segments[0]} L${xOf(samples[samples.length - 1].dist).toFixed(1)},${(H - PAD_B).toFixed(1)} L${xOf(samples[0].dist).toFixed(1)},${(H - PAD_B).toFixed(1)} Z`
      : '';

  const km = (m: number) => (m / 1000).toFixed(m >= 10000 ? 0 : 1);

  return (
    <div className="profile">
      <div className="pf-head">
        <span className="pf-title">线路剖面</span>
        <span className="pf-meta">
          {km(totalM)} km · 爬升 {Math.round(gain)} m · 下降 {Math.round(loss)} m
        </span>
        <button className="pf-x" onClick={clear} title="清除线路">
          ×
        </button>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="pf-svg" role="img" aria-label="线路高程剖面">
        <defs>
          <linearGradient id="pf-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7fc4ff" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#7fc4ff" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* 三条横向参考线：最高 / 中值 / 最低 */}
        {[0, 0.5, 1].map((t) => {
          const e = minE + spanE * (1 - t);
          return (
            <g key={t}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={yOf(e)}
                y2={yOf(e)}
                stroke="#ffffff"
                strokeOpacity={t === 0.5 ? 0.08 : 0.13}
                strokeDasharray={t === 0.5 ? '3 4' : undefined}
              />
              <text x={PAD_L - 6} y={yOf(e) + 3} textAnchor="end" className="pf-ax">
                {Math.round(e)}
              </text>
            </g>
          );
        })}

        {area && <path d={area} fill="url(#pf-fill)" />}
        {segments.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="#8fd0ff" strokeWidth="1.4" strokeLinejoin="round" />
        ))}

        {/* 横轴：起点 / 中点 / 终点（公里） */}
        {[0, 0.5, 1].map((t) => (
          <text
            key={t}
            x={xOf(totalM * t)}
            y={H - 5}
            textAnchor={t === 0 ? 'start' : t === 1 ? 'end' : 'middle'}
            className="pf-ax"
          >
            {t === 0 ? '0' : `${km(totalM * t)} km`}
          </text>
        ))}
      </svg>

      <div className="pf-foot">
        <span>
          最高 <b>{Math.round(maxE)}</b> m · 最低 <b>{Math.round(minE)}</b> m
        </span>
        {gaps > 0 && <span className="pf-gap">数据缺失 {gaps} 处，曲线在此断开</span>}
      </div>
    </div>
  );
}
