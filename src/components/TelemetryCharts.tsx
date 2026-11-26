import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PatientRecord, VitalReading } from "../types/smartcare.ts";

type MetricKey = "heartRate" | "spo2" | "temperatureC" | "anomalyScore";

const METRIC_META: Record<
  MetricKey,
  {
    label: string;
    unit: string;
    color: string;
    fill: string;
    domain: [number | "auto", number | "auto"];
  }
> = {
  heartRate: {
    label: "Heart Rate",
    unit: "BPM",
    color: "#16834A",
    fill: "#D3EBDD",
    domain: [45, 150],
  },
  spo2: {
    label: "Blood Oxygen (SpO₂)",
    unit: "%",
    color: "#116B3A",
    fill: "#EAF6EF",
    domain: [85, 100],
  },
  temperatureC: {
    label: "Temperature",
    unit: "°C",
    color: "#2E9E6B",
    fill: "#D3EBDD",
    domain: [35, 40],
  },
  anomalyScore: {
    label: "Anomaly Score",
    unit: "score",
    color: "#DC2626",
    fill: "#FEE2E2",
    domain: [-0.5, 0.4],
  },
};

export function TelemetryCharts({
  readings,
  patient,
}: {
  readings: VitalReading[];
  patient: PatientRecord;
}) {
  const [metric, setMetric] = useState<MetricKey>("heartRate");

  const chartData = useMemo(
    () =>
      readings.map((r) => ({
        time: new Date(r.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        heartRate: typeof r.heartRate === "number" ? r.heartRate : null,
        spo2: typeof r.spo2 === "number" ? r.spo2 : null,
        temperatureC: typeof r.temperatureC === "number" ? r.temperatureC : null,
        anomalyScore: r.anomalyScore,
        alertLevel: r.alertLevel,
      })),
    [readings]
  );

  const validMetricCount = useMemo(
    () =>
      chartData.filter((d) => typeof d[metric] === "number" && Number.isFinite(d[metric])).length,
    [chartData, metric]
  );

  const meta = METRIC_META[metric];
  const baselineVal =
    metric === "heartRate"
      ? patient.baselineHeartRateMean
      : metric === "spo2"
      ? patient.baselineSpo2Mean
      : metric === "temperatureC"
      ? patient.baselineTempMean
      : 0;

  return (
    <div className="bg-white border border-arova-border rounded-xl p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-arova-text">
            Historical Vital Trends
          </h3>
          <p className="text-xs text-arova-muted mt-0.5">
            {validMetricCount}/{readings.length} valid points · Dashed line indicates personal baseline reference
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-arova-mint border border-arova-border/70 rounded-lg self-start sm:self-auto overflow-x-auto max-w-full">
          {(Object.keys(METRIC_META) as MetricKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setMetric(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                metric === key
                  ? "bg-white text-arova-green-dark font-semibold shadow-sm"
                  : "text-arova-muted hover:text-arova-text"
              }`}
            >
              {METRIC_META[key].label}
            </button>
          ))}
        </div>
      </div>

      {chartData.length === 0 || validMetricCount === 0 ? (
        <div className="h-64 flex items-center justify-center border border-dashed border-arova-border rounded-lg text-sm text-arova-muted px-4 text-center bg-arova-mint/30">
          {chartData.length === 0
            ? "No vital readings recorded yet. Send a simulator or ESP32 packet to visualize trends."
            : `No valid ${meta.label.toLowerCase()} measurements recorded yet (sensor disconnected or model pending).`}
        </div>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DCE9DF" vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 11, fill: "#52685B" }}
                axisLine={{ stroke: "#DCE9DF" }}
                tickLine={false}
              />
              <YAxis
                domain={meta.domain}
                tick={{ fontSize: 11, fill: "#52685B" }}
                axisLine={false}
                tickLine={false}
                width={42}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#FFFFFF",
                  borderColor: "#DCE9DF",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "#26382E",
                }}
                formatter={(val: unknown) => [
                  typeof val === "number" ? `${val} ${meta.unit}` : "Unavailable",
                  meta.label,
                ]}
              />
              {typeof baselineVal === "number" && (
                <ReferenceLine
                  y={baselineVal}
                  stroke="#52685B"
                  strokeDasharray="4 4"
                  label={{
                    value: `Baseline (${baselineVal})`,
                    position: "insideTopRight",
                    fill: "#26382E",
                    fontSize: 11,
                  }}
                />
              )}
              <Area
                type="monotone"
                dataKey={metric}
                stroke={meta.color}
                strokeWidth={2}
                fill={meta.fill}
                fillOpacity={0.55}
                connectNulls={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
