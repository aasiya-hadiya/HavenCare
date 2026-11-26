from __future__ import annotations

import json
import os
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

from alert_engine import AlertDecisionConfig, AlertDecisionEngine
from ecg_features import EcgFeatureSummary
from features import (
    MODEL_FEATURE_NAMES,
    PatientWindowStore,
    PersonalBaselineSummary,
    WindowReading,
    compute_personal_baseline_stats,
    extract_windowed_features,
    parse_timestamp_sec,
)


DEFAULT_MODEL_DIR = Path(os.environ.get("SMARTCARE_MODEL_DIR", Path(__file__).parent / "models"))
ALLOWED_BASELINE_SOURCES = {"esp32_hardware", "simulator", "dataset_playback"}


def _safe_key(val: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", val)[:64] or "unknown"


@dataclass
class PatientBaselineModel:
    patient_id: str
    source: str
    scaler: StandardScaler
    model: IsolationForest
    baseline: PersonalBaselineSummary
    sample_count: int
    contamination: float
    model_version: str
    trained_at: str
    feature_names: List[str]


class AnomalyDetectorRegistry:
    """
    Per-patient, source-separated personalized Isolation Forest registry with:
    - Quality-filtered incremental baseline collection (esp32_hardware kept strictly separate from simulator; sample_demo excluded)
    - Time-windowed & activity-context feature extraction
    - Joblib + JSON disk persistence & model versioning
    - Separate AlertDecisionEngine with multi-window persistence
    """

    def __init__(self, model_dir: Optional[Path] = None) -> None:
        self.model_dir = Path(model_dir) if model_dir else DEFAULT_MODEL_DIR
        self.model_dir.mkdir(parents=True, exist_ok=True)
        self._models: Dict[Tuple[str, str], PatientBaselineModel] = {}
        self._pending_samples: Dict[Tuple[str, str], List[WindowReading]] = {}
        self.window_store = PatientWindowStore()
        self.alert_engine = AlertDecisionEngine()
        self._load_persisted_models()

    def _model_paths(self, patient_id: str, source: str) -> Tuple[Path, Path]:
        stem = f"{_safe_key(patient_id)}__{_safe_key(source)}"
        return self.model_dir / f"{stem}.joblib", self.model_dir / f"{stem}.meta.json"

    def _load_persisted_models(self) -> None:
        for meta_path in self.model_dir.glob("*.meta.json"):
            bundle_path = meta_path.with_name(meta_path.name.replace(".meta.json", ".joblib"))
            if not bundle_path.exists():
                continue
            try:
                payload = joblib.load(bundle_path)
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                entry = PatientBaselineModel(
                    patient_id=meta["patient_id"],
                    source=meta["source"],
                    scaler=payload["scaler"],
                    model=payload["model"],
                    baseline=payload["baseline"],
                    sample_count=int(meta["sample_count"]),
                    contamination=float(meta["contamination"]),
                    model_version=meta["model_version"],
                    trained_at=meta["trained_at"],
                    feature_names=list(meta.get("feature_names", MODEL_FEATURE_NAMES)),
                )
                self._models[(entry.patient_id, entry.source)] = entry
            except Exception:
                continue

    def _persist_model(self, entry: PatientBaselineModel) -> None:
        bundle_path, meta_path = self._model_paths(entry.patient_id, entry.source)
        joblib.dump(
            {
                "scaler": entry.scaler,
                "model": entry.model,
                "baseline": entry.baseline,
            },
            bundle_path,
        )
        meta = {
            "patient_id": entry.patient_id,
            "source": entry.source,
            "sample_count": entry.sample_count,
            "contamination": entry.contamination,
            "model_version": entry.model_version,
            "trained_at": entry.trained_at,
            "feature_names": entry.feature_names,
            "overall_means": entry.baseline.overall_means,
            "overall_stds": entry.baseline.overall_stds,
            "resting_samples": entry.baseline.resting.sample_count if entry.baseline.resting else 0,
            "active_samples": entry.baseline.active.sample_count if entry.baseline.active else 0,
            "ecg_sample_count": entry.baseline.ecg_sample_count,
            "ecg_model_trained": False,
        }
        meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    MIN_IFOREST_TRAINING_SAMPLES = 20

    def reset_patient(self, patient_id: str, source: Optional[str] = None) -> int:
        sources = [source] if source else list(ALLOWED_BASELINE_SOURCES)
        removed = 0
        for src in sources:
            key = (patient_id, src)
            if key in self._models:
                del self._models[key]
                removed += 1
            self._pending_samples.pop(key, None)
            bundle_path, meta_path = self._model_paths(patient_id, src)
            bundle_path.unlink(missing_ok=True)
            meta_path.unlink(missing_ok=True)
        self.window_store.clear(patient_id)
        self.alert_engine.clear(patient_id)
        return removed

    def get_status(self, patient_id: str, source: Optional[str] = None) -> Dict[str, object]:
        if source is not None:
            entries = [self._models[(patient_id, source)]] if (patient_id, source) in self._models else []
        else:
            entries = [
                v
                for (pid, src), v in self._models.items()
                if pid == patient_id and src != "dataset_playback"
            ]
        pending_count = sum(
            len(v)
            for (pid, src), v in self._pending_samples.items()
            if pid == patient_id and (source is None or src == source)
        )
        if not entries:
            return {
                "patient_id": patient_id,
                "source": source,
                "trained": False,
                "ecg_model_trained": False,
                "sample_count": pending_count,
                "min_training_samples": self.MIN_IFOREST_TRAINING_SAMPLES,
                "model_version": None,
                "trained_at": None,
                "means": None,
                "stds": None,
            }

        # Prefer esp32_hardware over simulator, and simulator over dataset_playback when source is unspecified
        priority = {"esp32_hardware": 0, "simulator": 1, "dataset_playback": 2}
        entry = sorted(entries, key=lambda e: priority.get(e.source, 3))[0]
        return {
            "patient_id": patient_id,
            "source": entry.source,
            "trained": True,
            "ecg_model_trained": False,
            "sample_count": entry.sample_count,
            "min_training_samples": self.MIN_IFOREST_TRAINING_SAMPLES,
            "model_version": entry.model_version,
            "trained_at": entry.trained_at,
            "means": entry.baseline.overall_means,
            "stds": entry.baseline.overall_stds,
            "resting_means": entry.baseline.resting.means if entry.baseline.resting else None,
            "active_means": entry.baseline.active.means if entry.baseline.active else None,
            "ecg_bpm_mean": entry.baseline.ecg_bpm_mean,
        }

    def validate_sensor_quality(
        self,
        heart_rate: Optional[float],
        spo2: Optional[float],
        temperature_c: Optional[float],
        accel_magnitude: float,
        ir_signal_ok: bool = True,
        finger_detected: bool = True,
        source: str = "simulator",
        available_modalities: Optional[Dict[str, bool]] = None,
        temperature_site: Optional[str] = None,
    ) -> Tuple[str, List[str]]:
        issues: List[str] = []
        is_dataset = source == "dataset_playback"
        hr_expected = (not is_dataset) or ((available_modalities or {}).get("heartRate", True) is not False)
        spo2_expected = (not is_dataset) or ((available_modalities or {}).get("spo2", True) is not False)

        if not finger_detected or not ir_signal_ok:
            issues.append("MAX30100 optical sensor reports no finger detected or low IR perfusion.")
        else:
            if hr_expected and (heart_rate is None or heart_rate == 0):
                issues.append("MAX30100 optical sensor reports no finger detected or low IR perfusion.")
            elif heart_rate is not None and (heart_rate < 30 or heart_rate > 230):
                issues.append(f"Heart rate reading ({heart_rate} BPM) outside physiological sensor bounds.")

            if spo2_expected and (spo2 is None or spo2 == 0):
                issues.append("MAX30100 optical sensor reports missing or invalid SpO2 optical signal.")
            elif spo2 is not None and (spo2 < 50 or spo2 > 100):
                issues.append(f"SpO2 reading ({spo2}%) outside pulse oximetry bounds.")

        min_temp = 25.0 if (is_dataset and temperature_site == "skin_wrist") else 30.0
        if temperature_c is not None and (temperature_c < min_temp or temperature_c > 43.0):
            issues.append(f"Temperature ({temperature_c} °C) indicates detached probe or out-of-range artifact.")

        if issues:
            return "poor_contact", issues
        if accel_magnitude > 2.6:
            return "noisy", ["High MPU6050 motion artifact detected; optical PPG readings may carry movement noise."]
        return "good", []

    def _is_clean_baseline_sample(
        self,
        s: WindowReading,
        source: str = "simulator",
        available_modalities: Optional[Dict[str, bool]] = None,
        temperature_site: Optional[str] = None,
    ) -> bool:
        if s.signal_quality != "good":
            return False
        is_dataset = source == "dataset_playback"
        hr_expected = (not is_dataset) or ((available_modalities or {}).get("heartRate", True) is not False)
        spo2_expected = (not is_dataset) or ((available_modalities or {}).get("spo2", True) is not False)

        if hr_expected and (s.heart_rate is None or not (30 <= s.heart_rate <= 230)):
            return False
        if not hr_expected and s.heart_rate is not None and not (30 <= s.heart_rate <= 230):
            return False

        if spo2_expected and (s.spo2 is None or not (50 <= s.spo2 <= 100)):
            return False
        if not spo2_expected and s.spo2 is not None and not (50 <= s.spo2 <= 100):
            return False

        min_temp = 25.0 if (is_dataset and temperature_site == "skin_wrist") else 30.0
        if s.temperature_c is not None and not (min_temp <= s.temperature_c <= 43.0):
            return False
        return True

    def fit_patient_baseline(
        self,
        patient_id: str,
        samples: List[WindowReading],
        source: str = "simulator",
        contamination: float = 0.05,
        min_samples: int = 20,
        available_modalities: Optional[Dict[str, bool]] = None,
        temperature_site: Optional[str] = None,
    ) -> PatientBaselineModel:
        if source not in ALLOWED_BASELINE_SOURCES:
            raise ValueError(
                f"Source '{source}' cannot train a personalized baseline. Only esp32_hardware, simulator, or dataset_playback readings are allowed."
            )

        clean_samples = [
            s
            for s in samples
            if self._is_clean_baseline_sample(
                s,
                source=source,
                available_modalities=available_modalities if source == "dataset_playback" else None,
                temperature_site=temperature_site if source == "dataset_playback" else None,
            )
        ]

        required = max(self.MIN_IFOREST_TRAINING_SAMPLES, min_samples)
        if len(clean_samples) < required:
            raise ValueError(
                f"At least {required} quality-filtered ('good') baseline samples are required to fit the 11-feature Isolation Forest (got {len(clean_samples)})."
            )

        clean_samples.sort(key=lambda s: s.timestamp_sec)
        baseline_summary = compute_personal_baseline_stats(clean_samples)

        # Build time-windowed feature matrix across sequential baseline windows
        temp_store = PatientWindowStore(max_window_len=8, max_window_age_sec=3600.0)
        feature_rows: List[List[float]] = []
        for s in clean_samples:
            win = temp_store.append_and_get(patient_id, source, s)
            ecg_sum = (
                EcgFeatureSummary(
                    sampling_rate_hz=200,
                    sample_count=100,
                    r_peak_count=2,
                    estimated_ecg_bpm=s.ecg_bpm,
                    rr_interval_mean_ms=s.ecg_rri_ms,
                    rr_variability_ms=s.ecg_hrv_ms,
                    amplitude_range=1.0,
                    signal_quality=s.ecg_signal_quality,
                )
                if s.ecg_signal_quality == "good" and not s.ecg_lead_off and s.ecg_bpm is not None
                else None
            )
            extracted = extract_windowed_features(win, baseline_summary, ecg_sum)
            feature_rows.append(extracted.feature_vector)

        matrix = np.array(feature_rows, dtype=float)
        scaler = StandardScaler()
        scaled = scaler.fit_transform(matrix)

        model = IsolationForest(
            n_estimators=150,
            contamination=contamination,
            random_state=42,
        )
        model.fit(scaled)

        now = datetime.now(timezone.utc)
        version = f"iforest-v2-{source}-{now.strftime('%Y%m%d%H%M%S')}"
        entry = PatientBaselineModel(
            patient_id=patient_id,
            source=source,
            scaler=scaler,
            model=model,
            baseline=baseline_summary,
            sample_count=len(clean_samples),
            contamination=contamination,
            model_version=version,
            trained_at=now.isoformat(),
            feature_names=list(MODEL_FEATURE_NAMES),
        )
        self._models[(patient_id, source)] = entry
        self._pending_samples[(patient_id, source)] = list(clean_samples[-500:])
        self._persist_model(entry)
        return entry

    def collect_baseline_sample(
        self,
        patient_id: str,
        sample: WindowReading,
        source: str,
        min_samples: int = 20,
        auto_fit: bool = True,
        available_modalities: Optional[Dict[str, bool]] = None,
        temperature_site: Optional[str] = None,
    ) -> Dict[str, object]:
        effective_min = max(self.MIN_IFOREST_TRAINING_SAMPLES, min_samples)
        if source not in ALLOWED_BASELINE_SOURCES:
            return {
                "accepted": False,
                "reason": f"Source '{source}' ignored for personalized baseline collection.",
                "collected_count": len(self._pending_samples.get((patient_id, source), [])),
                "required_samples": effective_min,
                "trained": (patient_id, source) in self._models,
            }

        eff_modalities = available_modalities if source == "dataset_playback" else None
        eff_temp_site = temperature_site if source == "dataset_playback" else None

        if not self._is_clean_baseline_sample(
            sample,
            source=source,
            available_modalities=eff_modalities,
            temperature_site=eff_temp_site,
        ):
            return {
                "accepted": False,
                "reason": "Sample excluded because sensor signal_quality is not 'good' or values are invalid/null.",
                "collected_count": len(self._pending_samples.get((patient_id, source), [])),
                "required_samples": effective_min,
                "trained": (patient_id, source) in self._models,
            }

        key = (patient_id, source)
        buf = self._pending_samples.setdefault(key, [])
        buf.append(sample)
        if len(buf) > 500:
            del buf[:-500]

        if auto_fit and len(buf) >= effective_min and key not in self._models:
            fitted = self.fit_patient_baseline(
                patient_id=patient_id,
                samples=buf,
                source=source,
                min_samples=effective_min,
                available_modalities=eff_modalities,
                temperature_site=eff_temp_site,
            )
            return {
                "accepted": True,
                "collected_count": len(buf),
                "required_samples": effective_min,
                "trained": True,
                "model_version": fitted.model_version,
                "means": fitted.baseline.overall_means,
            }

        return {
            "accepted": True,
            "collected_count": len(buf),
            "required_samples": effective_min,
            "trained": key in self._models,
            "model_version": self._models[key].model_version if key in self._models else None,
        }

    def analyze(
        self,
        patient_id: str,
        heart_rate: Optional[float],
        spo2: Optional[float],
        temperature_c: Optional[float],
        accel_magnitude: float,
        gyro_magnitude: float,
        movement_status: str = "resting",
        possible_fall_detected: bool = False,
        ir_signal_ok: bool = True,
        finger_detected: bool = True,
        ecg_summary: Optional[EcgFeatureSummary] = None,
        source: str = "simulator",
        timestamp: Optional[str] = None,
        config: Optional[AlertDecisionConfig] = None,
        available_modalities: Optional[Dict[str, bool]] = None,
        temperature_site: Optional[str] = None,
    ) -> Dict[str, object]:
        cfg = config or AlertDecisionConfig()
        is_dataset = source == "dataset_playback"
        eff_modalities = available_modalities if is_dataset else None
        eff_temp_site = temperature_site if is_dataset else None
        hr_expected = (not is_dataset) or ((eff_modalities or {}).get("heartRate", True) is not False)
        spo2_expected = (not is_dataset) or ((eff_modalities or {}).get("spo2", True) is not False)

        quality, quality_notes = self.validate_sensor_quality(
            heart_rate=heart_rate,
            spo2=spo2,
            temperature_c=temperature_c,
            accel_magnitude=accel_magnitude,
            ir_signal_ok=ir_signal_ok,
            finger_detected=finger_detected,
            source=source,
            available_modalities=eff_modalities,
            temperature_site=eff_temp_site,
        )

        ecg_lead_off = bool(ecg_summary and ecg_summary.signal_quality == "lead_off")
        ecg_note = " AD8232 ECG electrodes report lead-off." if ecg_lead_off else ""

        reading = WindowReading(
            timestamp_sec=parse_timestamp_sec(timestamp),
            heart_rate=heart_rate,
            spo2=spo2,
            temperature_c=temperature_c,
            accel_magnitude=accel_magnitude,
            gyro_magnitude=gyro_magnitude,
            movement_status=movement_status,
            signal_quality=quality,
            ecg_bpm=ecg_summary.estimated_ecg_bpm if ecg_summary else None,
            ecg_rri_ms=ecg_summary.rr_interval_mean_ms if ecg_summary else None,
            ecg_hrv_ms=ecg_summary.rr_variability_ms if ecg_summary else None,
            ecg_signal_quality=ecg_summary.signal_quality if ecg_summary else "unavailable",
            ecg_lead_off=ecg_lead_off,
        )

        window = self.window_store.append_and_get(patient_id, source, reading)
        entry = self._models.get((patient_id, source))
        pending_count = len(self._pending_samples.get((patient_id, source), []))

        extracted = extract_windowed_features(
            window=window,
            baseline=entry.baseline if entry else None,
            ecg_summary=ecg_summary,
        )

        raw_score: Optional[float] = None
        prediction: Optional[int] = None
        if (
            entry is not None
            and quality != "poor_contact"
            and (not hr_expected or heart_rate is not None)
            and (not spo2_expected or spo2 is not None)
        ):
            vec = np.array([extracted.feature_vector], dtype=float)
            scaled = entry.scaler.transform(vec)
            raw_score = float(entry.model.decision_function(scaled)[0])
            prediction = int(entry.model.predict(scaled)[0])

        decision = self.alert_engine.evaluate(
            patient_id=patient_id,
            source=source,
            signal_quality=quality,
            quality_notes=quality_notes,
            ecg_note=ecg_note,
            model_trained=entry is not None,
            collected_baseline_samples=entry.sample_count if entry else pending_count,
            heart_rate=heart_rate,
            spo2=spo2,
            temperature_c=temperature_c,
            accel_magnitude=accel_magnitude,
            movement_status=movement_status,
            possible_fall_detected=possible_fall_detected,
            raw_anomaly_score=raw_score,
            iforest_prediction=prediction,
            features=extracted,
            config=cfg,
            hr_expected=hr_expected,
            spo2_expected=spo2_expected,
        )

        return {
            "patient_id": patient_id,
            "source": source,
            "model_trained": entry is not None,
            "model_version": entry.model_version if entry else None,
            "ecg_model_trained": False,
            "signal_quality": quality,
            "anomaly_status": decision.anomaly_status,
            "anomaly_score": round(raw_score, 4) if raw_score is not None else 0.0,
            "alert_level": decision.alert_level,
            "triggered_metrics": decision.triggered_metrics,
            "contributing_features": decision.contributing_summary,
            "contributing_details": extracted.contributing_features[:5],
            "persistence_count": decision.persistence_count,
            "persistence_required": decision.persistence_required,
            "matched_baseline_context": extracted.matched_baseline_context,
            "window_size": extracted.window_size,
            "explanation": decision.explanation,
        }
