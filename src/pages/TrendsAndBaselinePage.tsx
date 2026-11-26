import { useMemo, useState } from "react";
import { Play, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { EcgWaveformPanel } from "../components/EcgWaveformPanel.tsx";
import { AlertLevelLabel } from "../components/StatusIndicator.tsx";
import { TelemetryCharts } from "../components/TelemetryCharts.tsx";
import { useSmartCare } from "../context/SmartCareContext.tsx";
import type { AlertLevel, MovementStatus } from "../types/smartcare.ts";

function buildSimulatedEcgBatch(
  hrBpm: number | null,
  leadOff: boolean,
  samplingRate = 200,
  sampleCount = 100
): number[] {
  if (leadOff) {
    return Array.from({ length: sampleCount }, (_, i) =>
      Number((2048 + Math.sin(i * 0.4) * 3).toFixed(1))
    );
  }
  const effectiveHr = hrBpm && hrBpm > 35 ? hrBpm : 72;
  const beatPeriodSec = 60 / effectiveHr;
  const samples: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = i / samplingRate;
    const phase = (t % beatPeriodSec) / beatPeriodSec;
    let mv = 0.02 * Math.sin(2 * Math.PI * 0.35 * t);
    if (phase > 0.12 && phase < 0.2) {
      mv += 0.14 * Math.sin(((phase - 0.12) / 0.08) * Math.PI);
    } else if (phase >= 0.26 && phase < 0.29) {
      mv -= 0.16;
    } else if (phase >= 0.29 && phase < 0.33) {
      mv += 1.05 * Math.sin(((phase - 0.29) / 0.04) * Math.PI);
    } else if (phase >= 0.33 && phase < 0.37) {
      mv -= 0.24;
    } else if (phase >= 0.48 && phase < 0.62) {
      mv += 0.26 * Math.sin(((phase - 0.48) / 0.14) * Math.PI);
    }
    samples.push(Number(mv.toFixed(3)));
  }
  return samples;
}

