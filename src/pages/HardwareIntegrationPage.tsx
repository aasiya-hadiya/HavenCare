import { useEffect, useState } from "react";
import { RefreshCw, Save, ShieldAlert } from "lucide-react";
import { EcgWaveformPanel } from "../components/EcgWaveformPanel.tsx";
import { useSmartCare } from "../context/SmartCareContext.tsx";
import { fetchLatestHardwareEvents } from "../services/apiClient.ts";

export function HardwareIntegrationPage() {
  const {
    devices,
    selectedPatient,
    saveDeviceConfig,
    integrations,
    liveHardwareSnapshot,
    ecgSegments,
  } = useSmartCare();
  const activeDevice = devices.find((d) => d.patientId === selectedPatient.patientId) ?? devices[0];

  const [deviceId, setDeviceId] = useState(activeDevice?.deviceId ?? "esp32-smartcare-01");
  const [label, setLabel] = useState(activeDevice?.label ?? "AROVA ESP32 Node");
  const [pulseOxVariant] = useState("MAX30100 (Confirmed)");
  const [ecgSensor, setEcgSensor] = useState(
    activeDevice?.ecgSensor ?? "AD8232 Single-Lead ECG (Provisional)"
  );
  const [tempSensor, setTempSensor] = useState(
    activeDevice?.tempSensor ?? "Configurable (Model Pending Confirmation)"
  );
  const [samplingMs, setSamplingMs] = useState(activeDevice?.samplingIntervalMs ?? 2000);
  const [firmwareVer, setFirmwareVer] = useState(activeDevice?.firmwareVersion ?? "esp32-hw-v2.0");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [liveEvents, setLiveEvents] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    if (!activeDevice) return;
    setDeviceId(activeDevice.deviceId);
    setLabel(activeDevice.label);
    setEcgSensor(activeDevice.ecgSensor ?? "AD8232 Single-Lead ECG (Provisional)");
    setTempSensor(activeDevice.tempSensor);
    setSamplingMs(activeDevice.samplingIntervalMs);
    setFirmwareVer(activeDevice.firmwareVersion);
    setSaveMessage(null);
  }, [activeDevice]);

  const loadEvents = async () => {
    try {
      const data = await fetchLatestHardwareEvents(selectedPatient.patientId);
      setLiveEvents(data.events ?? []);
    } catch {
      // Ignore transient poll error
    }
  };

  useEffect(() => {
    void loadEvents();
  }, [liveHardwareSnapshot?.readingId, selectedPatient.patientId]);

  const handleSaveDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveMessage(null);
    try {
      await saveDeviceConfig({
        deviceId,
        label,
        pulseOxChipVariant: pulseOxVariant,
        ecgSensor,
        tempSensor,
        samplingIntervalMs: samplingMs,
        firmwareVersion: firmwareVer,
      });
      setSaveMessage("Device hardware configuration saved.");
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : "Failed to save configuration.");
    }
  };

  const liveHrText =
    liveHardwareSnapshot && typeof liveHardwareSnapshot.heartRate === "number"
      ? `${Math.round(liveHardwareSnapshot.heartRate)} BPM`
      : "-- BPM";
  const liveSpo2Text =
    liveHardwareSnapshot && typeof liveHardwareSnapshot.spo2 === "number"
      ? `${liveHardwareSnapshot.spo2.toFixed(1)}%`
      : "--%";
  const liveTempText =
    liveHardwareSnapshot && typeof liveHardwareSnapshot.temperatureC === "number"
      ? `${liveHardwareSnapshot.temperatureC.toFixed(1)} °C`
      : "Temp Pending (null)";

  return (
    <div className="space-y-6">
      {/* Live Hardware Telemetry Status & Confirmed Stack Summary */}
      <section className="bg-white border border-arova-border rounded-xl p-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-arova-text">
              {liveHardwareSnapshot
                ? "Hardware Telemetry Status: ESP32 Streaming Live"
                : "Hardware Telemetry Status: Not Connected"}
            </h2>
            <span
              className={`text-xs font-mono font-medium px-2.5 py-0.5 rounded border ${
                liveHardwareSnapshot
                  ? "text-arova-green-dark bg-arova-mint border-arova-sage"
                  : "text-arova-muted bg-arova-mint/40 border-arova-border"
              }`}
            >
              {liveHardwareSnapshot ? "Live" : "Standby"}
            </span>
          </div>
          <p className="text-xs text-arova-muted leading-relaxed">
            {liveHardwareSnapshot ? (
              <>
                Receiving live ESP32 packets for{" "}
                <span className="font-mono text-arova-text">{selectedPatient.displayName}</span>:{" "}
                <span className="font-mono text-arova-text tabular-nums">
                  {liveHrText} · {liveSpo2Text} · {liveTempText} · ECG{" "}
                  {liveHardwareSnapshot.ecgSignalQuality ?? "unavailable"}
                </span>{" "}
                (last packet {new Date(liveHardwareSnapshot.createdAt).toLocaleTimeString()}).
              </>
            ) : (
              <>
                No physical ESP32 device is currently streaming live packets. Flash{" "}
                <code className="font-mono text-arova-text">/firmware/esp32_smartcare_template.ino</code>{" "}
                so MAX30100, batched AD8232 ECG, MPU6050, and optional temperature POST to{" "}
                <code className="font-mono text-arova-text">/api/wearable/ingest</code> and trigger
                non-blocking transistor haptic alerts.
              </>
            )}
          </p>
        </div>

        <div className="space-y-1.5 lg:border-l lg:border-arova-border lg:pl-5">
          <h2 className="text-base font-semibold text-arova-text">
            Confirmed Wearable Sensor Stack
          </h2>
          <p className="text-xs text-arova-muted leading-relaxed">
            <span className="font-semibold text-arova-text">ESP32 DevKit</span> · confirmed{" "}
            <span className="font-semibold text-arova-text">MAX30100</span> pulse oximeter (OXullo{" "}
            <code className="font-mono">MAX30100_PulseOximeter.h</code>) · provisional{" "}
            <span className="font-semibold text-arova-text">AD8232</span> ECG (ADC1 batched) ·{" "}
            <span className="font-semibold text-arova-text">MPU6050</span> 6-axis IMU · configurable
            temperature probe ·{" "}
            <span className="font-semibold text-arova-text">0.96&quot; SSD1306 I2C OLED</span> ·
            transistor/MOSFET vibration motor · battery-isolated power.
          </p>
        </div>
      </section>

      {/* Live / Historical AD8232 ECG Stream Inspector */}
      <EcgWaveformPanel
        segments={ecgSegments}
        compact
        title="AD8232 Batched ECG Stream Inspector"
      />

      {/* Configurable Sensor Mapping Form + JSON Contract */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form
          onSubmit={handleSaveDevice}
          className="bg-white border border-arova-border rounded-xl p-5 space-y-4"
        >
          <div>
            <h3 className="text-base font-semibold text-arova-text">
              Hardware Profile Configuration
            </h3>
            <p className="text-xs text-arova-muted mt-0.5">
              MAX30100 is locked as confirmed; temperature sensor remains configurable until physical probe confirmation
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <label className="space-y-1">
              <span className="text-arova-muted block">Device ID</span>
              <input
                type="text"
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                required
                className="w-full px-3 py-2 border border-arova-border rounded-lg font-mono text-arova-text focus:outline-none focus:border-arova-green"
              />
            </label>
            <label className="space-y-1">
              <span className="text-arova-muted block">Display Label</span>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
                className="w-full px-3 py-2 border border-arova-border rounded-lg text-arova-text focus:outline-none focus:border-arova-green"
              />
            </label>
            <label className="space-y-1">
              <span className="text-arova-muted block">Pulse Oximeter (Confirmed)</span>
              <input
                type="text"
                value={pulseOxVariant}
                readOnly
                className="w-full px-3 py-2 border border-arova-border rounded-lg bg-arova-mint/50 text-arova-text font-medium"
              />
            </label>
            <label className="space-y-1">
              <span className="text-arova-muted block">ECG Module (Provisional)</span>
              <select
                value={ecgSensor}
                onChange={(e) => setEcgSensor(e.target.value)}
                className="w-full px-2.5 py-2 border border-arova-border rounded-lg bg-white text-arova-text focus:outline-none focus:border-arova-green"
              >
                <option value="AD8232 Single-Lead ECG (Provisional)">
                  AD8232 Single-Lead ECG (Provisional)
                </option>
                <option value="AD8232 Disabled / Unconnected">
                  AD8232 Disabled / Unconnected
                </option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-arova-muted block">Temperature Sensor</span>
              <select
                value={tempSensor}
                onChange={(e) => setTempSensor(e.target.value)}
                className="w-full px-2.5 py-2 border border-arova-border rounded-lg bg-white text-arova-text focus:outline-none focus:border-arova-green"
              >
                <option value="Configurable (Model Pending Confirmation)">
                  Configurable (Model Pending Confirmation)
                </option>
                <option value="DS18B20 Digital Probe">DS18B20 Digital Probe</option>
                <option value="TMP117 High-Accuracy I2C">TMP117 High-Accuracy I2C</option>
                <option value="MLX90614 IR Sensor">MLX90614 IR Sensor</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-arova-muted block">Batch Upload Interval (ms)</span>
              <input
                type="number"
                min={500}
                max={60000}
                value={samplingMs}
                onChange={(e) => setSamplingMs(Number(e.target.value))}
                className="w-full px-3 py-2 border border-arova-border rounded-lg font-mono tabular-nums text-arova-text focus:outline-none focus:border-arova-green"
              />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-arova-muted block">Firmware Tag</span>
              <input
                type="text"
                value={firmwareVer}
                onChange={(e) => setFirmwareVer(e.target.value)}
                className="w-full px-3 py-2 border border-arova-border rounded-lg font-mono text-arova-text focus:outline-none focus:border-arova-green"
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            {saveMessage ? (
              <span className="text-xs text-arova-green-dark font-medium">{saveMessage}</span>
            ) : (
              <span className="text-xs text-arova-muted">
                ESP32 DevKit · MPU6050 · 0.96&quot; SSD1306 · Transistor Vibration · Battery Power
              </span>
            )}
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-arova-green rounded-lg hover:bg-arova-green-dark whitespace-nowrap shrink-0 transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              Save Hardware Config
            </button>
          </div>
        </form>

        {/* ESP32 JSON Contract & Ingestion Inspector */}
        <section className="bg-white border border-arova-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-arova-text">
                ESP32 Wi-Fi JSON Contract (v2 Batched ECG)
              </h3>
              <p className="text-xs text-arova-muted mt-0.5">
                POST /api/wearable/ingest · Preserves all v1 fields + batched ECG &amp; nullable sensors
              </p>
            </div>
            <button
              type="button"
              onClick={loadEvents}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-arova-green-dark bg-arova-mint border border-arova-sage rounded-lg hover:bg-arova-sage transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh Buffer
            </button>
          </div>

          <pre className="bg-arova-mint/35 border border-arova-border text-arova-text rounded-lg p-3.5 text-xs font-mono overflow-x-auto leading-relaxed">
{`{
  "deviceId": "${deviceId}",
  "patientId": "${selectedPatient.patientId}",
  "pulseOxVariant": "MAX30100",
  "tempSensorModel": null,
  "heartRate": 74.0,
  "spo2": 98.0,
  "temperatureC": null,
  "accelMagnitude": 1.02,
  "gyroMagnitude": 4.2,
  "movementStatus": "resting",
  "possibleFallDetected": false,
  "irSignalOk": true,
  "fingerDetected": true,
  "ecgSamples": [0.02, 0.14, 1.05, -0.24, ...],
  "ecgSamplingRate": 200,
  "ecgSignalQuality": "good",
  "ecgLeadOff": false,
  "ecgTimestamp": "2026-11-25T12:00:00Z",
  "batteryPct": null
}`}
          </pre>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-arova-text">
              Recent Server Ingest Buffer ({liveEvents.length})
            </h4>
            {liveEvents.length === 0 ? (
              <p className="text-xs text-arova-muted">
                No packets received in server memory yet. Run the simulator or POST from an ESP32 board.
              </p>
            ) : (
              <div className="max-h-36 overflow-y-auto divide-y divide-arova-border/60 border border-arova-border rounded-lg">
                {liveEvents.slice(0, 5).map((ev, idx) => (
                  <div key={idx} className="px-3 py-2 text-xs flex items-center justify-between gap-2">
                    <span className="font-mono text-arova-text">
                      {String(ev.deviceId)} ·{" "}
                      {typeof ev.heartRate === "number" ? `${ev.heartRate} BPM` : "-- BPM"} ·{" "}
                      {typeof ev.spo2 === "number" ? `${ev.spo2}%` : "--%"} · ECG{" "}
                      {String(ev.ecgSignalQuality ?? "n/a")}
                    </span>
                    <span className="font-mono text-arova-muted">
                      {String(ev.source)} · {String(ev.alertLevel)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Proposed ESP32 Pinout, Libraries & Electrical Safety Precautions */}
      <section className="bg-white border border-arova-border rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-arova-text">
              Proposed ESP32 DevKit Wiring, Verified Arduino Libraries &amp; Safety Precautions
            </h3>
            <p className="text-xs text-arova-muted mt-0.5">
              Pin assignments can be adjusted in <code className="font-mono">/firmware/esp32_smartcare_template.ino</code> before flashing
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-arova-border text-arova-muted">
                  <th className="py-2 pr-3">Module</th>
                  <th className="py-2 pr-3">Proposed ESP32 Pins</th>
                  <th className="py-2">Verified Library / Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-arova-border/60 text-arova-muted">
                <tr>
                  <td className="py-2 pr-3 font-medium text-arova-text">MAX30100 (Confirmed)</td>
                  <td className="py-2 pr-3 font-mono text-arova-text">SDA GPIO 21 · SCL GPIO 22 (0x57)</td>
                  <td className="py-2">OXullo <code className="font-mono">Arduino-MAX30100</code> (<code className="font-mono">MAX30100_PulseOximeter.h</code>)</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-medium text-arova-text">AD8232 ECG (Provisional)</td>
                  <td className="py-2 pr-3 font-mono text-arova-text">OUT GPIO 34 (ADC1) · LO+ 32 · LO- 33</td>
                  <td className="py-2">Native ESP32 <code className="font-mono">analogRead()</code> at 200 Hz batched (never ADC2 with Wi-Fi)</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-medium text-arova-text">MPU6050 IMU</td>
                  <td className="py-2 pr-3 font-mono text-arova-text">SDA GPIO 21 · SCL GPIO 22 (0x68)</td>
                  <td className="py-2"><code className="font-mono">Adafruit_MPU6050</code> + <code className="font-mono">Adafruit_Sensor</code></td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-medium text-arova-text">0.96&quot; SSD1306 OLED</td>
                  <td className="py-2 pr-3 font-mono text-arova-text">SDA GPIO 21 · SCL GPIO 22 (0x3C)</td>
                  <td className="py-2"><code className="font-mono">Adafruit_SSD1306</code> + <code className="font-mono">Adafruit_GFX</code></td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-medium text-arova-text">Temperature Probe</td>
                  <td className="py-2 pr-3 font-mono text-arova-text">GPIO 4 (1-Wire) or I2C 0x48 / 0x5A</td>
                  <td className="py-2">Configurable (<code className="font-mono">TEMP_SENSOR_NONE</code> default sends <code className="font-mono">null</code>)</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-medium text-arova-text">Vibration Motor</td>
                  <td className="py-2 pr-3 font-mono text-arova-text">GPIO 25 via Transistor / MOSFET</td>
                  <td className="py-2">Non-blocking <code className="font-mono">millis()</code> + flyback diode (Core v2 &amp; v3 PWM guard)</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2 text-xs text-amber-950 leading-relaxed">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
              <span>Critical Hardware &amp; Electrical Safety Precautions</span>
            </div>
            <ul className="list-disc list-inside space-y-1.5 text-amber-900">
              <li>
                <span className="font-semibold">Battery-Isolated ECG Only:</span> Operate AD8232 exclusively from battery power during human skin contact; never connect body electrodes while tethered to a mains-grounded USB laptop or wall charger.
              </li>
              <li>
                <span className="font-semibold">MAX30100 RCWL-0530 Pull-Up Fix:</span> Many green/purple MAX30100 boards pull SDA/SCL/INT to an onboard 1.8V LDO, causing I²C stalls on a 3.3V bus; verify or rework pull-ups to 3.3V if I²C scan fails.
              </li>
              <li>
                <span className="font-semibold">ESP32 ADC1 Rule:</span> Keep AD8232 analog output on ADC1 (<code className="font-mono">GPIO 32–39</code>); ADC2 pins fail when Wi-Fi is active.
              </li>
              <li>
                <span className="font-semibold">Transistor Driver Required:</span> Never drive the vibration motor directly from an ESP32 GPIO; use an NPN/MOSFET stage with a base/gate resistor and reverse flyback diode across the motor.
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Secure Token Setup Instructions for Real ESP32 Connection */}
      <section className="bg-white border border-arova-border rounded-xl p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-arova-text">
              Securing Real ESP32 Connections (Optional in Dev Mode)
            </h3>
            <p className="text-xs text-arova-muted mt-0.5">
              Current state:{" "}
              <span className="font-mono text-arova-text">
                {integrations?.wearableIngest.tokenProtected
                  ? "WEARABLE_INGEST_TOKEN active (X-Device-Key required)"
                  : "WEARABLE_INGEST_TOKEN not set (Development mode · Simulator allowed)"}
              </span>
            </p>
          </div>
        </div>

        <ol className="list-decimal list-inside space-y-1.5 text-xs text-arova-muted leading-relaxed">
          <li>
            Generate a random 256-bit device token locally:{" "}
            <code className="px-1.5 py-0.5 bg-arova-mint border border-arova-sage rounded font-mono text-arova-green-dark">
              openssl rand -hex 32
            </code>
          </li>
          <li>
            Store it on the backend only as{" "}
            <code className="px-1.5 py-0.5 bg-arova-mint border border-arova-sage rounded font-mono text-arova-green-dark">
              WEARABLE_INGEST_TOKEN
            </code>{" "}
            in server environment Secrets (never in client <code className="font-mono">VITE_*</code> variables).
          </li>
          <li>
            Configure the same secret as{" "}
            <code className="px-1.5 py-0.5 bg-arova-mint border border-arova-sage rounded font-mono text-arova-green-dark">
              DEVICE_KEY
            </code>{" "}
            in <code className="font-mono">/firmware/esp32_smartcare_template.ino</code> so each POST sends{" "}
            <code className="font-mono">X-Device-Key</code>.
          </li>
        </ol>
      </section>
    </div>
  );
}
