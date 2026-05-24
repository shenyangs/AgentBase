import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseConnectionConfig, Tool, ToolExecutionContext } from "@agentbase/core";

const nodeRequire = createRequire(import.meta.url);

export type DatabaseToolsOptions = {
  connections: DatabaseConnectionConfig[];
};

export function createDatabaseTools(options: DatabaseToolsOptions): Tool[] {
  return [listConnectionsTool(options), schemaTool(options), queryTool(options), executeTool(options)];
}

export function classifySql(sql: string): "read" | "write" {
  const normalized = sql.trim().replace(/^--.*$/gm, "").trim().toLowerCase();
  return /^(select|with|pragma|show|describe|desc|explain)\b/.test(normalized) ? "read" : "write";
}

function listConnectionsTool(options: DatabaseToolsOptions): Tool {
  return {
    name: "db_list_connections",
    description: "List configured database connections without exposing secrets.",
    requiredPermissions: ["database:read"],
    risk: "low",
    inputSchema: { type: "object", properties: {} },
    async execute() {
      return {
        ok: true,
        output: {
          summary: "database connections",
          preview: options.connections.map((connection) => `${connection.name}\t${connection.driver}\t${connection.readonly ? "readonly" : "readwrite"}`).join("\n"),
          connections: options.connections.map((connection) => sanitizeConnection(connection))
        },
        metadata: { durationMs: 0, truncated: false, count: options.connections.length }
      };
    }
  };
}

function schemaTool(options: DatabaseToolsOptions): Tool {
  return {
    name: "db_schema",
    description: "Inspect database schema for a configured connection.",
    requiredPermissions: ["database:read"],
    risk: "low",
    inputSchema: { type: "object", required: ["connection"], properties: { connection: { type: "string" } } },
    async execute(input, ctx) {
      const started = Date.now();
      const connection = getConnection(options, (input as { connection: string }).connection);
      const rows = await runRead(connection, schemaSql(connection.driver), [], ctx);
      return { ok: true, output: { summary: `schema for ${connection.name}`, preview: previewRows(rows), rows }, metadata: { durationMs: Date.now() - started, truncated: false, connection: connection.name, driver: connection.driver, statementKind: "read", rowCount: rows.length } };
    }
  };
}

function queryTool(options: DatabaseToolsOptions): Tool {
  return {
    name: "db_query",
    description: "Run a read-only SQL query against a configured database connection.",
    requiredPermissions: ["database:read"],
    risk: "medium",
    inputSchema: { type: "object", required: ["connection", "sql"], properties: { connection: { type: "string" }, sql: { type: "string" }, params: { type: "array" } } },
    async execute(input, ctx) {
      const started = Date.now();
      const { connection: name, sql, params = [] } = input as { connection: string; sql: string; params?: unknown[] };
      if (classifySql(sql) !== "read") {
        return { ok: false, error: { code: "DB_WRITE_IN_QUERY", message: "db_query only allows read SQL; use db_execute for writes" } };
      }
      const connection = getConnection(options, name);
      const rows = await runRead(connection, sql, params, ctx);
      const maxRows = connection.maxRows ?? 100;
      return { ok: true, output: { summary: `db_query ${connection.name}: ${rows.length} row(s)`, preview: previewRows(rows.slice(0, maxRows)), rows: rows.slice(0, maxRows) }, metadata: { durationMs: Date.now() - started, truncated: rows.length > maxRows, connection: connection.name, driver: connection.driver, statementKind: "read", rowCount: rows.length } };
    }
  };
}

function executeTool(options: DatabaseToolsOptions): Tool {
  return {
    name: "db_execute",
    description: "Run a write-capable SQL statement against a configured database connection.",
    requiredPermissions: ["database:write"],
    risk: "high",
    inputSchema: { type: "object", required: ["connection", "sql"], properties: { connection: { type: "string" }, sql: { type: "string" }, params: { type: "array" } } },
    async execute(input, ctx) {
      const started = Date.now();
      const { connection: name, sql, params = [] } = input as { connection: string; sql: string; params?: unknown[] };
      const connection = getConnection(options, name);
      if (connection.readonly) {
        return { ok: false, error: { code: "DB_READONLY", message: `Connection is readonly: ${connection.name}` } };
      }
      const result = await runWrite(connection, sql, params, ctx);
      return { ok: true, output: { summary: `db_execute ${connection.name}: ${result.affectedRows ?? 0} affected`, preview: JSON.stringify(result), result }, metadata: { durationMs: Date.now() - started, truncated: false, connection: connection.name, driver: connection.driver, statementKind: classifySql(sql), rowCount: result.affectedRows ?? 0 } };
    }
  };
}

