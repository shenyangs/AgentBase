import { describe, expect, it } from "vitest";
import type { ToolExecutionContext } from "@agentbase/core";
import { createHttpTools } from "./index";

describe("tools-http", () => {
  it("redacts response headers and stores large bodies as artifacts", async () => {
    const artifacts: unknown[] = [];
    const [tool] = createHttpTools({
      allowedDomains: ["example.com"],
      artifactStore: {
        async put(record) {
          artifacts.push(record);
          return record as never;
        },
        async get() {
          return undefined;
        },
        async materialize() {
          return undefined;
        },
        async list() {
          return [];
        }
      },
      fetch: async () =>
        new Response("hello world", {
          status: 201,
          headers: { authorization: "Bearer secret", "content-type": "text/plain" }
        })
    });
    const result = await tool.execute({ url: "https://example.com/path", maxBytes: 5 }, context());
    expect(result.ok).toBe(true);
    expect((result.output as any).headers.authorization).toBe("[REDACTED]");
    expect((result.output as any).truncated).toBe(true);
    expect(artifacts).toHaveLength(1);
  });

  it("blocks denied domains", async () => {
    const [tool] = createHttpTools({ deniedDomains: ["blocked.test"], fetch: async () => new Response("no") });
    await expect(tool.execute({ url: "https://blocked.test" }, context())).rejects.toThrow("denied");
  });
});

function context(): ToolExecutionContext {
  return {
    runId: "run",
    workspaceRoot: process.cwd(),
    signal: new AbortController().signal,
    policy: { name: "trusted" },
    env: {},
    trace: {
      async write(input) {
        return { id: "evt", runId: "run", ts: "now", type: input.type, data: input.data ?? {} };
      }
    }
  };
}
