import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifySql, createDatabaseTools } from "./index";

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

describe("tools-database", () => {
  it("classifies read and write sql", () => {
    expect(classifySql("select * from users")).toBe("read");
    expect(classifySql("insert into users values (1)")).toBe("write");
  });

  it("runs sqlite query and execute tools", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentbase-db-"));
    await mkdir(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, "test.sqlite"));
    db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items (name) VALUES ('one');");
    db.close();
    const tools = createDatabaseTools({ connections: [{ name: "local", driver: "sqlite", file: "test.sqlite", maxRows: 10 }] });
    const ctx = context(dir);
    const query = await tools.find((tool) => tool.name === "db_query")?.execute({ connection: "local", sql: "SELECT * FROM items" }, ctx);
    expect((query?.output as any).rows[0].name).toBe("one");
    const write = await tools.find((tool) => tool.name === "db_execute")?.execute({ connection: "local", sql: "INSERT INTO items (name) VALUES (?)", params: ["two"] }, ctx);
    expect((write?.output as any).result.affectedRows).toBe(1);
  });
});

function context(workspaceRoot: string) {
  return {
    runId: "run",
    workspaceRoot,
    signal: new AbortController().signal,
    policy: { name: "trusted" as const },
    env: {},
    trace: {
      async write(input: any) {
        return { id: "evt", runId: "run", ts: "now", type: input.type, data: input.data ?? {} };
      }
    }
  };
}
