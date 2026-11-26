import { useMemo } from "react";
import { Activity, AlertTriangle, Info, Thermometer, Waves } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  AvailableModalities,
  DatasetProvenanceSummary,
  PlaybackFrameResult,
} from "../types/smartcare.ts";

function formatOffsetLabel(ms: number): string {
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec.toFixed(totalSec < 10 ? 1 : 0)}s`;
  const mins = Math.floor(totalSec / 60);
  const remSec = Math.floor(totalSec % 60);
  return `${mins}:${String(remSec).padStart(2, "0")}`;
}

function formatTempSiteLabel(site: string | null | undefined): string {
  switch (site) {
    case "skin_wrist":
      return "Wrist skin temperature (typically lower than oral/core body temp)";
    case "skin_chest":
      return "Chest skin temperature";
    case "axillary":
      return "Axillary temperature";
    case "core_rectal":
      return "Core rectal temperature";
    case "ambient":
      return "Ambient sensor";
    default:
      return "Sensor site unspecified";
  }
}

interface ModalityListEntry {
  key: keyof AvailableModalities;
  label: string;
}

const MODALITY_LABELS: ModalityListEntry[] = [
  { key: "heartRate", label: "Heart Rate / PPG" },
  { key: "spo2", label: "SpO₂ (Oxygen Saturation)" },
  { key: "ecg", label: "ECG Waveform" },
  { key: "imu", label: "IMU (Accel / Gyro)" },
  { key: "temperatureC", label: "Temperature" },
  { key: "respiratoryRate", label: "Respiratory Rate" },
  { key: "sleepStage", label: "Sleep Stage" },
];

const CLINICAL_TOOLTIP_STYLE = {
  backgroundColor: "#FFFFFF",
  borderColor: "#DCE9DF",
  borderRadius: "8px",
  fontSize: "12px",
  color: "#26382E",
  boxShadow: "0 4px 12px rgba(22, 131, 74, 0.08)",
};

export function DatasetLabCharts({
  provenance,
  recentResults,
  lastResult,
}: {
  provenance: DatasetProvenanceSummary | null;
  recentResults: PlaybackFrameResult[];
  lastResult: PlaybackFrameResult | null;
}) {
  const modalities = provenance?.availableModalities ?? {};

  const timelineData = useMemo(
    () =>
      recentResults.map((r) => ({
        offsetLabel: formatOffsetLabel(r.relativeOffsetMs),
        frameIndex: r.frameIndex,
        heartRate: r.telemetrySnapshot.heartRate,
        spo2: r.telemetrySnapshot.spo2,
        temperatureC: r.telemetrySnapshot.temperatureC,
        respiratoryRateBpm: r.telemetrySnapshot.respiratoryRateBpm,
        accelMagnitude: Number(r.telemetrySnapshot.accelMagnitude.toFixed(3)),
        gyroMagnitude: Number(r.telemetrySnapshot.gyroMagnitude.toFixed(2)),
        anomalyScore: Number(r.analysis.anomalyScore.toFixed(4)),
        alertLevel: r.analysis.alertLevel,
        movementStatus: r.telemetrySnapshot.movementStatus,
        groundTruthLabel: r.groundTruthLabel,
        groundTruthFlag:
          r.groundTruthIsAnomalous === true
            ? 1
            : r.groundTruthIsAnomalous === false
            ? 0
            : null,
      })),
    [recentResults]
  );

  const ecgChartData = useMemo(() => {
    const samples = lastResult?.telemetrySnapshot.ecgSamples;
    if (!samples || samples.length === 0) return [];
    const sr =
      lastResult.telemetrySnapshot.ecgSamplingRate &&
      lastResult.telemetrySnapshot.ecgSamplingRate > 0
        ? lastResult.telemetrySnapshot.ecgSamplingRate
        : 200;
    const stepMs = 1000 / sr;
    return samples.map((val, idx) => ({
      timeMs: Math.round(idx * stepMs),
      amplitude: Number(val.toFixed(3)),
    }));
  }, [lastResult]);

  const unavailableModalities = useMemo(
    () => MODALITY_LABELS.filter((m) => !modalities[m.key]),
    [modalities]
  );

  if (!provenance) {
    return (
      <section className="bg-arova-mint/50 border border-arova-border rounded-xl p-6 text-center space-y-2">
        <p className="text-sm font-medium text-arova-text">
          No Dataset Recording Loaded for Sensor Visualization
        </p>
        <p className="text-xs text-arova-muted max-w-2xl mx-auto leading-relaxed">
          Import a verified public dataset CSV or TXT trace above. Charts render dynamically and
          strictly for the sensor modalities present in the imported recording—missing channels are
          never fabricated or backfilled.
        </p>
      </section>
    );
  }

  const latestSnap = lastResult?.telemetrySnapshot ?? null;
  const ecgFeatures = lastResult?.analysis.ecgFeatures;
  const hasPlayedFrames = timelineData.length > 0;

  return (
    <div className="space-y-4">
      {/* Modality Inventory Bar */}
      <div className="bg-arova-mint border border-arova-sage rounded-xl px-4 py-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="uppercase tracking-wider font-mono text-arova-green-dark font-semibold">
            Active Sensor Channels
          </span>
          <span className="text-arova-sage">/</span>
          <span className="text-arova-text font-mono font-medium">
            {MODALITY_LABELS.filter((m) => modalities[m.key])
              .map((m) => m.label)
              .join(" · ") || "None detected"}
          </span>
        </div>
        {unavailableModalities.length > 0 && (
          <div className="text-arova-muted font-mono text-[11px]">
            Unavailable (not fabricated):{" "}
            <span>{unavailableModalities.map((m) => m.label).join(" · ")}</span>
          </div>
        )}
      </div>

      {/* Live Numeric Telemetry Readout for Present Modalities Only */}
      {latestSnap && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {modalities.heartRate && (
            <div className="bg-white border border-arova-border rounded-xl p-3.5">
              <div className="text-[11px] uppercase tracking-wider font-mono text-arova-muted">
                Heart Rate
              </div>
              <div className="text-2xl font-semibold font-mono tabular-nums text-arova-green-dark mt-1">
                {latestSnap.heartRate !== null ? Math.round(latestSnap.heartRate) : "--"}
                <span className="text-xs text-arova-muted ml-1">BPM</span>
              </div>
            </div>
          )}

          {modalities.spo2 && (
            <div className="bg-white border border-arova-border rounded-xl p-3.5">
              <div className="text-[11px] uppercase tracking-wider font-mono text-arova-muted">
                SpO₂
              </div>
              <div className="text-2xl font-semibold font-mono tabular-nums text-arova-green mt-1">
                {latestSnap.spo2 !== null ? latestSnap.spo2.toFixed(1) : "--"}
                <span className="text-xs text-arova-muted ml-1">%</span>
              </div>
            </div>
          )}

          {modalities.temperatureC && (
            <div className="bg-white border border-arova-border rounded-xl p-3.5">
              <div className="text-[11px] uppercase tracking-wider font-mono text-arova-muted">
                Temperature
              </div>
              <div className="text-2xl font-semibold font-mono tabular-nums text-arova-green-dark mt-1">
                {latestSnap.temperatureC !== null ? latestSnap.temperatureC.toFixed(2) : "--"}
                <span className="text-xs text-arova-muted ml-1">°C</span>
              </div>
              <div className="text-[10px] font-mono text-arova-muted mt-0.5 truncate">
                {latestSnap.temperatureSite ?? provenance.temperatureSite ?? "site unknown"}
              </div>
            </div>
          )}

          {modalities.respiratoryRate && (
            <div className="bg-white border border-arova-border rounded-xl p-3.5">
              <div className="text-[11px] uppercase tracking-wider font-mono text-arova-muted">
                Resp Rate
              </div>
              <div className="text-2xl font-semibold font-mono tabular-nums text-arova-green-dark mt-1">
                {latestSnap.respiratoryRateBpm !== null
                  ? latestSnap.respiratoryRateBpm.toFixed(1)
                  : "--"}
                <span className="text-xs text-arova-muted ml-1">BrPM</span>
              </div>
            </div>
          )}

          {modalities.imu && (
            <div className="bg-white border border-arova-border rounded-xl p-3.5">
              <div className="text-[11px] uppercase tracking-wider font-mono text-arova-muted">
                IMU Accel / Gyro
              </div>
              <div className="text-xl font-semibold font-mono tabular-nums text-arova-green-dark mt-1">
                {latestSnap.accelMagnitude.toFixed(2)}
                <span className="text-xs text-arova-muted ml-1">g</span>
                <span className="text-arova-sage mx-1">/</span>
                {latestSnap.gyroMagnitude.toFixed(1)}
                <span className="text-xs text-arova-muted ml-1">°/s</span>
              </div>
              <div className="text-[10px] font-mono text-arova-muted mt-0.5">
                {latestSnap.movementStatus}
                {latestSnap.possibleFallDetected ? " · fall_flag" : ""}
              </div>
            </div>
          )}

          {modalities.ecg && (
            <div className="bg-white border border-arova-border rounded-xl p-3.5">
              <div className="text-[11px] uppercase tracking-wider font-mono text-arova-muted">
                ECG Est. Rate
              </div>
              <div className="text-2xl font-semibold font-mono tabular-nums text-arova-green-dark mt-1">
                {ecgFeatures?.estimatedEcgBpm !== null && ecgFeatures?.estimatedEcgBpm !== undefined
                  ? Math.round(ecgFeatures.estimatedEcgBpm)
                  : "--"}
                <span className="text-xs text-arova-muted ml-1">BPM</span>
              </div>
              <div className="text-[10px] font-mono text-arova-muted mt-0.5">
                {ecgFeatures
                  ? `${ecgFeatures.rPeakCount} R-peaks · ${ecgFeatures.signalQuality}`
                  : "window"}
              </div>
            </div>
          )}
        </div>
      )}

      {!hasPlayedFrames ? (
        <div className="bg-arova-mint/40 border border-dashed border-arova-sage rounded-xl p-8 text-center text-xs text-arova-muted">
          Recording loaded (
          <span className="font-mono font-medium text-arova-text">
            {provenance.originalFilename}
          </span>
          ). Press <span className="text-arova-green-dark font-semibold">Start</span> or{" "}
          <span className="text-arova-green-dark font-semibold">Step</span> in the playback controls
          to stream frames and plot live sensor charts.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Heart Rate Chart */}
          {modalities.heartRate && (
            <section className="bg-white border border-arova-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-arova-green" />
                  <h4 className="text-sm font-semibold text-arova-text">Heart Rate / PPG Stream</h4>
                </div>
                <span className="text-[11px] font-mono text-arova-muted">
                  BPM · {timelineData.length} frames
                </span>
              </div>
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timelineData} margin={{ top: 8, right: 10, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#DCE9DF" vertical={false} />
                    <XAxis
                      dataKey="offsetLabel"
                      tick={{ fontSize: 10, fill: "#52685B" }}
                      axisLine={{ stroke: "#DCE9DF" }}
                      tickLine={false}
                      minTickGap={20}
                    />
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={{ fontSize: 10, fill: "#52685B" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={CLINICAL_TOOLTIP_STYLE}
                      formatter={(val: unknown) => [
                        typeof val === "number" ? `${val.toFixed(1)} BPM` : "null (missing)",
                        "Heart Rate",
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="heartRate"
                      stroke="#16834A"
                      strokeWidth={2}
                      fill="#D3EBDD"
                      fillOpacity={0.6}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* SpO2 Chart */}
          {modalities.spo2 && (
            <section className="bg-white border border-arova-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Waves className="w-4 h-4 text-arova-green-dark" />
                  <h4 className="text-sm font-semibold text-arova-text">Blood Oxygen (SpO₂)</h4>
                </div>
                <span className="text-[11px] font-mono text-arova-muted">% saturation</span>
              </div>
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timelineData} margin={{ top: 8, right: 10, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#DCE9DF" vertical={false} />
                    <XAxis
                      dataKey="offsetLabel"
                      tick={{ fontSize: 10, fill: "#52685B" }}
                      axisLine={{ stroke: "#DCE9DF" }}
                      tickLine={false}
                      minTickGap={20}
                    />
                    <YAxis
                      domain={[80, 100]}
                      tick={{ fontSize: 10, fill: "#52685B" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={CLINICAL_TOOLTIP_STYLE}
                      formatter={(val: unknown) => [
                        typeof val === "number" ? `${val.toFixed(1)}%` : "null (missing)",
                        "SpO₂",
                      ]}
                    />
                    <ReferenceLine y={90} stroke="#D97706" strokeDasharray="4 4" />
                    <Area
                      type="monotone"
                      dataKey="spo2"
                      stroke="#116B3A"
                      strokeWidth={2}
                      fill="#EAF6EF"
                      fillOpacity={0.85}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Temperature Chart (with explicit temperatureSite notice) */}
          {modalities.temperatureC && (
            <section className="bg-white border border-arova-border rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Thermometer className="w-4 h-4 text-arova-green" />
                  <div>
                    <h4 className="text-sm font-semibold text-arova-text">Temperature Stream</h4>
                    <p className="text-[11px] font-mono text-amber-700 mt-0.5">
                      Site: {formatTempSiteLabel(provenance.temperatureSite)}
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-mono text-arova-muted shrink-0">°C</span>
              </div>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timelineData} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#DCE9DF" vertical={false} />
                    <XAxis
                      dataKey="offsetLabel"
                      tick={{ fontSize: 10, fill: "#52685B" }}
                      axisLine={{ stroke: "#DCE9DF" }}
                      tickLine={false}
                      minTickGap={20}
                    />
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={{ fontSize: 10, fill: "#52685B" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={CLINICAL_TOOLTIP_STYLE}
                      formatter={(val: unknown) => [
                        typeof val === "number" ? `${val.toFixed(2)} °C` : "null (missing)",
                        "Temperature",
                      ]}
                    />
                    <Line
                      type="monotone"
                      dataKey="temperatureC"
                      stroke="#2E9E6B"
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Respiratory Rate Chart */}
          {modalities.respiratoryRate && (
            <section className="bg-white border border-arova-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Waves className="w-4 h-4 text-arova-green" />
                  <h4 className="text-sm font-semibold text-arova-text">Respiratory Rate</h4>
                </div>
                <span className="text-[11px] font-mono text-arova-muted">breaths / min</span>
              </div>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timelineData} margin={{ top: 8, right: 10, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#DCE9DF" vertical={false} />
                    <XAxis
                      dataKey="offsetLabel"
                      tick={{ fontSize: 10, fill: "#52685B" }}
                      axisLine={{ stroke: "#DCE9DF" }}
                      tickLine={false}
                      minTickGap={20}
                    />
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={{ fontSize: 10, fill: "#52685B" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={CLINICAL_TOOLTIP_STYLE}
                      formatter={(val: unknown) => [
                        typeof val === "number" ? `${val.toFixed(1)} BrPM` : "null (missing)",
                        "Respiratory Rate",
                      ]}
                    />
                    <Line
                      type="monotone"
                      dataKey="respiratoryRateBpm"
                      stroke="#418E67"
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* IMU Accelerometer & Gyroscope Chart */}
          {modalities.imu && (
            <section className="bg-white border border-arova-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-arova-green" />
                  <h4 className="text-sm font-semibold text-arova-text">
                    IMU Kinematics (Accel g &amp; Gyro °/s)
                  </h4>
                </div>
                {latestSnap && (
                  <span className="text-[11px] font-mono text-arova-muted">
                    {latestSnap.accelX !== null
                      ? `XYZ ${latestSnap.accelX.toFixed(2)}, ${latestSnap.accelY?.toFixed(2)}, ${latestSnap.accelZ?.toFixed(2)}g`
                      : `Mag ${latestSnap.accelMagnitude.toFixed(2)}g`}
                  </span>
                )}
              </div>
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timelineData} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#DCE9DF" vertical={false} />
                    <XAxis
                      dataKey="offsetLabel"
                      tick={{ fontSize: 10, fill: "#52685B" }}
                      axisLine={{ stroke: "#DCE9DF" }}
                      tickLine={false}
                      minTickGap={20}
                    />
                    <YAxis
                      yAxisId="acc"
                      domain={[0, "auto"]}
                      tick={{ fontSize: 10, fill: "#16834A" }}
                      axisLine={false}
                      tickLine={false}
                      width={34}
                    />
                    <YAxis
                      yAxisId="gyro"
                      orientation="right"
                      domain={[0, "auto"]}
                      tick={{ fontSize: 10, fill: "#52685B" }}
                      axisLine={false}
                      tickLine={false}
                      width={38}
                    />
                    <Tooltip contentStyle={CLINICAL_TOOLTIP_STYLE} />
                    <ReferenceLine yAxisId="acc" y={2.5} stroke="#DC2626" strokeDasharray="4 4" />
                    <Line
                      yAxisId="acc"
                      type="monotone"
                      dataKey="accelMagnitude"
                      name="Accel Mag (g)"
                      stroke="#16834A"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      yAxisId="gyro"
                      type="monotone"
                      dataKey="gyroMagnitude"
                      name="Gyro Mag (°/s)"
                      stroke="#65A383"
                      strokeWidth={1.75}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {latestSnap?.possibleFallDetected && (
                <div className="flex items-center gap-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-600" />
                  <span>
                    Impact threshold indicator flagged on frame #{lastResult?.frameIndex} (experimental heuristic; non-clinical).
                  </span>
                </div>
              )}
            </section>
          )}

          {/* ECG Waveform Chart */}
          {modalities.ecg && (
            <section className="bg-white border border-arova-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-arova-green" />
                  <h4 className="text-sm font-semibold text-arova-text">
                    ECG Window Waveform &amp; R-Peak Metrics
                  </h4>
                </div>
                <span className="text-[11px] font-mono text-arova-muted">
                  {latestSnap?.ecgSamplingRate ?? provenance.samplingRateHz ?? 360} Hz ·{" "}
                  {ecgChartData.length} pts
                </span>
              </div>
              {ecgChartData.length === 0 ? (
                <div className="h-48 flex items-center justify-center border border-dashed border-arova-border rounded-lg text-xs text-arova-muted bg-arova-mint/30">
                  No ECG sample window present on the latest frame.
                </div>
              ) : (
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={ecgChartData} margin={{ top: 8, right: 10, left: -12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#DCE9DF" />
                      <XAxis
                        dataKey="timeMs"
                        tick={{ fontSize: 10, fill: "#52685B" }}
                        tickFormatter={(v: number) => `${v}ms`}
                        axisLine={{ stroke: "#DCE9DF" }}
                        tickLine={false}
                        minTickGap={24}
                      />
                      <YAxis
                        domain={["auto", "auto"]}
                        tick={{ fontSize: 10, fill: "#52685B" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={CLINICAL_TOOLTIP_STYLE}
                        labelFormatter={(label: unknown) => `Offset: ${String(label)} ms`}
                        formatter={(val: unknown) => [
                          typeof val === "number" ? val.toFixed(3) : String(val),
                          "ECG (mV / norm)",
                        ]}
                      />
                      <Line
                        type="monotone"
                        dataKey="amplitude"
                        stroke={latestSnap?.ecgLeadOff ? "#DC2626" : "#16834A"}
                        strokeWidth={1.6}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              {ecgFeatures && (
                <div className="grid grid-cols-4 gap-2 text-[11px] font-mono">
                  <div className="bg-arova-mint/60 border border-arova-border rounded-lg p-2">
                    <div className="text-arova-muted">ECG BPM</div>
                    <div className="text-arova-text font-semibold tabular-nums mt-0.5">
                      {ecgFeatures.estimatedEcgBpm !== null
                        ? `${ecgFeatures.estimatedEcgBpm.toFixed(1)}`
                        : "--"}
                    </div>
                  </div>
                  <div className="bg-arova-mint/60 border border-arova-border rounded-lg p-2">
                    <div className="text-arova-muted">R-R Mean</div>
                    <div className="text-arova-text font-semibold tabular-nums mt-0.5">
                      {ecgFeatures.rrIntervalMeanMs !== null
                        ? `${ecgFeatures.rrIntervalMeanMs.toFixed(0)}ms`
                        : "--"}
                    </div>
                  </div>
                  <div className="bg-arova-mint/60 border border-arova-border rounded-lg p-2">
                    <div className="text-arova-muted">HRV (SDNN)</div>
                    <div className="text-arova-text font-semibold tabular-nums mt-0.5">
                      {ecgFeatures.rrVariabilityMs !== null
                        ? `${ecgFeatures.rrVariabilityMs.toFixed(1)}ms`
                        : "--"}
                    </div>
                  </div>
                  <div className="bg-arova-mint/60 border border-arova-border rounded-lg p-2">
                    <div className="text-arova-muted">R-Peaks</div>
                    <div className="text-arova-text font-semibold tabular-nums mt-0.5">
                      {ecgFeatures.rPeakCount} ({ecgFeatures.signalQuality})
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Live ML Anomaly Score Timeline (always shown once frames play) */}
          <section className="bg-white border border-arova-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-amber-600" />
                <h4 className="text-sm font-semibold text-arova-text">
                  Isolation Forest Anomaly Score Stream
                </h4>
              </div>
              <span className="text-[11px] font-mono text-arova-muted">
                Lower negative scores = stronger anomaly
              </span>
            </div>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timelineData} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#DCE9DF" vertical={false} />
                  <XAxis
                    dataKey="offsetLabel"
                    tick={{ fontSize: 10, fill: "#52685B" }}
                    axisLine={{ stroke: "#DCE9DF" }}
                    tickLine={false}
                    minTickGap={20}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 10, fill: "#52685B" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={CLINICAL_TOOLTIP_STYLE}
                    formatter={(val: unknown) => [
                      typeof val === "number" ? val.toFixed(4) : String(val),
                      "Anomaly Score",
                    ]}
                  />
                  <ReferenceLine y={0} stroke="#52685B" strokeDasharray="4 4" />
                  <Area
                    type="monotone"
                    dataKey="anomalyScore"
                    stroke="#D97706"
                    strokeWidth={2}
                    fill="#FEF3C7"
                    fillOpacity={0.65}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
