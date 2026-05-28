import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { createId, type RelayMailbox, type RelayMessage, type RelayMessageStatus } from "@agentbase/core";

type RelayDb = {
  version: 1;
  messages: RelayMessage[];
};

export class JsonRelayMailbox implements RelayMailbox {
  readonly file: string;

  constructor(options: { file: string }) {
    this.file = path.resolve(options.file);
  }

  async send(message: Omit<RelayMessage, "id" | "status" | "attempts" | "createdAt" | "updatedAt"> & Partial<Pick<RelayMessage, "id" | "status" | "attempts" | "createdAt" | "updatedAt">>): Promise<RelayMessage> {
    const db = await this.readDb();
    const now = new Date().toISOString();
    const record: RelayMessage = {
      ...message,
      id: message.id ?? createId("relay"),
      status: message.status ?? "queued",
      attempts: message.attempts ?? 0,
      createdAt: message.createdAt ?? now,
      updatedAt: message.updatedAt ?? now
    };
    validateMessage(record);
    db.messages.push(record);
    await this.writeDb(db);
    return record;
  }

  async list(filter: { channel?: string; status?: RelayMessageStatus; runId?: string; limit?: number } = {}): Promise<RelayMessage[]> {
    const db = await this.readDb();
    return db.messages
      .filter((message) => !filter.channel || message.channel === filter.channel)
      .filter((message) => !filter.status || message.status === filter.status)
      .filter((message) => !filter.runId || message.runId === filter.runId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, filter.limit ?? db.messages.length);
  }

  async get(id: string): Promise<RelayMessage | undefined> {
    return (await this.readDb()).messages.find((message) => message.id === id);
  }

  async markDelivered(id: string): Promise<RelayMessage> {
    return this.update(id, (message, now) => ({
      ...message,
      status: "delivered",
      attempts: message.attempts + 1,
      deliveredAt: now,
      updatedAt: now
    }));
  }

  async markRunning(id: string): Promise<RelayMessage> {
    return this.update(id, (message, now) => ({
      ...message,
      status: "running",
      attempts: message.attempts + 1,
      runningAt: now,
      updatedAt: now
    }));
  }

  async markWaitingApproval(id: string, approvalId?: string): Promise<RelayMessage> {
    return this.update(id, (message, now) => ({
      ...message,
      status: "waiting_approval",
      waitingApprovalAt: now,
      updatedAt: now,
      metadata: {
        ...(message.metadata ?? {}),
        approvalId
      }
    }));
  }

  async acknowledge(id: string): Promise<RelayMessage> {
    return this.update(id, (message, now) => ({
      ...message,
      status: "acknowledged",
      acknowledgedAt: now,
      updatedAt: now
    }));
  }

  async fail(id: string, error: string): Promise<RelayMessage> {
    return this.update(id, (message, now) => ({
      ...message,
      status: "failed",
      error,
      failedAt: now,
      updatedAt: now
    }));
  }

  async cancel(id: string, reason?: string): Promise<RelayMessage> {
    return this.update(id, (message, now) => ({
      ...message,
      status: "cancelled",
      error: reason,
      cancelledAt: now,
      updatedAt: now
    }));
  }

  private async update(id: string, updater: (message: RelayMessage, now: string) => RelayMessage): Promise<RelayMessage> {
    const db = await this.readDb();
    const index = db.messages.findIndex((message) => message.id === id);
    if (index < 0) {
      throw new Error(`Relay message not found: ${id}`);
    }
    const next = updater(db.messages[index], new Date().toISOString());
    validateMessage(next);
    db.messages[index] = next;
    await this.writeDb(db);
    return next;
  }

  private async readDb(): Promise<RelayDb> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as RelayDb;
      if (parsed.version === 1 && Array.isArray(parsed.messages)) {
        return parsed;
      }
    } catch {
      // Empty mailbox.
    }
    return { version: 1, messages: [] };
  }

  private async writeDb(db: RelayDb): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  }
}

export function relayMailboxFile(cwd: string): string {
  return path.resolve(cwd, ".agentbase", "relay", "mailbox.json");
}

function validateMessage(message: RelayMessage): void {
  if (!message.channel || !message.type) {
    throw new Error("Relay message requires channel and type.");
  }
  if (!message.payload || typeof message.payload !== "object" || Array.isArray(message.payload)) {
    throw new Error("Relay message payload must be an object.");
  }
}
