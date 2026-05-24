import { describe, expect, it } from "vitest";
import { defaultConfig, disableToolset, enableToolset, patchConfig, redactConfig, setConfigPath, testProviderSettings, validateConfig } from "./index";

describe("@agentbase/config", () => {
  it("validates, patches, redacts, and mutates toolsets", () => {
    const config = defaultConfig("demo");
    expect(validateConfig(config)).toHaveLength(0);
    expect(enableToolset(config, "@agentbase/tools-http").toolsets).toContain("@agentbase/tools-http");
    expect(disableToolset(enableToolset(config, "@agentbase/tools-http"), "@agentbase/tools-http").toolsets).not.toContain("@agentbase/tools-http");
    expect(patchConfig(config, { provider: { type: "mock", model: "mock/other" } }).provider.model).toBe("mock/other");
    expect(setConfigPath(config, "policy", "read-only").policy).toBe("read-only");
    expect(patchConfig(config, { orchestration: { defaultMode: "flow", maxParallelTasks: 4 } }).orchestration?.maxParallelTasks).toBe(4);
    expect(redactConfig({ ...config, provider: { ...config.provider, apiKey: "sk-secret" } as never }).provider).toEqual(expect.objectContaining({ apiKey: "[REDACTED]" }));
  });

  it("rejects raw secrets and tests provider settings without network", () => {
    const config = defaultConfig("demo");
    expect(validateConfig({ ...config, provider: { ...config.provider, apiKey: "sk-secret" } as never }).map((issue) => issue.path)).toContain("provider.apiKey");
    expect(
      validateConfig({
        ...config,
        exports: {
          destinations: [{ name: "observer", type: "generic-http", url: "http://127.0.0.1:4000/ingest", format: "openinference" }]
        }
      })
    ).toHaveLength(0);
    expect(testProviderSettings(config).ok).toBe(true);
    expect(testProviderSettings({ ...config, provider: { type: "openai-compatible", model: "gpt-test", apiKeyEnv: "OPENAI_API_KEY" } }, {}).ok).toBe(false);
  });
});
