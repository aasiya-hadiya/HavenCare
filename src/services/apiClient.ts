import type {
  AnomalyStatus,
  BaselineProgressSummary,
  DatasetAdapterSpec,
  DatasetImportResponse,
  EcgFeatures,
  EcgSegmentRecord,
  EcgSignalQuality,
  IntegrationStatus,
  MovementStatus,
  PlaybackFrameResult,
  PlaybackStateSnapshot,
  PublicDatasetCatalogEntry,
  TelemetrySource,
  UserRole,
} from "../types/smartcare.ts";

export async function fetchIntegrationStatus(): Promise<IntegrationStatus> {
  const res = await fetch("/api/system/integrations");
  if (!res.ok) {
    throw new Error("Failed to check backend integration status.");
  }
  return res.json();
}

export async function fetchLatestHardwareEvents(patientId?: string): Promise<{
  snapshot?: Record<string, unknown> | null;
  ecgHistory?: EcgSegmentRecord[];
  events?: Array<Record<string, unknown>>;
}> {
  const qs = patientId ? `?patientId=${encodeURIComponent(patientId)}` : "";
  const res = await fetch(`/api/wearable/latest${qs}`);
  if (!res.ok) {
    throw new Error("Failed to query hardware ingestion buffer.");
  }
  return res.json();
}

export async function fetchPatientBaselineStatus(
  patientId: string,
  minSamples = 20
): Promise<{
  patientId: string;
  esp32Hardware: BaselineProgressSummary;
  simulator: BaselineProgressSummary;
  activeBaseline: BaselineProgressSummary;
}> {
  const res = await fetch(
    `/api/ml/baseline/status/${encodeURIComponent(patientId)}?minSamples=${encodeURIComponent(String(minSamples))}`
  );
  if (!res.ok) {
    throw new Error("Failed to load patient baseline status.");
  }
  return res.json();
}

export async function sendSimulatedWearablePacket(payload: {
  deviceId: string;
  patientId: string;
  timestamp?: string;
  heartRate: number | null;
  spo2: number | null;
  temperatureC: number | null;
  accelMagnitude: number;
  gyroMagnitude: number;
  movementStatus: MovementStatus;
  possibleFallDetected?: boolean;
  irSignalOk?: boolean;
  fingerDetected?: boolean;
  ecgSamples?: number[];
  ecgSamplingRate?: number;
  ecgSignalQuality?: EcgSignalQuality;
  ecgLeadOff?: boolean;
  ecgTimestamp?: string;
  source?: TelemetrySource;
  baselineMeans?: {
    heartRate: number;
    spo2: number;
    temperatureC: number;
  };
  baselineTrained?: boolean;
  policyConfig?: {
    baselineMinSamples?: number;
    warningPersistenceWindows?: number;
    criticalPersistenceWindows?: number;
    anomalyScoreWarningThreshold?: number;
  };
}) {
  const res = await fetch("/api/wearable/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      source: payload.source ?? "simulator",
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Telemetry ingestion failed.");
  }
  return data as {
    ok: boolean;
    deviceId: string;
    patientId: string;
    heartRate: number | null;
    spo2: number | null;
    temperatureC: number | null;
    accelMagnitude: number;
    gyroMagnitude: number;
    movementStatus: MovementStatus;
    possibleFallDetected: boolean;
    ecgSamples: number[];
    ecgSamplingRate: number;
    ecgSignalQuality: EcgSignalQuality;
    ecgLeadOff: boolean;
    ecgTimestamp: string | null;
    ecgFeatures: EcgFeatures;
    signalQuality: "good" | "noisy" | "poor_contact";
    anomalyStatus: AnomalyStatus;
    anomalyScore: number;
    alertLevel: "Normal" | "Warning" | "Critical";
    mlEngine: "unconnected_rule_check" | "python_isolation_forest";
    mlServiceConnected: boolean;
    modelTrained: boolean;
    modelVersion: string | null;
    ecgModelTrained: boolean;
    triggeredMetrics: string[];
    contributingFeatures: string[];
    persistenceCount: number;
    persistenceRequired: number;
    matchedBaselineContext: string;
    windowSize: number;
    baselineProgress: BaselineProgressSummary;
    explanation: string;
    hapticPattern: string;
    receivedAt: string;
    source: TelemetrySource;
  };
}

export async function requestBaselineFit(
  patientId: string,
  samples: Array<{
    heartRate: number;
    spo2: number;
    temperatureC: number | null;
    accelMagnitude?: number;
    gyroMagnitude?: number;
    movementStatus?: MovementStatus;
    signalQuality?: "good" | "noisy" | "poor_contact";
    timestamp?: string;
    ecgBpm?: number | null;
    ecgSignalQuality?: EcgSignalQuality;
    ecgLeadOff?: boolean;
  }>,
  options?: {
    source?: TelemetrySource;
    minSamples?: number;
  }
) {
  const res = await fetch("/api/ml/baseline/fit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientId,
      samples,
      source: options?.source ?? "simulator",
      minSamples: options?.minSamples ?? 20,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Baseline fitting failed.");
  }
  return data as {
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
  };
}

