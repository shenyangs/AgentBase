import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createId,
  type EvalResult,
  type MemoryBlock,
  type MemoryLineage,
  type MemoryProposal,
  type MemoryProposalStatus,
  type MemoryStore,
  type MemoryScope,
  type RuntimeEvent,
  type Tool
} from "@agentbase/core";

export class JsonMemoryStore implements MemoryStore {
  readonly file: string;

  constructor(options: { file: string }) {
    this.file = path.resolve(options.file);
  }

  async add(memory: Omit<MemoryBlock, "id" | "createdAt" | "updatedAt"> & Partial<Pick<MemoryBlock, "id" | "createdAt" | "updatedAt">>): Promise<MemoryBlock> {
    const memories = await this.readAll();
    const now = new Date().toISOString();
    const block: MemoryBlock = {
      id: memory.id ?? createId("mem"),
      scope: memory.scope,
      text: memory.text,
      kind: memory.kind,
      tags: memory.tags ?? [],
      score: memory.score,
      pinned: memory.pinned ?? false,
      promoted: memory.promoted ?? false,
      source: memory.source,
      metadata: memory.metadata,
      createdAt: memory.createdAt ?? now,
      updatedAt: memory.updatedAt ?? now
    };
    memories.push(block);
    await this.writeAll(memories);
    return block;
  }

  async search(query: string, options: { scopes?: MemoryScope[]; tags?: string[]; limit?: number } = {}): Promise<MemoryBlock[]> {
    const terms = tokenize(query);
    const memories = await this.readAll();
    return memories
      .filter((memory) => !options.scopes || options.scopes.includes(memory.scope))
      .filter((memory) => !options.tags || options.tags.every((tag) => memory.tags?.includes(tag)))
      .map((memory) => ({ memory, score: scoreMemory(memory, terms) }))
      .filter((hit) => terms.length === 0 || hit.score > 0 || hit.memory.pinned)
      .sort((a, b) => Number(b.memory.pinned) - Number(a.memory.pinned) || b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt))
      .slice(0, options.limit ?? 20)
      .map((hit) => hit.memory);
  }

  async list(options: { scope?: MemoryScope; limit?: number } = {}): Promise<MemoryBlock[]> {
    const memories = await this.readAll();
    return memories
      .filter((memory) => !options.scope || memory.scope === options.scope)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, options.limit ?? memories.length);
  }

  async promote(id: string): Promise<MemoryBlock> {
    const memories = await this.readAll();
    const found = memories.find((memory) => memory.id === id);
    if (!found) {
      throw new Error(`Memory not found: ${id}`);
    }
    found.promoted = true;
    found.pinned = true;
    found.updatedAt = new Date().toISOString();
    await this.writeAll(memories);
    return found;
  }

  private async readAll(): Promise<MemoryBlock[]> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as MemoryBlock[];
    } catch {
      return [];
    }
  }

  private async writeAll(memories: MemoryBlock[]): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(memories, null, 2)}\n`, "utf8");
  }
}

export class JsonMemoryProposalStore {
  readonly file: string;
  private readonly memoryStore: MemoryStore;

  constructor(options: { file: string; memoryStore: MemoryStore }) {
    this.file = path.resolve(options.file);
    this.memoryStore = options.memoryStore;
  }

  async propose(proposal: Omit<MemoryProposal, "id" | "status" | "createdAt" | "updatedAt"> & Partial<Pick<MemoryProposal, "id" | "status" | "createdAt" | "updatedAt">>): Promise<MemoryProposal> {
    const proposals = await this.readAll();
    const now = new Date().toISOString();
    const next: MemoryProposal = {
      ...proposal,
      id: proposal.id ?? createId("memprop"),
      status: proposal.status ?? "proposed",
      createdAt: proposal.createdAt ?? now,
      updatedAt: proposal.updatedAt ?? now
    };
    proposals.push(next);
    await this.writeAll(proposals);
    return next;
  }

  async getProposal(id: string): Promise<MemoryProposal | undefined> {
    return (await this.readAll()).find((proposal) => proposal.id === id);
  }

  async listProposals(filter: { status?: MemoryProposalStatus; limit?: number } = {}): Promise<MemoryProposal[]> {
    const proposals = await this.readAll();
    return proposals
      .filter((proposal) => !filter.status || proposal.status === filter.status)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, filter.limit ?? proposals.length);
  }

  async reviewProposal(id: string, review: { decision: "approved" | "rejected"; reviewedBy?: string; reason?: string }): Promise<MemoryProposal> {
    return this.updateProposal(id, (proposal) => ({
      ...proposal,
      status: review.decision === "approved" ? "reviewed" : "rejected",
      reviewedBy: review.reviewedBy,
      reviewedAt: new Date().toISOString(),
      reviewReason: review.reason,
      updatedAt: new Date().toISOString()
    }));
  }

  async testProposal(id: string, evalResults: EvalResult[]): Promise<MemoryProposal> {
    const passed = evalResults.length > 0 && evalResults.every((result) => result.passed);
    return this.updateProposal(id, (proposal) => ({
      ...proposal,
      evalResults,
      status: passed ? "tested" : "rejected",
      updatedAt: new Date().toISOString()
    }));
  }

  async promoteProposal(id: string): Promise<{ proposal: MemoryProposal; memory: MemoryBlock }> {
    const proposal = await this.getProposal(id);
    if (!proposal) {
      throw new Error(`Memory proposal not found: ${id}`);
    }
    if (proposal.status !== "reviewed" && proposal.status !== "tested") {
      throw new Error(`Memory proposal ${id} must be reviewed or tested before promotion.`);
    }
    const memory = await this.memoryStore.add({
      ...proposal.memory,
      pinned: true,
      promoted: true,
      metadata: {
        ...(proposal.memory.metadata ?? {}),
        proposalId: proposal.id,
        evidence: proposal.evidence ?? [],
        rationale: proposal.rationale
      }
    });
    const promoted = await this.updateProposal(id, (current) => ({
      ...current,
      status: "promoted",
      promotedMemoryId: memory.id,
      updatedAt: new Date().toISOString()
    }));
    return { proposal: promoted, memory };
  }

  private async updateProposal(id: string, update: (proposal: MemoryProposal) => MemoryProposal): Promise<MemoryProposal> {
    const proposals = await this.readAll();
    const index = proposals.findIndex((proposal) => proposal.id === id);
    if (index < 0) {
      throw new Error(`Memory proposal not found: ${id}`);
    }
    proposals[index] = update(proposals[index]);
    await this.writeAll(proposals);
    return proposals[index];
  }

  private async readAll(): Promise<MemoryProposal[]> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as MemoryProposal[];
    } catch {
      return [];
    }
  }

  private async writeAll(proposals: MemoryProposal[]): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(proposals, null, 2)}\n`, "utf8");
  }
}

