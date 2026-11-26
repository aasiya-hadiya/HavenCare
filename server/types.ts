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
export type PredictionStage =
  | "paused_poor_quality"
  | "insufficient_baseline"
  | "normal"
  | "anomalous_sensor_window"
  | "potential_fall_alert"
  | "confirmed_fall_event"
  | "confirmed_physiological_alert";
export type TemperatureSite =
  | "skin_wrist"
  | "skin_chest"
  | "axillary"
  | "core_rectal"
  | "ambient"
  | "unknown";
export type SleepStage = "wake" | "n1" | "n2" | "n3" | "rem" | "asleep" | "unknown";

export interface AvailableModalities {
  heartRate?: boolean;
  spo2?: boolean;
  temperatureC?: boolean;
  imu?: boolean;
  ecg?: boolean;
  respiratoryRate?: boolean;
  sleepStage?: boolean;
}

export interface FallMetrics {
  impactPeakG?: number | null;
  freeFallDurationMs?: number | null;
  postFallStillnessSec?: number | null;
  postFallOrientationDeg?: number | null;
  groundTruthFallLabel?: string | null;
}

export interface DatasetPlaybackContext {
  datasetId: string;
  recordId?: string;
  groundTruthLabel?: string | null;
  virtualTimestamp?: string;
}

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

export interface ContributingFeatureDetail {
  feature: string;
  currentValue: number;
  baselineValue: number;
  zScore: number;
  context: string;
  unit: string;
}

export interface BaselineProgress {
  collectedSamples: number;
  requiredSamples: number;
  status: "not_started" | "collecting" | "ready";
  source: TelemetrySource | null;
  modelVersion: string | null;
  restingSamples: number;
  activeSamples: number;
  ecgBaselineSamples: number;
}

export interface AlertPolicyConfig {
  baselineMinSamples?: number;
  warningPersistenceWindows?: number;
  criticalPersistenceWindows?: number;
  anomalyScoreWarningThreshold?: number;
  anomalyScoreCriticalThreshold?: number;
  zScoreWarningThreshold?: number;
  zScoreCriticalThreshold?: number;
}

export interface TelemetryPayload {
  patientId: string;
  deviceId?: string;
  timestamp?: string;
  heartRate: number | null;
  spo2: number | null;
  temperatureC: number | null;
  movementStatus: MovementStatus;
  accelMagnitude: number;
  gyroMagnitude: number;
  possibleFallDetected?: boolean;
  irSignalOk?: boolean;
  fingerDetected?: boolean;
  ecgSamples?: number[];
  ecgSamplingRate?: number;
  ecgSignalQuality?: EcgSignalQuality;
  ecgLeadOff?: boolean;
  ecgTimestamp?: string;
  ecgFeatures?: EcgFeatures;
  source?: TelemetrySource;
  baselineMeans?: {
    heartRate: number;
    spo2: number;
    temperatureC: number;
  };
  baselineTrained?: boolean;
  allowBaselineTraining?: boolean;
  policyConfig?: AlertPolicyConfig;
  // Backward-compatible optional extended fields for Stage 1+ dataset playback & future multi-axis sensors
  accelX?: number | null;
  accelY?: number | null;
  accelZ?: number | null;
  gyroX?: number | null;
  gyroY?: number | null;
  gyroZ?: number | null;
  imuSamplingRate?: number | null;
  fallMetrics?: FallMetrics;
  respiratoryRateBpm?: number | null;
  temperatureSite?: TemperatureSite | null;
  sleepStage?: SleepStage | null;
  availableModalities?: AvailableModalities;
  datasetContext?: DatasetPlaybackContext;
}

export interface PredictionClassification {
  stage: PredictionStage;
  anomalousWindow: boolean;
  potentialFallAlert: boolean;
  alertTriggered: boolean;
  confirmedFallEvent: boolean;
}

export interface MlAnalysisResult {
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
  contributingDetails: ContributingFeatureDetail[];
  persistenceCount: number;
  persistenceRequired: number;
  matchedBaselineContext: string;
  windowSize: number;
  baselineProgress: BaselineProgress;
  explanation: string;
  ecgFeatures?: EcgFeatures;
  predictionClassification?: PredictionClassification;
}

export type CallEscalationStatus =
  | "not_triggered"
  | "provider_unconfigured"
  | "calling_primary"
  | "primary_answered"
  | "escalated_secondary"
  | "completed";

export interface EscalationWorkflowState {
  alertId: string;
  patientId: string;
  primaryCaregiverName: string;
  primaryCaregiverPhoneConfigured: boolean;
  secondaryCaregiverName: string;
  secondaryCaregiverPhoneConfigured: boolean;
  providerConfigured: boolean;
  providerName: string;
  timeoutSec: number;
  status: CallEscalationStatus;
  startedAt: string;
  primaryCallAttemptedAt?: string;
  escalatedAt?: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  isDryRun: boolean;
  log: string[];
}
