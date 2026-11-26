import { useEffect, useState } from "react";
import { Check, PhoneCall, PhoneForwarded, ShieldCheck, UserCheck } from "lucide-react";
import { EcgWaveformPanel } from "../components/EcgWaveformPanel.tsx";
import { AlertLevelLabel } from "../components/StatusIndicator.tsx";
import { useSmartCare } from "../context/SmartCareContext.tsx";
import { advanceVoiceOutcome, triggerVoiceEscalation } from "../services/apiClient.ts";

export function CaregiverDashboardPage() {
  const {
    patients,
    selectedPatientId,
    setSelectedPatientId,
    selectedPatient,
    readings,
    alerts,
    integrations,
    systemSettings,
    acknowledgeAlert,
    resolveAlert,
    updateAlertEscalation,
    liveHardwareSnapshot,
    ecgSegments,
  } = useSmartCare();

  const [followUpNotes, setFollowUpNotes] = useState<Record<string, string>>({});
  const [countdownByAlert, setCountdownByAlert] = useState<Record<string, number>>({});
  const [escalationBusyId, setEscalationBusyId] = useState<string | null>(null);
  const [escalationError, setEscalationError] = useState<string | null>(null);

  const latest = liveHardwareSnapshot ?? readings[readings.length - 1] ?? null;
  const patientAlerts = alerts.filter((a) => a.patientId === selectedPatientId);
  const activeAlerts = patientAlerts.filter((a) => a.status !== "resolved");
  const resolvedAlerts = patientAlerts.filter((a) => a.status === "resolved");

  // Countdown timer for active calling_primary dry-run or live escalation
  useEffect(() => {
    const calling = patientAlerts.filter((a) => a.callEscalationStatus === "calling_primary");
    if (calling.length === 0) return;

    const interval = setInterval(() => {
      setCountdownByAlert((prev) => {
        const next = { ...prev };
        for (const a of calling) {
          const cur = next[a.alertId] ?? systemSettings.escalationTimeoutSec;
          if (cur > 1) {
            next[a.alertId] = cur - 1;
          } else if (cur === 1) {
            next[a.alertId] = 0;
            void advanceVoiceOutcome(a.alertId, "primary_no_answer_escalate")
              .then((updated) => updateAlertEscalation(a.alertId, updated.status, updated.log))
              .catch(() => {});
          }
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [patientAlerts, systemSettings.escalationTimeoutSec, updateAlertEscalation]);

  const handleStartEscalation = async (alertId: string, summary: string, dryRun: boolean) => {
    setEscalationBusyId(alertId);
    setEscalationError(null);
    try {
      const result = await triggerVoiceEscalation({
        alertId,
        patientId: selectedPatient.patientId,
        patientName: selectedPatient.displayName,
        summary,
        primaryCaregiverName: selectedPatient.primaryCaregiverName || "Primary Caregiver",
        secondaryCaregiverName: selectedPatient.secondaryCaregiverName || "Secondary Caregiver",
        timeoutSec: systemSettings.escalationTimeoutSec,
        dryRun,
      });
      if (result.status === "calling_primary") {
        setCountdownByAlert((prev) => ({
          ...prev,
          [alertId]: result.timeoutSec,
        }));
      }
      await updateAlertEscalation(alertId, result.status, result.log);
    } catch (err) {
      setEscalationError(err instanceof Error ? err.message : "Failed to initiate escalation.");
    } finally {
      setEscalationBusyId(null);
    }
  };

  const handleAdvanceOutcome = async (
    alertId: string,
    action: "primary_answered" | "primary_no_answer_escalate" | "secondary_acknowledged"
  ) => {
    setEscalationBusyId(alertId);
    setEscalationError(null);
    try {
      const updated = await advanceVoiceOutcome(alertId, action);
      await updateAlertEscalation(alertId, updated.status, updated.log);
    } catch (err) {
      setEscalationError(err instanceof Error ? err.message : "Failed to update call outcome.");
    } finally {
      setEscalationBusyId(null);
    }
  };

  const latestHrText =
    latest && typeof latest.heartRate === "number" ? `${Math.round(latest.heartRate)} BPM` : "-- BPM";
  const latestSpo2Text =
    latest && typeof latest.spo2 === "number" ? `${latest.spo2.toFixed(1)}%` : "--%";
  const latestTempText =
    latest && typeof latest.temperatureC === "number"
      ? `${latest.temperatureC.toFixed(1)} °C`
      : "Temp pending";
  const fallSuspect = Boolean(
    latest?.possibleFallDetected || latest?.movementStatus === "fall_suspect"
  );

  return (
    <div className="space-y-6">
      {/* Linked Patients Roster */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-arova-text">Linked Patients Under Care</h2>
          <p className="text-xs text-arova-muted mt-0.5">
            Select a patient to inspect current vitals, AD8232 ECG status, alerts, and emergency escalation workflow
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {patients.map((pt) => {
            const isSelected = pt.patientId === selectedPatientId;
            const ptActiveCount = alerts.filter(
              (a) => a.patientId === pt.patientId && a.status === "active"
            ).length;

            return (
              <button
                key={pt.patientId}
                type="button"
                onClick={() => setSelectedPatientId(pt.patientId)}
                className={`text-left rounded-xl p-4 border transition-colors ${
                  isSelected
                    ? "bg-arova-mint/50 border-arova-green ring-1 ring-arova-green"
                    : "bg-white border-arova-border hover:border-arova-sage"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-arova-text">{pt.displayName}</span>
                  <span
                    className={`text-xs font-semibold font-mono tabular-nums ${
                      ptActiveCount > 0 ? "text-red-700" : "text-arova-green-dark"
                    }`}
                  >
                    {ptActiveCount} active alert{ptActiveCount === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="text-xs text-arova-muted mt-1">
                  {pt.ageGroup || "Monitored patient"} · Baseline {pt.baselineStatus}
                </div>
                <div className="text-xs text-arova-muted mt-3 pt-3 border-t border-arova-border/70 flex items-center justify-between gap-2">
                  <span>Primary: {pt.primaryCaregiverName || "Unassigned"}</span>
                  <span className="font-mono text-arova-muted">{pt.dataMode}</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {fallSuspect && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-900">
          <span className="font-semibold">Possible Fall Indicator (Experimental IMU):</span>{" "}
          Selected patient&apos;s latest MPU6050 reading flagged an impact spike ({latest?.accelMagnitude?.toFixed(2) ?? "high"} g). Experimental heuristic — verify patient condition directly.
        </div>
      )}

      {/* Selected Patient Snapshot + Voice Integration Status */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-arova-border rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-arova-text">
                Active &amp; Acknowledged Alerts
              </h3>
              <p className="text-xs text-arova-muted mt-0.5">
                Acknowledge alerts, record follow-up actions, and track automated voice escalation
              </p>
            </div>
            {latest && (
              <div className="text-xs text-arova-muted font-mono tabular-nums text-right">
                <div>
                  Latest: {latestHrText} · {latestSpo2Text} · {latestTempText}
                </div>
                <div className="text-arova-muted/80 mt-0.5">
                  ML: {latest.anomalyStatus ?? latest.alertLevel} · score {latest.anomalyScore.toFixed(3)}
                  {latest.contributingFeatures && latest.contributingFeatures.length > 0
                    ? ` · ${latest.contributingFeatures.slice(0, 2).join(", ")}`
                    : ""}
                </div>
              </div>
            )}
          </div>

          {escalationError && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {escalationError}
            </div>
          )}

          {activeAlerts.length === 0 ? (
            <div className="py-10 text-center text-sm text-arova-muted border border-dashed border-arova-border rounded-lg bg-arova-mint/30">
              No active alerts require caregiver follow-up right now.
            </div>
          ) : (
            <div className="space-y-4">
              {activeAlerts.map((alert) => {
                const noteVal = followUpNotes[alert.alertId] ?? alert.followUpAction ?? "";
                const secondsLeft = countdownByAlert[alert.alertId];

                return (
                  <div
                    key={alert.alertId}
                    className="border border-arova-border rounded-xl p-4 space-y-3 bg-arova-mint/30"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <AlertLevelLabel level={alert.level} />
                        <span className="text-sm font-semibold text-arova-text">
                          {alert.title}
                        </span>
                      </div>
                      <span className="text-xs text-arova-muted font-mono tabular-nums">
                        {alert.status} · {alert.source}
                      </span>
                    </div>

                    <p className="text-xs text-arova-text leading-relaxed">{alert.explanation}</p>

                    {/* Caregiver Escalation Controls for Critical Alerts */}
                    {alert.level === "Critical" && (
                      <div className="bg-white border border-arova-border rounded-lg p-3.5 space-y-2.5">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs font-semibold text-arova-text">
                            <PhoneCall className="w-4 h-4 text-arova-green" />
                            <span>
                              Voice Escalation Status:{" "}
                              <span className="font-mono">{alert.callEscalationStatus}</span>
                            </span>
                            {typeof secondsLeft === "number" &&
                              alert.callEscalationStatus === "calling_primary" && (
                                <span className="font-mono tabular-nums text-amber-700">
                                  ({secondsLeft}s before secondary escalation)
                                </span>
                              )}
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {(alert.callEscalationStatus === "not_triggered" ||
                              alert.callEscalationStatus === "provider_unconfigured") && (
                              <>
                                {integrations?.voiceCalling.configured && (
                                  <button
                                    type="button"
                                    disabled={escalationBusyId === alert.alertId}
                                    onClick={() =>
                                      handleStartEscalation(alert.alertId, alert.explanation, false)
                                    }
                                    className="px-3 py-1.5 text-xs font-semibold text-white bg-red-700 rounded-lg hover:bg-red-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                                  >
                                    Dispatch Live Call
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={escalationBusyId === alert.alertId}
                                  onClick={() =>
                                    handleStartEscalation(alert.alertId, alert.explanation, true)
                                  }
                                  className="px-3 py-1.5 text-xs font-semibold text-arova-text bg-arova-mint border border-arova-border rounded-lg hover:bg-arova-sage/60 disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
                                >
                                  Run Workflow Dry-Run
                                </button>
                              </>
                            )}

                            {alert.callEscalationStatus === "calling_primary" && (
                              <>
                                <button
                                  type="button"
                                  disabled={escalationBusyId === alert.alertId}
                                  onClick={() =>
                                    handleAdvanceOutcome(alert.alertId, "primary_answered")
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-arova-green-dark bg-arova-mint border border-arova-sage rounded-lg hover:bg-arova-sage"
                                >
                                  <UserCheck className="w-3.5 h-3.5" />
                                  Primary Answered
                                </button>
                                <button
                                  type="button"
                                  disabled={escalationBusyId === alert.alertId}
                                  onClick={() =>
                                    handleAdvanceOutcome(
                                      alert.alertId,
                                      "primary_no_answer_escalate"
                                    )
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100"
                                >
                                  <PhoneForwarded className="w-3.5 h-3.5" />
                                  Timeout → Escalate Secondary
                                </button>
                              </>
                            )}

                            {alert.callEscalationStatus === "escalated_secondary" && (
                              <button
                                type="button"
                                disabled={escalationBusyId === alert.alertId}
                                onClick={() =>
                                  handleAdvanceOutcome(alert.alertId, "secondary_acknowledged")
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-arova-green-dark bg-arova-mint border border-arova-sage rounded-lg hover:bg-arova-sage"
                              >
                                <Check className="w-3.5 h-3.5" />
                                Secondary Answered
                              </button>
                            )}
                          </div>
                        </div>

                        {alert.callLog.length > 0 && (
                          <ul className="space-y-1 text-xs text-arova-muted font-mono border-t border-arova-border/70 pt-2">
                            {alert.callLog.map((line, i) => (
                              <li key={i}>{line}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {/* Follow-up Action Form */}
                    <div className="flex flex-col sm:flex-row gap-2 pt-1">
                      <input
                        type="text"
                        value={noteVal}
                        onChange={(e) =>
                          setFollowUpNotes((prev) => ({
                            ...prev,
                            [alert.alertId]: e.target.value,
                          }))
                        }
                        placeholder="Record caregiver follow-up action (e.g., spoke with patient, checked pulse)..."
                        className="flex-1 px-3 py-2 text-xs bg-white border border-arova-border rounded-lg text-arova-text focus:outline-none focus:border-arova-green"
                      />
                      <div className="flex items-center gap-2 shrink-0">
                        {alert.status === "active" && (
                          <button
                            type="button"
                            onClick={() => acknowledgeAlert(alert.alertId, noteVal)}
                            className="px-3 py-2 text-xs font-semibold text-white bg-arova-green rounded-lg hover:bg-arova-green-dark whitespace-nowrap transition-colors"
                          >
                            Acknowledge
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => resolveAlert(alert.alertId, noteVal)}
                          className="px-3 py-2 text-xs font-semibold text-arova-text bg-white border border-arova-border rounded-lg hover:bg-arova-mint whitespace-nowrap transition-colors"
                        >
                          Resolve Alert
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Emergency Contact & Escalation Configuration Panel */}
        <aside className="bg-white border border-arova-border rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-arova-green" />
            <h3 className="text-base font-semibold text-arova-text">
              Emergency Escalation Chain
            </h3>
          </div>

          <div className="space-y-3 text-xs">
            <div className="p-3 bg-arova-mint/60 border border-arova-border/70 rounded-lg space-y-1">
              <div className="text-arova-muted">Step 1 · Primary Caregiver</div>
              <div className="text-sm font-semibold text-arova-text">
                {selectedPatient.primaryCaregiverName || "Not Assigned"}
              </div>
              <div className="text-arova-muted">
                Timeout window: {systemSettings.escalationTimeoutSec} seconds
              </div>
            </div>

            <div className="p-3 bg-arova-mint/60 border border-arova-border/70 rounded-lg space-y-1">
              <div className="text-arova-muted">Step 2 · Secondary Escalation</div>
              <div className="text-sm font-semibold text-arova-text">
                {selectedPatient.secondaryCaregiverName || "Not Assigned"}
              </div>
              <div className="text-arova-muted">
                Triggered automatically if primary caregiver does not acknowledge
              </div>
            </div>

            <div className="pt-3 border-t border-arova-border/70 space-y-1.5">
              <div className="text-arova-muted font-medium">Voice Calling Integration</div>
              <div className="text-sm font-semibold text-arova-text">
                {integrations?.voiceCalling.configured
                  ? `${integrations.voiceCalling.providerName} (Configured)`
                  : "External Voice Provider Not Configured"}
              </div>
              <p className="text-arova-muted leading-relaxed">
                Configure <span className="font-mono">VOICE_PROVIDER</span> and{" "}
                <span className="font-mono">VOICE_WEBHOOK_URL</span> on the backend server to place real automated calls.
              </p>
            </div>
          </div>

          {resolvedAlerts.length > 0 && (
            <div className="pt-3 border-t border-arova-border/70 space-y-2">
              <h4 className="text-xs font-semibold text-arova-text">Resolved History</h4>
              <div className="space-y-2">
                {resolvedAlerts.slice(0, 3).map((ra) => (
                  <div key={ra.alertId} className="text-xs text-arova-muted">
                    <div className="font-medium text-arova-text">{ra.title}</div>
                    <div>{ra.followUpAction || "Resolved"}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </section>

      <EcgWaveformPanel
        segments={ecgSegments}
        compact
        title={`AD8232 ECG Monitor · ${selectedPatient.displayName}`}
      />
    </div>
  );
}
