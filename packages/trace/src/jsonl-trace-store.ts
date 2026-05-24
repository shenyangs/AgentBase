import { appendFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { RuntimeEvent, TraceStore } from "@agentbase/core";

export type JsonlTraceStoreOptions = {
  dir: string;
};

export type RunSummary = {
  runId: string;
  path: string;
  events: number;
  startedAt?: string;
  completedAt?: string;
  status: "running" | "completed" | "failed";
  agent?: string;
};

export class JsonlTraceStore implements TraceStore {
  readonly dir: string;

  constructor(options: JsonlTraceStoreOptions) {
    this.dir = path.resolve(options.dir);
  }

  async write(event: RuntimeEvent): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = this.fileForRun(event.runId);
    await appendFile(file, `${JSON.stringify(redactEvent(event))}\n`, "utf8");
  }

  async listRuns(): Promise<RunSummary[]> {
    await mkdir(this.dir, { recursive: true });
    const entries = await readdir(this.dir);
    const runs: RunSummary[] = [];

    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) {
        continue;
      }

      const file = path.join(this.dir, entry);
      const fileStat = await stat(file);
      if (!fileStat.isFile()) {
        continue;
      }

      const events = await readJsonlEvents(file);
      if (events.length === 0) {
        continue;
      }

      const runId = events[0].runId;
      const terminal = [...events].reverse().find((event) => event.type === "run.completed" || event.type === "run.failed");
      const started = events.find((event) => event.type === "run.started");

      runs.push({
        runId,
        path: file,
        events: events.length,
        startedAt: started?.ts,
        completedAt: terminal?.ts,
        status: terminal?.type === "run.completed" ? "completed" : terminal?.type === "run.failed" ? "failed" : "running",
        agent: typeof started?.data.agent === "string" ? started.data.agent : undefined
      });
    }

    return runs.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  }

  async readRun(runId: string): Promise<RuntimeEvent[]> {
    return readJsonlEvents(this.fileForRun(runId));
  }

  fileForRun(runId: string): string {
    return path.join(this.dir, `${runId}.jsonl`);
  }
}

export async function readJsonlEvents(file: string): Promise<RuntimeEvent[]> {
  const raw = await readFile(file, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RuntimeEvent);
}

export function redactEvent(event: RuntimeEvent): RuntimeEvent {
  return redactValue(event) as RuntimeEvent;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        if (isSecretKey(key)) {
          return [key, "[REDACTED]"];
        }
        return [key, redactValue(child)];
      })
    );
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  return value;
}

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, "");
  if (normalized === "inputtokens" || normalized === "outputtokens" || normalized === "totaltokens" || normalized === "tokenestimate") {
    return false;
  }

  return (
    normalized === "authorization" ||
    normalized === "apikey" ||
    normalized === "token" ||
    normalized === "accesstoken" ||
    normalized === "refreshtoken" ||
    normalized === "idtoken" ||
    normalized.includes("secret") ||
    normalized.includes("password")
  );
}

function redactString(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-[REDACTED]")
    .replace(/ghp_[A-Za-z0-9_]{12,}/g, "ghp_[REDACTED]")
    .replace(/xox[baprs]-[A-Za-z0-9-]{12,}/g, "xox-[REDACTED]")
    .replace(/AKIA[0-9A-Z]{12,}/g, "AKIA[REDACTED]")
    .replace(/Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/gi, "Authorization: Bearer [REDACTED]");
}
