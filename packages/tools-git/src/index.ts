import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PolicyError, type Tool } from "@agentbase/core";

const execFileAsync = promisify(execFile);

export function createGitTools(): Tool[] {
  return [gitStatusTool(), gitDiffTool(), gitShowTool(), gitLogTool()];
}

function gitStatusTool(): Tool {
  return {
    name: "git_status",
    description: "Show git status in short porcelain format for the workspace.",
    requiredPermissions: ["git:read"],
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", default: "." }
      }
    },
    async execute(input, ctx) {
      const { cwd = "." } = input as { cwd?: string };
      const absoluteCwd = await resolveGitCwd(ctx.workspaceRoot, cwd);
      const output = await runGit(["status", "--short", "--branch"], absoluteCwd);
      return { ok: true, output: { cwd, status: output.stdout, stderr: output.stderr } };
    }
  };
}

function gitDiffTool(): Tool {
  return {
    name: "git_diff",
    description: "Show a read-only git diff for the workspace.",
    requiredPermissions: ["git:read"],
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", default: "." },
        staged: { type: "boolean", default: false },
        path: { type: "string" },
        maxBytes: { type: "integer", default: 60000 }
      }
    },
    async execute(input, ctx) {
      const { cwd = ".", staged = false, path: filePath, maxBytes = 60_000 } = input as { cwd?: string; staged?: boolean; path?: string; maxBytes?: number };
      const absoluteCwd = await resolveGitCwd(ctx.workspaceRoot, cwd);
      const args = ["diff"];
      if (staged) {
        args.push("--staged");
      }
      if (filePath) {
        assertSafePathArg(filePath);
        args.push("--", filePath);
      }
      const output = await runGit(args, absoluteCwd, maxBytes);
      return { ok: true, output: { cwd, staged, path: filePath, diff: output.stdout, stderr: output.stderr, truncated: output.truncated } };
    }
  };
}

function gitShowTool(): Tool {
  return {
    name: "git_show",
    description: "Show a commit, object, or file revision without mutating the repository.",
    requiredPermissions: ["git:read"],
    risk: "low",
    inputSchema: {
      type: "object",
      required: ["revision"],
      properties: {
        cwd: { type: "string", default: "." },
        revision: { type: "string" },
        maxBytes: { type: "integer", default: 60000 }
      }
    },
    async execute(input, ctx) {
      const { cwd = ".", revision, maxBytes = 60_000 } = input as { cwd?: string; revision: string; maxBytes?: number };
      assertSafeRevision(revision);
      const absoluteCwd = await resolveGitCwd(ctx.workspaceRoot, cwd);
      const output = await runGit(["show", "--stat", "--patch", revision], absoluteCwd, maxBytes);
      return { ok: true, output: { cwd, revision, content: output.stdout, stderr: output.stderr, truncated: output.truncated } };
    }
  };
}

function gitLogTool(): Tool {
  return {
    name: "git_log",
    description: "Show recent commits in a compact read-only format.",
    requiredPermissions: ["git:read"],
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", default: "." },
        maxCount: { type: "integer", default: 20 }
      }
    },
    async execute(input, ctx) {
      const { cwd = ".", maxCount = 20 } = input as { cwd?: string; maxCount?: number };
      const absoluteCwd = await resolveGitCwd(ctx.workspaceRoot, cwd);
      const output = await runGit(["log", `--max-count=${Math.max(1, Math.min(maxCount, 100))}`, "--date=iso", "--pretty=format:%h%x09%ad%x09%s"], absoluteCwd);
      return { ok: true, output: { cwd, commits: output.stdout, stderr: output.stderr } };
    }
  };
}

async function resolveGitCwd(workspaceRoot: string, userCwd: string): Promise<string> {
  const root = await realpath(workspaceRoot);
  const candidate = path.resolve(root, userCwd);
  const actual = await realpath(candidate);
  const relative = path.relative(root, actual);
  if (relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative))) {
    throw new PolicyError(`Git cwd escapes workspace root: ${userCwd}`);
  }
  return actual;
}

async function runGit(args: string[], cwd: string, maxBytes = 60_000): Promise<{ stdout: string; stderr: string; truncated: boolean }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd, maxBuffer: Math.max(maxBytes * 2, 1024 * 1024) });
    const limitedStdout = limitBytes(stdout, maxBytes);
    const limitedStderr = limitBytes(stderr, maxBytes);
    return { stdout: limitedStdout.value, stderr: limitedStderr.value, truncated: limitedStdout.truncated || limitedStderr.truncated };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return {
      stdout: limitBytes(failure.stdout ?? "", maxBytes).value,
      stderr: limitBytes(failure.stderr ?? failure.message, maxBytes).value,
      truncated: false
    };
  }
}

function assertSafePathArg(value: string): void {
  if (value.includes("\0") || path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
    throw new PolicyError(`Unsafe git path argument: ${value}`);
  }
}

function assertSafeRevision(value: string): void {
  if (!/^[A-Za-z0-9_./:@~^+-]+$/.test(value) || value.startsWith("-")) {
    throw new PolicyError(`Unsafe git revision: ${value}`);
  }
}

function limitBytes(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const buffer = Buffer.from(value);
  if (buffer.byteLength <= maxBytes) {
    return { value, truncated: false };
  }
  return { value: `${buffer.subarray(0, maxBytes).toString("utf8")}\n[output truncated]`, truncated: true };
}
