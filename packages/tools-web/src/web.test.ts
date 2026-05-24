import { describe, expect, it } from "vitest";
import { createStaticSearchProvider, createWebTools } from "./index";

describe("createWebTools", () => {
  it("searches through configured provider", async () => {
    const tools = createWebTools({
      searchProvider: createStaticSearchProvider([{ title: "AgentBase", url: "https://example.com", snippet: "runtime tools" }])
    });
    const search = await tools.find((tool) => tool.name === "web_search")!.execute(
      { query: "runtime", maxResults: 3 },
      { runId: "run", workspaceRoot: process.cwd(), signal: new AbortController().signal, trace: fakeTrace(), policy: { name: "trusted" }, env: {} }
    );

    expect(search.ok).toBe(true);
    expect(JSON.stringify(search.output)).toContain("AgentBase");
  });

  it("fetches an allowlisted url", async () => {
    const tools = createWebTools({
      allowedDomains: ["example.com"],
      fetch: (async () => new Response("hello", { status: 200, headers: { "content-type": "text/plain" } })) as typeof fetch
    });

    const fetched = await tools.find((tool) => tool.name === "fetch_url")!.execute(
      { url: "https://example.com/readme", maxBytes: 100 },
      { runId: "run", workspaceRoot: process.cwd(), signal: new AbortController().signal, trace: fakeTrace(), policy: { name: "trusted" }, env: {} }
    );

    expect(fetched.ok).toBe(true);
    expect(JSON.stringify(fetched.output)).toContain("hello");
  });
});

function fakeTrace() {
  return {
    async write(input: { type: string; data?: Record<string, unknown> }) {
      return { id: "evt", runId: "run", type: input.type, ts: new Date().toISOString(), data: input.data ?? {} };
    }
  };
}
