import { describe, expect, it } from "vitest";
import { createAiSdkProvider } from "./index";

describe("createAiSdkProvider", () => {
  it("adapts AI SDK-like tool calls", async () => {
    const provider = createAiSdkProvider({
      async generateText() {
        return { toolCalls: [{ toolCallId: "call", toolName: "read_file", args: { path: "README.md" } }] };
      }
    });
    const response = await provider.complete({ runId: "run", step: 1, messages: [], tools: [] }, { runId: "run", signal: new AbortController().signal });
    expect(response.finishReason).toBe("tool-calls");
  });
});
