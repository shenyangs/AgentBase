import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Tool } from "@agentbase/core";
import { normalizePath, pathExists, resolveWorkspacePath, toWorkspaceRelative } from "./path-guard";

const execFileAsync = promisify(execFile);

export function createFsTools(): Tool[] {
  return [readFileTool(), writeFileTool(), listFilesTool(), searchFilesTool()];
}

function readFileTool(): Tool {
  return {
    name: "read_file",
    description: "Read a UTF-8 text file inside the workspace.",
    requiredPermissions: ["fs:read"],
    risk: "low",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string" },
        maxBytes: { type: "integer", default: 60000 }
      }
    },
    async execute(input, ctx) {
      const { path: userPath, maxBytes = 60_000 } = input as { path: string; maxBytes?: number };
      const file = await resolveWorkspacePath(ctx.workspaceRoot, userPath, { mustExist: true });
      const fileStat = await stat(file);
      if (!fileStat.isFile()) {
        return { ok: false, error: { code: "NOT_FILE", message: `${userPath} is not a file` } };
      }

      const buffer = await readFile(file);
      const truncated = buffer.byteLength > maxBytes;
      const content = buffer.subarray(0, maxBytes).toString("utf8");
      return {
        ok: true,
        output: {
          path: toWorkspaceRelative(ctx.workspaceRoot, file),
          content,
          bytes: buffer.byteLength,
          truncated
        },
        metadata: { path: toWorkspaceRelative(ctx.workspaceRoot, file), bytes: buffer.byteLength, truncated }
      };
    }
  };
}

function writeFileTool(): Tool {
  return {
    name: "write_file",
    description: "Write a UTF-8 text file inside the workspace and record a compact diff.",
    requiredPermissions: ["fs:write"],
    risk: "medium",
    inputSchema: {
      type: "object",
      required: ["path", "content"],
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        append: { type: "boolean", default: false }
      }
    },
    async execute(input, ctx) {
      const { path: userPath, content, append = false } = input as { path: string; content: string; append?: boolean };
      const file = await resolveWorkspacePath(ctx.workspaceRoot, userPath, { forWrite: true, mustExist: false });
      const existed = await pathExists(file);
      const before = existed ? await readFile(file, "utf8") : "";
      const after = append ? before + content : content;

      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, after, "utf8");

      const relativePath = toWorkspaceRelative(ctx.workspaceRoot, file);
      const diff = createLineDiff(before, after);
      await ctx.trace.write({
        type: "file.changed",
        data: {
          path: relativePath,
          existed,
          bytes: Buffer.byteLength(after),
          diff
        }
      });

      return {
        ok: true,
        output: { path: relativePath, bytes: Buffer.byteLength(after), diff },
        metadata: { path: relativePath, existed }
      };
    }
  };
}

function listFilesTool(): Tool {
  return {
    name: "list_files",
    description: "List files under a workspace path, skipping common generated directories.",
    requiredPermissions: ["fs:read"],
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", default: "." },
        maxEntries: { type: "integer", default: 200 }
      }
    },
    async execute(input, ctx) {
      const { path: userPath = ".", maxEntries = 200 } = input as { path?: string; maxEntries?: number };
      const root = await resolveWorkspacePath(ctx.workspaceRoot, userPath, { mustExist: true });
      const files: string[] = [];
      await walkFiles(root, ctx.workspaceRoot, files, maxEntries);
      return { ok: true, output: { path: userPath, files, truncated: files.length >= maxEntries } };
    }
  };
}

function searchFilesTool(): Tool {
  return {
    name: "search_files",
    description: "Search text files inside the workspace. Uses ripgrep when available and falls back to a JS scanner.",
    requiredPermissions: ["fs:read"],
    risk: "low",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        path: { type: "string", default: "." },
        maxResults: { type: "integer", default: 100 }
      }
    },
    async execute(input, ctx) {
      const { query, path: userPath = ".", maxResults = 100 } = input as { query: string; path?: string; maxResults?: number };
      const root = await resolveWorkspacePath(ctx.workspaceRoot, userPath, { mustExist: true });

      const rgResults = await tryRipgrep(query, root, ctx.workspaceRoot, maxResults);
      if (rgResults) {
        return { ok: true, output: { query, results: rgResults, provider: "rg", truncated: rgResults.length >= maxResults } };
      }

      const results = await searchWithJs(query, root, ctx.workspaceRoot, maxResults);
      return { ok: true, output: { query, results, provider: "js", truncated: results.length >= maxResults } };
    }
  };
}

