import { Activity, Cpu, HeartPulse, Thermometer, Waves, WifiOff, Wifi } from "lucide-react";
import { EcgWaveformPanel } from "../components/EcgWaveformPanel.tsx";
import { AlertLevelLabel } from "../components/StatusIndicator.tsx";
import { TelemetryCharts } from "../components/TelemetryCharts.tsx";
import { VitalMetricCard } from "../components/VitalMetricCard.tsx";
import { useSmartCare } from "../context/SmartCareContext.tsx";

export function PatientOverviewPage({
  onNavigate,
}: {
  onNavigate: (page: string) => void;
}) {
  const {
    selectedPatient,
    readings,
    alerts,
    devices,
    integrations,
    usingSampleData,
    systemSettings,
    liveHardwareSnapshot,
    ecgSegments,
    baselineStatusSummary,
  } = useSmartCare();

  const latest = liveHardwareSnapshot ?? readings[readings.length - 1] ?? null;
  const patientDevices = devices.filter((d) => d.patientId === selectedPatient.patientId);
  const activeDevice = patientDevices[0] ?? devices[0];
  const patientAlerts = alerts.filter((a) => a.patientId === selectedPatient.patientId);

  const isHardwareLive = Boolean(liveHardwareSnapshot) || activeDevice?.connectionStatus === "streaming";
  const mlConnected = Boolean(integrations?.mlService.reachable);

  const hrValue = latest && typeof latest.heartRate === "number" ? latest.heartRate : null;
  const spo2Value = latest && typeof latest.spo2 === "number" ? latest.spo2 : null;
  const tempValue = latest && typeof latest.temperatureC === "number" ? latest.temperatureC : null;
  const fallSuspect = Boolean(
    latest?.possibleFallDetected || latest?.movementStatus === "fall_suspect"
  );

  const hrTone =
    hrValue === null
      ? "normal"
      : hrValue >= 130 || hrValue <= 42
      ? "critical"
      : hrValue >= 105 || hrValue <= 50
      ? "warning"
      : "normal";

  const spo2Tone =
    spo2Value === null
      ? "normal"
      : spo2Value <= 90
      ? "critical"
      : spo2Value <= 94
      ? "warning"
      : "normal";

  const tempTone =
    tempValue === null
      ? "normal"
      : tempValue >= 39.0 || tempValue <= 35.0
      ? "critical"
      : tempValue >= 37.8 || tempValue <= 35.5
      ? "warning"
      : "normal";

  const moveTone = !latest
    ? "normal"
    : fallSuspect
    ? "critical"
    : latest.movementStatus === "inactive"
    ? "warning"
    : "normal";

  const latestEcgSegment = ecgSegments[0] ?? null;
  const ecgStatusLabel = latest?.ecgLeadOff || latestEcgSegment?.leadOff
    ? "AD8232 Lead-Off"
    : latest?.ecgSignalQuality === "good" || latestEcgSegment?.signalQuality === "good"
    ? "AD8232 Signal Good"
    : latest?.ecgSignalQuality === "noisy" || latestEcgSegment?.signalQuality === "noisy"
    ? "AD8232 Noisy"
    : "AD8232 Provisional";

  return (
    <div className="space-y-6">
      {usingSampleData && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-amber-900">
          <div>
            <span className="font-semibold">Sample Demonstration Data Active</span>
            <span className="mx-2 text-amber-400">·</span>
            <span>
              Displayed vitals, ECG batches, and alerts are clearly labeled sample demonstrations, not live ESP32 wearable readings.
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("trends")}
            className="text-amber-900 font-semibold underline underline-offset-2 whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            Test Simulator Packet
          </button>
        </div>
      )}

      {fallSuspect && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-red-900">
          <div>
            <span className="font-semibold">Possible Fall Indicator (Experimental IMU)</span>
            <span className="mx-2 text-red-400">·</span>
            <span>
              MPU6050 recorded an impact/orientation spike ({latest?.accelMagnitude?.toFixed(2) ?? "high"} g). Experimental heuristic only — verify patient status directly.
            </span>
          </div>
        </div>
      )}

      {/* 4 Primary Vital Metric Cards */}
      <section aria-label="Current Vital Readings" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <VitalMetricCard
          label="Heart Rate (MAX30100)"
          value={hrValue !== null ? String(Math.round(hrValue)) : "--"}
          unit={hrValue !== null ? "BPM" : undefined}
          baselineText={
            selectedPatient.baselineHeartRateMean
              ? `Baseline ${selectedPatient.baselineHeartRateMean.toFixed(0)} BPM`
              : "Baseline pending"
          }
          statusNote={
            hrValue === null
              ? latest?.signalQuality === "poor_contact"
                ? "No finger / poor contact"
                : "Unavailable"
              : hrTone === "normal"
              ? "Within range"
              : hrTone === "warning"
              ? "Elevated"
              : "Critical range"
          }
          tone={hrTone}
          icon={<HeartPulse className="w-5 h-5" />}
        />

        <VitalMetricCard
          label="Est. SpO₂ (MAX30100)"
          value={spo2Value !== null ? spo2Value.toFixed(1) : "--"}
          unit={spo2Value !== null ? "%" : undefined}
          baselineText={
            selectedPatient.baselineSpo2Mean
              ? `Baseline ${selectedPatient.baselineSpo2Mean.toFixed(1)}%`
              : "Baseline pending"
          }
          statusNote={
            spo2Value === null
              ? latest?.signalQuality === "poor_contact"
                ? "No finger / invalid"
                : "Unavailable"
              : spo2Tone === "normal"
              ? "Normal O₂"
              : spo2Tone === "warning"
              ? "Dip detected"
              : "Low SpO₂"
          }
          tone={spo2Tone}
          icon={<Waves className="w-5 h-5" />}
        />

        <VitalMetricCard
          label="Skin Temperature"
          value={tempValue !== null ? tempValue.toFixed(1) : "--"}
          unit={tempValue !== null ? "°C" : undefined}
          baselineText={
            selectedPatient.baselineTempMean
              ? `Baseline ${selectedPatient.baselineTempMean.toFixed(1)} °C`
              : "Probe configurable"
          }
          statusNote={
            tempValue === null
              ? "Sensor pending / null"
              : tempTone === "normal"
              ? "Nominal"
              : tempTone === "warning"
              ? "Elevated"
              : "High fever"
          }
          tone={tempTone}
          icon={<Thermometer className="w-5 h-5" />}
        />

        <VitalMetricCard
          label="Movement & Activity"
          value={latest ? latest.movementStatus.replace("_", " ") : "--"}
          baselineText={
            latest?.accelMagnitude
              ? `IMU ${latest.accelMagnitude.toFixed(2)} g · ${ecgStatusLabel}`
              : `MPU6050 ready · ${ecgStatusLabel}`
          }
          statusNote={
            fallSuspect
              ? "Possible fall (exp. IMU)"
              : moveTone === "warning"
              ? "Prolonged stillness"
              : "Expected motion"
          }
          tone={moveTone}
          icon={<Activity className="w-5 h-5" />}
        />
      </section>

      {/* 3 Operational Posture Panels */}
      <section aria-label="Monitoring Architecture Status" className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-arova-border rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-arova-muted">
            <span className="font-medium text-arova-text">Wearable Sensor Link</span>
            {isHardwareLive ? (
              <Wifi className="w-4 h-4 text-arova-green" />
            ) : (
              <WifiOff className="w-4 h-4 text-arova-muted" />
            )}
          </div>
          <p className="text-base font-semibold text-arova-text">
            {isHardwareLive ? "ESP32 Streaming Live" : "ESP32 Hardware Not Connected"}
          </p>
          <p className="text-xs text-arova-muted leading-relaxed">
            {activeDevice
              ? `${activeDevice.boardType} · ${activeDevice.pulseOxChipVariant} · ${activeDevice.ecgSensor || "AD8232 Provisional"}`
              : "No wearable node assigned yet."}
          </p>
        </div>

        <div className="bg-white border border-arova-border rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-arova-muted">
            <span className="font-medium text-arova-text">Personal Baseline Learning</span>
            <span className="font-mono tabular-nums text-arova-green-dark font-medium">
              {baselineStatusSummary?.activeBaseline.collectedSamples || selectedPatient.baselineSamplesCount}/
              {systemSettings.baselineMinSamples} samples
            </span>
          </div>
          <p className="text-base font-semibold text-arova-text capitalize">
            {(baselineStatusSummary?.activeBaseline.status ?? selectedPatient.baselineStatus) === "ready"
              ? "Baseline Ready"
              : (baselineStatusSummary?.activeBaseline.status ?? selectedPatient.baselineStatus) === "collecting"
              ? "Collecting Baseline"
              : "Not Started"}
          </p>
          <p className="text-xs text-arova-muted leading-relaxed">
            {selectedPatient.baselineSource
              ? `Source: ${selectedPatient.baselineSource} (${selectedPatient.baselineModelVersion || "local baseline"}). `
              : "Tracks clean quality-filtered resting & active patterns separately per source. "}
            {selectedPatient.baselineActiveHrMean
              ? `Active HR ${selectedPatient.baselineActiveHrMean.toFixed(0)} BPM.`
              : ""}
          </p>
        </div>

        <div className="bg-white border border-arova-border rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-arova-muted">
            <span className="font-medium text-arova-text">AI Monitoring Engine</span>
            <div className="flex items-center gap-1.5">
              {latest && (
                <span className="font-mono tabular-nums text-arova-green-dark font-medium">
                  score {latest.anomalyScore.toFixed(3)}
                </span>
              )}
              <Cpu className="w-4 h-4 text-arova-green" />
            </div>
          </div>
          <p className="text-base font-semibold text-arova-text">
            {mlConnected ? "Isolation Forest Connected" : "Demo Mode (ML Service Not Connected)"}
          </p>
          <p className="text-xs text-arova-muted leading-relaxed">
            {latest?.anomalyStatus === "insufficient_baseline"
              ? "Insufficient personal baseline data — collecting clean readings before ML anomaly scoring."
              : latest?.anomalyStatus === "paused_poor_quality"
              ? "Anomaly scoring paused due to poor sensor contact or detached optical probe."
              : latest?.contributingFeatures && latest.contributingFeatures.length > 0
              ? `State: ${latest.anomalyStatus ?? "evaluated"} (${latest.alertLevel}) · Drivers: ${latest.contributingFeatures.join(", ")}.`
              : mlConnected
              ? "FastAPI scikit-learn Isolation Forest evaluating multi-feature vitals (dedicated ECG model not trained)."
              : "Running in development Demo Mode with windowed baseline & persistence checks until optional ML_SERVICE_URL is linked."}
          </p>
        </div>
      </section>

      {/* Main Chart + Recent Alerts Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          <TelemetryCharts readings={readings} patient={selectedPatient} />
          <EcgWaveformPanel segments={ecgSegments} />
        </div>

        <div className="bg-white border border-arova-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-arova-text">Recent Warnings &amp; Alerts</h3>
              <p className="text-xs text-arova-muted mt-0.5">
                Explainable change summaries
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate("assistant")}
              className="text-xs font-semibold text-arova-green hover:text-arova-green-dark whitespace-nowrap shrink-0"
            >
              Ask AI Assistant
            </button>
          </div>

          {patientAlerts.length === 0 ? (
            <div className="py-8 text-center text-sm text-arova-muted border border-dashed border-arova-border rounded-lg bg-arova-mint/30">
              No active warnings or critical alerts for this patient.
            </div>
          ) : (
            <div className="divide-y divide-arova-border/70">
              {patientAlerts.slice(0, 4).map((alert) => (
                <div key={alert.alertId} className="py-3.5 first:pt-0 last:pb-0 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <AlertLevelLabel level={alert.level} />
                    <span className="text-xs text-arova-muted font-mono tabular-nums">
                      {new Date(alert.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-arova-text">{alert.title}</p>
                  <p className="text-xs text-arova-muted leading-relaxed">{alert.explanation}</p>
                  <div className="text-xs text-arova-muted flex items-center gap-2 pt-0.5">
                    <span>Status: {alert.status}</span>
                    <span aria-hidden="true">·</span>
                    <span>Metrics: {alert.triggeredMetrics.join(", ") || "Multi-sensor"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
