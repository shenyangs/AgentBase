import { createId } from "./id";
import type { ModelProvider, ModelRequest, ModelResponse } from "./types";

export type MockModelStep = ModelResponse | ((request: ModelRequest) => ModelResponse | Promise<ModelResponse>);

export function createMockModelProvider(steps: MockModelStep[] = []): ModelProvider {
  let index = 0;

  return {
    name: "mock",
    async complete(request) {
      if (index < steps.length) {
        const step = steps[index++];
        return typeof step === "function" ? step(request) : step;
      }

      return defaultMockResponse(request);
    }
  };
}

function defaultMockResponse(request: ModelRequest): ModelResponse {
  const toolMessages = request.messages.filter((message) => message.role === "tool");
  const hasListFiles = toolMessages.some((message) => message.name === "list_files");
  const hasReadReadme = toolMessages.some((message) => message.name === "read_file" && message.content.includes("README"));
  const hasReadPackage = toolMessages.some((message) => message.name === "read_file" && message.content.includes("package"));
  const visibleContext = request.messages.map((message) => ("content" in message ? message.content ?? "" : "")).join("\n");

  if (!hasListFiles && request.tools.some((tool) => tool.name === "list_files")) {
    return {
      finishReason: "tool-calls",
      message: {
        role: "assistant",
        toolCalls: [{ id: createId("call"), name: "list_files", input: { path: ".", maxEntries: 80 } }]
      },
      usage: estimateUsage(request)
    };
  }

  if (!hasReadReadme && visibleContext.includes("README.md") && request.tools.some((tool) => tool.name === "read_file")) {
    return {
      finishReason: "tool-calls",
      message: {
        role: "assistant",
        toolCalls: [{ id: createId("call"), name: "read_file", input: { path: "README.md", maxBytes: 12_000 } }]
      },
      usage: estimateUsage(request)
    };
  }

  if (!hasReadPackage && visibleContext.includes("package.json") && request.tools.some((tool) => tool.name === "read_file")) {
    return {
      finishReason: "tool-calls",
      message: {
        role: "assistant",
        toolCalls: [{ id: createId("call"), name: "read_file", input: { path: "package.json", maxBytes: 12_000 } }]
      },
      usage: estimateUsage(request)
    };
  }

  return {
    finishReason: "stop",
    message: {
      role: "assistant",
      content: [
        "Mock repo summary:",
        `- Inspected ${toolMessages.length} tool result(s).`,
        "- Runtime loop, tool execution, context preparation, and trace writing are working.",
        "- Replace the mock provider with a real provider adapter when you are ready for model-backed analysis."
      ].join("\n")
    },
    usage: estimateUsage(request)
  };
}

function estimateUsage(request: ModelRequest) {
  const chars = request.messages.reduce((total, message) => total + JSON.stringify(message).length, 0);
  return {
    inputTokens: Math.ceil(chars / 4),
    outputTokens: 64,
    totalTokens: Math.ceil(chars / 4) + 64
  };
}
