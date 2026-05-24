import { describe, expect, it } from "vitest";
import { createDefaultContextManager } from "./index";
import type { MemoryBlock, MemoryStore, WikiPageRecord, WikiStore } from "@agentbase/core";

describe("createDefaultContextManager", () => {
  it("creates a stable prefix and truncates large tool results", async () => {
    const context = createDefaultContextManager({ maxToolMessageChars: 20 });
    const prepared = await context.prepare({
      agent: { name: "agent", instructions: "inspect carefully" },
      input: "hello",
      state: {
        runId: "run_1",
        input: "hello",
        messages: [
          { role: "user", content: "hello" },
          { role: "tool", name: "read_file", toolCallId: "call_1", content: "x".repeat(100) }
        ],
        steps: 1,
        toolErrors: 0,
        artifacts: [],
        startedAt: new Date().toISOString(),
        metadata: {}
      },
      tools: [{ name: "read_file", description: "read", inputSchema: { type: "object" } }],
      policy: { name: "read-only" },
      limits: { maxSteps: 30, maxToolErrors: 5, maxRunMs: 1000 }
    });

    expect(prepared.messages[0].role).toBe("system");
    expect(prepared.snapshot.stablePrefixHash).toBeTruthy();
    expect(prepared.snapshot.layers?.map((layer) => layer.id)).toEqual(expect.arrayContaining(["stable-prefix", "dynamic-suffix"]));
    expect(JSON.stringify(prepared.messages)).toContain("truncated");
  });

  it("assembles memory and wiki context under budget with snapshot reasons", async () => {
    const now = new Date().toISOString();
    const memoryBlock: MemoryBlock = {
      id: "mem_1",
      scope: "project",
      text: "AgentBase uses runtime-backed workflows.",
      kind: "fact",
      tags: ["workflow"],
      pinned: true,
      promoted: true,
      createdAt: now,
      updatedAt: now
    };
    const memory: MemoryStore = {
      async add() {
        return memoryBlock;
      },
      async search() {
        return [memoryBlock];
      },
      async list() {
        return [memoryBlock];
      },
      async promote() {
        return memoryBlock;
      }
    };
    const wikiPage: WikiPageRecord = {
      id: "README.md",
      title: "AgentBase",
      path: "README.md",
      summary: "AgentBase has eval and replay gates.",
      updatedAt: now
    };
    const wiki: Pick<WikiStore, "query"> = {
      async query() {
        return [wikiPage];
      }
    };

    const context = createDefaultContextManager({ memory, wiki, maxContextTokens: 900 });
    const prepared = await context.prepare({
      agent: { name: "agent", instructions: "inspect carefully" },
      input: "How do workflows and eval gates work?",
      state: {
        runId: "run_1",
        input: "How do workflows and eval gates work?",
        messages: [{ role: "user", content: "How do workflows and eval gates work?" }],
        steps: 1,
        toolErrors: 0,
        artifacts: [],
        startedAt: now,
        metadata: {}
      },
      tools: [],
      policy: { name: "read-only" },
      limits: { maxSteps: 30, maxToolErrors: 5, maxRunMs: 1000 }
    });

    const rendered = JSON.stringify(prepared.messages);
    expect(rendered).toContain("Pinned memory");
    expect(rendered).toContain("Wiki hits");
    expect(prepared.snapshot.items.map((item) => item.type)).toEqual(expect.arrayContaining(["pinned_memory", "wiki"]));
    expect(prepared.snapshot.layers).toEqual(expect.arrayContaining([expect.objectContaining({ id: "memory", includedItems: expect.any(Number) }), expect.objectContaining({ id: "knowledge", includedItems: expect.any(Number) })]));
  });
});
