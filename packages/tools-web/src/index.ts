import type { Tool } from "@agentbase/core";

export type SearchResult = {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
  source?: string;
};

export type SearchProvider = {
  name: string;
  search(query: string, options?: { maxResults?: number }): Promise<SearchResult[]>;
};

export type WebToolsOptions = {
  searchProvider?: SearchProvider;
  allowedDomains?: string[];
  deniedDomains?: string[];
  fetch?: typeof fetch;
};

export function createWebTools(options: WebToolsOptions = {}): Tool[] {
  return [fetchUrlTool(options), webSearchTool(options.searchProvider ?? createStaticSearchProvider([]))];
}

export function createStaticSearchProvider(results: SearchResult[], name = "static"): SearchProvider {
  return {
    name,
    async search(query, options) {
      const normalized = query.toLowerCase();
      return results
        .filter((result) => `${result.title} ${result.snippet ?? ""} ${result.url}`.toLowerCase().includes(normalized))
        .slice(0, options?.maxResults ?? 10);
    }
  };
}

export function createHttpSearchProvider(options: {
  endpoint: string;
  apiKey?: string;
  apiKeyEnv?: string;
  name?: string;
  fetch?: typeof fetch;
}): SearchProvider {
  const fetchImpl = options.fetch ?? fetch;
  return {
    name: options.name ?? "http-search",
    async search(query, searchOptions) {
      const apiKey = options.apiKey ?? (options.apiKeyEnv ? process.env[options.apiKeyEnv] : undefined);
      const response = await fetchImpl(options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify({ query, maxResults: searchOptions?.maxResults ?? 10 })
      });

      if (!response.ok) {
        throw new Error(`Search provider failed: ${response.status} ${await response.text()}`);
      }

      const json = (await response.json()) as unknown;
      return normalizeSearchResults(json).slice(0, searchOptions?.maxResults ?? 10);
    }
  };
}

function fetchUrlTool(options: WebToolsOptions): Tool {
  const fetchImpl = options.fetch ?? fetch;
  return {
    name: "fetch_url",
    description: "Fetch a URL and return status, content type, and a text preview.",
    requiredPermissions: ["network:fetch"],
    risk: "medium",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string" },
        maxBytes: { type: "integer", default: 60000 }
      }
    },
    async execute(input) {
      const { url, maxBytes = 60_000 } = input as { url: string; maxBytes?: number };
      assertAllowedUrl(url, options);
      const response = await fetchImpl(url);
      const contentType = response.headers.get("content-type") ?? "";
      const buffer = Buffer.from(await response.arrayBuffer());
      const truncated = buffer.byteLength > maxBytes;
      return {
        ok: true,
        output: {
          url,
          status: response.status,
          contentType,
          text: buffer.subarray(0, maxBytes).toString("utf8"),
          bytes: buffer.byteLength,
          truncated
        },
        metadata: { url, status: response.status, contentType, bytes: buffer.byteLength, truncated }
      };
    }
  };
}

function webSearchTool(searchProvider: SearchProvider): Tool {
  return {
    name: "web_search",
    description: "Search the web through a configured SearchProvider.",
    requiredPermissions: ["network:fetch"],
    risk: "medium",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        maxResults: { type: "integer", default: 10 }
      }
    },
    async execute(input) {
      const { query, maxResults = 10 } = input as { query: string; maxResults?: number };
      const results = await searchProvider.search(query, { maxResults });
      return {
        ok: true,
        output: { query, provider: searchProvider.name, results, truncated: results.length >= maxResults },
        metadata: { provider: searchProvider.name, resultCount: results.length }
      };
    }
  };
}

function assertAllowedUrl(value: string, options: WebToolsOptions): void {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol: ${url.protocol}`);
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

function normalizeSearchResults(value: unknown): SearchResult[] {
  const raw = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.results) ? value.results : [];
  return raw.flatMap((item): SearchResult[] => {
    if (!isRecord(item) || typeof item.url !== "string") {
      return [];
    }
    return [
      {
        title: typeof item.title === "string" ? item.title : item.url,
        url: item.url,
        snippet: typeof item.snippet === "string" ? item.snippet : undefined,
        publishedAt: typeof item.publishedAt === "string" ? item.publishedAt : undefined,
        source: typeof item.source === "string" ? item.source : undefined
      }
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
