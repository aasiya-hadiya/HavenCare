export type UserRole = "patient" | "caregiver" | "admin";
export type AlertLevel = "Normal" | "Warning" | "Critical";
export type MovementStatus = "resting" | "walking" | "active" | "fall_suspect" | "inactive";
export type SignalQuality = "good" | "noisy" | "poor_contact";
export type EcgSignalQuality = "good" | "noisy" | "lead_off" | "unavailable";
export type TelemetrySource = "sample_demo" | "simulator" | "esp32_hardware" | "dataset_playback";
export type MlEngineType = "unconnected_rule_check" | "python_isolation_forest";
export type AnomalyStatus =
  | "insufficient_baseline"
  | "paused_poor_quality"
  | "normal"
  | "anomalous";
export type TemperatureSite =
  | "skin_wrist"
  | "skin_chest"
  | "axillary"
  | "core_rectal"
  | "ambient"
  | "unknown";
export type SleepStage = "wake" | "n1" | "n2" | "n3" | "rem" | "asleep" | "unknown";
export type BaselineStatus = "not_started" | "collecting" | "ready";
export type AlertStatus = "active" | "acknowledged" | "resolved";
export type CallEscalationStatus =
  | "not_triggered"
  | "provider_unconfigured"
  | "calling_primary"
  | "primary_answered"
  | "escalated_secondary"
  | "completed";

export const VALIDATION_LIMITS = {
  MAX_ID_LEN: 128,
  MAX_NAME_LEN: 100,
  MAX_TITLE_LEN: 160,
  MAX_EXPLANATION_LEN: 600,
  MAX_ALERT_EXPLANATION_LEN: 800,
  MAX_FOLLOWUP_LEN: 500,
  MAX_ECG_BATCH: 250,
  ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
} as const;

export interface EcgFeatures {
  samplingRateHz: number;
  sampleCount: number;
  rPeakCount: number;
  estimatedEcgBpm: number | null;
  rrIntervalMeanMs: number | null;
  rrVariabilityMs: number | null;
  amplitudeRange: number;
  signalQuality: EcgSignalQuality;
}

export interface EcgSegmentRecord {
  segmentId: string;
  deviceId: string;
  patientId: string;
  samples: number[];
  samplingRate: number;
  signalQuality: EcgSignalQuality;
  leadOff: boolean;
  timestamp: string;
  features?: EcgFeatures;
  source: TelemetrySource;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  role: UserRole;
  createdAt?: string;
  updatedAt?: string;
}

export interface PatientRecord {
  patientId: string;
  ownerUid: string;
  displayName: string;
  ageGroup?: string;
  baselineStatus: BaselineStatus;
  baselineSamplesCount: number;
  baselineHeartRateMean?: number;
  baselineSpo2Mean?: number;
  baselineTempMean?: number;
  baselineSource?: TelemetrySource;
  baselineModelTrained?: boolean;
  baselineModelVersion?: string;
  baselineEcgBpmMean?: number;
  baselineActiveHrMean?: number;
  primaryCaregiverUid?: string;
  secondaryCaregiverUid?: string;
  primaryCaregiverName?: string;
  secondaryCaregiverName?: string;
  dataMode: "sample" | "live";
  createdAt?: string;
  updatedAt?: string;
}

export interface VitalReading {
  readingId: string;
  patientId: string;
  ownerUid: string;
  primaryCaregiverUid?: string;
  secondaryCaregiverUid?: string;
  heartRate: number | null;
  spo2: number | null;
  temperatureC: number | null;
  movementStatus: MovementStatus;
  accelMagnitude?: number;
  gyroMagnitude?: number;
  possibleFallDetected?: boolean;
  accelX?: number | null;
  accelY?: number | null;
  accelZ?: number | null;
  gyroX?: number | null;
  gyroY?: number | null;
  gyroZ?: number | null;
  imuSamplingRate?: number | null;
  respiratoryRateBpm?: number | null;
  temperatureSite?: TemperatureSite | null;
  sleepStage?: SleepStage | null;
  ecgSamples?: number[];
  ecgSamplingRate?: number;
  ecgSignalQuality?: EcgSignalQuality;
  ecgLeadOff?: boolean;
  ecgTimestamp?: string;
  ecgHeartRateBpm?: number;
  signalQuality: SignalQuality;
  anomalyStatus?: AnomalyStatus;
  anomalyScore: number;
  alertLevel: AlertLevel;
  contributingFeatures?: string[];
  persistenceCount?: number;
  modelVersion?: string;
  source: TelemetrySource;
  mlEngine: MlEngineType;
  explanation: string;
  createdAt: string;
}

