import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { createId, type Capability, type CapabilityDraft, type CapabilityRun, type CapabilityStore } from "@agentbase/core";

type CapabilityDb = {
  version: 1;
  drafts: CapabilityDraft[];
  capabilities: Capability[];
  runs: CapabilityRun[];
};

export class JsonCapabilityStore implements CapabilityStore {
  readonly file: string;

  constructor(options: { file: string }) {
    this.file = path.resolve(options.file);
  }

  async createDraft(draft: Omit<CapabilityDraft, "id" | "status" | "createdAt" | "updatedAt"> & Partial<Pick<CapabilityDraft, "id" | "status" | "createdAt" | "updatedAt">>): Promise<CapabilityDraft> {
    const db = await this.readDb();
    const now = new Date().toISOString();
    const record: CapabilityDraft = {
      ...draft,
      id: draft.id ?? createId("capdraft"),
      status: draft.status ?? "draft",
      createdAt: draft.createdAt ?? now,
      updatedAt: draft.updatedAt ?? now
    };
    db.drafts.push(record);
    await this.writeDb(db);
    return record;
  }

  async listDrafts(filter: { status?: CapabilityDraft["status"]; limit?: number } = {}): Promise<CapabilityDraft[]> {
    const db = await this.readDb();
    return db.drafts
      .filter((draft) => !filter.status || draft.status === filter.status)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, filter.limit ?? db.drafts.length);
  }

  async getDraft(id: string): Promise<CapabilityDraft | undefined> {
    return (await this.readDb()).drafts.find((draft) => draft.id === id);
  }

  async promoteDraft(id: string, input: { instructions?: string; defaultTools?: string[]; capabilityId?: string } = {}): Promise<{ draft: CapabilityDraft; capability: Capability }> {
    const db = await this.readDb();
    const draft = db.drafts.find((candidate) => candidate.id === id);
    if (!draft) {
      throw new Error(`Capability draft not found: ${id}`);
    }
    if (draft.status !== "draft") {
      throw new Error(`Capability draft ${id} is already ${draft.status}.`);
    }

    const now = new Date().toISOString();
    const capability: Capability = {
      id: input.capabilityId ?? createId("cap"),
      title: draft.title,
      summary: draft.summary,
      instructions: input.instructions ?? draft.suggestedInstructions ?? draft.summary,
      defaultTools: input.defaultTools ?? draft.suggestedTools,
      sourceDraftId: draft.id,
      version: 1,
      status: "active",
      createdAt: now,
      updatedAt: now,
      metadata: draft.metadata
    };
    draft.status = "promoted";
    draft.updatedAt = now;
    db.capabilities.push(capability);
    await this.writeDb(db);
    return { draft, capability };
  }

  async listCapabilities(filter: { status?: Capability["status"]; limit?: number } = {}): Promise<Capability[]> {
    const db = await this.readDb();
    return db.capabilities
      .filter((capability) => !filter.status || capability.status === filter.status)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, filter.limit ?? db.capabilities.length);
  }

  async getCapability(id: string): Promise<Capability | undefined> {
    return (await this.readDb()).capabilities.find((capability) => capability.id === id);
  }

  async recordRun(run: Omit<CapabilityRun, "id" | "createdAt"> & Partial<Pick<CapabilityRun, "id" | "createdAt">>): Promise<CapabilityRun> {
    const db = await this.readDb();
    if (!db.capabilities.some((capability) => capability.id === run.capabilityId)) {
      throw new Error(`Capability not found: ${run.capabilityId}`);
    }
    const record: CapabilityRun = {
      ...run,
      id: run.id ?? createId("caprun"),
      createdAt: run.createdAt ?? new Date().toISOString()
    };
    db.runs.push(record);
    await this.writeDb(db);
    return record;
  }

  async listRuns(filter: { capabilityId?: string; limit?: number } = {}): Promise<CapabilityRun[]> {
    const db = await this.readDb();
    return db.runs
      .filter((run) => !filter.capabilityId || run.capabilityId === filter.capabilityId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, filter.limit ?? db.runs.length);
  }

  private async readDb(): Promise<CapabilityDb> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as CapabilityDb;
      if (parsed.version === 1 && Array.isArray(parsed.drafts) && Array.isArray(parsed.capabilities) && Array.isArray(parsed.runs)) {
        return parsed;
      }
    } catch {
      // Empty workspace.
    }
    return { version: 1, drafts: [], capabilities: [], runs: [] };
  }

  private async writeDb(db: CapabilityDb): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  }
}

export function capabilityStoreFile(cwd: string): string {
  return path.resolve(cwd, ".agentbase", "capabilities", "capabilities.json");
}
