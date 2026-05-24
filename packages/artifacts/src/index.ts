import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactRecord, ArtifactStore, MaterializedRef, Tool } from "@agentbase/core";

export class FileArtifactStore implements ArtifactStore {
  readonly dir: string;

  constructor(options: { dir: string }) {
    this.dir = path.resolve(options.dir);
  }

  async put(record: Omit<ArtifactRecord, "createdAt"> & { createdAt?: string }): Promise<ArtifactRecord> {
    await mkdir(this.dir, { recursive: true });
    const stored: ArtifactRecord = { ...record, createdAt: record.createdAt ?? new Date().toISOString() };
    await writeFile(this.fileForRef(stored.ref), `${JSON.stringify(stored, null, 2)}\n`, "utf8");
    return stored;
  }

  async get(ref: string): Promise<ArtifactRecord | undefined> {
    try {
      return JSON.parse(await readFile(this.fileForRef(ref), "utf8")) as ArtifactRecord;
    } catch {
      return undefined;
    }
  }

  async materialize(ref: string): Promise<MaterializedRef | undefined> {
    const record = await this.get(ref);
    if (!record) {
      return undefined;
    }
    return {
      ref: record.ref,
      kind: record.kind,
      content: record.content,
      summary: record.summary,
      preview: record.preview,
      metadata: record.metadata
    };
  }

  async list(filter: { runId?: string; kind?: string; limit?: number } = {}): Promise<ArtifactRecord[]> {
    await mkdir(this.dir, { recursive: true });
    const entries = await readdir(this.dir);
    const records: ArtifactRecord[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) {
        continue;
      }
      const record = JSON.parse(await readFile(path.join(this.dir, entry), "utf8")) as ArtifactRecord;
      if (filter.runId && record.runId !== filter.runId) {
        continue;
      }
      if (filter.kind && record.kind !== filter.kind) {
        continue;
      }
      records.push(record);
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, filter.limit ?? records.length);
  }

  fileForRef(ref: string): string {
    return path.join(this.dir, `${encodeURIComponent(ref)}.json`);
  }
}

export function createMaterializeRefTool(store: ArtifactStore): Tool {
  return {
    name: "materialize_ref",
    description: "Materialize an AgentBase artifact ref into model-visible content.",
    requiredPermissions: ["fs:read"],
    risk: "low",
    inputSchema: {
      type: "object",
      required: ["ref"],
      properties: {
        ref: { type: "string" }
      }
    },
    async execute(input) {
      const { ref } = input as { ref: string };
      const materialized = await store.materialize(ref);
      if (!materialized) {
        return { ok: false, error: { code: "ARTIFACT_NOT_FOUND", message: `Artifact not found: ${ref}` } };
      }
      return { ok: true, output: materialized, metadata: { ref, kind: materialized.kind } };
    }
  };
}