async function walkFiles(root: string, workspaceRoot: string, files: string[], maxEntries: number): Promise<void> {
  if (files.length >= maxEntries) {
    return;
  }

  const rootStat = await stat(root);
  if (rootStat.isFile()) {
    files.push(toWorkspaceRelative(workspaceRoot, root));
    return;
  }

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (files.length >= maxEntries || shouldSkip(entry.name)) {
      continue;
    }

    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(absolute, workspaceRoot, files, maxEntries);
    } else if (entry.isFile()) {
      files.push(toWorkspaceRelative(workspaceRoot, absolute));
    }
  }
}

async function tryRipgrep(query: string, cwd: string, workspaceRoot: string, maxResults: number): Promise<SearchResult[] | undefined> {
  try {
    const { stdout } = await execFileAsync("rg", ["--line-number", "--column", "--fixed-strings", "--color", "never", query, "."], {
      cwd,
      maxBuffer: 1024 * 1024
    });
    return stdout
      .split("\n")
      .filter(Boolean)
      .slice(0, maxResults)
      .map((line) => parseRipgrepLine(line, cwd, workspaceRoot));
  } catch (error) {
    const maybe = error as NodeJS.ErrnoException & { code?: string | number; stdout?: string };
    if (String(maybe.code) === "1") {
      return [];
    }
    if (typeof maybe.stdout === "string" && maybe.stdout.length > 0) {
      return maybe.stdout
        .split("\n")
        .filter(Boolean)
        .slice(0, maxResults)
        .map((line) => parseRipgrepLine(line, cwd, workspaceRoot));
    }
    return undefined;
  }
}

type SearchResult = {
  path: string;
  line: number;
  column: number;
  preview: string;
};

function parseRipgrepLine(line: string, cwd: string, workspaceRoot: string): SearchResult {
  const [file = "", lineNo = "0", column = "0", ...rest] = line.split(":");
  return {
    path: normalizePath(path.join(toWorkspaceRelative(workspaceRoot, cwd), file)),
    line: Number(lineNo),
    column: Number(column),
    preview: rest.join(":")
  };
}

async function searchWithJs(query: string, root: string, workspaceRoot: string, maxResults: number): Promise<SearchResult[]> {
  const files: string[] = [];
  await walkFiles(root, workspaceRoot, files, 2_000);
  const results: SearchResult[] = [];

  for (const relative of files) {
    if (results.length >= maxResults) {
      break;
    }

    const absolute = path.join(workspaceRoot, relative);
    let content: string;
    try {
      content = await readFile(absolute, "utf8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    lines.forEach((line, index) => {
      if (results.length < maxResults && line.includes(query)) {
        results.push({ path: relative, line: index + 1, column: line.indexOf(query) + 1, preview: line });
      }
    });
  }

  return results;
}

function shouldSkip(name: string): boolean {
  return name === "node_modules" || name === ".git" || name === "dist" || name === "coverage" || name === ".agentbase";
}

function createLineDiff(before: string, after: string, maxLines = 80): string {
  if (before === after) {
    return "";
  }

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lines = [`--- before`, `+++ after`];
  const max = Math.max(beforeLines.length, afterLines.length);

  for (let i = 0; i < max && lines.length < maxLines; i += 1) {
    if (beforeLines[i] === afterLines[i]) {
      continue;
    }
    if (beforeLines[i] !== undefined) {
      lines.push(`-${beforeLines[i]}`);
    }
    if (afterLines[i] !== undefined) {
      lines.push(`+${afterLines[i]}`);
    }
  }

  if (lines.length >= maxLines) {
    lines.push("[diff truncated]");
  }

  return lines.join("\n");
}