export function TrendsAndBaselinePage() {
  const {
    selectedPatient,
    readings,
    ecgSegments,
    baselineStatusSummary,
    injectSimulatorReading,
    fitBaselineForSelectedPatient,
    systemSettings,
  } = useSmartCare();

  const [filterLevel, setFilterLevel] = useState<"All" | AlertLevel>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [baselineFeedback, setBaselineFeedback] = useState<string | null>(null);
  const [fittingBaseline, setFittingBaseline] = useState(false);

  // Simulator controls (explicitly labeled as test simulator)
  const [simHr, setSimHr] = useState<number | null>(76);
  const [simSpo2, setSimSpo2] = useState<number | null>(97.8);
  const [simTemp, setSimTemp] = useState<number | null>(36.7);
  const [simAccel, setSimAccel] = useState(1.02);
  const [simMovement, setSimMovement] = useState<MovementStatus>("resting");
  const [simFingerOk, setSimFingerOk] = useState(true);
  const [simIncludeEcg, setSimIncludeEcg] = useState(true);
  const [simEcgLeadOff, setSimEcgLeadOff] = useState(false);
  const [simSubmitting, setSimSubmitting] = useState(false);
  const [simResultMessage, setSimResultMessage] = useState<string | null>(null);

  const filteredReadings = useMemo(() => {
    return [...readings]
      .reverse()
      .filter((r) => {
        if (filterLevel !== "All" && r.alertLevel !== filterLevel) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return (
            r.explanation.toLowerCase().includes(q) ||
            r.movementStatus.toLowerCase().includes(q) ||
            r.source.toLowerCase().includes(q)
          );
        }
        return true;
      });
  }, [readings, filterLevel, searchQuery]);

  const applyPreset = (
    preset: "normal" | "warning_hr" | "critical_hypoxia" | "poor_contact"
  ) => {
    if (preset === "normal") {
      setSimHr(74);
      setSimSpo2(98.0);
      setSimTemp(36.6);
      setSimAccel(1.01);
      setSimMovement("resting");
      setSimFingerOk(true);
      setSimIncludeEcg(true);
      setSimEcgLeadOff(false);
    } else if (preset === "warning_hr") {
      setSimHr(112);
      setSimSpo2(94.2);
      setSimTemp(37.9);
      setSimAccel(1.05);
      setSimMovement("resting");
      setSimFingerOk(true);
      setSimIncludeEcg(true);
      setSimEcgLeadOff(false);
    } else if (preset === "critical_hypoxia") {
      setSimHr(136);
      setSimSpo2(87.5);
      setSimTemp(38.5);
      setSimAccel(3.2);
      setSimMovement("fall_suspect");
      setSimFingerOk(true);
      setSimIncludeEcg(true);
      setSimEcgLeadOff(false);
    } else {
      setSimHr(null);
      setSimSpo2(null);
      setSimTemp(null);
      setSimAccel(0.98);
      setSimMovement("resting");
      setSimFingerOk(false);
      setSimIncludeEcg(true);
      setSimEcgLeadOff(true);
    }
  };

  const handleSendSim = async () => {
    setSimSubmitting(true);
    setSimResultMessage(null);
    try {
      const ecgSamplingRate = 200;
      const ecgSamples = simIncludeEcg
        ? buildSimulatedEcgBatch(simHr, simEcgLeadOff, ecgSamplingRate, 100)
        : undefined;

      const created = await injectSimulatorReading({
        heartRate: simFingerOk ? simHr : null,
        spo2: simFingerOk ? simSpo2 : null,
        temperatureC: simTemp,
        accelMagnitude: simAccel,
        gyroMagnitude: simAccel * 10,
        movementStatus: simMovement,
        possibleFallDetected: simMovement === "fall_suspect",
        irSignalOk: simFingerOk,
        fingerDetected: simFingerOk,
        ecgSamples,
        ecgSamplingRate: simIncludeEcg ? ecgSamplingRate : undefined,
        ecgLeadOff: simIncludeEcg ? simEcgLeadOff : undefined,
        ecgSignalQuality: simIncludeEcg
          ? simEcgLeadOff
            ? "lead_off"
            : "good"
          : undefined,
        ecgTimestamp: simIncludeEcg ? new Date().toISOString() : undefined,
        source: "simulator",
      });
      setSimResultMessage(
        `Processed via /api/wearable/ingest (${created.alertLevel} · score ${created.anomalyScore.toFixed(3)}): ${created.explanation}`
      );
    } catch (err) {
      setSimResultMessage(err instanceof Error ? err.message : "Simulator request failed.");
    } finally {
      setSimSubmitting(false);
    }
  };

  const handleFitBaseline = async () => {
    setFittingBaseline(true);
    setBaselineFeedback(null);
    try {
      const res = await fitBaselineForSelectedPatient();
      setBaselineFeedback(res.message);
    } catch (err) {
      setBaselineFeedback(err instanceof Error ? err.message : "Failed to compute baseline.");
    } finally {
      setFittingBaseline(false);
    }
  };

  return (
    <div className="space-y-6">
      <TelemetryCharts readings={readings} patient={selectedPatient} />

      <EcgWaveformPanel
        segments={ecgSegments}
        title="AD8232 Historical & Live ECG Waveform Segments"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Personal Baseline Learning Panel */}
        <section className="bg-white border border-arova-border rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-arova-text">
                Personalized Baseline Learning
              </h3>
              <p className="text-xs text-arova-muted mt-0.5">
                Fits an individual Isolation Forest baseline once {systemSettings.baselineMinSamples}+ clean readings exist
              </p>
            </div>
            <button
              type="button"
              onClick={handleFitBaseline}
              disabled={fittingBaseline}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-arova-green rounded-lg hover:bg-arova-green-dark disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {fittingBaseline ? "Fitting..." : "Recompute Baseline"}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-1">
            <div className="bg-arova-mint/60 border border-arova-border/70 rounded-lg p-3">
              <div className="text-xs text-arova-muted">Resting HR Mean</div>
              <div className="text-lg font-semibold text-arova-text font-mono tabular-nums mt-0.5">
                {selectedPatient.baselineHeartRateMean
                  ? `${selectedPatient.baselineHeartRateMean.toFixed(1)} BPM`
                  : "--"}
              </div>
            </div>
            <div className="bg-arova-mint/60 border border-arova-border/70 rounded-lg p-3">
              <div className="text-xs text-arova-muted">SpO₂ Mean</div>
              <div className="text-lg font-semibold text-arova-text font-mono tabular-nums mt-0.5">
                {selectedPatient.baselineSpo2Mean
                  ? `${selectedPatient.baselineSpo2Mean.toFixed(1)}%`
                  : "--"}
              </div>
            </div>
            <div className="bg-arova-mint/60 border border-arova-border/70 rounded-lg p-3">
              <div className="text-xs text-arova-muted">Temp / Active HR</div>
              <div className="text-lg font-semibold text-arova-text font-mono tabular-nums mt-0.5">
                {selectedPatient.baselineTempMean
                  ? `${selectedPatient.baselineTempMean.toFixed(1)} °C`
                  : "--"}
                {selectedPatient.baselineActiveHrMean
                  ? ` · ${selectedPatient.baselineActiveHrMean.toFixed(0)}`
                  : ""}
              </div>
            </div>
          </div>

          <div className="text-xs text-arova-muted flex flex-wrap items-center justify-between gap-2 pt-1">
            <span>
              Source separation: HW {baselineStatusSummary?.esp32Hardware.collectedSamples ?? 0} · Sim{" "}
              {baselineStatusSummary?.simulator.collectedSamples ?? 0} clean samples
            </span>
            {selectedPatient.baselineModelVersion && (
              <span className="font-mono text-arova-green-dark">
                {selectedPatient.baselineModelVersion}
              </span>
            )}
          </div>

          {baselineFeedback && (
            <p className="text-xs text-arova-text bg-arova-mint/50 border border-arova-border rounded-lg p-3 leading-relaxed">
              {baselineFeedback}
            </p>
          )}
        </section>

        {/* Pipeline Simulator (Clearly Labeled Not Real Hardware) */}
        <section className="bg-white border border-arova-border rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-arova-text">
                Telemetry Pipeline Simulator (Test Only)
              </h3>
              <p className="text-xs text-arova-muted mt-0.5">
                Tagged as <span className="font-mono">source: &quot;simulator&quot;</span> · Tests MAX30100, nullable temp, and batched AD8232 ECG ingest
              </p>
            </div>
            <SlidersHorizontal className="w-4 h-4 text-arova-green shrink-0" />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => applyPreset("normal")}
              className="px-2.5 py-1.5 text-xs font-medium bg-arova-mint hover:bg-arova-sage text-arova-green-dark rounded-md transition-colors"
            >
              Normal Resting
            </button>
            <button
              type="button"
              onClick={() => applyPreset("warning_hr")}
              className="px-2.5 py-1.5 text-xs font-medium bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-md transition-colors"
            >
              Warning (Tachycardia)
            </button>
            <button
              type="button"
              onClick={() => applyPreset("critical_hypoxia")}
              className="px-2.5 py-1.5 text-xs font-medium bg-red-50 hover:bg-red-100 text-red-800 rounded-md transition-colors"
            >
              Critical (Low SpO₂ + Fall)
            </button>
            <button
              type="button"
              onClick={() => applyPreset("poor_contact")}
              className="px-2.5 py-1.5 text-xs font-medium bg-arova-mint/60 hover:bg-arova-mint border border-arova-border text-arova-text rounded-md transition-colors"
            >
              No Finger / Lead-Off (null)
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <label className="space-y-1">
              <span className="text-arova-muted block">HR (BPM)</span>
              <input
                type="number"
                value={simHr ?? ""}
                placeholder="null"
                onChange={(e) =>
                  setSimHr(e.target.value === "" ? null : Number(e.target.value))
                }
                className="w-full px-2.5 py-1.5 border border-arova-border rounded-lg font-mono tabular-nums text-arova-text focus:outline-none focus:border-arova-green"
              />
            </label>
            <label className="space-y-1">
              <span className="text-arova-muted block">SpO₂ (%)</span>
              <input
                type="number"
                step="0.1"
                value={simSpo2 ?? ""}
                placeholder="null"
                onChange={(e) =>
                  setSimSpo2(e.target.value === "" ? null : Number(e.target.value))
                }
                className="w-full px-2.5 py-1.5 border border-arova-border rounded-lg font-mono tabular-nums text-arova-text focus:outline-none focus:border-arova-green"
              />
            </label>
            <label className="space-y-1">
              <span className="text-arova-muted block">Temp (°C, optional)</span>
              <input
                type="number"
                step="0.1"
                value={simTemp ?? ""}
                placeholder="null (pending)"
                onChange={(e) =>
                  setSimTemp(e.target.value === "" ? null : Number(e.target.value))
                }
                className="w-full px-2.5 py-1.5 border border-arova-border rounded-lg font-mono tabular-nums text-arova-text focus:outline-none focus:border-arova-green"
              />
            </label>
            <label className="space-y-1">
              <span className="text-arova-muted block">Movement</span>
              <select
                value={simMovement}
                onChange={(e) => setSimMovement(e.target.value as MovementStatus)}
                className="w-full px-2 py-1.5 border border-arova-border rounded-lg bg-white text-arova-text focus:outline-none focus:border-arova-green"
              >
                <option value="resting">resting</option>
                <option value="walking">walking</option>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
                <option value="fall_suspect">fall_suspect</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-4 text-xs text-arova-text">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={simFingerOk}
                  onChange={(e) => setSimFingerOk(e.target.checked)}
                  className="rounded border-arova-border text-arova-green focus:ring-arova-green accent-[#16834A]"
                />
                MAX30100 finger valid
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={simIncludeEcg}
                  onChange={(e) => setSimIncludeEcg(e.target.checked)}
                  className="rounded border-arova-border text-arova-green focus:ring-arova-green accent-[#16834A]"
                />
                Batch ECG (100 pts)
              </label>
              {simIncludeEcg && (
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={simEcgLeadOff}
                    onChange={(e) => setSimEcgLeadOff(e.target.checked)}
                    className="rounded border-arova-border text-red-700 focus:ring-red-600 accent-[#B91C1C]"
                  />
                  AD8232 Lead-Off
                </label>
              )}
            </div>

            <button
              type="button"
              onClick={handleSendSim}
              disabled={simSubmitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-arova-green rounded-lg hover:bg-arova-green-dark disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5" />
              {simSubmitting ? "Evaluating..." : "Run Pipeline Check"}
            </button>
          </div>

          {simResultMessage && (
            <p className="text-xs text-arova-text bg-arova-mint/50 border border-arova-border rounded-lg p-3 leading-relaxed">
              {simResultMessage}
            </p>
          )}
        </section>
      </div>

      {/* Historical Telemetry Table */}
      <section className="bg-white border border-arova-border rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-arova-text">Recorded Telemetry History</h3>
            <p className="text-xs text-arova-muted mt-0.5">
              Complete log with MAX30100 contact quality, AD8232 ECG status, source origin, and ML attribution
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-arova-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter readings..."
                className="pl-8 pr-3 py-1.5 text-xs border border-arova-border rounded-lg w-44 text-arova-text placeholder:text-arova-muted/70 focus:outline-none focus:border-arova-green"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-arova-mint border border-arova-border/70 rounded-lg">
              {(["All", "Normal", "Warning", "Critical"] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setFilterLevel(lvl)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    filterLevel === lvl
                      ? "bg-white text-arova-green-dark font-semibold shadow-sm"
                      : "text-arova-muted hover:text-arova-text"
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-arova-border text-xs font-medium text-arova-muted">
                <th className="py-2.5 pr-4">Time</th>
                <th className="py-2.5 pr-4 text-right">HR</th>
                <th className="py-2.5 pr-4 text-right">SpO₂</th>
                <th className="py-2.5 pr-4 text-right">Temp</th>
                <th className="py-2.5 pr-4">Movement</th>
                <th className="py-2.5 pr-4">Quality / ECG</th>
                <th className="py-2.5 pr-4">Level</th>
                <th className="py-2.5 pr-4">Source</th>
                <th className="py-2.5">Explanation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-arova-border/60 text-xs">
              {filteredReadings.map((r) => (
                <tr key={r.readingId} className="hover:bg-arova-mint/35 transition-colors">
                  <td className="py-2.5 pr-4 font-mono tabular-nums text-arova-muted whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular-nums font-medium text-arova-text whitespace-nowrap">
                    {typeof r.heartRate === "number" ? `${Math.round(r.heartRate)} BPM` : "--"}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-arova-text whitespace-nowrap">
                    {typeof r.spo2 === "number" ? `${r.spo2.toFixed(1)}%` : "--"}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-arova-text whitespace-nowrap">
                    {typeof r.temperatureC === "number" ? `${r.temperatureC.toFixed(1)} °C` : "--"}
                  </td>
                  <td className="py-2.5 pr-4 text-arova-text whitespace-nowrap">
                    {r.movementStatus}
                    {r.possibleFallDetected ? " (exp. fall)" : ""}
                  </td>
                  <td className="py-2.5 pr-4 text-arova-muted whitespace-nowrap">
                    {r.signalQuality}
                    {r.ecgSignalQuality ? ` · ECG ${r.ecgSignalQuality}` : ""}
                  </td>
                  <td className="py-2.5 pr-4 whitespace-nowrap">
                    <div className="space-y-0.5">
                      <AlertLevelLabel level={r.alertLevel} />
                      <div className="font-mono text-arova-muted">
                        {r.anomalyScore.toFixed(2)}
                        {r.anomalyStatus ? ` · ${r.anomalyStatus}` : ""}
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-arova-muted whitespace-nowrap">
                    {r.source}
                  </td>
                  <td className="py-2.5 text-arova-text min-w-[240px]">
                    <div>{r.explanation}</div>
                    {r.contributingFeatures && r.contributingFeatures.length > 0 && (
                      <div className="font-mono text-arova-green-dark mt-0.5">
                        Drivers: {r.contributingFeatures.join(", ")}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
