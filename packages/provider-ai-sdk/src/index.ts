import type { ModelProvider, ModelRequest, ModelResponse } from "@agentbase/core";

export type AiSdkLikeGenerateText = (request: {
  messages: ModelRequest["messages"];
  tools: ModelRequest["tools"];
  model?: unknown;
}) => Promise<{
  text?: string;
  toolCalls?: Array<{ toolCallId?: string; id?: string; toolName?: string; name?: string; args?: unknown; input?: unknown }>;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  finishReason?: string;
}>;

export function createAiSdkProvider(options: { model?: unknown; generateText: AiSdkLikeGenerateText; name?: string }): ModelProvider {
  return {
    name: options.name ?? "ai-sdk",
    async complete(request): Promise<ModelResponse> {
      const result = await options.generateText({ model: options.model, messages: request.messages, tools: request.tools });
      const toolCalls = (result.toolCalls ?? []).map((call) => ({
        id: call.toolCallId ?? call.id ?? `call_${Math.random().toString(36).slice(2)}`,
        name: call.toolName ?? call.name ?? "unknown_tool",
        input: call.args ?? call.input ?? {}
      }));
      return {
        finishReason: toolCalls.length > 0 ? "tool-calls" : result.finishReason === "length" ? "length" : "stop",
        message: {
          role: "assistant",
          content: result.text,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined
        },
        usage: {
          inputTokens: result.usage?.promptTokens,
          outputTokens: result.usage?.completionTokens,
          totalTokens: result.usage?.totalTokens
        },
        metadata: { provider: options.name ?? "ai-sdk" }
      };
    }
  };
}
