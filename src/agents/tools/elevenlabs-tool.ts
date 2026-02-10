import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { readStringParam } from "./common.js";

const ElevenLabsToolSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("textToSpeech"),
      Type.Literal("listVoices"),
      Type.Literal("getVoice"),
      Type.Literal("speechToSpeech"),
      Type.Literal("getModels"),
      Type.Literal("getHistory"),
    ],
    { description: "ElevenLabs API action to perform" },
  ),
  text: Type.Optional(Type.String({ description: "Text to convert to speech" })),
  voiceId: Type.Optional(Type.String({ description: "Voice ID to use (default: Rachel)" })),
  modelId: Type.Optional(
    Type.String({ description: "Model ID (default: eleven_multilingual_v2)" }),
  ),
  audioUrl: Type.Optional(Type.String({ description: "URL to audio file for speech-to-speech" })),
  stability: Type.Optional(Type.Number({ description: "Voice stability (0-1, default: 0.5)" })),
  similarityBoost: Type.Optional(
    Type.Number({ description: "Similarity boost (0-1, default: 0.75)" }),
  ),
  style: Type.Optional(Type.Number({ description: "Style exaggeration (0-1, default: 0)" })),
  outputFormat: Type.Optional(
    Type.String({ description: "Output format (mp3_44100_128, pcm_16000, etc.)" }),
  ),
});

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";

async function elevenlabsRequest(
  endpoint: string,
  apiKey: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
  isFormData = false,
): Promise<unknown> {
  const headers: Record<string, string> = {
    "xi-api-key": apiKey,
  };

  if (!isFormData && body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`https://api.elevenlabs.io/v1${endpoint}`, {
    method,
    headers,
    ...(body ? { body: isFormData ? (body as FormData) : JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs API error (${response.status}): ${error}`);
  }

  // Check if response is audio
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("audio")) {
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return { audio: base64, contentType };
  }

  return response.json();
}

export function createElevenLabsTool(_opts?: { config?: OpenClawConfig }): AnyAgentTool {
  return {
    label: "ElevenLabs",
    name: "elevenlabs",
    description:
      "ElevenLabs voice AI API. Actions: textToSpeech, listVoices, getVoice, speechToSpeech, " +
      "getModels, getHistory. API key handled securely server-side.",
    parameters: ElevenLabsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        return {
          content: [
            { type: "text", text: "ElevenLabs API key not configured. Set ELEVENLABS_API_KEY." },
          ],
          details: { error: "missing_api_key" },
        };
      }

      try {
        let result: unknown;

        switch (action) {
          case "textToSpeech": {
            const text = readStringParam(params, "text", { required: true });
            const voiceId = readStringParam(params, "voiceId") || DEFAULT_VOICE_ID;
            const modelId = readStringParam(params, "modelId") || DEFAULT_MODEL_ID;
            const stability = (params.stability as number) ?? 0.5;
            const similarityBoost = (params.similarityBoost as number) ?? 0.75;
            const style = (params.style as number) ?? 0;
            const outputFormat = readStringParam(params, "outputFormat") || "mp3_44100_128";

            result = await elevenlabsRequest(
              `/text-to-speech/${voiceId}?output_format=${outputFormat}`,
              apiKey,
              "POST",
              {
                text,
                model_id: modelId,
                voice_settings: {
                  stability,
                  similarity_boost: similarityBoost,
                  style,
                  use_speaker_boost: true,
                },
              },
            );

            // If we got audio back, indicate it
            if (result && typeof result === "object" && "audio" in result) {
              const audioResult = result as { audio: string; contentType: string };
              return {
                content: [
                  {
                    type: "text",
                    text: `Audio generated successfully (${audioResult.contentType}). Base64 audio data: ${audioResult.audio.substring(0, 100)}... (truncated)`,
                  },
                ],
                details: { action, success: true, hasAudio: true },
              };
            }
            break;
          }
          case "listVoices": {
            result = await elevenlabsRequest("/voices", apiKey);
            break;
          }
          case "getVoice": {
            const voiceId = readStringParam(params, "voiceId", { required: true });
            result = await elevenlabsRequest(`/voices/${voiceId}`, apiKey);
            break;
          }
          case "speechToSpeech": {
            const audioUrl = readStringParam(params, "audioUrl", { required: true });
            const voiceId = readStringParam(params, "voiceId") || DEFAULT_VOICE_ID;
            const modelId = readStringParam(params, "modelId") || "eleven_english_sts_v2";
            const stability = (params.stability as number) ?? 0.5;
            const similarityBoost = (params.similarityBoost as number) ?? 0.75;

            // Fetch the audio file
            const audioResponse = await fetch(audioUrl);
            if (!audioResponse.ok) {
              throw new Error(`Failed to fetch audio: ${audioResponse.status}`);
            }
            const audioBlob = await audioResponse.blob();

            const formData = new FormData();
            formData.append("audio", audioBlob, "audio.mp3");
            formData.append("model_id", modelId);
            formData.append(
              "voice_settings",
              JSON.stringify({
                stability,
                similarity_boost: similarityBoost,
              }),
            );

            result = await elevenlabsRequest(
              `/speech-to-speech/${voiceId}`,
              apiKey,
              "POST",
              formData,
              true,
            );

            if (result && typeof result === "object" && "audio" in result) {
              const audioResult = result as { audio: string; contentType: string };
              return {
                content: [
                  {
                    type: "text",
                    text: `Speech-to-speech conversion successful. Base64 audio: ${audioResult.audio.substring(0, 100)}... (truncated)`,
                  },
                ],
                details: { action, success: true, hasAudio: true },
              };
            }
            break;
          }
          case "getModels": {
            result = await elevenlabsRequest("/models", apiKey);
            break;
          }
          case "getHistory": {
            result = await elevenlabsRequest("/history", apiKey);
            break;
          }
          default:
            return {
              content: [{ type: "text", text: `Unknown action: ${action}` }],
              details: { error: "unknown_action" },
            };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { action, success: true },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `ElevenLabs error: ${message}` }],
          details: { action, error: message },
        };
      }
    },
  };
}