type MemoryLineageDb = {
  version: 1;
  lineages: MemoryLineage[];
};

export class JsonMemoryLineageStore {
  readonly file: string;

  constructor(options: { file: string }) {
    this.file = path.resolve(options.file);
  }

  async link(lineage: MemoryLineage): Promise<MemoryLineage> {
    const db = await this.readDb();
    const key = lineage.memoryId ?? lineage.proposalId ?? `${lineage.sourceRunId}:${lineage.sourceEventId}:${lineage.sourceArtifactRef}`;
    const index = db.lineages.findIndex((entry) => (entry.memoryId ?? entry.proposalId ?? `${entry.sourceRunId}:${entry.sourceEventId}:${entry.sourceArtifactRef}`) === key);
    const next: MemoryLineage = {
      ...db.lineages[index],
      ...lineage,
      usedByRunIds: [...new Set([...(db.lineages[index]?.usedByRunIds ?? []), ...(lineage.usedByRunIds ?? [])])]
    };
    if (index >= 0) {
      db.lineages[index] = next;
    } else {
      db.lineages.push(next);
    }
    await this.writeDb(db);
    return next;
  }

  async list(filter: { memoryId?: string; proposalId?: string; runId?: string } = {}): Promise<MemoryLineage[]> {
    const db = await this.readDb();
    return db.lineages.filter((entry) => {
      if (filter.memoryId && entry.memoryId !== filter.memoryId) return false;
      if (filter.proposalId && entry.proposalId !== filter.proposalId) return false;
      if (filter.runId && entry.sourceRunId !== filter.runId && !(entry.usedByRunIds ?? []).includes(filter.runId)) return false;
      return true;
    });
  }

