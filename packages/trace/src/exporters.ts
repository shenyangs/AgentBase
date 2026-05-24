import type { RuntimeEvent } from "@agentbase/core";
import { redactEvent } from "./jsonl-trace-store";

export type TraceExportFormat = "jsonl" | "otel" | "openinference" | "langfuse" | "phoenix";

export type TraceExportPayload =
  | string
  | {
      schema: string;
      format: Exclude<TraceExportFormat, "jsonl">;
      exportedAt: string;
      runIds: string[];
      data: unknown;
    };

export function serializeTraceExport(events: RuntimeEvent[], format: TraceExportFormat = "jsonl"): string {
  const redacted = events.map(redactEvent).sort((left, right) => left.ts.localeCompare(right.ts));
  if (format === "jsonl") {
    return `${redacted.map((event) => JSON.stringify(event)).join("\n")}\n`;
  }
  return `${JSON.stringify(createTraceExport(redacted, format), null, 2)}\n`;
}

export function createTraceExport(events: RuntimeEvent[], format: Exclude<TraceExportFormat, "jsonl">): TraceExportPayload {
  const redacted = events.map(redactEvent).sort((left, right) => left.ts.localeCompare(right.ts));
  const runIds = [...new Set(redacted.map((event) => event.runId))];
  const exportedAt = new Date().toISOString();

  if (format === "otel") {
    return {
      schema: "agentbase.trace.export.v1",
      format,
      exportedAt,
      runIds,
      data: {
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: "agentbase" } },
                { key: "telemetry.sdk.name", value: { stringValue: "agentbase-local" } }
              ]
            },
            scopeSpans: [
              {
                scope: { name: "agentbase.runtime", version: "0.1.0" },
                spans: redacted.map(eventToOtelSpan)
              }
            ]
          }
        ]
      }
    };
  }

  if (format === "openinference" || format === "phoenix") {
    return {
      schema: "agentbase.trace.export.v1",
      format,
      exportedAt,
      runIds,
      data: {
        spans: redacted.map((event) => ({
          context: {
            trace_id: traceIdForRun(event.runId),
            span_id: spanIdForEvent(event.id)
          },
          name: event.type,
          start_time: event.ts,
          end_time: event.ts,
          span_kind: spanKind(event.type),
          attributes: {
            "agentbase.run_id": event.runId,
            "agentbase.event_id": event.id,
            "agentbase.event_type": event.type,
            ...flattenAttributes(event.data, "agentbase.data")
          }
        }))
      }
    };
  }

  return {
    schema: "agentbase.trace.export.v1",
    format,
    exportedAt,
    runIds,
    data: {
      traces: groupByRun(redacted).map(([runId, runEvents]) => ({
        id: runId,
        name: String(runEvents.find((event) => event.type === "run.started")?.data.agent ?? "agentbase-run"),
        timestamp: runEvents[0]?.ts,
        metadata: {
          runId,
          status: terminalStatus(runEvents),
          eventCount: runEvents.length
        },
        observations: runEvents.map((event) => ({
          id: event.id,
          traceId: runId,
          type: langfuseObservationType(event.type),
          name: event.type,
          startTime: event.ts,
          endTime: event.ts,
          metadata: event.data
        }))
      }))
    }
  };
}

function eventToOtelSpan(event: RuntimeEvent): Record<string, unknown> {
  return {
    traceId: traceIdForRun(event.runId),
    spanId: spanIdForEvent(event.id),
    name: event.type,
    kind: spanKind(event.type),
    startTimeUnixNano: dateToUnixNano(event.ts),
    endTimeUnixNano: dateToUnixNano(event.ts),
    attributes: [
      { key: "agentbase.run_id", value: { stringValue: event.runId } },
      { key: "agentbase.event_id", value: { stringValue: event.id } },
      { key: "agentbase.event_type", value: { stringValue: event.type } },
      ...Object.entries(flattenAttributes(event.data, "agentbase.data")).map(([key, value]) => ({
        key,
        value: otelValue(value)
      }))
    ]
  };
}

function flattenAttributes(value: unknown, prefix: string): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { [prefix]: primitiveAttribute(value) };
  }
  const entries: Record<string, string | number | boolean> = {};
  for (const [key, child] of Object.entries(value)) {
    const attributeKey = `${prefix}.${key}`;
    if (child && typeof child === "object") {
      entries[attributeKey] = JSON.stringify(child);
    } else {
      entries[attributeKey] = primitiveAttribute(child);
    }
  }
  return entries;
}

function primitiveAttribute(value: unknown): string | number | boolean {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  return JSON.stringify(value);
}

function otelValue(value: string | number | boolean): Record<string, unknown> {
  if (typeof value === "number") return { doubleValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  return { stringValue: value };
}

function groupByRun(events: RuntimeEvent[]): Array<[string, RuntimeEvent[]]> {
  const groups = new Map<string, RuntimeEvent[]>();
  for (const event of events) {
    groups.set(event.runId, [...(groups.get(event.runId) ?? []), event]);
  }
  return [...groups.entries()];
}

function terminalStatus(events: RuntimeEvent[]): string {
  const terminal = [...events].reverse().find((event) => event.type.startsWith("run.") && event.type !== "run.started");
  return terminal?.type.replace("run.", "") ?? "running";
}

function langfuseObservationType(type: string): string {
  if (type.startsWith("model.")) return "GENERATION";
  if (type.startsWith("tool.")) return "SPAN";
  if (type.startsWith("workflow.")) return "SPAN";
  return "EVENT";
}

function spanKind(type: string): string {
  if (type.startsWith("model.")) return "LLM";
  if (type.startsWith("tool.")) return "TOOL";
  if (type.startsWith("workflow.")) return "CHAIN";
  return "INTERNAL";
}

function traceIdForRun(runId: string): string {
  return fixedHex(runId, 32);
}

function spanIdForEvent(eventId: string): string {
  return fixedHex(eventId, 16);
}

function fixedHex(value: string, length: number): string {
  const encoded = Buffer.from(value).toString("hex");
  return encoded.padEnd(length, "0").slice(0, length);
}

function dateToUnixNano(value: string): string {
  const ms = Date.parse(value);
  return `${Number.isFinite(ms) ? ms : 0}000000`;
}
