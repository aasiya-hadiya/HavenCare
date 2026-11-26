import { sharedAlertDecisionEngine } from "./alertDecisionEngine.ts";
import { sharedBaselineTracker } from "./baselineTracker.ts";
import { extractEcgFeatures } from "./ecgProcessor.ts";
import { extractWindowFeatures, sharedWindowStore } from "./featureExtractor.ts";
import type {
  AlertLevel,
  AlertPolicyConfig,
  AnomalyStatus,
  AvailableModalities,
  BaselineProgress,
  EcgSignalQuality,
  MlAnalysisResult,
  MovementStatus,
  PredictionClassification,
  PredictionStage,
  SignalQuality,
  TelemetryPayload,
  TelemetrySource,
  TemperatureSite,
} from "./types.ts";

export function classifyPrediction(
  payload: Pick<TelemetryPayload, "possibleFallDetected" | "movementStatus" | "accelMagnitude">,
  analysis: Pick<MlAnalysisResult, "anomalyStatus" | "alertLevel" | "triggeredMetrics">
): PredictionClassification {
  const isPoorQuality = analysis.anomalyStatus === "paused_poor_quality";
  const anomalousWindow = !isPoorQuality && analysis.anomalyStatus === "anomalous";
  const alertTriggered =
    !isPoorQuality && (analysis.alertLevel === "Warning" || analysis.alertLevel === "Critical");
  const hasFallCue =
    Boolean(payload.possibleFallDetected) ||
    payload.movementStatus === "fall_suspect" ||
    payload.accelMagnitude >= 2.8 ||
    analysis.triggeredMetrics.some((m) => /movement|fall/i.test(m));
  const potentialFallAlert = !isPoorQuality && hasFallCue;
  const confirmedFallEvent = !isPoorQuality && alertTriggered && hasFallCue;

  let stage: PredictionStage;
  if (isPoorQuality) {
    stage = "paused_poor_quality";
  } else if (confirmedFallEvent) {
    stage = "confirmed_fall_event";
  } else if (alertTriggered) {
    stage = "confirmed_physiological_alert";
  } else if (potentialFallAlert) {
    stage = "potential_fall_alert";
  } else if (anomalousWindow) {
    stage = "anomalous_sensor_window";
  } else if (analysis.anomalyStatus === "insufficient_baseline") {
    stage = "insufficient_baseline";
  } else {
    stage = "normal";
  }

  return {
    stage,
    anomalousWindow,
    potentialFallAlert,
    alertTriggered,
    confirmedFallEvent,
  };
}

