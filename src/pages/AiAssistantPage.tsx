import { useState } from "react";
import { Info, Send, Sparkles } from "lucide-react";
import { useSmartCare } from "../context/SmartCareContext.tsx";
import { askGeminiAssistant } from "../services/apiClient.ts";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const QUICK_PROMPTS = [
  "Explain the latest alert using the recorded readings.",
  "Summarize recent health trends in plain language for a caregiver.",
  "How do personal baseline learning and sensor quality checks work?",
  "What is the difference between sample demo mode and live ESP32 hardware?",
];

export function AiAssistantPage() {
  const { activeRole, selectedPatient, readings, alerts, usingSampleData, liveHardwareSnapshot } =
    useSmartCare();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hello. I am the AROVA Health Assistant. I can explain recorded wearable readings, baseline comparisons, and alert triggers in plain language. I do not diagnose medical conditions or declare medical emergencies.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const sendQuestion = async (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed || loading) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setErrorMsg(null);

    const latest = liveHardwareSnapshot ?? readings[readings.length - 1] ?? null;

    try {
      const answer = await askGeminiAssistant({
        question: trimmed,
        history: messages,
        context: {
          role: activeRole,
          patientName: selectedPatient.displayName,
          dataMode: usingSampleData ? "sample" : selectedPatient.dataMode,
          baselineStatus: selectedPatient.baselineStatus,
          baselineSummary: `Samples: ${selectedPatient.baselineSamplesCount}, Mean HR: ${
            selectedPatient.baselineHeartRateMean ?? "n/a"
          } BPM, Mean SpO2: ${selectedPatient.baselineSpo2Mean ?? "n/a"}%, Mean Temp: ${
            selectedPatient.baselineTempMean ?? "n/a"
          } C`,
          latestReading: latest
            ? {
                heartRate: latest.heartRate,
                spo2: latest.spo2,
                temperatureC: latest.temperatureC,
                movementStatus: latest.movementStatus,
                signalQuality: latest.signalQuality,
                alertLevel: latest.alertLevel,
                anomalyScore: latest.anomalyScore,
                source: latest.source,
                explanation: latest.explanation,
                timestamp: latest.createdAt,
              }
            : null,
          recentReadings: readings.slice(-8).map((r) => ({
            heartRate: r.heartRate,
            spo2: r.spo2,
            temperatureC: r.temperatureC,
            movementStatus: r.movementStatus,
            alertLevel: r.alertLevel,
            timestamp: r.createdAt,
          })),
          recentAlerts: alerts
            .filter((a) => a.patientId === selectedPatient.patientId)
            .slice(0, 5)
            .map((a) => ({
            level: a.level,
            status: a.status,
            title: a.title,
            explanation: a.explanation,
            callEscalationStatus: a.callEscalationStatus,
            timestamp: a.createdAt,
          })),
        },
      });

      setMessages((prev) => [...prev, { role: "assistant", content: answer }]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not reach Gemini assistant.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-4">
      <div className="bg-arova-mint/60 border border-arova-sage rounded-xl px-4 py-3 flex items-start gap-3 text-xs text-arova-muted">
        <Info className="w-4 h-4 text-arova-green shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-arova-text">Safety &amp; Clinical Boundary:</span>{" "}
          This assistant summarizes recorded AROVA telemetry for informational clarity. It never diagnoses medical conditions or replaces a clinician or emergency services.
        </div>
      </div>

      <div className="bg-white border border-arova-border rounded-xl flex flex-col h-[560px]">
        <div className="px-5 py-3.5 border-b border-arova-border flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-arova-green" />
            <h2 className="text-sm font-semibold text-arova-text">
              AROVA Assistant · Context: {selectedPatient.displayName}
            </h2>
          </div>
          <span className="text-xs text-arova-muted font-mono">
            {usingSampleData ? "sample_demo" : selectedPatient.dataMode}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[82%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-arova-green text-white"
                    : "bg-arova-mint border border-arova-sage/60 text-arova-text"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="text-xs text-arova-muted">Analyzing recorded readings with Gemini...</div>
          )}
          {errorMsg && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {errorMsg}
            </div>
          )}
        </div>

        <div className="px-5 py-2.5 border-t border-arova-border flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => void sendQuestion(q)}
              disabled={loading}
              className="px-2.5 py-1 text-xs bg-arova-mint hover:bg-arova-sage text-arova-green-dark border border-arova-sage rounded-md transition-colors text-left"
            >
              {q}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendQuestion(input);
          }}
          className="p-4 border-t border-arova-border flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about recent trends, alert explanations, or system behavior..."
            className="flex-1 px-3.5 py-2 text-sm text-arova-text border border-arova-border rounded-lg focus:outline-none focus:border-arova-green placeholder:text-arova-muted/70"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-arova-green rounded-lg hover:bg-arova-green-dark disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
          >
            <Send className="w-4 h-4" />
            Ask
          </button>
        </form>
      </div>
    </div>
  );
}
