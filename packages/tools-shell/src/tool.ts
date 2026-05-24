import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "@agentbase/core";
import { assessShellPolicy } from "./policy";
import { resolveShellCwd } from "./path-guard";

const execAsync = promisify(exec);

export function createShellTool(): Tool {
  return {
    name: "run_shell",
    description: "Run a shell command inside the workspace with timeout, output limits, and policy checks.",
    requiredPermissions: ["shell:run"],
    risk: "high",
    inputSchema: {
      type: "object",
      required: ["command"],
      properties: {
        command: { type: "string" },
        cwd: { type: "string", default: "." },
        timeoutMs: { type: "integer", default: 30000 },
        maxOutputBytes: { type: "integer", default: 20000 }
      }
    },
    async execute(input, ctx) {
      const { command, cwd = ".", timeoutMs = 30_000, maxOutputBytes = 20_000 } = input as {
        command: string;
        cwd?: string;
        timeoutMs?: number;
        maxOutputBytes?: number;
      };

      const decision = assessShellPolicy(command, ctx.policy);
      if (!decision.allowed) {
        return { ok: false, error: { code: "SHELL_POLICY_REJECTED", message: decision.reason, details: { risk: decision.risk } } };
      }

      const absoluteCwd = await resolveShellCwd(ctx.workspaceRoot, cwd);

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: absoluteCwd,
          timeout: timeoutMs,
          maxBuffer: Math.max(maxOutputBytes * 2, 1024 * 1024),
          env: { ...process.env, ...ctx.env }
        });

        const limitedStdout = limitBytes(stdout, maxOutputBytes);
        const limitedStderr = limitBytes(stderr, maxOutputBytes);
        return {
          ok: true,
          output: {
            command,
            cwd,
            status: "success",
            exitCode: 0,
            stdout: limitedStdout.value,
            stderr: limitedStderr.value,
            truncated: limitedStdout.truncated || limitedStderr.truncated,
            risk: decision.risk
          }
        };
      } catch (error) {
        const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string; killed?: boolean };
        const limitedStdout = limitBytes(failure.stdout ?? "", maxOutputBytes);
        const limitedStderr = limitBytes(failure.stderr ?? "", maxOutputBytes);
        const timedOut = failure.killed === true || /timed out/i.test(failure.message ?? "");

        return {
          ok: true,
          output: {
            command,
            cwd,
            status: timedOut ? "timed_out" : "command_failed",
            exitCode: typeof failure.code === "number" ? failure.code : 1,
            stdout: limitedStdout.value,
            stderr: limitedStderr.value || (timedOut ? "Command timed out" : ""),
            truncated: limitedStdout.truncated || limitedStderr.truncated,
            timedOut,
            risk: decision.risk
          }
        };
      }
    }
  };
}

function limitBytes(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const buffer = Buffer.from(value);
  if (buffer.byteLength <= maxBytes) {
    return { value, truncated: false };
  }

  return { value: `${buffer.subarray(0, maxBytes).toString("utf8")}\n[output truncated]`, truncated: true };
}
