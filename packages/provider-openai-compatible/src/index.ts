import type { FinishReason, Message, ModelProvider, ModelResponse, ToolCall, ToolDefinition } from "@agentbase/core";

export type OpenAICompatibleProviderOptions = {
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  model: string;
  name?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

type ChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export function createOpenAICompatibleProvider(options: OpenAICompatibleProviderOptions): ModelProvider {
  const baseUrl = stripTrailingSlash(options.baseUrl ?? "https://api.openai.com/v1");
  const fetchImpl = options.fetch ?? fetch;

  return {
    name: options.name ?? "openai-compatible",
    async complete(request): Promise<ModelResponse> {
      const apiKey = resolveApiKey(options);
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          ...options.headers
        },
        body: JSON.stringify({
          model: options.model,
          messages: request.messages.map(toChatMessage),
          tools: request.tools.map(toChatTool),
          tool_choice: request.tools.length > 0 ? "auto" : undefined
        })
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI-compatible provider failed: ${response.status} ${body.slice(0, 500)}`);
      }

      const json = (await response.json()) as ChatCompletionResponse;
      const choice = json.choices?.[0];
      const message = choice?.message;
      const toolCalls = (message?.tool_calls ?? []).map(parseToolCall).filter(Boolean) as ToolCall[];
      const content = typeof message?.content === "string" ? message.content : undefined;

      return {
        finishReason: mapFinishReason(choice?.finish_reason, toolCalls.length),
        message: {
          role: "assistant",
          content,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined
        },
        usage: {
          inputTokens: json.usage?.prompt_tokens,
          outputTokens: json.usage?.completion_tokens,
          totalTokens: json.usage?.total_tokens
        },
        metadata: { provider: options.name ?? "openai-compatible", model: options.model }
      };
    }
  };
}

function toChatMessage(message: Message): Record<string, unknown> {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content ?? null,
      tool_calls: message.toolCalls?.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.input ?? {})
        }
      }))
    };
  }

  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content
    };
  }

  return { role: message.role, content: message.content };
}

function toChatTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  };
}

function parseToolCall(call: NonNullable<ChatCompletionResponse["choices"]>[number]["message"] extends infer M ? M extends { tool_calls?: Array<infer T> } ? T : never : never): ToolCall | undefined {
  const id = typeof call.id === "string" ? call.id : undefined;
  const name = typeof call.function?.name === "string" ? call.function.name : undefined;
  if (!id || !name) {
    return undefined;
  }

  return {
    id,
    name,
    input: parseJson(call.function?.arguments ?? "{}")
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function mapFinishReason(reason: string | undefined, toolCallCount: number): FinishReason {
  if (toolCallCount > 0 || reason === "tool_calls") {
    return "tool-calls";
  }
  if (reason === "length") {
    return "length";
  }
  if (reason === "stop" || !reason) {
    return "stop";
  }
  return "error";
}

function resolveApiKey(options: OpenAICompatibleProviderOptions): string | undefined {
  if (options.apiKey) {
    return options.apiKey;
  }
  if (options.apiKeyEnv) {
    return process.env[options.apiKeyEnv];
  }
  return undefined;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
