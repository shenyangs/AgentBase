import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { createId, type ExperienceAtom, type ExperienceEvent, type ExperienceLedger, type ExperienceLesson } from "@agentbase/core";

type ExperienceDb = {
  version: 1;
  events: ExperienceEvent[];
  atoms: ExperienceAtom[];
  lessons: ExperienceLesson[];
};

export class JsonExperienceLedger implements ExperienceLedger {
  readonly file: string;

  constructor(options: { file: string }) {
    this.file = path.resolve(options.file);
  }

  async addEvent(event: Omit<ExperienceEvent, "id" | "createdAt"> & Partial<Pick<ExperienceEvent, "id" | "createdAt">>): Promise<ExperienceEvent> {
    const db = await this.readDb();
    const record: ExperienceEvent = {
      ...event,
      id: event.id ?? createId("exp"),
      createdAt: event.createdAt ?? new Date().toISOString()
    };
    db.events.push(record);
    await this.writeDb(db);
    return record;
  }

  async addAtom(atom: Omit<ExperienceAtom, "id" | "createdAt" | "updatedAt"> & Partial<Pick<ExperienceAtom, "id" | "createdAt" | "updatedAt">>): Promise<ExperienceAtom> {
    const db = await this.readDb();
    const now = new Date().toISOString();
    const record: ExperienceAtom = {
      ...atom,
      id: atom.id ?? createId("atom"),
      createdAt: atom.createdAt ?? now,
      updatedAt: atom.updatedAt ?? now
    };
    db.atoms.push(record);
    await this.writeDb(db);
    return record;
  }

  async addLesson(lesson: Omit<ExperienceLesson, "id" | "status" | "createdAt" | "updatedAt"> & Partial<Pick<ExperienceLesson, "id" | "status" | "createdAt" | "updatedAt">>): Promise<ExperienceLesson> {
    const db = await this.readDb();
    const now = new Date().toISOString();
    const record: ExperienceLesson = {
      ...lesson,
      id: lesson.id ?? createId("lesson"),
      status: lesson.status ?? "draft",
      createdAt: lesson.createdAt ?? now,
      updatedAt: lesson.updatedAt ?? now
    };
    db.lessons.push(record);
    await this.writeDb(db);
    return record;
  }

  async listEvents(filter: { runId?: string; type?: string; limit?: number } = {}): Promise<ExperienceEvent[]> {
    const db = await this.readDb();
    return db.events
      .filter((event) => !filter.runId || event.runId === filter.runId)
      .filter((event) => !filter.type || event.type === filter.type)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, filter.limit ?? db.events.length);
  }

  async listAtoms(filter: { tag?: string; limit?: number } = {}): Promise<ExperienceAtom[]> {
    const db = await this.readDb();
    return db.atoms
      .filter((atom) => !filter.tag || atom.tags?.includes(filter.tag))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, filter.limit ?? db.atoms.length);
  }

  async listLessons(filter: { status?: ExperienceLesson["status"]; limit?: number } = {}): Promise<ExperienceLesson[]> {
    const db = await this.readDb();
    return db.lessons
      .filter((lesson) => !filter.status || lesson.status === filter.status)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, filter.limit ?? db.lessons.length);
  }

  private async readDb(): Promise<ExperienceDb> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as ExperienceDb;
      if (parsed.version === 1 && Array.isArray(parsed.events) && Array.isArray(parsed.atoms) && Array.isArray(parsed.lessons)) {
        return parsed;
      }
    } catch {
      // Empty workspace.
    }
    return { version: 1, events: [], atoms: [], lessons: [] };
  }

  private async writeDb(db: ExperienceDb): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  }
}

export function experienceLedgerFile(cwd: string): string {
  return path.resolve(cwd, ".agentbase", "experience", "ledger.json");
}
