import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { readStringParam } from "./common.js";

const OpenAIToolSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("chat"),
      Type.Literal("embedding"),
      Type.Literal("moderation"),
      Type.Literal("transcribe"),
    ],
    { description: "API action to perform" },
  ),
  prompt: Type.Optional(Type.String({ description: "Prompt for chat completion" })),
  text: Type.Optional(Type.String({ description: "Text for embedding or moderation" })),
  model: Type.Optional(Type.String({ description: "Model to use (default: gpt-4o-mini)" })),
  audioUrl: Type.Optional(Type.String({ description: "URL to audio file for transcription" })),
  systemPrompt: Type.Optional(Type.String({ description: "System prompt for chat" })),
});

async function openaiRequest(endpoint: string, apiKey: string, body: unknown): Promise<unknown> {
  const response = await fetch(`https://api.openai.com/v1${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${error}`);
  }

  return response.json();
}

export function createOpenAITool(_opts?: { config?: OpenClawConfig }): AnyAgentTool {
  return {
    label: "OpenAI",
    name: "openai",
    description:
      "Direct OpenAI API access. Actions: chat (completions), embedding, moderation, transcribe. " +
      "API key is handled securely server-side.",
    parameters: OpenAIToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return {
          content: [{ type: "text", text: "OpenAI API key not configured. Set OPENAI_API_KEY." }],
          details: { error: "missing_api_key" },
        };
      }

      try {
        let result: unknown;

        switch (action) {
          case "chat": {
            const prompt = readStringParam(params, "prompt", { required: true });
            const model = readStringParam(params, "model") || "gpt-4o-mini";
            const systemPrompt = readStringParam(params, "systemPrompt");

            const messages: Array<{ role: string; content: string }> = [];
            if (systemPrompt) {
              messages.push({ role: "system", content: systemPrompt });
            }
            messages.push({ role: "user", content: prompt });

            result = await openaiRequest("/chat/completions", apiKey, {
              model,
              messages,
            });
            break;
          }
          case "embedding": {
            const text = readStringParam(params, "text", { required: true });
            const model = readStringParam(params, "model") || "text-embedding-3-small";

            result = await openaiRequest("/embeddings", apiKey, {
              model,
              input: text,
            });
            break;
          }
          case "moderation": {
            const text = readStringParam(params, "text", { required: true });

            result = await openaiRequest("/moderations", apiKey, {
              input: text,
            });
            break;
          }
          case "transcribe": {
            const audioUrl = readStringParam(params, "audioUrl", { required: true });

            // Fetch audio and send to Whisper
            const audioResponse = await fetch(audioUrl);
            if (!audioResponse.ok) {
              throw new Error(`Failed to fetch audio: ${audioResponse.status}`);
            }

            const audioBlob = await audioResponse.blob();
            const formData = new FormData();
            formData.append("file", audioBlob, "audio.mp3");
            formData.append("model", "whisper-1");

            const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
              },
              body: formData,
            });

            if (!response.ok) {
              const error = await response.text();
              throw new Error(`Whisper API error (${response.status}): ${error}`);
            }

            result = await response.json();
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
          content: [{ type: "text", text: `OpenAI error: ${message}` }],
          details: { action, error: message },
        };
      }
    },
  };
}