export interface AlertRecord {
  alertId: string;
  patientId: string;
  ownerUid: string;
  primaryCaregiverUid?: string;
  secondaryCaregiverUid?: string;
  level: "Warning" | "Critical";
  status: AlertStatus;
  title: string;
  explanation: string;
  triggeredMetrics: string[];
  source: TelemetrySource;
  acknowledgedByUid?: string;
  acknowledgedByName?: string;
  followUpAction?: string;
  callEscalationStatus: CallEscalationStatus;
  callLog: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WearableDevice {
  deviceId: string;
  label: string;
  patientId: string;
  ownerUid: string;
  boardType: string;
  pulseOxChipVariant: string;
  ecgSensor?: string;
  imuSensor: string;
  tempSensor: string;
  displayModule: string;
  hapticModule: string;
  samplingIntervalMs: number;
  connectionStatus: "not_connected" | "streaming" | "offline";
  lastSeenAt?: string;
  firmwareVersion: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CareLink {
  linkId: string;
  patientId: string;
  patientName: string;
  patientOwnerUid: string;
  caregiverUid: string;
  caregiverName: string;
  priority: "primary" | "secondary";
  status: "active" | "pending" | "revoked";
  createdAt?: string;
  updatedAt?: string;
}

export interface SystemSettings {
  settingId: string;
  escalationTimeoutSec: number;
  baselineMinSamples: number;
  samplingDefaultMs: number;
  warningPersistenceWindows?: number;
  criticalPersistenceWindows?: number;
  anomalyScoreThreshold?: number;
  updatedByUid: string;
  updatedAt?: string;
}

export interface BaselineProgressSummary {
  collectedSamples: number;
  requiredSamples: number;
  status: BaselineStatus;
  source: TelemetrySource | null;
  modelVersion: string | null;
  restingSamples: number;
  activeSamples: number;
  ecgBaselineSamples: number;
}

export interface IntegrationStatus {
  gemini: {
    configured: boolean;
    model: string;
  };
  mlService: {
    configured: boolean;
    reachable: boolean;
    urlConfigured: boolean;
    demoMode: boolean;
    engineLabel: string;
  };
  voiceCalling: {
    configured: boolean;
    providerName: string;
    timeoutSec: number;
    usingDefaultTimeout: boolean;
  };
  wearableIngest: {
    endpoint: string;
    tokenProtected: boolean;
  };
}

// --- Stage 3: Public Dataset Lab Types ---

export type DatasetAccessTier =
  | "open_access"
  | "registration_required"
  | "restricted_dua"
  | "credentialed_required";

export type DatasetAgeCohort =
  | "mixed_young_and_elderly"
  | "wide_adult_including_elderly"
  | "general_adult"
  | "young_healthy_adults"
  | "adult_clinical_sleep"
  | "hospital_icu_mixed";

export type SupportedAdapterDatasetId =
  | "sisfall"
  | "umafall"
  | "bidmc_ppg_respiration"
  | "mitdb_arrhythmia"
  | "ppg_dalia"
  | "wesad";

export interface AvailableModalities {
  heartRate?: boolean;
  spo2?: boolean;
  temperatureC?: boolean;
  imu?: boolean;
  ecg?: boolean;
  respiratoryRate?: boolean;
  sleepStage?: boolean;
}

export interface PublicDatasetCatalogEntry {
  id: string;
  name: string;
  sourcePlatform: string;
  exactUrl: string;
  doiOrReference: string;
  accessTier: DatasetAccessTier;
  requiresManualDownload: boolean;
  accessInstructions: string;
  cohort: {
    ageGroup: DatasetAgeCohort;
    includesElderly: boolean;
    allParticipantsElderly: false;
    participantCountSummary: string;
    demographicsNote: string;
  };
  signalsAvailable: {
    ecg: boolean;
    ppgOrHr: boolean;
    spo2: boolean;
    temperature: boolean;
    temperatureSite: "skin_wrist" | "skin_chest" | "core_rectal" | "none";
    imuAccel: boolean;
    imuGyro: boolean;
    respiratoryRate: boolean;
    sleepStages: boolean;
    fallLabels: boolean;
  };
  samplingRatesNote: string;
  nativeFormats: string[];
  integratedLocally: false;
  stageStatus: string;
}

export interface DatasetAdapterSpec {
  datasetId: SupportedAdapterDatasetId;
  supportedExtensions: string[];
  expectedFormats: string[];
  requiredColumnsNote: string;
  optionalColumnsNote: string;
  conversionWorkflowNote: string;
}

export type PlaybackStatus = "unloaded" | "ready" | "playing" | "paused" | "completed";

export interface PlaybackTelemetrySnapshot {
  heartRate: number | null;
  spo2: number | null;
  temperatureC: number | null;
  temperatureSite: TemperatureSite | null;
  respiratoryRateBpm: number | null;
  accelMagnitude: number;
  gyroMagnitude: number;
  accelX: number | null;
  accelY: number | null;
  accelZ: number | null;
  gyroX: number | null;
  gyroY: number | null;
  gyroZ: number | null;
  movementStatus: MovementStatus;
  possibleFallDetected: boolean;
  sleepStage: SleepStage | null;
  ecgSamples?: number[];
  ecgSamplingRate?: number;
  ecgSignalQuality?: EcgSignalQuality;
  ecgLeadOff?: boolean;
}

export interface PlaybackMlAnalysis {
  mlServiceConnected: boolean;
  mlEngine: MlEngineType;
  modelTrained: boolean;
  modelVersion: string | null;
  ecgModelTrained: boolean;
  signalQuality: SignalQuality;
  anomalyStatus: AnomalyStatus;
  anomalyScore: number;
  alertLevel: AlertLevel;
  triggeredMetrics: string[];
  contributingFeatures: string[];
  contributingDetails: Array<{
    feature: string;
    currentValue: number;
    baselineValue: number;
    zScore: number;
    context: string;
    unit: string;
  }>;
  persistenceCount: number;
  persistenceRequired: number;
  matchedBaselineContext: string;
  windowSize: number;
  baselineProgress: BaselineProgressSummary;
  explanation: string;
  ecgFeatures?: EcgFeatures;
  predictionClassification?: {
    stage:
      | "paused_poor_quality"
      | "insufficient_baseline"
      | "normal"
      | "anomalous_sensor_window"
      | "potential_fall_alert"
      | "confirmed_fall_event"
      | "confirmed_physiological_alert";
    anomalousWindow: boolean;
    potentialFallAlert: boolean;
    alertTriggered: boolean;
    confirmedFallEvent: boolean;
  };
}

export interface PlaybackFrameResult {
  frameIndex: number;
  relativeOffsetMs: number;
  timestampIso: string;
  groundTruthLabel: string | null;
  groundTruthIsAnomalous: boolean | null;
  telemetrySnapshot: PlaybackTelemetrySnapshot;
  analysis: PlaybackMlAnalysis;
}

export type GroundTruthGranularity = "sample_level" | "trial_level" | "none";

export type BaselineIndependenceStatus =
  | "no_baseline_trained"
  | "within_recording_split_not_independent"
  | "within_recording_online_not_independent";

export interface DatasetProvenanceSummary {
  datasetId: string;
  datasetName: string;
  sourcePlatform: string;
  participantId: string;
  recordId: string;
  originalFilename: string;
  source: "dataset_playback";
  isClinicalPatient: false;
  samplingRateHz: number | null;
  startTimestampIso: string | null;
  endTimestampIso: string | null;
  durationMs: number;
  hasGroundTruthLabels: boolean;
  labelGranularity?: GroundTruthGranularity;
  allFramesAnomalous?: boolean;
  labeledFrameCount: number;
  availableModalities: AvailableModalities;
  temperatureSite: TemperatureSite | null;
  cohortNote: string;
  includesElderly: boolean;
  allParticipantsElderly: false;
  provenanceNote: string;
  warnings: string[];
}

export interface GroundTruthConfusionMatrix {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
  f1Score: number;
}

export interface EventEvaluationMetrics {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1Score: number;
  groundTruthEventCount: number;
  detectedEventCount: number;
  predictedEventCount: number;
}

export interface GroundTruthEvaluationSummary {
  hasGroundTruthLabels: boolean;
  labelGranularity?: GroundTruthGranularity;
  baselineIndependence?: BaselineIndependenceStatus;
  totalProcessedFrames: number;
  labeledCount: number;
  unlabeledCount: number;
  skippedPoorQualityCount: number;
  excludedBaselineTrainingCount?: number;
  metrics: GroundTruthConfusionMatrix | null;
  frameEvaluation?: {
    alertLevel: GroundTruthConfusionMatrix;
    anomalousWindow: GroundTruthConfusionMatrix;
    confirmedFallEvent: GroundTruthConfusionMatrix;
    counts: {
      anomalousWindowCount: number;
      potentialFallAlertCount: number;
      alertTriggeredCount: number;
      confirmedFallEventCount: number;
    };
    metricDescriptions: {
      alertLevel: string;
      anomalousWindow: string;
      confirmedFallEvent: string;
    };
  } | null;
  eventEvaluation?: {
    available: boolean;
    groundTruthEventCount: number;
    alertEventMetrics: EventEvaluationMetrics | null;
    confirmedFallEventMetrics: EventEvaluationMetrics | null;
    note: string;
  };
  limitationNote?: string | null;
  note: string;
  disclaimer: string;
}

export interface PlaybackStateSnapshot {
  status: PlaybackStatus;
  playbackPatientKey: string | null;
  currentRecordIndex: number;
  processedCount: number;
  totalRecords: number;
  speed: number;
  provenance: DatasetProvenanceSummary | null;
  lastResult: PlaybackFrameResult | null;
  recentResults: PlaybackFrameResult[];
  evaluation: GroundTruthEvaluationSummary;
}

export interface DatasetImportResponse {
  ok: boolean;
  recording: {
    datasetId: SupportedAdapterDatasetId;
    datasetName: string;
    sourcePlatform: string;
    participantId: string;
    recordId: string;
    originalFilename: string;
    samplingRateHz: number | null;
    startTimestampIso: string | null;
    endTimestampIso: string | null;
    durationMs: number;
    availableModalities: AvailableModalities;
    temperatureSite: TemperatureSite | null;
    hasGroundTruthLabels: boolean;
    labelGranularity?: GroundTruthGranularity;
    allFramesAnomalous?: boolean;
    labeledFrameCount: number;
    totalFrames: number;
    cohortNote: string;
    includesElderly: boolean;
    allParticipantsElderly: false;
    provenanceNote: string;
    warnings: string[];
  };
  playback: PlaybackStateSnapshot;
}

