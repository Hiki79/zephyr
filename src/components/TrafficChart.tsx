import { useMemo } from "react";
import type { TrafficSample } from "../lib/store";
import { splitBytes } from "../lib/format";

const W = 900;
const H = 116;
const PAD_R = 62;
const PAD_T = 10;
const PAD_B = 16;

/**
 * Rolling 60-second view of up and down throughput. The scale is picked from
 * the window's own peak so a quiet line still reads, and every gridline is
 * labelled with a rate the chart actually reaches.
 */
export default function TrafficChart({ samples }: { samples: TrafficSample[] }) {
  const { downPath, upPath, fillPath, ticks, endX, endY } = useMemo(() => {
    const peak = Math.max(...samples.map((s) => Math.max(s.up, s.down)), 1024);
    // Round the ceiling up to a clean power-of-two-ish step so labels stay stable.
    const exp = Math.floor(Math.log(peak) / Math.log(1024));
    const unitSize = Math.pow(1024, exp);
    const step = Math.max(1, Math.ceil(peak / unitSize / 2)) * unitSize;
    const max = step * 2;

    const x = (i: number) => (i * (W - PAD_R)) / (samples.length - 1);
    const y = (v: number) => PAD_T + (H - PAD_T - PAD_B) * (1 - Math.min(v, max) / max);

    const line = (pick: (s: TrafficSample) => number) =>
      samples.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(pick(s)).toFixed(1)}`).join(" ");

    const downPath = line((s) => s.down);
    const upPath = line((s) => s.up);
    const fillPath = `${downPath} L${x(samples.length - 1).toFixed(1)} ${y(0).toFixed(1)} L${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`;

    const ticks = [0, step, max].map((v) => {
      const [value, unit] = splitBytes(v);
      return { y: y(v), label: v === 0 ? "0" : `${value} ${unit}/s` };
    });

    return {
      downPath,
      upPath,
      fillPath,
      ticks,
      endX: x(samples.length - 1),
      endY: y(samples[samples.length - 1]?.down ?? 0),
    };
  }, [samples]);

  return (
    <svg className="hero-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="最近 60 秒流量">
      <defs>
        <linearGradient id="trafficFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((tick) => (
        <g key={tick.label}>
          <line
            x1="0"
            x2={W - PAD_R}
            y1={tick.y}
            y2={tick.y}
            stroke="rgba(255,255,255,0.22)"
            strokeWidth="1"
          />
          <text x={W - PAD_R + 9} y={tick.y + 3.5}>
            {tick.label}
          </text>
        </g>
      ))}
      <path d={fillPath} fill="url(#trafficFill)" />
      <path d={upPath} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.4" strokeLinejoin="round" />
      <path d={downPath} fill="none" stroke="#ffffff" strokeWidth="1.9" strokeLinejoin="round" />
      <circle cx={endX} cy={endY} r="3.4" fill="#ffffff" stroke="#3157f4" strokeWidth="1.8" />
    </svg>
  );
}
