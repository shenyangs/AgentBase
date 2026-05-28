import { describe, expect, it } from "vitest";
import { routeProvider } from "./index";

describe("provider router", () => {
  it("selects deterministic routes and fallbacks", () => {
    const decision = routeProvider({
      task: "run a high risk database write",
      toolPermissions: ["database:write"],
      defaultProvider: "mock",
      routes: [
        { id: "cheap", provider: "mock", match: { risk: "low" } },
        { id: "strong", provider: "openai-compatible", model: "gpt-strong", match: { risk: "high" }, reason: "high risk route" }
      ],
      fallbacks: ["mock"]
    });

    expect(decision).toEqual(expect.objectContaining({ provider: "openai-compatible", model: "gpt-strong", routeId: "strong", estimatedRisk: "high" }));
    expect(decision.fallbackProviders).toEqual(["mock"]);
  });
});