export async function triggerVoiceEscalation(params: {
  alertId: string;
  patientId: string;
  patientName: string;
  summary: string;
  primaryCaregiverName: string;
  secondaryCaregiverName: string;
  timeoutSec: number;
  dryRun: boolean;
}) {
  const res = await fetch("/api/voice/escalate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Escalation request failed.");
  }
  return data as {
    alertId: string;
    status:
      | "not_triggered"
      | "provider_unconfigured"
      | "calling_primary"
      | "primary_answered"
      | "escalated_secondary"
      | "completed";
    providerConfigured: boolean;
    providerName: string;
    timeoutSec: number;
    isDryRun: boolean;
    log: string[];
  };
}

export async function advanceVoiceOutcome(
  alertId: string,
  action: "primary_answered" | "primary_no_answer_escalate" | "secondary_acknowledged"
) {
  const res = await fetch("/api/voice/outcome", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alertId, action }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to update escalation outcome.");
  }
  return data as {
    alertId: string;
    status:
      | "not_triggered"
      | "provider_unconfigured"
      | "calling_primary"
      | "primary_answered"
      | "escalated_secondary"
      | "completed";
    log: string[];
  };
}

export async function askGeminiAssistant(params: {
  question: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  context: {
    role: UserRole;
    patientName: string;
    dataMode: "sample" | "live";
    baselineStatus: string;
    baselineSummary: string;
    latestReading: {
      heartRate: number | null;
      spo2: number | null;
      temperatureC: number | null;
      movementStatus: string;
      signalQuality: string;
      alertLevel: string;
      anomalyScore: number;
      source: string;
      explanation: string;
      timestamp: string;
    } | null;
    recentReadings: Array<{
      heartRate: number | null;
      spo2: number | null;
      temperatureC: number | null;
      movementStatus: string;
      alertLevel: string;
      timestamp: string;
    }>;
    recentAlerts: Array<{
      level: string;
      status: string;
      title: string;
      explanation: string;
      callEscalationStatus: string;
      timestamp: string;
    }>;
  };
}): Promise<string> {
  const res = await fetch("/api/ai/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Assistant request failed.");
  }
  return data.answer as string;
}

// --- Stage 3: Dataset Lab API Client ---

export class DatasetImportApiError extends Error {
  public readonly code?: string;
  public readonly details?: string[];

  constructor(message: string, code?: string, details?: string[]) {
    super(message);
    this.name = "DatasetImportApiError";
    this.code = code;
    this.details = details;
  }
}

export async function fetchDatasetCatalog(): Promise<{
  stage: number;
  integratedLocally: boolean;
  datasets: PublicDatasetCatalogEntry[];
}> {
  const res = await fetch("/api/datasets/catalog");
  if (!res.ok) {
    throw new Error("Failed to load public dataset catalog.");
  }
  return res.json();
}

export async function fetchDatasetAdapters(): Promise<{
  stage: number;
  adapters: DatasetAdapterSpec[];
}> {
  const res = await fetch("/api/datasets/adapters");
  if (!res.ok) {
    throw new Error("Failed to load dataset adapter specifications.");
  }
  return res.json();
}

export async function importDatasetFile(payload: {
  datasetId: string;
  filename: string;
  content: string;
  participantId?: string;
  recordId?: string;
  windowMs?: number;
  autoLoadPlayback?: boolean;
  speed?: number;
  prefitBaselineCount?: number;
  minBaselineSamples?: number;
}): Promise<DatasetImportResponse> {
  const res = await fetch("/api/datasets/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as Partial<DatasetImportResponse> & {
    error?: string;
    code?: string;
    details?: string[];
  };
  if (!res.ok) {
    throw new DatasetImportApiError(
      data.error || "Dataset import failed.",
      data.code,
      data.details
    );
  }
  return data as DatasetImportResponse;
}

export async function fetchPlaybackStatus(): Promise<PlaybackStateSnapshot> {
  const res = await fetch("/api/datasets/playback/status");
  if (!res.ok) {
    throw new Error("Failed to fetch dataset playback status.");
  }
  return res.json();
}

export async function startPlayback(): Promise<PlaybackStateSnapshot> {
  const res = await fetch("/api/datasets/playback/start", { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to start playback.");
  return data as PlaybackStateSnapshot;
}

export async function pausePlayback(): Promise<PlaybackStateSnapshot> {
  const res = await fetch("/api/datasets/playback/pause", { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to pause playback.");
  return data as PlaybackStateSnapshot;
}

export async function resumePlayback(): Promise<PlaybackStateSnapshot> {
  const res = await fetch("/api/datasets/playback/resume", { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to resume playback.");
  return data as PlaybackStateSnapshot;
}

export async function stepPlayback(): Promise<{
  snapshot: PlaybackStateSnapshot;
  result: PlaybackFrameResult | null;
}> {
  const res = await fetch("/api/datasets/playback/step", { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to step playback.");
  return data as { snapshot: PlaybackStateSnapshot; result: PlaybackFrameResult | null };
}

export async function resetPlayback(): Promise<PlaybackStateSnapshot> {
  const res = await fetch("/api/datasets/playback/reset", { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to reset playback.");
  return data as PlaybackStateSnapshot;
}

export async function setPlaybackSpeed(speed: number): Promise<PlaybackStateSnapshot> {
  const res = await fetch("/api/datasets/playback/speed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ speed }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to update playback speed.");
  return data as PlaybackStateSnapshot;
}

