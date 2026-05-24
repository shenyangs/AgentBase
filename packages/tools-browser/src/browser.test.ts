import { describe, expect, it } from "vitest";
import type { BrowserAdapter } from "./index";
import { browserDoctor, createBrowserTools } from "./index";

describe("tools-browser", () => {
  it("uses adapter-backed browser tools", async () => {
    const adapter: BrowserAdapter = {
      async open(url) {
        return { url, title: "Example", text: "hello page" };
      },
      async snapshot() {
        return { url: "https://example.com", text: "snapshot" };
      },
      async click() {
        return { url: "https://example.com", text: "clicked" };
      },
      async type() {
        return { url: "https://example.com", text: "typed" };
      },
      async select() {
        return { url: "https://example.com", text: "selected" };
      },
      async screenshot() {
        return Buffer.from("png");
      },
      async extract() {
        return { text: "extract", html: "<main>extract</main>" };
      },
      async close() {}
    };
    const tools = createBrowserTools({ adapter, allowedDomains: ["example.com"] });
    const result = await tools.find((tool) => tool.name === "browser_open")?.execute({ url: "https://example.com" }, context());
    expect((result?.output as any).preview).toContain("hello");
    await expect(tools.find((tool) => tool.name === "browser_open")?.execute({ url: "https://blocked.com" }, context())).rejects.toThrow("allowlisted");
  });

  it("doctors adapter mode without requiring a browser", async () => {
    expect((await browserDoctor({ adapter: {} as BrowserAdapter })).ok).toBe(true);
  });
});

function context() {
  return {
    runId: "run",
    workspaceRoot: process.cwd(),
    signal: new AbortController().signal,
    policy: { name: "trusted" as const },
    env: {},
    trace: {
      async write(input: any) {
        return { id: "evt", runId: "run", ts: "now", type: input.type, data: input.data ?? {} };
      }
    }
  };
}
