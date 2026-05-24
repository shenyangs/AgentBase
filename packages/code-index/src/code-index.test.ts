import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CodeIndexFileRecord, CodeIndexStore, CodeReferenceRecord, CodeSymbolRecord } from "@agentbase/core";
import { createCodeIndexTools, extractSymbols } from "./index";

describe("code-index", () => {
  it("extracts TypeScript symbols", () => {
    expect(extractSymbols("a.ts", "export function hello() {}\nclass World {}").map((symbol) => symbol.name)).toEqual(["hello", "World"]);
  });

  it("indexes files into a store and searches symbols", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentbase-index-"));
    await mkdir(path.join(dir, "src"), { recursive: true });
    await writeFile(path.join(dir, "src", "index.ts"), "export function hello() {}\nhello();\n", "utf8");
    const store = memoryStore();
    const tools = createCodeIndexTools({ store });
    const result = await tools.find((tool) => tool.name === "code_index")?.execute({ path: "." }, context(dir));
    expect((result?.output as any).symbols).toBe(1);
    const search = await tools.find((tool) => tool.name === "code_search_symbols")?.execute({ query: "hello" }, context(dir));
    expect((search?.output as any).symbols[0].name).toBe("hello");
  });
});

function memoryStore(): CodeIndexStore {
  const files: CodeIndexFileRecord[] = [];
  const symbols: CodeSymbolRecord[] = [];
  const references: CodeReferenceRecord[] = [];
  return {
    async upsertCodeFile(file) {
      files.push(file);
      return file;
    },
    async upsertCodeSymbols(next) {
      symbols.push(...next);
    },
    async upsertCodeReferences(next) {
      references.push(...next);
    },
    async searchCodeSymbols(query) {
      return symbols.filter((symbol) => symbol.name.includes(query));
    },
    async findCodeReferences(symbolId) {
      return references.filter((reference) => reference.symbolId === symbolId);
    },
    async listCodeFiles() {
      return files;
    }
  };
}

function context(workspaceRoot: string) {
  return {
    runId: "run",
    workspaceRoot,
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
