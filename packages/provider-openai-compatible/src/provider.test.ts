import { describe, expect, it } from "vitest";
import { createOpenAICompatibleProvider } from "./index";

describe("createOpenAICompatibleProvider", () => {
  it("maps tools and tool calls through chat completions format", async () => {
    const requests: unknown[] = [];
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "test-key",
      model: "test-model",
      fetch: (async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: { name: "read_file", arguments: "{\"path\":\"README.md\"}" }
                    }
                  ]
                }
              }
            ],
            usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }
          }),
          { status: 200 }
        );
      }) as typeof fetch
    });

    const response = await provider.complete(
      {
        runId: "run",
        step: 1,
        messages: [{ role: "user", content: "read" }],
        tools: [{ name: "read_file", description: "Read file", inputSchema: { type: "object" } }]
      },
      { runId: "run", signal: new AbortController().signal }
    );

    expect(response.finishReason).toBe("tool-calls");
    expect(response.message.role).toBe("assistant");
    expect(response.message.toolCalls?.[0]).toEqual({ id: "call_1", name: "read_file", input: { path: "README.md" } });
    expect(JSON.stringify(requests[0])).toContain("read_file");
  });
});
