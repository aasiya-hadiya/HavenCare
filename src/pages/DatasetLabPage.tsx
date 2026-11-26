import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Database,
  ExternalLink,
  FileSpreadsheet,
  FlaskConical,
  Pause,
  Play,
  RotateCcw,
  Search,
  ShieldAlert,
  StepForward,
  Upload,
} from "lucide-react";
import { DatasetLabCharts } from "../components/DatasetLabCharts.tsx";
import {
  DatasetImportApiError,
  fetchDatasetAdapters,
  fetchDatasetCatalog,
  fetchIntegrationStatus,
  fetchPlaybackStatus,
  importDatasetFile,
  pausePlayback,
  resetPlayback,
  resumePlayback,
  setPlaybackSpeed,
  startPlayback,
  stepPlayback,
} from "../services/apiClient.ts";
import type {
  AlertLevel,
  DatasetAdapterSpec,
  DatasetImportResponse,
  IntegrationStatus,
  PlaybackStateSnapshot,
  PublicDatasetCatalogEntry,
  SupportedAdapterDatasetId,
} from "../types/smartcare.ts";

type CatalogFilter = "all" | "direct_csv" | "conversion_required" | "restricted" | "elderly_inclusive";

const DIRECT_CSV_IDS = new Set<string>(["sisfall", "umafall", "bidmc_ppg_respiration"]);
const CONVERSION_ADAPTER_IDS = new Set<string>(["mitdb_arrhythmia", "ppg_dalia", "wesad"]);
const BINARY_EXTENSIONS = [".edf", ".dat", ".hea", ".atr", ".apn", ".pkl", ".pickle"];
const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 5, 10, 25, 50];

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0.0 s";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

function getCatalogReadiness(entry: PublicDatasetCatalogEntry): {
  key: "direct" | "convert_adapter" | "convert_external" | "restricted";
  label: string;
  toneClass: string;
} {
  if (
    entry.accessTier === "restricted_dua" ||
    entry.accessTier === "credentialed_required" ||
    entry.accessTier === "registration_required"
  ) {
    return {
      key: "restricted",
      label:
        entry.accessTier === "credentialed_required"
          ? "Credentialed Access Required"
          : entry.accessTier === "restricted_dua"
          ? "Restricted / DUA Required"
          : "Account Login Required",
      toneClass: "text-amber-700",
    };
  }
  if (DIRECT_CSV_IDS.has(entry.id)) {
    return {
      key: "direct",
      label: "Direct CSV/TXT Adapter Ready",
      toneClass: "text-arova-green-dark",
    };
  }
  if (CONVERSION_ADAPTER_IDS.has(entry.id)) {
    return {
      key: "convert_adapter",
      label: "Requires CSV Export (Adapter Ready)",
      toneClass: "text-arova-green",
    };
  }
  return {
    key: "convert_external",
    label: "WFDB/EDF Conversion Required (No Stage 2 Parser)",
    toneClass: "text-arova-muted",
  };
}

function formatSignalSummary(entry: PublicDatasetCatalogEntry): string {
  const list: string[] = [];
  if (entry.signalsAvailable.ecg) list.push("ECG");
  if (entry.signalsAvailable.ppgOrHr) list.push("PPG/HR");
  if (entry.signalsAvailable.spo2) list.push("SpO₂");
  if (entry.signalsAvailable.temperature) {
    list.push(`Temp (${entry.signalsAvailable.temperatureSite})`);
  }
  if (entry.signalsAvailable.imuAccel) {
    list.push(entry.signalsAvailable.imuGyro ? "IMU Accel+Gyro" : "IMU Accel");
  }
  if (entry.signalsAvailable.respiratoryRate) list.push("Resp");
  if (entry.signalsAvailable.sleepStages) list.push("Sleep Stages");
  if (entry.signalsAvailable.fallLabels) list.push("Fall Labels");
  return list.join(" · ");
}

function formatAlertBadge(level: AlertLevel): {
  glyph: string;
  textClass: string;
  borderClass: string;
} {
  if (level === "Critical") {
    return {
      glyph: "✖ Critical",
      textClass: "text-rose-700",
      borderClass: "border-rose-200 bg-rose-50",
    };
  }
  if (level === "Warning") {
    return {
      glyph: "▲ Warning",
      textClass: "text-amber-800",
      borderClass: "border-amber-200 bg-amber-50",
    };
  }
  return {
    glyph: "● Normal",
    textClass: "text-arova-green-dark",
    borderClass: "border-arova-sage bg-arova-mint",
  };
}

