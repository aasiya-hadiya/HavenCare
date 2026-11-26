import { useEffect, useState } from "react";
import { Cpu, Link2, Save, Settings2, Users } from "lucide-react";
import { AlertLevelLabel } from "../components/StatusIndicator.tsx";
import { useSmartCare } from "../context/SmartCareContext.tsx";

export function AdminConsolePage() {
  const {
    patients,
    selectedPatient,
    devices,
    alerts,
    careLinks,
    registeredUsers,
    integrations,
    systemSettings,
    isAdminUser,
    user,
    addCareLink,
    updateSystemSettings,
    refreshIntegrations,
  } = useSmartCare();

  const [caregiverName, setCaregiverName] = useState("");
  const [caregiverUid, setCaregiverUid] = useState("");
  const [priority, setPriority] = useState<"primary" | "secondary">("primary");
  const [linkStatusMsg, setLinkStatusMsg] = useState<string | null>(null);

  const [timeoutSec, setTimeoutSec] = useState(systemSettings.escalationTimeoutSec);
  const [minSamples, setMinSamples] = useState(systemSettings.baselineMinSamples);
  const [samplingMs, setSamplingMs] = useState(systemSettings.samplingDefaultMs);
  const [warnPersistence, setWarnPersistence] = useState(systemSettings.warningPersistenceWindows ?? 2);
  const [critPersistence, setCritPersistence] = useState(systemSettings.criticalPersistenceWindows ?? 3);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);

  useEffect(() => {
    setTimeoutSec(systemSettings.escalationTimeoutSec);
    setMinSamples(systemSettings.baselineMinSamples);
    setSamplingMs(systemSettings.samplingDefaultMs);
    setWarnPersistence(systemSettings.warningPersistenceWindows ?? 2);
    setCritPersistence(systemSettings.criticalPersistenceWindows ?? 3);
  }, [
    systemSettings.escalationTimeoutSec,
    systemSettings.baselineMinSamples,
    systemSettings.samplingDefaultMs,
    systemSettings.warningPersistenceWindows,
    systemSettings.criticalPersistenceWindows,
  ]);

  const handleAddLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!caregiverName.trim() || !caregiverUid.trim()) return;
    setLinkStatusMsg(null);
    try {
      await addCareLink({ caregiverName, caregiverUid, priority });
      setCaregiverName("");
      setCaregiverUid("");
      setLinkStatusMsg("Caregiver relationship added.");
    } catch (err) {
      setLinkStatusMsg(err instanceof Error ? err.message : "Could not create caregiver link.");
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsMsg(null);
    try {
      await updateSystemSettings({
        escalationTimeoutSec: timeoutSec,
        baselineMinSamples: minSamples,
        samplingDefaultMs: samplingMs,
        warningPersistenceWindows: warnPersistence,
        criticalPersistenceWindows: critPersistence,
      });
      setSettingsMsg(
        isAdminUser
          ? "Global system settings saved to Firestore."
          : "Updated in local preview state (sign in with verified admin account to persist globally)."
      );
    } catch (err) {
      setSettingsMsg(err instanceof Error ? err.message : "Failed to save settings.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Architecture Integration Health */}
      <section className="bg-white border border-arova-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-arova-text">
              System Integration &amp; Service Posture
            </h2>
            <p className="text-xs text-arova-muted mt-0.5">
              Live backend readiness reported from server environment configuration
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshIntegrations()}
            className="px-3 py-1.5 text-xs font-medium text-arova-green-dark bg-arova-mint border border-arova-border rounded-lg hover:bg-arova-sage/60 transition-colors"
          >
            Re-check Services
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div className="p-3.5 bg-arova-mint/50 border border-arova-border/70 rounded-lg space-y-1">
            <div className="text-arova-muted">Gemini AI Assistant</div>
            <div className="text-sm font-semibold text-arova-text">
              {integrations?.gemini.configured ? "Connected (Server-Side)" : "API Key Pending"}
            </div>
            <div className="font-mono text-arova-muted">{integrations?.gemini.model || "gemini-4-hydrogen"}</div>
          </div>

          <div className="p-3.5 bg-arova-mint/50 border border-arova-border/70 rounded-lg space-y-1">
            <div className="text-arova-muted">Python Isolation Forest</div>
            <div className="text-sm font-semibold text-arova-text">
              {integrations?.mlService.reachable ? "Connected" : "Demo Mode (Optional)"}
            </div>
            <div className="text-arova-muted">
              {integrations?.mlService.reachable
                ? "FastAPI scikit-learn active"
                : "ML_SERVICE_URL optional in dev"}
            </div>
          </div>

          <div className="p-3.5 bg-arova-mint/50 border border-arova-border/70 rounded-lg space-y-1">
            <div className="text-arova-muted">ESP32 Ingestion API</div>
            <div className="text-sm font-semibold text-arova-text">Endpoint Ready</div>
            <div className="font-mono text-arova-muted">
              {integrations?.wearableIngest.tokenProtected ? "X-Device-Key Enforced" : "Dev Mode (Token Optional)"}
            </div>
          </div>

          <div className="p-3.5 bg-arova-mint/50 border border-arova-border/70 rounded-lg space-y-1">
            <div className="text-arova-muted">Caregiver Voice Provider</div>
            <div className="text-sm font-semibold text-arova-text">
              {integrations?.voiceCalling.configured
                ? integrations.voiceCalling.providerName
                : "Not Configured (Optional)"}
            </div>
            <div className="text-arova-muted">
              Timeout: {integrations?.voiceCalling.timeoutSec ?? systemSettings.escalationTimeoutSec}s{" "}
              {integrations?.voiceCalling.usingDefaultTimeout ? "(Dev Default)" : ""}
            </div>
          </div>
        </div>
      </section>

      {/* Users & Caregiver Links + Global Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-arova-border rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-arova-green" />
            <h3 className="text-base font-semibold text-arova-text">
              Caregiver–Patient Relationships
            </h3>
          </div>

          <form onSubmit={handleAddLink} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
            <input
              type="text"
              value={caregiverName}
              onChange={(e) => setCaregiverName(e.target.value)}
              placeholder="Caregiver Name"
              className="px-3 py-2 border border-arova-border rounded-lg text-arova-text focus:outline-none focus:border-arova-green"
            />
            <input
              type="text"
              value={caregiverUid}
              onChange={(e) => setCaregiverUid(e.target.value)}
              placeholder="Caregiver UID"
              className="px-3 py-2 border border-arova-border rounded-lg font-mono text-arova-text focus:outline-none focus:border-arova-green"
            />
            <div className="flex gap-2">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as "primary" | "secondary")}
                className="flex-1 px-2 py-2 border border-arova-border rounded-lg bg-white text-arova-text focus:outline-none focus:border-arova-green"
              >
                <option value="primary">Primary</option>
                <option value="secondary">Secondary</option>
              </select>
              <button
                type="submit"
                className="inline-flex items-center gap-1 px-3 py-2 font-semibold text-white bg-arova-green rounded-lg hover:bg-arova-green-dark whitespace-nowrap transition-colors"
              >
                <Link2 className="w-3.5 h-3.5" />
                Link
              </button>
            </div>
          </form>
          {linkStatusMsg && <p className="text-xs text-arova-green-dark font-medium">{linkStatusMsg}</p>}

          <div className="divide-y divide-arova-border/60 border border-arova-border rounded-lg">
            {careLinks.map((link) => (
              <div key={link.linkId} className="px-3.5 py-2.5 flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-arova-text">{link.caregiverName}</span>
                  <span className="mx-1.5 text-arova-muted">→</span>
                  <span className="text-arova-text">{link.patientName}</span>
                </div>
                <span className="font-mono text-arova-muted">
                  {link.priority} · {link.status}
                </span>
              </div>
            ))}
          </div>

          <div className="pt-2 text-xs text-arova-muted">
            Active patient roster: {patients.length} profile(s) · Active target: {selectedPatient.displayName}
          </div>
        </section>

        <form
          onSubmit={handleSaveSettings}
          className="bg-white border border-arova-border rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-arova-green" />
            <h3 className="text-base font-semibold text-arova-text">
              Application Monitoring Settings
            </h3>
          </div>

          <div className="space-y-3 text-xs">
            <label className="block space-y-1">
              <span className="text-arova-muted font-medium">
                Caregiver Escalation Timeout (seconds)
              </span>
              <input
                type="number"
                min={10}
                max={600}
                value={timeoutSec}
                onChange={(e) => setTimeoutSec(Number(e.target.value))}
                className="w-full px-3 py-2 border border-arova-border rounded-lg font-mono tabular-nums text-arova-text focus:outline-none focus:border-arova-green"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-arova-muted font-medium">
                Minimum Baseline Samples for Isolation Forest
              </span>
              <input
                type="number"
                min={5}
                max={5000}
                value={minSamples}
                onChange={(e) => setMinSamples(Number(e.target.value))}
                className="w-full px-3 py-2 border border-arova-border rounded-lg font-mono tabular-nums text-arova-text focus:outline-none focus:border-arova-green"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-arova-muted font-medium">
                Default ESP32 Sampling Cadence (ms)
              </span>
              <input
                type="number"
                min={500}
                max={60000}
                value={samplingMs}
                onChange={(e) => setSamplingMs(Number(e.target.value))}
                className="w-full px-3 py-2 border border-arova-border rounded-lg font-mono tabular-nums text-arova-text focus:outline-none focus:border-arova-green"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-arova-muted font-medium">
                  Warning Persistence (Windows)
                </span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={warnPersistence}
                  onChange={(e) => setWarnPersistence(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-arova-border rounded-lg font-mono tabular-nums text-arova-text focus:outline-none focus:border-arova-green"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-arova-muted font-medium">
                  Critical Persistence (Windows)
                </span>
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={critPersistence}
                  onChange={(e) => setCritPersistence(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-arova-border rounded-lg font-mono tabular-nums text-arova-text focus:outline-none focus:border-arova-green"
                />
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-arova-muted">
              {user
                ? isAdminUser
                  ? "Verified Admin Account"
                  : "Standard User (Preview Settings)"
                : "Sign in as Admin to persist globally"}
            </span>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-arova-green rounded-lg hover:bg-arova-green-dark whitespace-nowrap transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              Save Settings
            </button>
          </div>
          {settingsMsg && <p className="text-xs text-arova-green-dark font-medium">{settingsMsg}</p>}
        </form>
      </div>

      {/* Wearable Devices & System Alert History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-arova-border rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-arova-green" />
            <h3 className="text-base font-semibold text-arova-text">Wearable Device Fleet</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-arova-border text-arova-muted">
                  <th className="py-2 pr-3">Device ID</th>
                  <th className="py-2 pr-3">Pulse Ox</th>
                  <th className="py-2 pr-3">Cadence</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-arova-border/60">
                {devices.map((d) => (
                  <tr key={d.deviceId}>
                    <td className="py-2.5 pr-3 font-mono text-arova-text">{d.deviceId}</td>
                    <td className="py-2.5 pr-3 text-arova-muted">{d.pulseOxChipVariant}</td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums text-arova-muted">
                      {d.samplingIntervalMs}ms
                    </td>
                    <td className="py-2.5 font-mono text-arova-muted">{d.connectionStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-white border border-arova-border rounded-xl p-5 space-y-3">
          <h3 className="text-base font-semibold text-arova-text">System Alert Audit Log</h3>
          <div className="divide-y divide-arova-border/60">
            {alerts.slice(0, 5).map((a) => (
              <div key={a.alertId} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <AlertLevelLabel level={a.level} />
                    <span className="font-medium text-arova-text">{a.title}</span>
                  </div>
                  <div className="text-arova-muted">
                    Status: {a.status} · Escalation: {a.callEscalationStatus}
                  </div>
                </div>
                <span className="font-mono text-arova-muted shrink-0">{a.source}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Registered Users Roster */}
      <section className="bg-white border border-arova-border rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-arova-text">Registered Accounts &amp; Roles</h3>
          <span className="text-xs text-arova-muted">{registeredUsers.length} account(s)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-arova-border text-arova-muted">
                <th className="py-2 pr-4">Display Name</th>
                <th className="py-2 pr-4">User ID</th>
                <th className="py-2">Assigned Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-arova-border/60">
              {registeredUsers.map((u) => (
                <tr key={u.uid}>
                  <td className="py-2.5 pr-4 font-medium text-arova-text">{u.displayName}</td>
                  <td className="py-2.5 pr-4 font-mono text-arova-muted">{u.uid}</td>
                  <td className="py-2.5 capitalize text-arova-text">{u.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
