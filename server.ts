import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askSmartCareAssistant, type AssistantContextPayload } from "./server/gemini.ts";
import { sharedAlertDecisionEngine } from "./server/alertDecisionEngine.ts";
import { sharedBaselineTracker } from "./server/baselineTracker.ts";
import { sharedWindowStore } from "./server/featureExtractor.ts";
import {
  analyzeTelemetry,
  checkMlServiceHealth,
  fitPatientBaselineRemote,
  getPatientBaselineStatusSummary,
  resetPatientMlRemote,
} from "./server/mlClient.ts";
import {
  DatasetValidationError,
  getSupportedAdapterSpecs,
  isSupportedAdapterDatasetId,
  parseDatasetFile,
} from "./server/datasets/adapters/index.ts";
import { getDatasetCatalog, getDatasetCatalogEntry } from "./server/datasets/catalog.ts";
import { sharedPlaybackEngine } from "./server/datasets/playbackEngine.ts";
import { createWearableRouter } from "./server/esp32Ingest.ts";
import {
  advanceEscalationOutcome,
  getEscalationState,
  getVoiceProviderConfig,
  initiateCaregiverEscalation,
} from "./server/voiceClient.ts";
import type { TelemetryPayload, TelemetrySource } from "./server/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

async function startServer() {
  const app = express();
  app.use("/api/datasets", express.json({ limit: "10mb" }));
  app.use(express.json({ limit: "1mb" }));

  // --- Integration & Health Endpoints ---
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/system/integrations", async (_req, res) => {
    const mlHealth = await checkMlServiceHealth();
    const voiceConfig = getVoiceProviderConfig();
    const geminiConfigured = Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY"
    );

    res.json({
      gemini: {
        configured: geminiConfigured,
        model: "gemini-4-hydrogen",
      },
      mlService: mlHealth,
      voiceCalling: voiceConfig,
      wearableIngest: {
        endpoint: "/api/wearable/ingest",
        tokenProtected: Boolean(process.env.WEARABLE_INGEST_TOKEN?.trim()),
      },
    });
  });

  // --- ESP32 Wearable Ingestion ---
  app.use("/api/wearable", createWearableRouter());

  // --- Verified Public Dataset Catalog (Read-Only Stage 1 Metadata) ---
  app.get("/api/datasets/catalog", (_req, res) => {
    res.json({
      stage: 1,
      integratedLocally: false,
      datasets: getDatasetCatalog(),
    });
  });

  app.get("/api/datasets/catalog/:id", (req, res) => {
    const entry = getDatasetCatalogEntry(req.params.id);
    if (!entry) {
      res.status(404).json({ error: `Dataset '${req.params.id}' was not found in the catalog.` });
      return;
    }
    res.json({ stage: 1, dataset: entry });
  });

  // --- Stage 2: Dataset File Import Adapters & Playback Engine ---
  app.get("/api/datasets/adapters", (_req, res) => {
    res.json({
      stage: 2,
      adapters: getSupportedAdapterSpecs(),
    });
  });

  app.post("/api/datasets/import", async (req, res) => {
    try {
      const body = req.body as {
        datasetId?: unknown;
        filename?: unknown;
        content?: unknown;
        participantId?: unknown;
        recordId?: unknown;
        windowMs?: unknown;
        autoLoadPlayback?: unknown;
        speed?: unknown;
        prefitBaselineCount?: unknown;
        minBaselineSamples?: unknown;
      };

      const rawDatasetId = typeof body?.datasetId === "string" ? body.datasetId.trim() : "";
      const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
      const content = typeof body?.content === "string" ? body.content : "";

      if (!rawDatasetId) {
        res.status(400).json({ error: "datasetId is required." });
        return;
      }
      if (!isSupportedAdapterDatasetId(rawDatasetId)) {
        res.status(400).json({
          error: `Unsupported dataset adapter '${rawDatasetId}'. Supported CSV/TXT adapters: ${getSupportedAdapterSpecs().map((s) => s.datasetId).join(", ")}.`,
        });
        return;
      }
      if (!filename || !content) {
        res.status(400).json({ error: "filename and UTF-8 CSV/TXT content are required." });
        return;
      }

      const recording = parseDatasetFile({
        datasetId: rawDatasetId,
        filename,
        content,
        participantId: typeof body.participantId === "string" ? body.participantId : undefined,
        recordId: typeof body.recordId === "string" ? body.recordId : undefined,
        windowMs: typeof body.windowMs === "number" && Number.isFinite(body.windowMs) ? body.windowMs : undefined,
      });

      const shouldLoad = body.autoLoadPlayback !== false;
      const playback = shouldLoad
        ? await sharedPlaybackEngine.loadRecording(recording, {
            speed: typeof body.speed === "number" && Number.isFinite(body.speed) ? body.speed : 1,
            prefitBaselineCount:
              typeof body.prefitBaselineCount === "number" && Number.isFinite(body.prefitBaselineCount)
                ? body.prefitBaselineCount
                : 0,
            minBaselineSamples:
              typeof body.minBaselineSamples === "number" && Number.isFinite(body.minBaselineSamples)
                ? body.minBaselineSamples
                : 20,
          })
        : sharedPlaybackEngine.getStatus();

      const firstFrame = recording.frames[0];
      const lastFrame = recording.frames[recording.frames.length - 1];
      const durationMs =
        firstFrame && lastFrame
          ? Math.max(0, lastFrame.relativeOffsetMs - firstFrame.relativeOffsetMs)
          : 0;

      res.json({
        ok: true,
        recording: {
          datasetId: recording.datasetId,
          datasetName: recording.datasetName,
          sourcePlatform: recording.sourcePlatform,
          participantId: recording.participantId,
          recordId: recording.recordId,
          originalFilename: recording.originalFilename,
          samplingRateHz: recording.samplingRateHz,
          startTimestampIso: firstFrame ? firstFrame.timestampIso : null,
          endTimestampIso: lastFrame ? lastFrame.timestampIso : null,
          durationMs,
          availableModalities: recording.availableModalities,
          temperatureSite: recording.temperatureSite,
          hasGroundTruthLabels: recording.hasGroundTruthLabels,
          labelGranularity:
            recording.labelGranularity ?? (recording.hasGroundTruthLabels ? "sample_level" : "none"),
          allFramesAnomalous:
            recording.frames.length > 0 &&
            recording.frames.every((f) => f.groundTruthIsAnomalous === true),
          labeledFrameCount: recording.labeledFrameCount,
          totalFrames: recording.frames.length,
          cohortNote: recording.cohortNote,
          includesElderly: recording.includesElderly,
          allParticipantsElderly: recording.allParticipantsElderly,
          provenanceNote: recording.provenanceNote,
          warnings: recording.warnings,
        },
        playback,
      });
    } catch (err) {
      if (err instanceof DatasetValidationError) {
        res.status(400).json({ error: err.message, code: err.code, details: err.details });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : "Dataset import failed." });
    }
  });

  app.get("/api/datasets/playback/status", (_req, res) => {
    res.json(sharedPlaybackEngine.getStatus());
  });

  app.post("/api/datasets/playback/start", (_req, res) => {
    try {
      res.json(sharedPlaybackEngine.start());
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Cannot start playback." });
    }
  });

  app.post("/api/datasets/playback/pause", (_req, res) => {
    try {
      res.json(sharedPlaybackEngine.pause());
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Cannot pause playback." });
    }
  });

  app.post("/api/datasets/playback/resume", (_req, res) => {
    try {
      res.json(sharedPlaybackEngine.resume());
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Cannot resume playback." });
    }
  });

  app.post("/api/datasets/playback/step", async (_req, res) => {
    try {
      const outcome = await sharedPlaybackEngine.step();
      res.json(outcome);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Cannot step playback." });
    }
  });

  app.post("/api/datasets/playback/reset", async (_req, res) => {
    try {
      const snapshot = await sharedPlaybackEngine.reset();
      res.json(snapshot);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Cannot reset playback." });
    }
  });

  app.post("/api/datasets/playback/speed", (req, res) => {
    try {
      const body = req.body as { speed?: unknown };
      if (typeof body?.speed !== "number" || !Number.isFinite(body.speed) || body.speed <= 0) {
        res.status(400).json({ error: "speed must be a positive number." });
        return;
      }
      res.json(sharedPlaybackEngine.setSpeed(body.speed));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Cannot update playback speed." });
    }
  });

  // --- ML Anomaly Detection & Baseline Fitting ---
  app.post("/api/ml/analyze", async (req, res) => {
    try {
      const body = req.body as Partial<TelemetryPayload>;
      if (!body?.patientId) {
        res.status(400).json({ error: "patientId is required." });
        return;
      }

      const heartRate =
        body.heartRate === null || body.heartRate === undefined
          ? null
          : typeof body.heartRate === "number" && Number.isFinite(body.heartRate)
          ? body.heartRate
          : NaN;
      const spo2 =
        body.spo2 === null || body.spo2 === undefined
          ? null
          : typeof body.spo2 === "number" && Number.isFinite(body.spo2)
          ? body.spo2
          : NaN;
      const temperatureC =
        body.temperatureC === null || body.temperatureC === undefined
          ? null
          : typeof body.temperatureC === "number" && Number.isFinite(body.temperatureC)
          ? body.temperatureC
          : NaN;

      if (Number.isNaN(heartRate) || Number.isNaN(spo2) || Number.isNaN(temperatureC)) {
        res.status(400).json({ error: "heartRate, spo2, and temperatureC must be numeric or null." });
        return;
      }

      const allowedSources = new Set<TelemetrySource>([
        "sample_demo",
        "simulator",
        "esp32_hardware",
        "dataset_playback",
      ]);
      const source: TelemetrySource =
        typeof body.source === "string" && allowedSources.has(body.source as TelemetrySource)
          ? (body.source as TelemetrySource)
          : "simulator";

      const result = await analyzeTelemetry({
        patientId: body.patientId,
        deviceId: body.deviceId,
        timestamp: typeof body.timestamp === "string" ? body.timestamp : undefined,
        heartRate,
        spo2,
        temperatureC,
        movementStatus: body.movementStatus ?? "resting",
        accelMagnitude: typeof body.accelMagnitude === "number" ? body.accelMagnitude : 1.0,
        gyroMagnitude: typeof body.gyroMagnitude === "number" ? body.gyroMagnitude : 4.0,
        possibleFallDetected: Boolean(body.possibleFallDetected),
        irSignalOk: body.irSignalOk ?? true,
        fingerDetected: body.fingerDetected ?? true,
        ecgSamples: Array.isArray(body.ecgSamples) ? body.ecgSamples : undefined,
        ecgSamplingRate: typeof body.ecgSamplingRate === "number" ? body.ecgSamplingRate : undefined,
        ecgSignalQuality: body.ecgSignalQuality,
        ecgLeadOff: typeof body.ecgLeadOff === "boolean" ? body.ecgLeadOff : undefined,
        ecgTimestamp: typeof body.ecgTimestamp === "string" ? body.ecgTimestamp : undefined,
        source,
        baselineMeans: body.baselineMeans,
        baselineTrained: body.baselineTrained,
        policyConfig: body.policyConfig,
        accelX: typeof body.accelX === "number" ? body.accelX : undefined,
        accelY: typeof body.accelY === "number" ? body.accelY : undefined,
        accelZ: typeof body.accelZ === "number" ? body.accelZ : undefined,
        gyroX: typeof body.gyroX === "number" ? body.gyroX : undefined,
        gyroY: typeof body.gyroY === "number" ? body.gyroY : undefined,
        gyroZ: typeof body.gyroZ === "number" ? body.gyroZ : undefined,
        imuSamplingRate: typeof body.imuSamplingRate === "number" ? body.imuSamplingRate : undefined,
        fallMetrics: body.fallMetrics,
        respiratoryRateBpm: typeof body.respiratoryRateBpm === "number" ? body.respiratoryRateBpm : undefined,
        temperatureSite: body.temperatureSite,
        sleepStage: body.sleepStage,
        availableModalities: body.availableModalities,
        datasetContext: body.datasetContext,
      });

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "ML analysis failed." });
    }
  });

  app.get("/api/ml/baseline/status/:patientId", (req, res) => {
    const minSamplesRaw = Number(req.query.minSamples);
    const required = Number.isFinite(minSamplesRaw) && minSamplesRaw >= 5 ? Math.round(minSamplesRaw) : 20;
    res.json(getPatientBaselineStatusSummary(req.params.patientId, required));
  });

  app.post("/api/ml/baseline/reset", async (req, res) => {
    const body = req.body as {
      patientId?: string;
      source?: "esp32_hardware" | "simulator" | "dataset_playback";
    };
    if (!body?.patientId) {
      res.status(400).json({ error: "patientId is required." });
      return;
    }
    const { remoteCleared } = await resetPatientMlRemote(body.patientId, body.source);
    res.json({ ok: true, patientId: body.patientId, remoteCleared });
  });

  app.post("/api/ml/baseline/fit", async (req, res) => {
    try {
      const body = req.body as {
        patientId?: string;
        source?: TelemetryPayload["source"];
        minSamples?: number;
        availableModalities?: TelemetryPayload["availableModalities"];
        temperatureSite?: TelemetryPayload["temperatureSite"];
        samples?: Array<{
          heartRate: number | null;
          spo2: number | null;
          temperatureC: number | null;
          accelMagnitude?: number;
          gyroMagnitude?: number;
          movementStatus?: TelemetryPayload["movementStatus"];
          signalQuality?: "good" | "noisy" | "poor_contact";
          timestamp?: string;
          ecgBpm?: number | null;
          ecgSignalQuality?: TelemetryPayload["ecgSignalQuality"];
          ecgLeadOff?: boolean;
          temperatureSite?: TelemetryPayload["temperatureSite"];
        }>;
      };
      if (!body?.patientId || !Array.isArray(body.samples)) {
        res.status(400).json({ error: "patientId and samples array are required." });
        return;
      }
      const normalized = body.samples.map((s) => ({
        heartRate: s.heartRate === null || s.heartRate === undefined ? null : Number(s.heartRate),
        spo2: s.spo2 === null || s.spo2 === undefined ? null : Number(s.spo2),
        temperatureC:
          s.temperatureC === null || s.temperatureC === undefined ? null : Number(s.temperatureC),
        accelMagnitude: typeof s.accelMagnitude === "number" ? s.accelMagnitude : 1.0,
        gyroMagnitude: typeof s.gyroMagnitude === "number" ? s.gyroMagnitude : 4.0,
        movementStatus: s.movementStatus,
        signalQuality: s.signalQuality,
        timestamp: s.timestamp,
        ecgBpm: typeof s.ecgBpm === "number" ? s.ecgBpm : null,
        ecgSignalQuality: s.ecgSignalQuality,
        ecgLeadOff: Boolean(s.ecgLeadOff),
        temperatureSite: s.temperatureSite ?? body.temperatureSite ?? null,
      }));
      const result = await fitPatientBaselineRemote(body.patientId, normalized, {
        source: body.source ?? "simulator",
        minSamples: typeof body.minSamples === "number" ? body.minSamples : 20,
        availableModalities: body.availableModalities,
        temperatureSite: body.temperatureSite ?? null,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Baseline fitting failed." });
    }
  });

  // --- Caregiver Automated Voice Calling & Escalation ---
  app.post("/api/voice/escalate", async (req, res) => {
    try {
      const body = req.body as {
        alertId?: string;
        patientId?: string;
        patientName?: string;
        summary?: string;
        primaryCaregiverName?: string;
        secondaryCaregiverName?: string;
        timeoutSec?: number;
        dryRun?: boolean;
      };

      if (!body?.alertId || !body?.patientId || !body?.patientName) {
        res.status(400).json({ error: "alertId, patientId, and patientName are required." });
        return;
      }

      const state = await initiateCaregiverEscalation({
        alertId: body.alertId,
        patientId: body.patientId,
        patientName: body.patientName,
        summary: body.summary || "Critical wearable anomaly alert",
        primaryCaregiverName: body.primaryCaregiverName || "Primary Caregiver",
        secondaryCaregiverName: body.secondaryCaregiverName || "Secondary Caregiver",
        timeoutSec: typeof body.timeoutSec === "number" ? body.timeoutSec : undefined,
        dryRun: Boolean(body.dryRun),
      });

      res.json(state);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Voice escalation dispatch failed." });
    }
  });

  app.post("/api/voice/outcome", (req, res) => {
    const body = req.body as {
      alertId?: string;
      action?: "primary_answered" | "primary_no_answer_escalate" | "secondary_acknowledged";
    };
    if (!body?.alertId || !body?.action) {
      res.status(400).json({ error: "alertId and action are required." });
      return;
    }
    const updated = advanceEscalationOutcome(body.alertId, body.action);
    if (!updated) {
      res.status(404).json({ error: "Escalation workflow session not found for alertId." });
      return;
    }
    res.json(updated);
  });

  app.get("/api/voice/status/:alertId", (req, res) => {
    const state = getEscalationState(req.params.alertId);
    res.json({ state });
  });

  // --- Gemini AI Health Assistant (Server-Side Only) ---
  app.post("/api/ai/assistant", async (req, res) => {
    try {
      const body = req.body as {
        question?: string;
        history?: Array<{ role: "user" | "assistant"; content: string }>;
        context?: AssistantContextPayload;
      };

      const question = typeof body?.question === "string" ? body.question.trim() : "";
      if (!question || question.length > 1500) {
        res.status(400).json({ error: "A question between 1 and 1500 characters is required." });
        return;
      }
      if (!body.context) {
        res.status(400).json({ error: "Patient telemetry context is required." });
        return;
      }

      const answer = await askSmartCareAssistant(question, body.history ?? [], body.context);
      res.json({ answer });
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Gemini assistant request failed.";
      let status = 500;
      let cleanMsg = raw;
      if (raw.includes("GEMINI_API_KEY")) {
        status = 503;
      } else if (raw.includes("503") || raw.includes("UNAVAILABLE")) {
        status = 503;
        cleanMsg = "Gemini AI is temporarily experiencing high demand (503 UNAVAILABLE). Please retry in a moment.";
      } else if (raw.includes("429") || raw.includes("RESOURCE_EXHAUSTED")) {
        status = 429;
        cleanMsg = "Gemini AI rate limit or quota reached (429 RESOURCE_EXHAUSTED).";
      } else if (raw.includes("403") || raw.includes("PERMISSION_DENIED") || raw.includes("API_KEY_INVALID")) {
        status = 403;
        cleanMsg = "Gemini API key was rejected (403/400). Check Settings > Secrets.";
      }
      res.status(status).json({ error: cleanMsg });
    }
  });

  // --- Vite Middleware (Dev) or Static Dist (Prod) ---
  if (process.env.NODE_ENV === "production") {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`SmartCare AI server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Fatal server startup error:", err);
  process.exit(1);
});
