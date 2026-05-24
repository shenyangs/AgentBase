import { describe, expect, it } from "vitest";
import { assessShellPolicy, classifyShellCommand } from "./policy";

describe("shell policy", () => {
  it("classifies common commands", () => {
    expect(classifyShellCommand("ls -la")).toBe("low");
    expect(classifyShellCommand("pnpm install")).toBe("medium");
    expect(classifyShellCommand("rm -rf /")).toBe("high");
  });

  it("blocks shell in read-only and high-risk commands without approval", () => {
    expect(assessShellPolicy("ls", { name: "read-only" }).allowed).toBe(false);
    expect(assessShellPolicy("rm -rf tmp", { name: "developer" }).allowed).toBe(false);
  });

  it("allows low-risk commands under workspace-write", () => {
    expect(assessShellPolicy("git status", { name: "workspace-write" }).allowed).toBe(true);
  });
});
