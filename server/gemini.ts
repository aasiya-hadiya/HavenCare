import { GoogleGenAI, ThinkingLevel } from "@google/genai";

let cachedClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new Error("GEMINI_API_KEY is not configured in server secrets.");
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return cachedClient;
}

export interface AssistantContextPayload {
  role: "patient" | "caregiver" | "admin";
  patientName: string;
  dataMode: "sample" | "live";
  baselineStatus: string;
  baselineSummary: string;
  latestReading?: {
    heartRate: number | null;
    spo2: number | null;
    temperatureC: number | null;
    movementStatus: string;
    signalQuality: string;
    alertLevel: string;
    anomalyScore: number;
    source: string;
    explanation: string;
    timestamp: string;
  } | null;
  recentReadings: Array<{
    heartRate: number | null;
    spo2: number | null;
    temperatureC: number | null;
    movementStatus: string;
    alertLevel: string;
    timestamp: string;
  }>;
  recentAlerts: Array<{
    level: string;
    status: string;
    title: string;
    explanation: string;
    callEscalationStatus: string;
    timestamp: string;
  }>;
}

export async function askSmartCareAssistant(
  question: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  context: AssistantContextPayload
): Promise<string> {
  const ai = getGeminiClient();

  const systemInstruction = `You are the SmartCare AI Health Assistant inside a Wearable-Based Early Warning System.

STRICT CLINICAL & TRANSPARENCY GUARDRAILS:
1. NEVER diagnose any disease, illness, or medical condition.
2. NEVER prescribe medication or give clinical treatment orders.
3. NEVER independently decide or declare that someone is experiencing a medical emergency—only explain what the recorded wearable readings, baseline comparisons, and system alert rules show. Always advise contacting a qualified healthcare professional or local emergency services for real medical concerns.
4. Be completely transparent about data origin: if context.dataMode is "sample", explicitly note that the values shown are sample demonstration readings rather than live ESP32 wearable measurements.
5. Keep explanations clear, calm, concise, and tailored to the user's role (${context.role}):
   - For patients: explain trends in everyday, reassuring language.
   - For caregivers: summarize recent reading patterns, alert explanations, and follow-up/escalation status clearly.
   - For administrators: explain system telemetry, baseline readiness, and hardware/ML architecture accurately.
6. Only cite numbers and events present in the JSON context below. Do not invent readings.`;

  const contextBlock = JSON.stringify(context, null, 2);
  const historyTranscript = history
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  const prompt = `CURRENT MONITORED CONTEXT (JSON):
${contextBlock}

RECENT CONVERSATION:
${historyTranscript || "(none)"}

USER QUESTION:
${question}`;

  const retryDelaysMs = [500, 1200];
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: prompt,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      const text = response.text?.trim();
      if (!text) {
        throw new Error("Gemini returned an empty response.");
      }
      return text;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("429");
      if (isTransient && attempt < retryDelaysMs.length) {
        await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
        continue;
      }
      throw err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("Gemini request failed.");
}
