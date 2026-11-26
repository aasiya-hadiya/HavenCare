import crypto from "node:crypto";
import express from "express";
import { extractEcgFeatures } from "./ecgProcessor.ts";
import { analyzeTelemetry } from "./mlClient.ts";
import type { EcgFeatures, EcgSignalQuality, MovementStatus, TelemetryPayload } from "./types.ts";

export interface EcgSegmentRecord {
  segmentId: string;
  deviceId: string;
  patientId: string;
  samples: number[];
  samplingRate: number;
  signalQuality: EcgSignalQuality;
  leadOff: boolean;
  timestamp: string;
  features: EcgFeatures;
  source: "esp32_hardware" | "simulator";
}

export interface LiveHardwareSnapshot {
  deviceId: string;
  patientId: string;
  pulseOxVariant: string;
  tempSensorModel: string;
  ecgSensorModel: string;
  heartRate: number | null;
  spo2: number | null;
  temperatureC: number | null;
  accelMagnitude: number;
  gyroMagnitude: number;
  movementStatus: MovementStatus;
  possibleFallDetected: boolean;
  irSignalOk: boolean;
  fingerDetected: boolean;
  ecgSamples: number[];
  ecgSamplingRate: number;
  ecgSignalQuality: EcgSignalQuality;
  ecgLeadOff: boolean;
  ecgTimestamp: string | null;
  ecgFeatures: EcgFeatures;
  signalQuality: string;
  anomalyScore: number;
  alertLevel: string;
  mlEngine: string;
  explanation: string;
  batteryPct: number | null;
  oledActive: boolean;
  hapticPattern: "none" | "single_pulse" | "triple_alert";
  receivedAt: string;
  source: "esp32_hardware" | "simulator";
}

const latestHardwareByPatient = new Map<string, LiveHardwareSnapshot>();
const ecgHistoryByPatient = new Map<string, EcgSegmentRecord[]>();
const recentHardwareEvents: LiveHardwareSnapshot[] = [];

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const VALID_MOVEMENTS = new Set<MovementStatus>([
  "resting",
  "walking",
  "active",
  "fall_suspect",
  "inactive",
]);

const VALID_ECG_QUALITIES = new Set<EcgSignalQuality>([
  "good",
  "noisy",
  "lead_off",
  "unavailable",
]);

