# SmartCare AI — External Integration & ESP32 Hardware Guide

SmartCare AI runs in full development mode without external ML, ESP32 hardware, or voice-calling credentials. When connecting live external services or flashing physical hardware, use the guides below. Server-side secrets belong in **Settings > Secrets** (never in client `VITE_*` variables).

## 1. Python FastAPI + scikit-learn Isolation Forest (`ML_SERVICE_URL`)
- **Development Default**: Optional. When unset or unreachable, the dashboard clearly indicates **Demo Mode (Rule-Based Pre-Check)** and never pretends an Isolation Forest model is connected.
- **Note on ECG**: Dedicated ECG arrhythmia/anomaly ML models are **not** trained (`ecgModelTrained: false`). ECG feature extraction (`estimatedEcgBpm`, `rrIntervalMeanMs`, `rrVariabilityMs`) runs modularly for telemetry inspection only.
- **When Ready**: Start `/ml-service` (`uvicorn main:app --host 127.0.0.1 --port 18000`) and set `ML_SERVICE_URL="http://127.0.0.1:18000"` on the Node backend (avoid port `8000`, which is used by the AI Studio container bridge).

## 2. ESP32 Wearable Ingestion Token (`WEARABLE_INGEST_TOKEN`)
- **Development Default**: Optional. Simulator packets (`source: "simulator"`) work without a token.
- **Before Connecting a Real ESP32**:
  1. Generate a 256-bit token: `openssl rand -hex 32`
  2. Store as `WEARABLE_INGEST_TOKEN` in server **Settings > Secrets**.
  3. Set the matching value in `DEVICE_KEY` inside `/firmware/esp32_smartcare_template.ino` (`X-Device-Key` HTTP header).

## 3. Confirmed ESP32 Hardware Stack, Libraries & Pinout
Firmware file: `/firmware/esp32_smartcare_template.ino`

| Module | Status | Proposed ESP32 DevKit Pins | Verified Arduino Library & Version |
| --- | --- | --- | --- |
| **MAX30100** | Confirmed | `SDA GPIO 21`, `SCL GPIO 22` (`0x57`) | **OXullo `Arduino-MAX30100` (`MAX30100lib` v1.2.1)** (`MAX30100_PulseOximeter.h`). Do **not** use SparkFun MAX3010x. |
| **AD8232 ECG** | Provisional | `OUTPUT GPIO 34` (ADC1), `LO+ GPIO 32`, `LO- GPIO 33` | Built-in `analogReadMilliVolts()` at `200 Hz` double-buffered (`250` samples / `1250 ms` POST). Never use ADC2 with Wi-Fi. |
| **MPU6050 IMU** | Confirmed | `SDA GPIO 21`, `SCL GPIO 22` (`0x68`) | `Adafruit MPU6050` (v2.2.9) + `Adafruit Unified Sensor` |
| **0.96" SSD1306 OLED** | Confirmed | `SDA GPIO 21`, `SCL GPIO 22` (`0x3C`) | `Adafruit SSD1306` (v2.5.17) + `Adafruit GFX Library` (v1.13.0) |
| **Temperature Probe** | Configurable | `GPIO 4` (DS18B20) or I²C `0x48`/`0x5A` | Default `TEMP_SENSOR_NONE` sends JSON `null`. Optional: `OneWire` (v2.3.8)+`DallasTemperature` (v4.0.6), `Adafruit TMP117` (v1.0.5), or `Adafruit MLX90614` (v2.1.7). |
| **Vibration Motor** | Confirmed | `GPIO 25` -> Transistor/MOSFET driver | Non-blocking `millis()` PWM with `#if ESP_ARDUINO_VERSION_MAJOR >= 3` Core v2/v3/v4 guard + flyback diode. |

### Critical Wiring & Safety Precautions
1. **Battery-Isolated ECG Operation**: Always disconnect mains-grounded USB cables and wall chargers when AD8232 skin electrodes are attached to a human body. Operate on isolated rechargeable battery power only.
2. **MAX30100 RCWL-0530 Pull-Up Check**: Many green/purple MAX30100 breakout boards tie I²C pull-ups to an internal 1.8V regulator, preventing I²C recognition on a 3.3V bus. Verify/rework pull-ups to 3.3V if `pox.begin()` fails.
3. **ArduinoJson & ESP32 Core Compatibility**: Firmware includes `#if` guards supporting both `ArduinoJson` (`v6.x` / `v7.4.3`) and `esp32` Arduino Core (`v2.0.x` `ledcSetup`/`ledcAttachPin` and `v3.x`/`v4.x` `ledcAttach`), and pins HTTPS uploads onto Core 0 so Core 1 `pox.update()` and `200 Hz` ECG capture never stall.
4. **TLS Certificate Validation**: `ALLOW_INSECURE_TLS_DEV` defaults to `false`. Paste your server's Root CA PEM into `ROOT_CA_PEM` in `/firmware/esp32_smartcare_template.ino` before flashing for HTTPS ingestion.

### Hardware Details Still Useful to Confirm Before Final PCB/Flash
- Exact temperature probe part number (`DS18B20`, `TMP117`, `MLX90614`, or other).
- Final PCB GPIO assignments if different from `SDA 21`, `SCL 22`, `ECG 34/32/33`, `TEMP 4`, `VIB 25`.
- Whether your AD8232 breakout exposes `LO+` and `LO-` pins and whether your SSD1306 is `128×64` at `0x3C`.
- Battery voltage divider resistor ratio (if `BATTERY_ADC_ENABLED` is turned on).

## 4. Automated Caregiver Voice Calling (`VOICE_*`)
- **Development Default**: Optional (`VOICE_CALL_TIMEOUT_SEC` defaults to `30`).
- **When Ready**: Set `VOICE_PROVIDER`, `VOICE_WEBHOOK_URL`, `VOICE_API_KEY`, and optional `VOICE_CALL_TIMEOUT_SEC` in server **Settings > Secrets**.