async function runRead(connection: DatabaseConnectionConfig, sql: string, params: unknown[], ctx: ToolExecutionContext): Promise<Record<string, unknown>[]> {
  if (connection.driver === "sqlite") {
    const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(resolveSqliteFile(connection, ctx.workspaceRoot), { readOnly: true });
    try {
      return db.prepare(limitSql(sql, connection.maxRows ?? 100)).all(...(params as any[])) as Record<string, unknown>[];
    } finally {
      db.close();
    }
  }
  if (connection.driver === "postgres") {
    const { Client } = nodeRequire("pg") as any;
    const client = new Client({ connectionString: getConnectionString(connection, ctx) });
    await client.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows;
    } finally {
      await client.end();
    }
  }
  const mysql = await import("mysql2/promise");
  const conn = await mysql.createConnection(getConnectionString(connection, ctx));
  try {
    const [rows] = await conn.execute(sql, params as any[]);
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  } finally {
    await conn.end();
  }
}

async function runWrite(connection: DatabaseConnectionConfig, sql: string, params: unknown[], ctx: ToolExecutionContext): Promise<{ affectedRows?: number; rows?: unknown[] }> {
  if (connection.driver === "sqlite") {
    const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(resolveSqliteFile(connection, ctx.workspaceRoot));
    try {
      const result = db.prepare(sql).run(...(params as any[]));
      return { affectedRows: Number(result.changes ?? 0) };
    } finally {
      db.close();
    }
  }
  if (connection.driver === "postgres") {
    const { Client } = nodeRequire("pg") as any;
    const client = new Client({ connectionString: getConnectionString(connection, ctx) });
    await client.connect();
    try {
      const result = await client.query(sql, params);
      return { affectedRows: result.rowCount ?? 0, rows: result.rows };
    } finally {
      await client.end();
    }
  }
  const mysql = await import("mysql2/promise");
  const conn = await mysql.createConnection(getConnectionString(connection, ctx));
  try {
    const [result] = await conn.execute(sql, params as any[]);
    return { affectedRows: typeof (result as any).affectedRows === "number" ? (result as any).affectedRows : 0 };
  } finally {
    await conn.end();
  }
}

function getConnection(options: DatabaseToolsOptions, name: string): DatabaseConnectionConfig {
  const connection = options.connections.find((candidate) => candidate.name === name);
  if (!connection) {
    throw new Error(`Unknown database connection: ${name}`);
  }
  return connection;
}

function resolveSqliteFile(connection: DatabaseConnectionConfig, workspaceRoot: string): string {
  if (!connection.file) {
    throw new Error(`SQLite connection requires file: ${connection.name}`);
  }
  const root = path.resolve(workspaceRoot);
  const file = path.resolve(root, connection.file);
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`SQLite database escapes workspace: ${connection.file}`);
  }
  return file;
}

function getConnectionString(connection: DatabaseConnectionConfig, ctx: ToolExecutionContext): string {
  const value = connection.connectionStringEnv ? ctx.env[connection.connectionStringEnv] : undefined;
  if (!value) {
    throw new Error(`Connection string env is missing for ${connection.name}`);
  }
  return value;
}

function schemaSql(driver: DatabaseConnectionConfig["driver"]): string {
  if (driver === "sqlite") return "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') ORDER BY name";
  if (driver === "postgres") return "SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema, table_name";
  return "SHOW TABLES";
}

function limitSql(sql: string, maxRows: number): string {
  return /\blimit\s+\d+/i.test(sql) ? sql : `${sql.replace(/;\s*$/, "")} LIMIT ${Math.max(1, Math.min(maxRows, 1000))}`;
}

function sanitizeConnection(connection: DatabaseConnectionConfig): Record<string, unknown> {
  return { name: connection.name, driver: connection.driver, readonly: Boolean(connection.readonly), file: connection.driver === "sqlite" ? connection.file : undefined, connectionStringEnv: connection.connectionStringEnv };
}

function previewRows(rows: unknown[]): string {
  return JSON.stringify(rows.slice(0, 20), null, 2).slice(0, 4000);
}
