import { createId, type ArtifactStore, type HttpToolConfig, type Tool } from "@agentbase/core";

export type HttpToolsOptions = HttpToolConfig & {
  artifactStore?: ArtifactStore;
  fetch?: typeof fetch;
};

export function createHttpTools(options: HttpToolsOptions = {}): Tool[] {
  return [httpRequestTool(options)];
}

function httpRequestTool(options: HttpToolsOptions): Tool {
  const fetchImpl = options.fetch ?? fetch;
  return {
    name: "http_request",
    description: "Send an HTTP request with domain policy, timeout, output limits, redaction, and artifact-backed response bodies.",
    requiredPermissions: ["network:http"],
    risk: "medium",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string" },
        method: { type: "string", default: "GET" },
        headers: { type: "object", additionalProperties: true },
        body: { type: "string" },
        timeoutMs: { type: "integer", default: options.timeoutMs ?? 30000 },
        maxBytes: { type: "integer", default: options.maxBytes ?? 60000 }
      }
    },
    async execute(input, ctx) {
      const started = Date.now();
      const request = input as { url: string; method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number; maxBytes?: number };
      assertAllowedUrl(request.url, options);
      const method = (request.method ?? "GET").toUpperCase();
      const timeoutMs = request.timeoutMs ?? options.timeoutMs ?? 30_000;
      const maxBytes = request.maxBytes ?? options.maxBytes ?? 60_000;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error(`HTTP request timed out after ${timeoutMs}ms`)), timeoutMs);
      const parentAbort = () => controller.abort(ctx.signal.reason);
      ctx.signal.addEventListener("abort", parentAbort, { once: true });
      try {
        const response = await fetchImpl(request.url, {
          method,
          headers: request.headers,
          body: method === "GET" || method === "HEAD" ? undefined : request.body,
          signal: controller.signal
        });
        const contentType = response.headers.get("content-type") ?? "";
        const buffer = Buffer.from(await response.arrayBuffer());
        const text = buffer.toString("utf8");
        const truncated = buffer.byteLength > maxBytes;
        const preview = text.slice(0, maxBytes);
        const ref = `http-response://${ctx.runId}/${createId("http")}`;
        const artifacts = options.artifactStore
          ? [
              {
                id: ref,
                kind: "http_response",
                uri: ref,
                summary: `${method} ${request.url} -> ${response.status}`,
                metadata: { url: request.url, status: response.status, contentType, bytes: buffer.byteLength }
              }
            ]
          : [];
        if (options.artifactStore) {
          await options.artifactStore.put({
            ref,
            kind: "http_response",
            runId: ctx.runId,
            content: { url: request.url, status: response.status, headers: headersToObject(response.headers), text },
            summary: `${method} ${request.url} -> ${response.status}`,
            preview,
            metadata: { method, url: request.url, status: response.status, contentType, bytes: buffer.byteLength }
          });
        }
        return {
          ok: true,
          output: {
            summary: `${method} ${request.url} -> ${response.status}`,
            preview,
            status: response.status,
            contentType,
            bytes: buffer.byteLength,
            truncated,
            headers: redactHeaders(headersToObject(response.headers)),
            artifactRef: options.artifactStore ? ref : undefined
          },
          artifacts,
          metadata: { durationMs: Date.now() - started, truncated, url: request.url, method, status: response.status }
        };
      } finally {
        clearTimeout(timeout);
        ctx.signal.removeEventListener("abort", parentAbort);
      }
    }
  };
}

function assertAllowedUrl(value: string, options: HttpToolConfig): void {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported HTTP protocol: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  if (options.deniedDomains?.some((domain) => matchesDomain(host, domain))) {
    throw new Error(`Domain is denied by policy: ${host}`);
  }
  if (options.allowedDomains && !options.allowedDomains.some((domain) => matchesDomain(host, domain))) {
    throw new Error(`Domain is not allowlisted: ${host}`);
  }
}

function matchesDomain(host: string, domain: string): boolean {
  const normalized = domain.toLowerCase();
  return host === normalized || host.endsWith(`.${normalized}`);
}

function headersToObject(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, isSecretHeader(key) ? "[REDACTED]" : value]));
}

function isSecretHeader(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === "authorization" || normalized === "cookie" || normalized === "set-cookie" || normalized.includes("api-key") || normalized.includes("token");
}