function getMlServiceUrl(): string | null {
  const raw = process.env.ML_SERVICE_URL?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function checkMlServiceHealth(): Promise<{
  configured: boolean;
  reachable: boolean;
  urlConfigured: boolean;
  demoMode: boolean;
  engineLabel: string;
}> {
  const baseUrl = getMlServiceUrl();
  if (!baseUrl) {
    return {
      configured: false,
      reachable: false,
      urlConfigured: false,
      demoMode: true,
      engineLabel: "Demo Mode · Python Isolation Forest Not Connected",
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return {
        configured: true,
        reachable: false,
        urlConfigured: true,
        demoMode: true,
        engineLabel: "Demo Mode · Python FastAPI Service Unreachable",
      };
    }
    return {
      configured: true,
      reachable: true,
      urlConfigured: true,
      demoMode: false,
      engineLabel: "Python FastAPI + scikit-learn Isolation Forest (Connected)",
    };
  } catch {
    return {
      configured: true,
      reachable: false,
      urlConfigured: true,
      demoMode: true,
      engineLabel: "Demo Mode · Python FastAPI Service Unreachable",
    };
  }
}

export function validateSensorQuality(payload: TelemetryPayload): {
  signalQuality: SignalQuality;
  notes: string[];
} {
  const notes: string[] = [];
  const isDatasetPlayback = payload.source === "dataset_playback";
  const hrExpected = !isDatasetPlayback || payload.availableModalities?.heartRate !== false;
  const spo2Expected = !isDatasetPlayback || payload.availableModalities?.spo2 !== false;

  if (payload.fingerDetected === false || payload.irSignalOk === false) {
    notes.push("MAX30100 optical sensor reports no finger detected or low IR perfusion.");
  } else {
    if (hrExpected && (payload.heartRate === null || payload.heartRate === 0)) {
      notes.push("MAX30100 optical sensor reports no finger detected or low IR perfusion.");
    } else if (payload.heartRate !== null && (payload.heartRate < 30 || payload.heartRate > 230)) {
      notes.push(`Heart rate (${payload.heartRate} BPM) outside valid physiological sensor bounds.`);
    }

    if (spo2Expected && (payload.spo2 === null || payload.spo2 === 0)) {
      notes.push("MAX30100 optical sensor reports missing or invalid SpO2 optical signal.");
    } else if (payload.spo2 !== null && (payload.spo2 < 50 || payload.spo2 > 100)) {
      notes.push(`SpO2 (${payload.spo2}%) outside valid pulse oximetry bounds.`);
    }
  }

  const minTemp = isDatasetPlayback && payload.temperatureSite === "skin_wrist" ? 25 : 30;
  if (payload.temperatureC !== null && (payload.temperatureC < minTemp || payload.temperatureC > 43)) {
    notes.push(`Temperature (${payload.temperatureC} °C) suggests probe detachment or sensor fault.`);
  }

  if (notes.length > 0) {
    return { signalQuality: "poor_contact", notes };
  }
  if (payload.accelMagnitude > 2.6) {
    return {
      signalQuality: "noisy",
      notes: ["High MPU6050 movement detected; optical PPG reading may contain motion noise."],
    };
  }
  return { signalQuality: "good", notes: [] };
}

export async function analyzeTelemetry(payload: TelemetryPayload): Promise<MlAnalysisResult> {
  const source: TelemetrySource = payload.source ?? "simulator";
  const timestampStr = payload.timestamp ?? new Date().toISOString();
  const parsedTs = Date.parse(timestampStr);
  const timestampMs = Number.isFinite(parsedTs) ? parsedTs : Date.now();
  const requiredSamples = Math.max(5, Math.round(payload.policyConfig?.baselineMinSamples ?? 20));
  const effectiveModalities = source === "dataset_playback" ? payload.availableModalities : undefined;

  const ecgFeatures =
    payload.ecgFeatures ??
    (Array.isArray(payload.ecgSamples) || payload.ecgLeadOff !== undefined || payload.ecgSignalQuality
      ? extractEcgFeatures({
          samples: payload.ecgSamples,
          samplingRateHz: payload.ecgSamplingRate,
          leadOff: payload.ecgLeadOff,
          reportedQuality: payload.ecgSignalQuality,
        })
      : undefined);

  const qualityCheck = validateSensorQuality(payload);
  const ecgLeadOff = Boolean(payload.ecgLeadOff || ecgFeatures?.signalQuality === "lead_off");

  // Incremental quality-filtered baseline collection (source-separated: esp32_hardware vs simulator vs dataset_playback; sample_demo excluded;
  // fall-labeled dataset_playback frames set allowBaselineTraining=false to prevent training on fall events)
  const allowBaselineTraining = payload.allowBaselineTraining !== false;
  const opticalReadyForSource =
    source === "dataset_playback" || (payload.heartRate !== null && payload.spo2 !== null);
  if (
    allowBaselineTraining &&
    qualityCheck.signalQuality === "good" &&
    opticalReadyForSource &&
    (source === "esp32_hardware" || source === "simulator" || source === "dataset_playback")
  ) {
    sharedBaselineTracker.recordCleanSample(
      payload.patientId,
      source,
      {
        timestampMs,
        heartRate: payload.heartRate,
        spo2: payload.spo2,
        temperatureC: payload.temperatureC,
        accelMagnitude: payload.accelMagnitude,
        gyroMagnitude: payload.gyroMagnitude,
        movementStatus: payload.movementStatus,
        signalQuality: qualityCheck.signalQuality,
        ecgBpm: ecgFeatures?.estimatedEcgBpm ?? null,
        ecgRriMs: ecgFeatures?.rrIntervalMeanMs ?? null,
        ecgHrvMs: ecgFeatures?.rrVariabilityMs ?? null,
        ecgSignalQuality: ecgFeatures?.signalQuality ?? "unavailable",
        ecgLeadOff,
        temperatureSite: payload.temperatureSite,
        availableModalities: effectiveModalities,
      },
      requiredSamples
    );
  }

  const profile = sharedBaselineTracker.getProfile(payload.patientId, source);
  const baselineProgress = sharedBaselineTracker.getProgress(payload.patientId, source, requiredSamples);
  const baselineReady = Boolean(
    (profile && baselineProgress.status === "ready") || payload.baselineTrained === true
  );

  // Append to timestamp-ordered sliding window separated by (patientId, source)
  const window = sharedWindowStore.append(payload.patientId, source, {
    timestampMs,
    heartRate: payload.heartRate,
    spo2: payload.spo2,
    temperatureC: payload.temperatureC,
    accelMagnitude: payload.accelMagnitude,
    gyroMagnitude: payload.gyroMagnitude,
    movementStatus: payload.movementStatus,
    signalQuality: qualityCheck.signalQuality,
    ecgFeatures,
    ecgLeadOff,
  });

  const features = extractWindowFeatures({
    window,
    profile,
    fallbackBaselineMeans: payload.baselineMeans,
  });

  const baseUrl = getMlServiceUrl();
  if (baseUrl) {
    try {
      const sendAnalyze = async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        try {
          return await fetch(`${baseUrl}/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              patient_id: payload.patientId,
              source,
              timestamp: timestampStr,
              heart_rate: payload.heartRate,
              spo2: payload.spo2,
              temperature_c: payload.temperatureC,
              accel_magnitude: payload.accelMagnitude,
              gyro_magnitude: payload.gyroMagnitude,
              movement_status: payload.movementStatus,
              possible_fall_detected: Boolean(payload.possibleFallDetected),
              ir_signal_ok: payload.irSignalOk ?? true,
              finger_detected: payload.fingerDetected ?? true,
              baseline_min_samples: Math.max(20, requiredSamples),
              warning_persistence_windows: payload.policyConfig?.warningPersistenceWindows ?? 2,
              critical_persistence_windows: payload.policyConfig?.criticalPersistenceWindows ?? 3,
              anomaly_score_warning: payload.policyConfig?.anomalyScoreWarningThreshold ?? -0.05,
              available_modalities: effectiveModalities ?? null,
              temperature_site: payload.temperatureSite ?? null,
              respiratory_rate_bpm: payload.respiratoryRateBpm ?? null,
              sleep_stage: payload.sleepStage ?? null,
              ecg_features: ecgFeatures
                ? {
                    sampling_rate_hz: ecgFeatures.samplingRateHz,
                    sample_count: ecgFeatures.sampleCount,
                    r_peak_count: ecgFeatures.rPeakCount,
                    estimated_ecg_bpm: ecgFeatures.estimatedEcgBpm,
                    rr_interval_mean_ms: ecgFeatures.rrIntervalMeanMs,
                    rr_variability_ms: ecgFeatures.rrVariabilityMs,
                    amplitude_range: ecgFeatures.amplitudeRange,
                    signal_quality: ecgFeatures.signalQuality,
                  }
                : null,
            }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      };

      let res = await sendAnalyze();
      if (res.ok) {
        let data = (await res.json()) as {
          model_trained: boolean;
          model_version?: string | null;
          ecg_model_trained?: boolean;
          signal_quality: SignalQuality;
          anomaly_status?: AnomalyStatus;
          anomaly_score: number;
          alert_level: AlertLevel;
          triggered_metrics: string[];
          contributing_features?: string[];
          persistence_count?: number;
          persistence_required?: number;
          matched_baseline_context?: string;
          window_size?: number;
          explanation: string;
        };

        // If Node has accumulated >= max(20, requiredSamples) clean samples and Python model isn't trained yet, sync fit once
        const effectiveIfMin = Math.max(20, requiredSamples);
        const cachedClean = sharedBaselineTracker.getSamples(payload.patientId, source);
        if (
          allowBaselineTraining &&
          !data.model_trained &&
          (source === "esp32_hardware" || source === "simulator" || source === "dataset_playback") &&
          cachedClean.length >= effectiveIfMin
        ) {
          const fitController = new AbortController();
          const fitTimer = setTimeout(() => fitController.abort(), 5000);
          try {
            const fitRes = await fetch(`${baseUrl}/baseline/fit`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                patient_id: payload.patientId,
                source,
                min_samples: effectiveIfMin,
                available_modalities: effectiveModalities ?? null,
                temperature_site: payload.temperatureSite ?? null,
                samples: cachedClean.map((s) => ({
                  heart_rate: s.heartRate,
                  spo2: s.spo2,
                  temperature_c: s.temperatureC,
                  accel_magnitude: s.accelMagnitude,
                  gyro_magnitude: s.gyroMagnitude,
                  movement_status: s.movementStatus,
                  signal_quality: s.signalQuality,
                  timestamp: new Date(s.timestampMs).toISOString(),
                  ecg_bpm: s.ecgBpm ?? null,
                  ecg_rri_ms: s.ecgRriMs ?? null,
                  ecg_hrv_ms: s.ecgHrvMs ?? null,
                  ecg_signal_quality: s.ecgSignalQuality ?? "unavailable",
                  ecg_lead_off: Boolean(s.ecgLeadOff),
                })),
              }),
              signal: fitController.signal,
            });
            if (fitRes.ok) {
              const retryRes = await sendAnalyze();
              if (retryRes.ok) {
                data = (await retryRes.json()) as typeof data;
              }
            }
          } finally {
            clearTimeout(fitTimer);
          }
        }

        const syncedProgress: BaselineProgress =
          data.model_trained && baselineProgress.status !== "ready"
            ? {
                ...baselineProgress,
                status: "ready",
                source,
                modelVersion: data.model_version ?? baselineProgress.modelVersion,
              }
            : {
                ...baselineProgress,
                modelVersion: data.model_version ?? baselineProgress.modelVersion,
              };

        const resolvedAnomalyStatus: AnomalyStatus =
          data.anomaly_status ??
          (data.signal_quality === "poor_contact"
            ? "paused_poor_quality"
            : !data.model_trained
            ? "insufficient_baseline"
            : data.alert_level === "Normal"
            ? "normal"
            : "anomalous");
        const resolvedTriggered = Array.isArray(data.triggered_metrics) ? data.triggered_metrics : [];

        return {
          mlServiceConnected: true,
          mlEngine: "python_isolation_forest",
          modelTrained: Boolean(data.model_trained),
          modelVersion: data.model_version ?? profile?.modelVersion ?? null,
          ecgModelTrained: Boolean(data.ecg_model_trained),
          signalQuality: data.signal_quality,
          anomalyStatus: resolvedAnomalyStatus,
          anomalyScore: Number(data.anomaly_score),
          alertLevel: data.alert_level,
          triggeredMetrics: resolvedTriggered,
          contributingFeatures: Array.isArray(data.contributing_features)
            ? data.contributing_features
            : [],
          contributingDetails: features.contributingDetails.slice(0, 5),
          persistenceCount: Number(data.persistence_count ?? 0),
          persistenceRequired: Number(
            data.persistence_required ?? payload.policyConfig?.warningPersistenceWindows ?? 2
          ),
          matchedBaselineContext: data.matched_baseline_context ?? features.matchedBaselineContext,
          windowSize: Number(data.window_size ?? features.windowSize),
          baselineProgress: syncedProgress,
          explanation: data.explanation,
          ecgFeatures,
          predictionClassification: classifyPrediction(payload, {
            anomalyStatus: resolvedAnomalyStatus,
            alertLevel: data.alert_level,
            triggeredMetrics: resolvedTriggered,
          }),
        };
      }
    } catch {
      // Fall through honestly to local windowed decision engine marked as unconnected
    }
  }

  // Honest fallback when external Python FastAPI Isolation Forest service is not connected
  const decision = sharedAlertDecisionEngine.evaluate({
    patientId: payload.patientId,
    source,
    signalQuality: qualityCheck.signalQuality,
    qualityNotes: qualityCheck.notes,
    ecgLeadOff,
    heartRate: payload.heartRate,
    spo2: payload.spo2,
    temperatureC: payload.temperatureC,
    accelMagnitude: payload.accelMagnitude,
    possibleFallDetected: Boolean(payload.possibleFallDetected),
    baselineReady,
    baselineProgress,
    features,
    mlServiceConnected: false,
    policyInput: payload.policyConfig,
    availableModalities: effectiveModalities,
  });

  return {
    mlServiceConnected: false,
    mlEngine: "unconnected_rule_check",
    modelTrained: Boolean(profile?.remotePythonTrained),
    modelVersion: profile?.modelVersion ?? null,
    ecgModelTrained: false,
    signalQuality: qualityCheck.signalQuality,
    anomalyStatus: decision.anomalyStatus,
    anomalyScore: decision.anomalyScore,
    alertLevel: decision.alertLevel,
    triggeredMetrics: decision.triggeredMetrics,
    contributingFeatures: decision.contributingFeatures,
    contributingDetails: features.contributingDetails.slice(0, 5),
    persistenceCount: decision.persistenceCount,
    persistenceRequired: decision.persistenceRequired,
    matchedBaselineContext: features.matchedBaselineContext,
    windowSize: features.windowSize,
    baselineProgress,
    explanation: decision.explanation,
    ecgFeatures,
    predictionClassification: classifyPrediction(payload, {
      anomalyStatus: decision.anomalyStatus,
      alertLevel: decision.alertLevel,
      triggeredMetrics: decision.triggeredMetrics,
    }),
  };
}

export async function fitPatientBaselineRemote(
  patientId: string,
  samples: Array<{
    heartRate: number | null;
    spo2: number | null;
    temperatureC: number | null;
    accelMagnitude: number;
    gyroMagnitude: number;
    movementStatus?: MovementStatus;
    signalQuality?: SignalQuality;
    timestamp?: string;
    ecgBpm?: number | null;
    ecgRriMs?: number | null;
    ecgHrvMs?: number | null;
    ecgSignalQuality?: EcgSignalQuality;
    ecgLeadOff?: boolean;
    temperatureSite?: TemperatureSite | null;
  }>,
  options?: {
    source?: TelemetrySource;
    minSamples?: number;
    availableModalities?: AvailableModalities;
    temperatureSite?: TemperatureSite | null;
  }
): Promise<{
  mlServiceConnected: boolean;
  trained: boolean;
  baselineStatus: "not_started" | "collecting" | "ready";
  sampleCount: number;
  requiredSamples: number;
  source: TelemetrySource;
  modelVersion: string;
  restingSamples: number;
  activeSamples: number;
  ecgBaselineSamples: number;
  means: { heartRate: number; spo2: number; temperatureC: number };
  ecgBpmMean: number | null;
  activeHeartRateMean: number | null;
  message: string;
}> {
  const source: TelemetrySource = options?.source ?? "simulator";
  const minSamples = Math.max(5, Math.round(options?.minSamples ?? 20));
  const effectiveModalities = source === "dataset_playback" ? options?.availableModalities : undefined;

  const mappedSamples = samples.map((s) => ({
    timestampMs: s.timestamp && Number.isFinite(Date.parse(s.timestamp)) ? Date.parse(s.timestamp) : Date.now(),
    heartRate: typeof s.heartRate === "number" && Number.isFinite(s.heartRate) ? s.heartRate : null,
    spo2: typeof s.spo2 === "number" && Number.isFinite(s.spo2) ? s.spo2 : null,
    temperatureC: typeof s.temperatureC === "number" && Number.isFinite(s.temperatureC) ? s.temperatureC : null,
    accelMagnitude: s.accelMagnitude,
    gyroMagnitude: s.gyroMagnitude,
    movementStatus: s.movementStatus ?? ("resting" as MovementStatus),
    signalQuality: s.signalQuality ?? ("good" as SignalQuality),
    ecgBpm: s.ecgBpm ?? null,
    ecgRriMs: s.ecgRriMs ?? null,
    ecgHrvMs: s.ecgHrvMs ?? null,
    ecgSignalQuality: s.ecgSignalQuality ?? ("unavailable" as EcgSignalQuality),
    ecgLeadOff: Boolean(s.ecgLeadOff),
    temperatureSite: s.temperatureSite ?? options?.temperatureSite ?? null,
    availableModalities: effectiveModalities,
  }));

  let remoteTrained = false;
  let remoteConnected = false;
  let remoteModelVersion: string | null = null;

  const effectivePythonMin = Math.max(20, minSamples);
  const baseUrl = getMlServiceUrl();
  if (baseUrl && mappedSamples.length >= effectivePythonMin) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${baseUrl}/baseline/fit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId,
          source,
          min_samples: effectivePythonMin,
          available_modalities: effectiveModalities ?? null,
          temperature_site: options?.temperatureSite ?? null,
          samples: mappedSamples.map((s) => ({
            heart_rate: s.heartRate,
            spo2: s.spo2,
            temperature_c: s.temperatureC,
            accel_magnitude: s.accelMagnitude,
            gyro_magnitude: s.gyroMagnitude,
            movement_status: s.movementStatus,
            signal_quality: s.signalQuality,
            timestamp: new Date(s.timestampMs).toISOString(),
            ecg_bpm: s.ecgBpm,
            ecg_rri_ms: s.ecgRriMs,
            ecg_hrv_ms: s.ecgHrvMs,
            ecg_signal_quality: s.ecgSignalQuality,
            ecg_lead_off: s.ecgLeadOff,
          })),
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const remoteData = (await res.json()) as { trained?: boolean; model_version?: string };
        remoteConnected = true;
        remoteTrained = Boolean(remoteData.trained);
        remoteModelVersion = remoteData.model_version ?? null;
      }
    } catch {
      // Fall through honestly
    }
  }

  const profile = sharedBaselineTracker.fitBaseline(
    patientId,
    source,
    mappedSamples,
    minSamples,
    remoteTrained,
    remoteModelVersion
  );

  const baselineStatus: "not_started" | "collecting" | "ready" =
    profile.sampleCount >= minSamples ? "ready" : "collecting";

  const message = remoteTrained
    ? `Fitted personalized scikit-learn Isolation Forest (${profile.modelVersion}) on ${profile.sampleCount} quality-filtered ${source} readings.`
    : profile.sampleCount < minSamples
    ? `Collected ${profile.sampleCount}/${minSamples} quality-filtered ${source} readings (mean HR ${profile.means.heartRate.toFixed(1)} BPM, SpO2 ${profile.means.spo2.toFixed(1)}%). Collect at least ${minSamples} clean readings to complete personalized baseline learning.`
    : baseUrl && profile.sampleCount < effectivePythonMin
    ? `Computed statistical baseline on ${profile.sampleCount} ${source} readings; scikit-learn Isolation Forest requires at least ${effectivePythonMin} quality-filtered readings before fitting.`
    : `Computed personalized multi-context baseline (${profile.sampleCount} ${source} readings, resting=${profile.resting?.sampleCount ?? 0}, active=${profile.active?.sampleCount ?? 0}). Python FastAPI Isolation Forest service is not connected yet, so scikit-learn model persistence runs locally once connected.`;

  return {
    mlServiceConnected: remoteConnected,
    trained: remoteTrained,
    baselineStatus,
    sampleCount: profile.sampleCount,
    requiredSamples: minSamples,
    source,
    modelVersion: profile.modelVersion,
    restingSamples: profile.resting?.sampleCount ?? 0,
    activeSamples: profile.active?.sampleCount ?? 0,
    ecgBaselineSamples: profile.ecgBaselineSamples,
    means: {
      heartRate: Number(profile.means.heartRate.toFixed(1)),
      spo2: Number(profile.means.spo2.toFixed(1)),
      temperatureC: Number(profile.means.temperatureC.toFixed(2)),
    },
    ecgBpmMean: profile.ecgBpmMean,
    activeHeartRateMean: profile.active?.heartRateMean ?? null,
    message,
  };
}

export function getPatientBaselineStatusSummary(
  patientId: string,
  requiredSamples = 20
): {
  patientId: string;
  esp32Hardware: BaselineProgress;
  simulator: BaselineProgress;
  activeBaseline: BaselineProgress;
} {
  const hw = sharedBaselineTracker.getProgress(patientId, "esp32_hardware", requiredSamples);
  const sim = sharedBaselineTracker.getProgress(patientId, "simulator", requiredSamples);
  const activeBaseline = hw.collectedSamples > 0 ? hw : sim;
  return {
    patientId,
    esp32Hardware: hw,
    simulator: sim,
    activeBaseline,
  };
}

export async function resetPatientMlRemote(
  patientId: string,
  source?: "esp32_hardware" | "simulator" | "dataset_playback"
): Promise<{ remoteCleared: boolean }> {
  sharedBaselineTracker.resetPatient(patientId, source);
  sharedWindowStore.clear(patientId);
  sharedAlertDecisionEngine.clear(patientId);

  const baseUrl = getMlServiceUrl();
  if (!baseUrl) {
    return { remoteCleared: false };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(`${baseUrl}/baseline/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, source: source ?? null }),
        signal: controller.signal,
      });
      return { remoteCleared: res.ok };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { remoteCleared: false };
  }
}
