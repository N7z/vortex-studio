import React, { useLayoutEffect, useRef, useState } from 'react';

const PAD = { top: 12, right: 14, bottom: 22, left: 46 };
const HEIGHT = 190;
const GAP = 2;

const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n.toLocaleString());

const dayLabel = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function ticks(max) {
    if (max <= 0) return [0, 1];
    const step = Math.max(1, 10 ** Math.floor(Math.log10(max / 3)));
    const nice = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => max / s <= 4) ?? step * 10;
    const out = [];
    for (let v = 0; v <= max + nice / 2; v += nice) out.push(v);
    return out;
}

function useWidth() {
    const ref = useRef(null);
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, width];
}

export default function Chart({ title, subtitle, data, series, kind = 'line' }) {
    const [ref, width] = useWidth();
    const [hover, setHover] = useState(null);

    const empty = !data.length;
    const stacked = kind === 'bar';
    const totals = data.map((d) => (stacked
        ? series.reduce((sum, s) => sum + (d[s.key] ?? 0), 0)
        : Math.max(...series.map((s) => d[s.key] ?? 0))));
    const scale = ticks(Math.max(1, ...totals));
    const top = scale[scale.length - 1];

    const plotW = Math.max(0, width - PAD.left - PAD.right);
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const y = (v) => PAD.top + plotH - (v / top) * plotH;
    const band = plotW / Math.max(1, data.length);
    const x = (i) => (stacked ? PAD.left + band * (i + 0.5) : PAD.left + (data.length < 2 ? plotW / 2 : (plotW * i) / (data.length - 1)));

    const barW = Math.min(24, Math.max(2, band - 4));
    const at = hover != null ? data[hover] : null;

    const move = (e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - box.left;
        if (!data.length || plotW <= 0) return;
        const i = stacked
            ? Math.floor((px - PAD.left) / band)
            : Math.round(((px - PAD.left) / plotW) * (data.length - 1));
        setHover(Math.min(data.length - 1, Math.max(0, i)));
    };

    return (
        <figure className="chart" ref={ref}>
            <figcaption>
                <span className="chart-title">{title}</span>
                {subtitle && <span className="chart-sub">{subtitle}</span>}
            </figcaption>

            {series.length > 1 && (
                <div className="chart-legend">
                    {series.map((s) => (
                        <span key={s.key}>
                            <i style={{ background: s.color }} />{s.label}
                        </span>
                    ))}
                </div>
            )}

            {empty ? (
                <div className="chart-empty">Nothing recorded yet.</div>
            ) : (
                <div className="chart-plot">
                    <svg
                        width={width} height={HEIGHT} role="img" aria-label={`${title}, ${subtitle ?? ''}`}
                        onMouseMove={move} onMouseLeave={() => setHover(null)}
                    >
                        {scale.map((v) => (
                            <g key={v}>
                                <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)}
                                    stroke={v === 0 ? '#383835' : '#2c2c2a'} strokeWidth="1" />
                                <text x={PAD.left - 8} y={y(v) + 4} className="chart-tick" textAnchor="end">
                                    {compact(v)}
                                </text>
                            </g>
                        ))}

                        {stacked && data.map((d, i) => {
                            let base = 0;
                            return series.map((s) => {
                                const v = d[s.key] ?? 0;
                                const y0 = y(base);
                                base += v;
                                const h = y0 - y(base);
                                if (h <= 0) return null;
                                return (
                                    <rect
                                        key={s.key} x={x(i) - barW / 2} width={barW}
                                        y={y(base)} height={Math.max(1, h - GAP)}
                                        rx="2" fill={s.color}
                                        opacity={hover == null || hover === i ? 1 : 0.45}
                                    />
                                );
                            });
                        })}

                        {!stacked && series.map((s) => (
                            <polyline
                                key={s.key} fill="none" stroke={s.color} strokeWidth="2"
                                strokeLinejoin="round" strokeLinecap="round"
                                points={data.map((d, i) => `${x(i)},${y(d[s.key] ?? 0)}`).join(' ')}
                            />
                        ))}

                        {at && (
                            <g>
                                <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH}
                                    stroke="#898781" strokeWidth="1" />
                                {!stacked && series.map((s) => (
                                    <circle key={s.key} cx={x(hover)} cy={y(at[s.key] ?? 0)} r="4"
                                        fill={s.color} stroke="#14141a" strokeWidth="2" />
                                ))}
                            </g>
                        )}

                        <text x={PAD.left} y={HEIGHT - 6} className="chart-tick">{dayLabel(data[0].day)}</text>
                        <text x={width - PAD.right} y={HEIGHT - 6} className="chart-tick" textAnchor="end">
                            {dayLabel(data[data.length - 1].day)}
                        </text>
                    </svg>

                    {at && (
                        <div
                            className="chart-tip"
                            style={{ left: Math.min(Math.max(x(hover), 60), Math.max(60, width - 60)) }}
                        >
                            <div className="chart-tip-day">{dayLabel(at.day)}</div>
                            {series.map((s) => (
                                <div key={s.key}>
                                    <i style={{ background: s.color }} />
                                    {s.label}<b>{(at[s.key] ?? 0).toLocaleString()}</b>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </figure>
    );
}
