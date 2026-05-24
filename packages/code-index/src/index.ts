import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createId, type CodeIndexStore, type CodeReferenceRecord, type CodeSymbolRecord, type Tool } from "@agentbase/core";

export type CodeIndexOptions = {
  store: CodeIndexStore;
  maxFiles?: number;
};

export function createCodeIndexTools(options: CodeIndexOptions): Tool[] {
  return [codeIndexTool(options), codeSearchSymbolsTool(options), codeFindReferencesTool(options), codeOutlineTool(options)];
}

function codeIndexTool(options: CodeIndexOptions): Tool {
  return {
    name: "code_index",
    description: "Index workspace source files into a queryable code symbol and reference index.",
    requiredPermissions: ["code:index", "fs:read"],
    risk: "low",
    inputSchema: { type: "object", properties: { path: { type: "string", default: "." }, maxFiles: { type: "integer", default: options.maxFiles ?? 1000 } } },
    async execute(input, ctx) {
      const started = Date.now();
      const { path: userPath = ".", maxFiles = options.maxFiles ?? 1000 } = input as { path?: string; maxFiles?: number };
      const root = resolveWorkspacePath(ctx.workspaceRoot, userPath);
      const files: string[] = [];
      await walk(root, files, maxFiles);
      const allSymbols: CodeSymbolRecord[] = [];
      const references: CodeReferenceRecord[] = [];
      for (const file of files) {
        const content = await readFile(file, "utf8");
        const relative = normalize(path.relative(ctx.workspaceRoot, file));
        const symbols = extractSymbols(relative, content);
        allSymbols.push(...symbols);
        await options.store.upsertCodeFile({ path: relative, hash: hash(content), summary: summarize(relative, content), language: languageFor(relative), updatedAt: new Date().toISOString() });
        await options.store.upsertCodeSymbols(symbols);
      }
      for (const file of files) {
        const content = await readFile(file, "utf8");
        const relative = normalize(path.relative(ctx.workspaceRoot, file));
        references.push(...extractReferences(relative, content, allSymbols));
      }
      await options.store.upsertCodeReferences(references);
      return { ok: true, output: { summary: `indexed ${files.length} file(s), ${allSymbols.length} symbol(s)`, preview: allSymbols.slice(0, 20).map((symbol) => `${symbol.kind}\t${symbol.name}\t${symbol.path}:${symbol.line}`).join("\n"), files: files.length, symbols: allSymbols.length, references: references.length }, metadata: { durationMs: Date.now() - started, truncated: files.length >= maxFiles } };
    }
  };
}

function codeSearchSymbolsTool(options: CodeIndexOptions): Tool {
  return {
    name: "code_search_symbols",
    description: "Search indexed code symbols by name or signature.",
    requiredPermissions: ["code:index", "fs:read"],
    risk: "low",
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, limit: { type: "integer", default: 20 } } },
    async execute(input) {
      const { query, limit = 20 } = input as { query: string; limit?: number };
      const symbols = await options.store.searchCodeSymbols(query, { limit });
      return { ok: true, output: { summary: `${symbols.length} symbol(s)`, preview: symbols.map((symbol) => `${symbol.kind}\t${symbol.name}\t${symbol.path}:${symbol.line}`).join("\n"), symbols }, metadata: { durationMs: 0, truncated: symbols.length >= limit } };
    }
  };
}

function codeFindReferencesTool(options: CodeIndexOptions): Tool {
  return {
    name: "code_find_references",
    description: "Find indexed references for a symbol id.",
    requiredPermissions: ["code:index", "fs:read"],
    risk: "low",
    inputSchema: { type: "object", required: ["symbolId"], properties: { symbolId: { type: "string" }, limit: { type: "integer", default: 50 } } },
    async execute(input) {
      const { symbolId, limit = 50 } = input as { symbolId: string; limit?: number };
      const references = await options.store.findCodeReferences(symbolId, { limit });
      return { ok: true, output: { summary: `${references.length} reference(s)`, preview: references.map((reference) => `${reference.path}:${reference.line}\t${reference.preview}`).join("\n"), references }, metadata: { durationMs: 0, truncated: references.length >= limit } };
    }
  };
}

function codeOutlineTool(options: CodeIndexOptions): Tool {
  return {
    name: "code_outline",
    description: "Return indexed files and their summaries.",
    requiredPermissions: ["code:index", "fs:read"],
    risk: "low",
    inputSchema: { type: "object", properties: { limit: { type: "integer", default: 100 } } },
    async execute(input) {
      const { limit = 100 } = input as { limit?: number };
      const files = await options.store.listCodeFiles({ limit });
      return { ok: true, output: { summary: `${files.length} indexed file(s)`, preview: files.map((file) => `${file.path}\t${file.summary}`).join("\n"), files }, metadata: { durationMs: 0, truncated: files.length >= limit } };
    }
  };
}

export function extractSymbols(relative: string, content: string): CodeSymbolRecord[] {
  const symbols: CodeSymbolRecord[] = [];
  const lines = content.split("\n");
  const patterns: Array<{ kind: string; regex: RegExp }> = [
    { kind: "class", regex: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/ },
    { kind: "interface", regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
    { kind: "type", regex: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/ },
    { kind: "function", regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
    { kind: "const", regex: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)/ },
    { kind: "python_def", regex: /^\s*def\s+([A-Za-z_][\w]*)/ },
    { kind: "python_class", regex: /^\s*class\s+([A-Za-z_][\w]*)/ }
  ];
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      const match = line.match(pattern.regex);
      if (match) {
        const name = match[1];
        symbols.push({ id: `${relative}#${name}`, path: relative, name, kind: pattern.kind, line: index + 1, column: line.indexOf(name) + 1, signature: line.trim() });
        break;
      }
    }
  });
  return symbols;
}

function extractReferences(relative: string, content: string, symbols: CodeSymbolRecord[]): CodeReferenceRecord[] {
  const references: CodeReferenceRecord[] = [];
  const lines = content.split("\n");
  for (const symbol of symbols) {
    const regex = new RegExp(`\\b${escapeRegExp(symbol.name)}\\b`);
    lines.forEach((line, index) => {
      if (regex.test(line) && !(relative === symbol.path && index + 1 === symbol.line)) {
        references.push({ symbolId: symbol.id, path: relative, line: index + 1, preview: line.trim().slice(0, 240) });
      }
    });
  }
  return references;
}

function resolveWorkspacePath(workspaceRoot: string, userPath: string): string {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, userPath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${userPath}`);
  }
  return target;
}

async function walk(root: string, files: string[], maxFiles: number): Promise<void> {
  if (files.length >= maxFiles) return;
  const rootStat = await stat(root);
  if (rootStat.isFile()) {
    if (isIndexable(root)) files.push(root);
    return;
  }
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (files.length >= maxFiles || shouldSkip(entry.name)) continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) await walk(absolute, files, maxFiles);
    if (entry.isFile() && isIndexable(entry.name)) files.push(absolute);
  }
}

function shouldSkip(name: string): boolean {
  return name === "node_modules" || name === ".git" || name === "dist" || name === "coverage" || name === ".agentbase";
}

function isIndexable(name: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|md|json)$/i.test(name);
}

function languageFor(relative: string): string | undefined {
  return relative.split(".").pop();
}

function summarize(relative: string, content: string): string {
  return `${relative}: ${content.replace(/\s+/g, " ").trim().slice(0, 180)}`;
}

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function normalize(value: string): string {
  return value.split(path.sep).join("/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