export function createWearableRouter(): express.Router {
  const router = express.Router();

  router.get("/config", (_req, res) => {
    const tokenConfigured = Boolean(process.env.WEARABLE_INGEST_TOKEN?.trim());
    res.json({
      ingestEndpoint: "/api/wearable/ingest",
      deviceAuthRequired: tokenConfigured,
      developmentModeNote: tokenConfigured
        ? "WEARABLE_INGEST_TOKEN is configured on the server; hardware POSTs require the X-Device-Key header."
        : "WEARABLE_INGEST_TOKEN is not set (development mode). Simulator packets work immediately; configure WEARABLE_INGEST_TOKEN in server Secrets before connecting a real ESP32.",
      tokenSetupSteps: [
        "Generate a 256-bit secret token via: openssl rand -hex 32",
        "Store it on the server as WEARABLE_INGEST_TOKEN in Settings > Secrets (never in frontend VITE_* variables).",
        "Paste the matching token into DEVICE_KEY in /firmware/esp32_smartcare_template.ino.",
      ],
      supportedHardware: {
        mcu: "ESP32 DevKit (Wi-Fi JSON HTTP/HTTPS POST)",
        pulseOximeter: "MAX30100 (Confirmed — OXullo MAX30100_PulseOximeter.h)",
        ecg: "AD8232 Provisional ECG (ESP32 ADC1 + LO+/LO- Lead-Off, Batched Waveforms)",
        imu: "MPU6050 6-axis Accelerometer & Gyroscope (Experimental Fall Indicator)",
        temperature: "Configurable Skin Temperature Sensor (Model Pending Confirmation)",
        display: "0.96-inch SSD1306 I2C OLED (128x64)",
        haptic: "Vibration Motor via Transistor/MOSFET Driver (Non-Blocking)",
        power: "Rechargeable Battery & Power-Management Arrangement",
      },
    });
  });

  router.get("/latest", (req, res) => {
    const patientId = typeof req.query.patientId === "string" ? req.query.patientId.trim() : "";
    if (patientId) {
      res.json({
        snapshot: latestHardwareByPatient.get(patientId) ?? null,
        ecgHistory: ecgHistoryByPatient.get(patientId) ?? [],
      });
      return;
    }
    res.json({
      events: recentHardwareEvents.slice(0, 20),
    });
  });

  router.post("/ingest", async (req, res) => {
    try {
      const configuredToken = process.env.WEARABLE_INGEST_TOKEN?.trim();
      const body = req.body as Record<string, unknown>;
      const isSimulator = body?.source === "simulator";

      if (configuredToken && !isSimulator) {
        const providedKey = typeof req.header("X-Device-Key") === "string" ? req.header("X-Device-Key")!.trim() : "";
        if (!providedKey || !timingSafeCompare(providedKey, configuredToken)) {
          res.status(401).json({ error: "Invalid or missing X-Device-Key header for hardware ingestion." });
          return;
        }
      }

      const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim().slice(0, 64) : "";
      const patientId = typeof body?.patientId === "string" ? body.patientId.trim().slice(0, 128) : "";
      if (!deviceId || !patientId) {
        res.status(400).json({ error: "deviceId and patientId are required." });
        return;
      }

      const irSignalOk = body?.irSignalOk !== false;
      const fingerDetected = body?.fingerDetected !== false;
      const opticalInvalidAllowed = !fingerDetected || !irSignalOk;

      let heartRate: number | null = null;
      if (body?.heartRate !== null && body?.heartRate !== undefined) {
        const parsedHr = Number(body.heartRate);
        if (!Number.isFinite(parsedHr)) {
          res.status(400).json({ error: "heartRate must be a valid number or null." });
          return;
        }
        if (parsedHr === 0 && opticalInvalidAllowed) {
          heartRate = null;
        } else if (parsedHr < 20 || parsedHr > 260) {
          if (opticalInvalidAllowed) {
            heartRate = null;
          } else {
            res.status(400).json({ error: "heartRate must be between 20 and 260 BPM when fingerDetected is true." });
            return;
          }
        } else {
          heartRate = parsedHr;
        }
      }

      let spo2: number | null = null;
      if (body?.spo2 !== null && body?.spo2 !== undefined) {
        const parsedSpo2 = Number(body.spo2);
        if (!Number.isFinite(parsedSpo2)) {
          res.status(400).json({ error: "spo2 must be a valid number or null." });
          return;
        }
        if (parsedSpo2 === 0 && opticalInvalidAllowed) {
          spo2 = null;
        } else if (parsedSpo2 < 40 || parsedSpo2 > 100) {
          if (opticalInvalidAllowed) {
            spo2 = null;
          } else {
            res.status(400).json({ error: "spo2 must be between 40 and 100% when fingerDetected is true." });
            return;
          }
        } else {
          spo2 = parsedSpo2;
        }
      }

      let temperatureC: number | null = null;
      if (body?.temperatureC !== null && body?.temperatureC !== undefined) {
        const parsedTemp = Number(body.temperatureC);
        if (!Number.isFinite(parsedTemp)) {
          res.status(400).json({ error: "temperatureC must be a valid number or null." });
          return;
        }
        // Treat common unattached DS18B20 sentinel (-127) cleanly if ever passed, otherwise enforce 20..45 C
        if (parsedTemp <= -100) {
          temperatureC = null;
        } else if (parsedTemp < 20 || parsedTemp > 45) {
          res.status(400).json({ error: "temperatureC must be between 20 and 45 °C (or null when unconfirmed)." });
          return;
        } else {
          temperatureC = parsedTemp;
        }
      }

      const accelMagnitude = body?.accelMagnitude !== undefined ? Number(body.accelMagnitude) : 1.0;
      const gyroMagnitude = body?.gyroMagnitude !== undefined ? Number(body.gyroMagnitude) : 4.0;
      const rawMovement = typeof body?.movementStatus === "string" ? body.movementStatus : "resting";
      const movementStatus: MovementStatus = VALID_MOVEMENTS.has(rawMovement as MovementStatus)
        ? (rawMovement as MovementStatus)
        : "resting";
      const possibleFallDetected =
        body?.possibleFallDetected === true ||
        movementStatus === "fall_suspect" ||
        (Number.isFinite(accelMagnitude) && accelMagnitude >= 2.8);

      // Parse batched AD8232 ECG fields safely without fabricating missing samples
      const rawEcgSamples = Array.isArray(body?.ecgSamples) ? body.ecgSamples : [];
      const ecgSamples: number[] = [];
      for (let i = 0; i < Math.min(rawEcgSamples.length, 250); i++) {
        const v = Number(rawEcgSamples[i]);
        if (Number.isFinite(v) && v >= -3300 && v <= 4095) {
          ecgSamples.push(Number(v.toFixed(2)));
        }
      }

      const rawEcgRate = body?.ecgSamplingRate !== undefined ? Number(body.ecgSamplingRate) : 200;
      const ecgSamplingRate =
        Number.isFinite(rawEcgRate) && rawEcgRate >= 25 && rawEcgRate <= 1000
          ? Math.round(rawEcgRate)
          : 200;
      const ecgLeadOff = body?.ecgLeadOff === true;
      const rawEcgQuality = typeof body?.ecgSignalQuality === "string" ? body.ecgSignalQuality : undefined;
      const reportedEcgQuality: EcgSignalQuality | undefined =
        rawEcgQuality && VALID_ECG_QUALITIES.has(rawEcgQuality as EcgSignalQuality)
          ? (rawEcgQuality as EcgSignalQuality)
          : undefined;
      const ecgTimestamp =
        typeof body?.ecgTimestamp === "string" && body.ecgTimestamp.trim()
          ? body.ecgTimestamp.trim().slice(0, 60)
          : ecgSamples.length > 0 || body?.ecgLeadOff !== undefined
          ? new Date().toISOString()
          : null;

      const ecgFeatures = extractEcgFeatures({
        samples: ecgSamples,
        samplingRateHz: ecgSamplingRate,
        leadOff: ecgLeadOff,
        reportedQuality: reportedEcgQuality,
      });

      const optNum = (val: unknown): number | undefined => {
        if (val === null || val === undefined) return undefined;
        const n = Number(val);
        return Number.isFinite(n) ? n : undefined;
      };

      const rawBaseline = body?.baselineMeans as Record<string, unknown> | undefined;
      const baselineMeans =
        rawBaseline &&
        typeof rawBaseline.heartRate === "number" &&
        typeof rawBaseline.spo2 === "number" &&
        typeof rawBaseline.temperatureC === "number"
          ? {
              heartRate: rawBaseline.heartRate,
              spo2: rawBaseline.spo2,
              temperatureC: rawBaseline.temperatureC,
            }
          : undefined;

      const rawPolicy = body?.policyConfig as Record<string, unknown> | undefined;
      const telemetry: TelemetryPayload = {
        patientId,
        deviceId,
        timestamp: typeof body?.timestamp === "string" ? body.timestamp : undefined,
        heartRate,
        spo2,
        temperatureC,
        movementStatus,
        accelMagnitude: Number.isFinite(accelMagnitude) ? accelMagnitude : 1.0,
        gyroMagnitude: Number.isFinite(gyroMagnitude) ? gyroMagnitude : 4.0,
        possibleFallDetected,
        irSignalOk,
        fingerDetected,
        ecgSamples,
        ecgSamplingRate,
        ecgSignalQuality: ecgFeatures.signalQuality,
        ecgLeadOff,
        ecgTimestamp: ecgTimestamp ?? undefined,
        ecgFeatures,
        source: isSimulator ? "simulator" : "esp32_hardware",
        baselineMeans,
        baselineTrained: typeof body?.baselineTrained === "boolean" ? body.baselineTrained : undefined,
        accelX: optNum(body?.accelX),
        accelY: optNum(body?.accelY),
        accelZ: optNum(body?.accelZ),
        gyroX: optNum(body?.gyroX),
        gyroY: optNum(body?.gyroY),
        gyroZ: optNum(body?.gyroZ),
        imuSamplingRate: optNum(body?.imuSamplingRate),
        respiratoryRateBpm: optNum(body?.respiratoryRateBpm),
        policyConfig: rawPolicy
          ? {
              baselineMinSamples:
                typeof rawPolicy.baselineMinSamples === "number"
                  ? rawPolicy.baselineMinSamples
                  : undefined,
              warningPersistenceWindows:
                typeof rawPolicy.warningPersistenceWindows === "number"
                  ? rawPolicy.warningPersistenceWindows
                  : undefined,
              criticalPersistenceWindows:
                typeof rawPolicy.criticalPersistenceWindows === "number"
                  ? rawPolicy.criticalPersistenceWindows
                  : undefined,
              anomalyScoreWarningThreshold:
                typeof rawPolicy.anomalyScoreWarningThreshold === "number"
                  ? rawPolicy.anomalyScoreWarningThreshold
                  : undefined,
            }
          : undefined,
      };

      const analysis = await analyzeTelemetry(telemetry);
      const hapticPattern: LiveHardwareSnapshot["hapticPattern"] =
        analysis.alertLevel === "Critical"
          ? "triple_alert"
          : analysis.alertLevel === "Warning"
          ? "single_pulse"
          : "none";

      const receivedAt = new Date().toISOString();
      const source: "esp32_hardware" | "simulator" = isSimulator ? "simulator" : "esp32_hardware";

      const snapshot: LiveHardwareSnapshot = {
        deviceId,
        patientId,
        pulseOxVariant:
          typeof body?.pulseOxVariant === "string" ? body.pulseOxVariant.slice(0, 48) : "MAX30100 (Confirmed)",
        tempSensorModel:
          typeof body?.tempSensorModel === "string"
            ? body.tempSensorModel.slice(0, 48)
            : "Configurable (Pending Confirmation)",
        ecgSensorModel:
          typeof body?.ecgSensorModel === "string"
            ? body.ecgSensorModel.slice(0, 48)
            : "AD8232 (Provisional ECG)",
        heartRate,
        spo2,
        temperatureC,
        accelMagnitude: telemetry.accelMagnitude,
        gyroMagnitude: telemetry.gyroMagnitude,
        movementStatus,
        possibleFallDetected,
        irSignalOk,
        fingerDetected,
        ecgSamples,
        ecgSamplingRate,
        ecgSignalQuality: ecgFeatures.signalQuality,
        ecgLeadOff,
        ecgTimestamp,
        ecgFeatures,
        signalQuality: analysis.signalQuality,
        anomalyScore: analysis.anomalyScore,
        alertLevel: analysis.alertLevel,
        mlEngine: analysis.mlEngine,
        explanation: analysis.explanation,
        batteryPct:
          typeof body?.batteryPct === "number" && Number.isFinite(body.batteryPct)
            ? Math.max(0, Math.min(100, Math.round(body.batteryPct)))
            : null,
        oledActive: body?.oledActive !== false,
        hapticPattern,
        receivedAt,
        source,
      };

      latestHardwareByPatient.set(patientId, snapshot);
      recentHardwareEvents.unshift(snapshot);
      if (recentHardwareEvents.length > 50) recentHardwareEvents.pop();

      if (ecgSamples.length > 0 || ecgLeadOff) {
        const segment: EcgSegmentRecord = {
          segmentId: `ecg_${Date.now()}`,
          deviceId,
          patientId,
          samples: ecgSamples,
          samplingRate: ecgSamplingRate,
          signalQuality: ecgFeatures.signalQuality,
          leadOff: ecgLeadOff,
          timestamp: ecgTimestamp ?? receivedAt,
          features: ecgFeatures,
          source,
        };
        const existingSegs = ecgHistoryByPatient.get(patientId) ?? [];
        ecgHistoryByPatient.set(patientId, [segment, ...existingSegs].slice(0, 12));
      }

      res.json({
        ok: true,
        ...snapshot,
        triggeredMetrics: analysis.triggeredMetrics,
        mlServiceConnected: analysis.mlServiceConnected,
        modelTrained: analysis.modelTrained,
        modelVersion: analysis.modelVersion,
        ecgModelTrained: analysis.ecgModelTrained,
        anomalyStatus: analysis.anomalyStatus,
        contributingFeatures: analysis.contributingFeatures,
        contributingDetails: analysis.contributingDetails,
        persistenceCount: analysis.persistenceCount,
        persistenceRequired: analysis.persistenceRequired,
        matchedBaselineContext: analysis.matchedBaselineContext,
        windowSize: analysis.windowSize,
        baselineProgress: analysis.baselineProgress,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to process wearable telemetry payload.",
      });
    }
  });

  return router;
}