  async markUsed(memoryId: string, runId: string): Promise<MemoryLineage> {
    const [existing] = await this.list({ memoryId });
    return this.link({
      ...(existing ?? {}),
      memoryId,
      usedByRunIds: [...new Set([...(existing?.usedByRunIds ?? []), runId])]
    });
  }

  async supersede(memoryId: string, supersededBy?: string): Promise<MemoryLineage> {
    const [existing] = await this.list({ memoryId });
    return this.link({ ...(existing ?? {}), memoryId, supersededBy: supersededBy ?? "superseded" });
  }

  private async readDb(): Promise<MemoryLineageDb> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as MemoryLineageDb;
      if (parsed.version === 1 && Array.isArray(parsed.lineages)) {
        return parsed;
      }
    } catch {
      // Empty lineage store.
    }
    return { version: 1, lineages: [] };
  }

  private async writeDb(db: MemoryLineageDb): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  }
}

export function memoryLineageFile(cwd: string, memoryFile = ".agentbase/memory/memory.json"): string {
  return path.join(path.dirname(path.resolve(cwd, memoryFile)), "lineage.json");
}

export function draftMemoryProposalFromRun(events: RuntimeEvent[], runId: string): Omit<MemoryProposal, "id" | "status" | "createdAt" | "updatedAt"> {
  const final = [...events].reverse().find((event) => event.type === "run.completed" || event.type === "model.completed");
  const context = [...events].reverse().find((event) => event.type === "context.prepared");
  const outputPreview = typeof final?.data.outputPreview === "string" ? final.data.outputPreview : typeof final?.data.status === "string" ? final.data.status : "Run completed with reusable local evidence.";
  return {
    memory: {
      scope: "project",
      text: `Run ${runId} produced reusable evidence: ${truncate(outputPreview, 240)}`,
      kind: "summary",
      tags: ["curated", "trace"],
      source: runId,
      metadata: {
        sourceRunId: runId,
        sourceEventId: final?.id,
        contextEventId: context?.id
      }
    },
    rationale: "Curated from a completed run. Review before promoting to durable memory.",
    evidence: [
      { type: "run", ref: runId, summary: "Source run for memory curate." },
      ...(final ? [{ type: "trace", ref: final.id, summary: `Source event: ${final.type}` }] : [])
    ],
    metadata: {
      source: "memory.curate",
      sourceRunId: runId
    }
  };
}

export function createMemoryTools(store: MemoryStore): Tool[] {
  return [
    {
      name: "memory_search",
      description: "Search persistent AgentBase memory blocks.",
      requiredPermissions: ["fs:read"],
      risk: "low",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string" },
          scope: { type: "string" },
          limit: { type: "integer", default: 10 }
        }
      },
      async execute(input) {
        const { query, scope, limit = 10 } = input as { query: string; scope?: MemoryScope; limit?: number };
        return { ok: true, output: { results: await store.search(query, { scopes: scope ? [scope] : undefined, limit }) } };
      }
    },
    {
      name: "memory_add",
      description: "Add a persistent memory block after policy and eval gates allow it.",
      requiredPermissions: ["fs:write"],
      risk: "medium",
      inputSchema: {
        type: "object",
        required: ["scope", "text"],
        properties: {
          scope: { type: "string" },
          text: { type: "string" },
          kind: { type: "string" },
          tags: { type: "array", items: { type: "string" } }
        }
      },
      async execute(input) {
        const block = await store.add(input as Omit<MemoryBlock, "id" | "createdAt" | "updatedAt">);
        return { ok: true, output: block, metadata: { memoryId: block.id, scope: block.scope } };
      }
    }
  ];
}

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/).filter(Boolean);
}

function scoreMemory(memory: MemoryBlock, terms: string[]): number {
  const haystack = `${memory.text} ${memory.tags?.join(" ") ?? ""} ${memory.kind ?? ""}`.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0) + (memory.score ?? 0);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