export function DatasetLabPage() {
  const [catalog, setCatalog] = useState<PublicDatasetCatalogEntry[]>([]);
  const [adapters, setAdapters] = useState<DatasetAdapterSpec[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);
  const [playback, setPlayback] = useState<PlaybackStateSnapshot | null>(null);
  const [loadingInit, setLoadingInit] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  // Catalog filter & search
  const [catalogFilter, setCatalogFilter] = useState<CatalogFilter>("all");
  const [catalogSearch, setCatalogSearch] = useState("");

  // Upload & validation form state
  const [selectedDatasetId, setSelectedDatasetId] =
    useState<SupportedAdapterDatasetId>("sisfall");
  const [participantOverride, setParticipantOverride] = useState("");
  const [recordOverride, setRecordOverride] = useState("");
  const [prefitBaselineCount, setPrefitBaselineCount] = useState<number>(20);
  const [minBaselineSamples, setMinBaselineSamples] = useState<number>(20);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<{
    message: string;
    code?: string;
    details?: string[];
  } | null>(null);
  const [lastImportSummary, setLastImportSummary] = useState<
    DatasetImportResponse["recording"] | null
  >(null);

  // Playback control state
  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importerSectionRef = useRef<HTMLElement | null>(null);

  const loadInitialState = useCallback(async () => {
    setLoadingInit(true);
    setInitError(null);
    try {
      const [catRes, adapterRes, intRes, pbRes] = await Promise.all([
        fetchDatasetCatalog(),
        fetchDatasetAdapters(),
        fetchIntegrationStatus(),
        fetchPlaybackStatus(),
      ]);
      setCatalog(catRes.datasets);
      setAdapters(adapterRes.adapters);
      setIntegrations(intRes);
      setPlayback(pbRes);
    } catch (err) {
      setInitError(err instanceof Error ? err.message : "Failed to initialize Dataset Lab.");
    } finally {
      setLoadingInit(false);
    }
  }, []);

  useEffect(() => {
    void loadInitialState();
  }, [loadInitialState]);

  // Poll playback status while actively playing
  useEffect(() => {
    if (playback?.status !== "playing") return;
    const timer = window.setInterval(() => {
      void fetchPlaybackStatus()
        .then((snap) => setPlayback(snap))
        .catch(() => {
          // Non-fatal transient poll error; next interval will retry
        });
    }, 350);
    return () => window.clearInterval(timer);
  }, [playback?.status]);

  const activeAdapterSpec = useMemo(
    () => adapters.find((a) => a.datasetId === selectedDatasetId) ?? null,
    [adapters, selectedDatasetId]
  );

  const filteredCatalog = useMemo(() => {
    return catalog.filter((entry) => {
      const readiness = getCatalogReadiness(entry);
      if (catalogFilter === "direct_csv" && readiness.key !== "direct") return false;
      if (
        catalogFilter === "conversion_required" &&
        readiness.key !== "convert_adapter" &&
        readiness.key !== "convert_external"
      ) {
        return false;
      }
      if (catalogFilter === "restricted" && readiness.key !== "restricted") return false;
      if (catalogFilter === "elderly_inclusive" && !entry.cohort.includesElderly) return false;
      if (catalogSearch.trim()) {
        const q = catalogSearch.toLowerCase();
        return (
          entry.name.toLowerCase().includes(q) ||
          entry.id.toLowerCase().includes(q) ||
          entry.sourcePlatform.toLowerCase().includes(q) ||
          entry.cohort.demographicsNote.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [catalog, catalogFilter, catalogSearch]);

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    setControlError(null);

    try {
      const lowerName = file.name.toLowerCase();
      const isKnownBinary = BINARY_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
      // Avoid loading multi-hundred-MB binary EDF/PKL blobs into browser memory just to reject them;
      // send the header slice so backend DatasetValidationError returns exact conversion steps immediately.
      const content = isKnownBinary
        ? await file.slice(0, 1024).text()
        : await file.text();

      const res = await importDatasetFile({
        datasetId: selectedDatasetId,
        filename: file.name,
        content,
        participantId: participantOverride.trim() || undefined,
        recordId: recordOverride.trim() || undefined,
        autoLoadPlayback: true,
        speed: playback?.speed ?? 1,
        prefitBaselineCount,
        minBaselineSamples,
      });

      setLastImportSummary(res.recording);
      setPlayback(res.playback);
    } catch (err) {
      if (err instanceof DatasetImportApiError) {
        setUploadError({
          message: err.message,
          code: err.code,
          details: err.details,
        });
      } else {
        setUploadError({
          message: err instanceof Error ? err.message : "Failed to import dataset file.",
        });
      }
    } finally {
      setUploading(false);
    }
  };

  const handlePlaybackAction = async (
    action: () => Promise<PlaybackStateSnapshot>
  ) => {
    setControlBusy(true);
    setControlError(null);
    try {
      const snap = await action();
      setPlayback(snap);
    } catch (err) {
      setControlError(err instanceof Error ? err.message : "Playback action failed.");
    } finally {
      setControlBusy(false);
    }
  };

  const handleStep = async () => {
    setControlBusy(true);
    setControlError(null);
    try {
      const outcome = await stepPlayback();
      setPlayback(outcome.snapshot);
    } catch (err) {
      setControlError(err instanceof Error ? err.message : "Step playback failed.");
    } finally {
      setControlBusy(false);
    }
  };

  const handleSelectAdapterFromCatalog = (datasetId: SupportedAdapterDatasetId) => {
    setSelectedDatasetId(datasetId);
    setUploadError(null);
    importerSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const totalRecords = playback?.totalRecords ?? 0;
  const processedCount = playback?.processedCount ?? 0;
  const progressPct =
    totalRecords > 0 ? Math.min(100, Math.round((processedCount / totalRecords) * 100)) : 0;

  const lastResult = playback?.lastResult ?? null;
  const latestAnalysis = lastResult?.analysis ?? null;
  const provenance = playback?.provenance ?? null;
  const evaluation = playback?.evaluation ?? null;

  const mlConnected = Boolean(integrations?.mlService.reachable);
  const isPlaying = playback?.status === "playing";
  const hasLoadedRecording = Boolean(playback && playback.status !== "unloaded" && totalRecords > 0);

  return (
    <div className="bg-white text-arova-text space-y-6">
      {/* Top Research Header & Source Isolation Ribbon */}
      <section className="bg-white border border-arova-border rounded-xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-arova-green-dark font-semibold">
              <FlaskConical className="w-4 h-4 text-arova-green" />
              <span>AROVA Dataset Validation Lab</span>
              <span className="text-arova-sage">/</span>
              <span className="text-arova-muted">Non-Clinical Research Mode</span>
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-arova-text">
              Public Research Dataset Import, Time-Preserving Playback &amp; ML Evaluation
            </h2>
            <p className="text-xs text-arova-muted max-w-3xl leading-relaxed">
              Import verified public biomedical and fall-detection CSV/TXT recordings, replay
              samples through the live FastAPI Isolation Forest engine under strict modality
              preservation, and inspect precision/recall metrics without polluting clinical
              Firestore records or ESP32 hardware baselines.
            </p>
          </div>

          <div className="flex flex-col sm:items-end gap-1.5 shrink-0 font-mono text-xs">
            <div className="flex items-center gap-2">
              <span className="text-arova-muted">ML Engine:</span>
              {mlConnected ? (
                <span className="text-arova-green-dark font-semibold">
                  ● Live Python Isolation Forest (:18000)
                </span>
              ) : (
                <span className="text-amber-700 font-semibold">
                  ▲ Demo Fallback (ML Service Unreachable)
                </span>
              )}
            </div>
            <div className="text-[11px] text-arova-muted">
              Active Source: <span className="text-arova-green-dark font-semibold">dataset_playback</span>
              <span className="mx-1.5 text-arova-sage">·</span>
              <span>Isolated from esp32_hardware &amp; simulator</span>
            </div>
            <div className="text-[11px] text-arova-muted">
              Clinical Firestore Writes:{" "}
              <span className="text-arova-green-dark font-medium">Disabled (0 writes)</span>
            </div>
          </div>
        </div>

        {/* Distinct Source Comparison Strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-arova-border text-xs">
          <div className="bg-arova-mint border border-arova-sage rounded-lg px-3.5 py-2.5">
            <div className="font-mono text-[11px] uppercase tracking-wider text-arova-green-dark font-semibold">
              ● Active Mode: Public Research Dataset
            </div>
            <div className="text-arova-text mt-1">
              Streams user-uploaded public dataset traces under{" "}
              <span className="font-mono text-arova-text">ds_*</span> keys.
            </div>
          </div>
          <div className="bg-white border border-arova-border rounded-lg px-3.5 py-2.5">
            <div className="font-mono text-[11px] uppercase tracking-wider text-arova-text font-medium">
              Synthetic Demo (Trends Page)
            </div>
            <div className="text-arova-muted mt-1">
              In-browser test packets tagged <span className="font-mono">simulator</span> /{" "}
              <span className="font-mono">sample_demo</span>.
            </div>
          </div>
          <div className="bg-white border border-arova-border rounded-lg px-3.5 py-2.5">
            <div className="font-mono text-[11px] uppercase tracking-wider text-arova-text font-medium">
              ESP32 Wearable Hardware
            </div>
            <div className="text-arova-muted mt-1">
              Physical MAX30100 + AD8232 + MPU6050 ingestion at{" "}
              <span className="font-mono">/api/wearable/ingest</span>.
            </div>
          </div>
        </div>
      </section>

      {initError && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs text-rose-800 flex items-center justify-between gap-3">
          <span>{initError}</span>
          <button
            type="button"
            onClick={() => void loadInitialState()}
            className="px-3 py-1 bg-rose-100 hover:bg-rose-200 text-rose-900 rounded-md font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {/* Upload + Playback Split Console */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Dataset Upload & Validation */}
        <section
          ref={importerSectionRef}
          className="xl:col-span-5 bg-white border border-arova-border rounded-xl p-5 space-y-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-arova-text">
                1. Import &amp; Validate Dataset Trace
              </h3>
              <p className="text-xs text-arova-muted mt-0.5">
                Parses real user-supplied CSV/TXT exports; never generates missing columns.
              </p>
            </div>
            <FileSpreadsheet className="w-4 h-4 text-arova-green shrink-0 mt-0.5" />
          </div>

          <div className="space-y-3 text-xs">
            <label className="block space-y-1.5">
              <span className="text-arova-text font-medium block">Target Dataset Adapter</span>
              <select
                aria-label="Target Dataset Adapter"
                value={selectedDatasetId}
                onChange={(e) => {
                  setSelectedDatasetId(e.target.value as SupportedAdapterDatasetId);
                  setUploadError(null);
                }}
                className="w-full px-3 py-2 bg-white border border-arova-border rounded-lg text-arova-text focus:outline-none focus:border-arova-green focus:ring-2 focus:ring-arova-mint"
              >
                {adapters.map((spec) => {
                  const cat = catalog.find((c) => c.id === spec.datasetId);
                  return (
                    <option key={spec.datasetId} value={spec.datasetId}>
                      {cat ? cat.name : spec.datasetId} ({spec.supportedExtensions.join(", ")})
                    </option>
                  );
                })}
              </select>
            </label>

            {activeAdapterSpec && (
              <div className="bg-arova-mint/50 border border-arova-border rounded-lg p-3 space-y-1.5 text-[11px] leading-relaxed">
                <div className="text-arova-green-dark font-mono font-semibold">
                  Accepted: {activeAdapterSpec.supportedExtensions.join(" · ")}
                </div>
                <div className="text-arova-text">
                  <span className="text-arova-muted font-medium">Required:</span>{" "}
                  {activeAdapterSpec.requiredColumnsNote}
                </div>
                <div className="text-arova-muted">
                  <span className="text-arova-text font-medium">Optional:</span>{" "}
                  {activeAdapterSpec.optionalColumnsNote}
                </div>
                <div className="text-amber-800">
                  <span className="text-arova-text font-medium">Workflow:</span>{" "}
                  {activeAdapterSpec.conversionWorkflowNote}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-arova-muted block">Participant ID (optional)</span>
                <input
                  type="text"
                  value={participantOverride}
                  onChange={(e) => setParticipantOverride(e.target.value)}
                  placeholder="Auto from file"
                  className="w-full px-2.5 py-1.5 bg-white border border-arova-border rounded-lg text-arova-text font-mono placeholder:text-arova-muted/60 focus:outline-none focus:border-arova-green focus:ring-2 focus:ring-arova-mint"
                />
              </label>
              <label className="space-y-1">
                <span className="text-arova-muted block">Record ID (optional)</span>
                <input
                  type="text"
                  value={recordOverride}
                  onChange={(e) => setRecordOverride(e.target.value)}
                  placeholder="Auto from file"
                  className="w-full px-2.5 py-1.5 bg-white border border-arova-border rounded-lg text-arova-text font-mono placeholder:text-arova-muted/60 focus:outline-none focus:border-arova-green focus:ring-2 focus:ring-arova-mint"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-arova-muted block">Prefit Normal Prefix</span>
                <select
                  aria-label="Prefit Normal Prefix"
                  value={prefitBaselineCount}
                  onChange={(e) => setPrefitBaselineCount(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 bg-white border border-arova-border rounded-lg text-arova-text font-mono focus:outline-none focus:border-arova-green"
                >
                  <option value={0}>0 frames (online baseline)</option>
                  <option value={10}>10 normal frames</option>
                  <option value={20}>20 normal frames</option>
                  <option value={30}>30 normal frames</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-arova-muted block">Min Baseline Samples</span>
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={minBaselineSamples}
                  onChange={(e) =>
                    setMinBaselineSamples(Math.max(5, Math.min(100, Number(e.target.value) || 20)))
                  }
                  className="w-full px-2.5 py-1.5 bg-white border border-arova-border rounded-lg text-arova-text font-mono tabular-nums focus:outline-none focus:border-arova-green"
                />
              </label>
            </div>

            {/* Drag and Drop + File Picker */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) void handleFileUpload(dropped);
              }}
              className={`border-2 border-dashed rounded-xl p-5 text-center transition-colors ${
                dragActive
                  ? "border-arova-green bg-arova-mint"
                  : "border-arova-sage bg-arova-mint/35 hover:border-arova-green hover:bg-arova-mint/60"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,.edf,.dat,.hea,.pkl"
                className="hidden"
                onChange={(e) => {
                  const chosen = e.target.files?.[0];
                  if (chosen) void handleFileUpload(chosen);
                  e.target.value = "";
                }}
              />
              <Upload className="w-6 h-6 text-arova-green mx-auto mb-2" />
              <p className="text-sm font-medium text-arova-text">
                {uploading ? "Validating & parsing dataset..." : "Drop CSV or TXT recording here"}
              </p>
              <p className="text-[11px] text-arova-muted mt-1">
                Raw binaries (.edf, .dat, .pkl) are safely rejected with exact CSV conversion steps.
              </p>
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-arova-green hover:bg-arova-green-dark text-white rounded-lg disabled:opacity-50 transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                {uploading ? "Parsing..." : "Select Dataset File"}
              </button>
            </div>
          </div>

          {uploadError && (
            <div
              role="alert"
              className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 text-xs text-rose-800 space-y-1.5"
            >
              <div className="flex items-center gap-2 font-semibold text-rose-900">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                <span>
                  Import Validation Failed
                  {uploadError.code ? ` (${uploadError.code})` : ""}
                </span>
              </div>
              <p className="leading-relaxed">{uploadError.message}</p>
              {uploadError.details && uploadError.details.length > 0 && (
                <ul className="list-disc pl-4 text-rose-700 space-y-0.5 font-mono text-[11px]">
                  {uploadError.details.slice(0, 5).map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Validated Upload Confirmation Summary */}
          {(lastImportSummary || provenance) && (
            <div className="bg-arova-mint border border-arova-sage rounded-xl p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-semibold text-arova-green-dark">
                  <CheckCircle2 className="w-4 h-4 text-arova-green shrink-0" />
                  <span>Validated Trace Loaded</span>
                </div>
                <span className="font-mono text-[11px] text-arova-muted truncate">
                  {lastImportSummary?.originalFilename ?? provenance?.originalFilename}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] font-mono pt-1">
                <div>
                  <span className="text-arova-muted">Participant:</span>{" "}
                  <span className="text-arova-text font-medium">
                    {lastImportSummary?.participantId ?? provenance?.participantId}
                  </span>
                </div>
                <div>
                  <span className="text-arova-muted">Frames:</span>{" "}
                  <span className="text-arova-text font-medium tabular-nums">
                    {lastImportSummary?.totalFrames ?? totalRecords}
                  </span>
                </div>
                <div>
                  <span className="text-arova-muted">Rate:</span>{" "}
                  <span className="text-arova-text font-medium tabular-nums">
                    {(lastImportSummary?.samplingRateHz ?? provenance?.samplingRateHz)
                      ? `${lastImportSummary?.samplingRateHz ?? provenance?.samplingRateHz} Hz`
                      : "Variable / Unknown"}
                  </span>
                </div>
                <div>
                  <span className="text-arova-muted">Span:</span>{" "}
                  <span className="text-arova-text font-medium tabular-nums">
                    {formatDurationMs(
                      lastImportSummary?.durationMs ?? provenance?.durationMs ?? 0
                    )}
                  </span>
                </div>
              </div>

              {(lastImportSummary?.startTimestampIso ?? provenance?.startTimestampIso) && (
                <div className="text-[11px] font-mono text-arova-muted pt-0.5 break-all">
                  Range: {lastImportSummary?.startTimestampIso ?? provenance?.startTimestampIso} →{" "}
                  {lastImportSummary?.endTimestampIso ?? provenance?.endTimestampIso}
                </div>
              )}

              <div className="text-[11px] text-arova-text pt-0.5">
                <span className="text-arova-muted font-medium">Cohort Note:</span>{" "}
                {lastImportSummary?.cohortNote ?? provenance?.cohortNote}
              </div>

              {(lastImportSummary?.warnings ?? provenance?.warnings ?? []).length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[11px] text-amber-800 space-y-0.5">
                  {(lastImportSummary?.warnings ?? provenance?.warnings ?? []).map((w, idx) => (
                    <div key={idx}>{w}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Right: Playback Controls + Live ML Output + Ground-Truth Evaluation */}
        <div className="xl:col-span-7 space-y-6">
          {/* Playback Control Panel */}
          <section className="bg-white border border-arova-border rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-arova-text">
                  2. Time-Preserving Playback Controller
                </h3>
                <p className="text-xs text-arova-muted mt-0.5 font-mono">
                  {provenance
                    ? `${provenance.datasetName} · ${provenance.participantId} · ${provenance.recordId}`
                    : "Awaiting dataset import"}
                </p>
              </div>
              <div className="text-xs font-mono shrink-0">
                <span className="text-arova-muted mr-2">State:</span>
                <span
                  className={`font-semibold uppercase ${
                    playback?.status === "playing"
                      ? "text-arova-green"
                      : playback?.status === "completed"
                      ? "text-arova-green-dark"
                      : playback?.status === "paused"
                      ? "text-amber-700"
                      : "text-arova-muted"
                  }`}
                >
                  {playback?.status === "playing" ? "● playing" : playback?.status ?? "unloaded"}
                </span>
              </div>
            </div>

            {/* Progress Bar & Time Readout */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                <span className="text-arova-text font-medium tabular-nums">
                  Record {processedCount} / {totalRecords} ({progressPct}%)
                </span>
                <span className="text-arova-green-dark tabular-nums">
                  {lastResult
                    ? `T+${formatDurationMs(lastResult.relativeOffsetMs)} · ${lastResult.timestampIso}`
                    : "Virtual timestamp: --"}
                </span>
              </div>
              <div className="w-full h-2 bg-arova-mint rounded-full overflow-hidden border border-arova-sage">
                <div
                  className="h-full bg-arova-green transition-all duration-150"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Control Buttons + Speed */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                {playback?.status === "paused" ? (
                  <button
                    type="button"
                    disabled={!hasLoadedRecording || controlBusy}
                    onClick={() => void handlePlaybackAction(resumePlayback)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-arova-green hover:bg-arova-green-dark text-white rounded-lg disabled:opacity-40 transition-colors"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Resume
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={
                      !hasLoadedRecording ||
                      controlBusy ||
                      isPlaying ||
                      playback?.status === "completed"
                    }
                    onClick={() => void handlePlaybackAction(startPlayback)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-arova-green hover:bg-arova-green-dark text-white rounded-lg disabled:opacity-40 transition-colors"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Start
                  </button>
                )}

                <button
                  type="button"
                  disabled={!isPlaying || controlBusy}
                  onClick={() => void handlePlaybackAction(pausePlayback)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white hover:bg-arova-mint text-arova-text border border-arova-border rounded-lg disabled:opacity-40 transition-colors"
                >
                  <Pause className="w-3.5 h-3.5" />
                  Pause
                </button>

                <button
                  type="button"
                  disabled={
                    !hasLoadedRecording || controlBusy || playback?.status === "completed"
                  }
                  onClick={() => void handleStep()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white hover:bg-arova-mint text-arova-text border border-arova-border rounded-lg disabled:opacity-40 transition-colors"
                >
                  <StepForward className="w-3.5 h-3.5" />
                  Step
                </button>

                <button
                  type="button"
                  disabled={!hasLoadedRecording || controlBusy}
                  onClick={() => void handlePlaybackAction(resetPlayback)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-arova-mint/50 hover:bg-arova-mint text-arova-text border border-arova-border rounded-lg disabled:opacity-40 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </button>
              </div>

              <label className="flex items-center gap-2 text-xs">
                <span className="text-arova-muted font-mono">Speed:</span>
                <select
                  aria-label="Playback speed"
                  value={playback?.speed ?? 1}
                  disabled={controlBusy}
                  onChange={(e) =>
                    void handlePlaybackAction(() => setPlaybackSpeed(Number(e.target.value)))
                  }
                  className="px-2.5 py-1.5 bg-white border border-arova-border rounded-lg text-arova-green-dark font-mono font-medium tabular-nums focus:outline-none focus:border-arova-green"
                >
                  {SPEED_OPTIONS.map((spd) => (
                    <option key={spd} value={spd}>
                      {spd}x
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {controlError && (
              <div className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                {controlError}
              </div>
            )}
          </section>

          {/* Live ML Results & Ground-Truth Evaluation Split */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Live ML Results Panel */}
            <section className="bg-white border border-arova-border rounded-xl p-5 space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-arova-text">Live ML Anomaly Decision</h3>
                {latestAnalysis ? (
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-mono font-semibold border ${
                      formatAlertBadge(latestAnalysis.alertLevel).borderClass
                    } ${formatAlertBadge(latestAnalysis.alertLevel).textClass}`}
                  >
                    {formatAlertBadge(latestAnalysis.alertLevel).glyph}
                  </span>
                ) : (
                  <span className="text-xs font-mono text-arova-muted">Idle</span>
                )}
              </div>

              {!latestAnalysis ? (
                <p className="text-xs text-arova-muted leading-relaxed">
                  Real backend ML decisions (<span className="font-mono text-arova-text">anomalyScore</span>,{" "}
                  <span className="font-mono text-arova-text">signalQuality</span>, baseline progress,
                  persistence, and explanation) will display here as frames execute.
                </p>
              ) : (
                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-2.5 font-mono">
                    <div className="bg-arova-mint/35 border border-arova-border rounded-lg p-2.5">
                      <div className="text-[11px] text-arova-muted">Anomaly Score</div>
                      <div className="text-lg font-semibold text-arova-text tabular-nums mt-0.5">
                        {latestAnalysis.anomalyScore.toFixed(4)}
                      </div>
                    </div>
                    <div className="bg-arova-mint/35 border border-arova-border rounded-lg p-2.5">
                      <div className="text-[11px] text-arova-muted">Prediction Stage</div>
                      <div className="text-xs font-semibold text-arova-green-dark mt-1.5">
                        {latestAnalysis.predictionClassification?.stage ?? latestAnalysis.anomalyStatus}
                      </div>
                    </div>
                    <div className="bg-arova-mint/35 border border-arova-border rounded-lg p-2.5">
                      <div className="text-[11px] text-arova-muted">Signal Quality</div>
                      <div className="text-xs font-semibold text-arova-text mt-1">
                        {latestAnalysis.signalQuality}
                      </div>
                    </div>
                    <div className="bg-arova-mint/35 border border-arova-border rounded-lg p-2.5">
                      <div className="text-[11px] text-arova-muted">Persistence</div>
                      <div className="text-xs font-semibold text-arova-text tabular-nums mt-1">
                        {latestAnalysis.persistenceCount} / {latestAnalysis.persistenceRequired}
                      </div>
                    </div>
                  </div>

                  {/* Baseline Learning Progress */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between font-mono text-[11px]">
                      <span className="text-arova-muted">
                        Isolated Baseline ({latestAnalysis.baselineProgress.status})
                      </span>
                      <span className="text-arova-text font-medium tabular-nums">
                        {latestAnalysis.baselineProgress.collectedSamples} /{" "}
                        {latestAnalysis.baselineProgress.requiredSamples}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-arova-mint rounded-full overflow-hidden border border-arova-sage">
                      <div
                        className="h-full bg-arova-green"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(
                              (latestAnalysis.baselineProgress.collectedSamples /
                                Math.max(1, latestAnalysis.baselineProgress.requiredSamples)) *
                                100
                            )
                          )}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div className="bg-arova-mint/35 border border-arova-border rounded-lg p-2.5 space-y-1">
                    <div className="text-[11px] font-mono text-arova-muted">
                      Engine: {latestAnalysis.mlEngine}
                      {latestAnalysis.modelVersion ? ` (${latestAnalysis.modelVersion})` : ""}
                    </div>
                    <p className="text-arova-text leading-relaxed">{latestAnalysis.explanation}</p>
                    {latestAnalysis.contributingFeatures.length > 0 && (
                      <div className="text-[11px] font-mono text-arova-green-dark pt-0.5">
                        Drivers: {latestAnalysis.contributingFeatures.join(", ")}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* Ground-Truth Evaluation Panel */}
            <section className="bg-white border border-arova-border rounded-xl p-5 space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-arova-text">
                  Ground-Truth Evaluation
                </h3>
                <span className="text-[11px] font-mono text-arova-muted">
                  {evaluation?.hasGroundTruthLabels
                    ? evaluation.labelGranularity === "trial_level"
                      ? "Trial-Level Label"
                      : "Sample-Level Label"
                    : "Unlabeled / Pending"}
                </span>
              </div>

              {!evaluation || !evaluation.hasGroundTruthLabels || !evaluation.metrics ? (
                <div className="space-y-3 text-xs">
                  <div className="bg-arova-mint/35 border border-dashed border-arova-sage rounded-lg p-3.5 text-arova-muted leading-relaxed">
                    {evaluation?.note ??
                      "Precision, recall, and F1 are strictly omitted until frames with dataset ground-truth labels are processed."}
                  </div>
                  {evaluation?.limitationNote && (
                    <div className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2.5 leading-relaxed">
                      {evaluation.limitationNote}
                    </div>
                  )}
                  <p className="text-[11px] text-arova-muted leading-relaxed">
                    {evaluation?.disclaimer ??
                      "Evaluates AROVA anomaly/alert output against dataset-provided event or protocol labels. This measures anomaly detection performance only and is not a clinically validated diagnosis."}
                  </p>
                </div>
              ) : (
                <div className="space-y-3 text-xs">
                  {/* Latest Frame Dataset vs AROVA Comparison */}
                  {lastResult && (
                    <div className="bg-arova-mint/35 border border-arova-border rounded-lg p-2.5 flex items-center justify-between gap-2 font-mono text-[11px]">
                      <div>
                        <span className="text-arova-muted">Dataset Label: </span>
                        <span
                          className={
                            lastResult.groundTruthIsAnomalous
                              ? "text-rose-700 font-semibold"
                              : "text-arova-green-dark font-semibold"
                          }
                        >
                          {lastResult.groundTruthLabel ?? "n/a"} (
                          {lastResult.groundTruthIsAnomalous ? "anomalous" : "normal"})
                        </span>
                      </div>
                      <div>
                        <span className="text-arova-muted">Stage: </span>
                        <span className={formatAlertBadge(lastResult.analysis.alertLevel).textClass}>
                          {lastResult.analysis.predictionClassification?.stage ??
                            lastResult.analysis.alertLevel}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Frame-Level Alert Evaluation (Persistence-Aware) */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-mono text-arova-muted">
                      <span>Frame-Level: Persistence Alert (Warning / Critical)</span>
                      <span className="tabular-nums">
                        Labeled: {evaluation.labeledCount} · Unlabeled: {evaluation.unlabeledCount}
                        {(evaluation.excludedBaselineTrainingCount ?? 0) > 0
                          ? ` · Baseline Excluded: ${evaluation.excludedBaselineTrainingCount}`
                          : ""}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 font-mono">
                      <div className="bg-arova-mint border border-arova-sage rounded-lg p-2.5">
                        <div className="text-[11px] text-arova-muted">Precision</div>
                        <div className="text-base font-semibold text-arova-green-dark tabular-nums mt-0.5">
                          {(evaluation.metrics.precision * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div className="bg-arova-mint border border-arova-sage rounded-lg p-2.5">
                        <div className="text-[11px] text-arova-muted">Recall</div>
                        <div className="text-base font-semibold text-arova-green tabular-nums mt-0.5">
                          {(evaluation.metrics.recall * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div className="bg-white border border-arova-border rounded-lg p-2.5">
                        <div className="text-[11px] text-arova-muted">F1 Score</div>
                        <div className="text-base font-semibold text-arova-text tabular-nums mt-0.5">
                          {(evaluation.metrics.f1Score * 100).toFixed(1)}%
                        </div>
                      </div>
                    </div>

                    {/* Confusion Matrix Counts */}
                    <div className="grid grid-cols-4 gap-2 font-mono text-center">
                      <div className="bg-arova-mint border border-arova-sage rounded-lg p-2">
                        <div className="text-[10px] text-arova-green-dark font-semibold">TP</div>
                        <div className="text-sm font-semibold text-arova-green-dark tabular-nums">
                          {evaluation.metrics.tp}
                        </div>
                      </div>
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
                        <div className="text-[10px] text-amber-700 font-semibold">FP</div>
                        <div className="text-sm font-semibold text-amber-900 tabular-nums">
                          {evaluation.metrics.fp}
                        </div>
                      </div>
                      <div className="bg-white border border-arova-border rounded-lg p-2">
                        <div className="text-[10px] text-arova-muted font-semibold">TN</div>
                        <div className="text-sm font-semibold text-arova-text tabular-nums">
                          {evaluation.metrics.tn}
                        </div>
                      </div>
                      <div className="bg-rose-50 border border-rose-200 rounded-lg p-2">
                        <div className="text-[10px] text-rose-700 font-semibold">FN</div>
                        <div className="text-sm font-semibold text-rose-900 tabular-nums">
                          {evaluation.metrics.fn}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Three-Tier Window vs Potential vs Confirmed Fall Breakdown */}
                  {evaluation.frameEvaluation && (
                    <div className="bg-arova-mint/35 border border-arova-border rounded-lg p-2.5 space-y-1 font-mono text-[11px]">
                      <div className="flex justify-between text-arova-text">
                        <span>Anomalous Windows (incl. transient)</span>
                        <span>
                          P {(evaluation.frameEvaluation.anomalousWindow.precision * 100).toFixed(0)}% · R{" "}
                          {(evaluation.frameEvaluation.anomalousWindow.recall * 100).toFixed(0)}% · F1{" "}
                          {(evaluation.frameEvaluation.anomalousWindow.f1Score * 100).toFixed(0)}% (
                          {evaluation.frameEvaluation.counts.anomalousWindowCount})
                        </span>
                      </div>
                      <div className="flex justify-between text-arova-text">
                        <span>Confirmed Fall Events (Alert + IMU Fall)</span>
                        <span>
                          P {(evaluation.frameEvaluation.confirmedFallEvent.precision * 100).toFixed(0)}% · R{" "}
                          {(evaluation.frameEvaluation.confirmedFallEvent.recall * 100).toFixed(0)}% · F1{" "}
                          {(evaluation.frameEvaluation.confirmedFallEvent.f1Score * 100).toFixed(0)}% (
                          {evaluation.frameEvaluation.counts.confirmedFallEventCount})
                        </span>
                      </div>
                      <div className="text-arova-muted">
                        Potential Fall Cues Observed: {evaluation.frameEvaluation.counts.potentialFallAlertCount}
                      </div>
                    </div>
                  )}

                  {/* Event-Level Detection (only when genuine event boundaries exist) */}
                  {evaluation.eventEvaluation && (
                    <div className="bg-arova-mint/35 border border-arova-border rounded-lg p-2.5 space-y-1 text-[11px]">
                      <div className="font-mono font-semibold text-arova-text">
                        Event-Level Detection{" "}
                        {evaluation.eventEvaluation.available
                          ? `(${evaluation.eventEvaluation.groundTruthEventCount} GT events)`
                          : "(Unavailable)"}
                      </div>
                      {evaluation.eventEvaluation.available &&
                      evaluation.eventEvaluation.alertEventMetrics ? (
                        <div className="font-mono text-arova-green-dark font-medium">
                          Alert Events: TP={evaluation.eventEvaluation.alertEventMetrics.tp} · FP=
                          {evaluation.eventEvaluation.alertEventMetrics.fp} · FN=
                          {evaluation.eventEvaluation.alertEventMetrics.fn} · F1{" "}
                          {(evaluation.eventEvaluation.alertEventMetrics.f1Score * 100).toFixed(1)}%
                        </div>
                      ) : (
                        <div className="text-arova-muted">{evaluation.eventEvaluation.note}</div>
                      )}
                    </div>
                  )}

                  {evaluation.limitationNote && (
                    <div className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2.5 leading-relaxed">
                      {evaluation.limitationNote}
                    </div>
                  )}

                  <div className="text-[11px] font-mono text-arova-muted">
                    {evaluation.note}
                  </div>
                  <p className="text-[11px] text-amber-900 bg-amber-50/70 border border-amber-200 rounded-lg p-2.5 leading-relaxed">
                    {evaluation.disclaimer}
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {/* Live Modality-Aware Sensor Visualization */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-arova-green" />
            <h3 className="text-base font-semibold text-arova-text">
              3. Modality-Aware Live Telemetry Charts
            </h3>
          </div>
          {provenance && (
            <span className="text-xs font-mono text-arova-muted">
              Showing recent window ({playback?.recentResults.length ?? 0} frames)
            </span>
          )}
        </div>
        <DatasetLabCharts
          provenance={provenance}
          recentResults={playback?.recentResults ?? []}
          lastResult={lastResult}
        />
      </section>

      {/* Verified Public Dataset Catalog (All 12 Datasets) */}
      <section className="bg-white border border-arova-border rounded-xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-arova-green" />
              <h3 className="text-base font-semibold text-arova-text">
                4. Verified Public Research Dataset Catalog ({catalog.length} Datasets)
              </h3>
            </div>
            <p className="text-xs text-arova-muted mt-1">
              None of these public archives are pre-bundled or locally downloaded by default (
              <span className="font-mono text-arova-text">integratedLocally: false</span>). Elderly
              participation is listed explicitly per cohort—no dataset consists exclusively of
              elderly subjects.
            </p>
          </div>

          <div className="relative shrink-0">
            <Search className="w-3.5 h-3.5 text-arova-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
              placeholder="Search datasets, cohorts..."
              className="pl-8 pr-3 py-1.5 text-xs bg-white border border-arova-border rounded-lg text-arova-text w-full sm:w-56 placeholder:text-arova-muted/60 focus:outline-none focus:border-arova-green focus:ring-2 focus:ring-arova-mint"
            />
          </div>
        </div>

        {/* Interactive Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 bg-arova-mint/60 p-1 rounded-lg border border-arova-border w-fit">
          {(
            [
              { key: "all", label: `All (${catalog.length})` },
              { key: "direct_csv", label: "Direct CSV/TXT Ready" },
              { key: "conversion_required", label: "Requires Conversion" },
              { key: "restricted", label: "Restricted / DUA" },
              { key: "elderly_inclusive", label: "Includes Elderly Cohort" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setCatalogFilter(tab.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                catalogFilter === tab.key
                  ? "bg-arova-green text-white font-semibold"
                  : "text-arova-muted hover:text-arova-text hover:bg-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loadingInit ? (
          <div className="py-10 text-center text-xs text-arova-muted font-mono">
            Loading dataset catalog...
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredCatalog.map((entry) => {
              const readiness = getCatalogReadiness(entry);
              const hasAdapter = adapters.some((a) => a.datasetId === entry.id);
              return (
                <article
                  key={entry.id}
                  className="bg-arova-mint/30 border border-arova-border rounded-xl p-4 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-arova-text leading-snug">
                          {entry.name}
                        </h4>
                        <div className="text-[11px] font-mono text-arova-muted mt-0.5">
                          {entry.sourcePlatform} · {entry.doiOrReference}
                        </div>
                      </div>
                      <a
                        href={entry.exactUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-mono text-arova-green-dark hover:text-arova-green font-medium shrink-0"
                      >
                        <span>Source</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>

                    {/* Text-First Metadata Rows */}
                    <div className="text-xs space-y-1 border-t border-arova-border pt-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px]">
                        <span className={`font-semibold ${readiness.toneClass}`}>
                          {readiness.label}
                        </span>
                        <span className="text-arova-sage">·</span>
                        <span className="text-arova-muted">
                          Local Status:{" "}
                          <span className="text-arova-text font-medium">Not Locally Integrated</span>
                        </span>
                      </div>

                      <div className="text-arova-text">
                        <span className="text-arova-muted font-mono text-[11px]">Signals:</span>{" "}
                        <span className="font-mono text-[11px] text-arova-text">
                          {formatSignalSummary(entry)}
                        </span>
                      </div>

                      <div className="text-arova-text text-[11px] leading-relaxed">
                        <span className="text-arova-muted font-mono">Cohort:</span>{" "}
                        <span
                          className={
                            entry.cohort.includesElderly
                              ? "text-arova-green-dark font-medium"
                              : "text-arova-text"
                          }
                        >
                          {entry.cohort.includesElderly
                            ? "Includes elderly & younger adults (not elderly-only)"
                            : "General/young adult cohort (no elderly subjects)"}
                        </span>
                        {" — "}
                        {entry.cohort.participantCountSummary}
                      </div>

                      <div className="text-arova-muted text-[11px] leading-relaxed">
                        <span className="text-arova-muted font-mono">Formats:</span>{" "}
                        {entry.nativeFormats.join(", ")} · {entry.samplingRatesNote}
                      </div>

                      <div className="text-arova-muted text-[11px] leading-relaxed">
                        <span className="text-arova-muted font-mono">Access:</span>{" "}
                        {entry.accessInstructions}
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-arova-border flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-[11px] text-arova-muted">id: {entry.id}</span>
                    {hasAdapter ? (
                      <button
                        type="button"
                        onClick={() =>
                          handleSelectAdapterFromCatalog(entry.id as SupportedAdapterDatasetId)
                        }
                        className="px-3 py-1.5 text-xs font-semibold bg-arova-mint hover:bg-arova-green hover:text-white text-arova-green-dark border border-arova-sage rounded-lg transition-colors"
                      >
                        Select for Import
                      </button>
                    ) : (
                      <span className="text-[11px] font-mono text-arova-muted">
                        {readiness.key === "restricted"
                          ? "Manual DUA download required"
                          : "Conversion parser pending"}
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
