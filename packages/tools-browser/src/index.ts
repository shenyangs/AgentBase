import { createId, type BrowserToolConfig, type Tool } from "@agentbase/core";

export type BrowserAdapter = {
  open(url: string): Promise<BrowserSnapshot>;
  snapshot(): Promise<BrowserSnapshot>;
  click(selector: string): Promise<BrowserSnapshot>;
  type(selector: string, text: string): Promise<BrowserSnapshot>;
  select(selector: string, value: string): Promise<BrowserSnapshot>;
  screenshot(options?: { fullPage?: boolean }): Promise<Buffer>;
  extract(selector?: string): Promise<{ text: string; html?: string }>;
  close(): Promise<void>;
};

export type BrowserSnapshot = {
  url: string;
  title?: string;
  text: string;
};

export type BrowserToolsOptions = Partial<BrowserToolConfig> & {
  adapter?: BrowserAdapter;
};

export function createBrowserTools(options: BrowserToolsOptions = {}): Tool[] {
  const config: BrowserToolConfig = {
    mode: options.mode ?? "managed",
    headless: options.headless ?? true,
    cdpUrl: options.cdpUrl,
    allowedDomains: options.allowedDomains,
    deniedDomains: options.deniedDomains
  };
  const adapter = options.adapter ?? createPlaywrightAdapter(config);
  return [
    browserOpenTool(config, adapter),
    browserSnapshotTool(adapter),
    browserClickTool(adapter),
    browserTypeTool(adapter),
    browserSelectTool(adapter),
    browserScreenshotTool(adapter),
    browserExtractTool(adapter),
    browserCloseTool(adapter)
  ];
}

export async function browserDoctor(options: BrowserToolsOptions = {}): Promise<{ ok: boolean; mode: string; error?: string }> {
  try {
    if (!options.adapter) {
      await import("playwright");
    }
    return { ok: true, mode: options.mode ?? "managed" };
  } catch (error) {
    return { ok: false, mode: options.mode ?? "managed", error: error instanceof Error ? error.message : String(error) };
  }
}

function browserOpenTool(config: BrowserToolConfig, adapter: BrowserAdapter): Tool {
  return {
    name: "browser_open",
    description: "Open a URL in the configured browser session.",
    requiredPermissions: ["browser:read"],
    risk: "medium",
    inputSchema: { type: "object", required: ["url"], properties: { url: { type: "string" } } },
    async execute(input) {
      const started = Date.now();
      const { url } = input as { url: string };
      assertAllowedUrl(url, config);
      const snapshot = await adapter.open(url);
      return browserOutput("opened", snapshot, started);
    }
  };
}

function browserSnapshotTool(adapter: BrowserAdapter): Tool {
  return {
    name: "browser_snapshot",
    description: "Capture the current browser page as a text snapshot.",
    requiredPermissions: ["browser:read"],
    risk: "low",
    inputSchema: { type: "object", properties: {} },
    async execute() {
      const started = Date.now();
      return browserOutput("snapshot", await adapter.snapshot(), started);
    }
  };
}

function browserClickTool(adapter: BrowserAdapter): Tool {
  return {
    name: "browser_click",
    description: "Click an element in the browser by selector.",
    requiredPermissions: ["browser:interact"],
    risk: "high",
    inputSchema: { type: "object", required: ["selector"], properties: { selector: { type: "string" } } },
    async execute(input) {
      const started = Date.now();
      const { selector } = input as { selector: string };
      return browserOutput("clicked", await adapter.click(selector), started);
    }
  };
}

function browserTypeTool(adapter: BrowserAdapter): Tool {
  return {
    name: "browser_type",
    description: "Type text into an element in the browser by selector.",
    requiredPermissions: ["browser:interact"],
    risk: "high",
    inputSchema: { type: "object", required: ["selector", "text"], properties: { selector: { type: "string" }, text: { type: "string" } } },
    async execute(input) {
      const started = Date.now();
      const { selector, text } = input as { selector: string; text: string };
      return browserOutput("typed", await adapter.type(selector, text), started);
    }
  };
}

function browserSelectTool(adapter: BrowserAdapter): Tool {
  return {
    name: "browser_select",
    description: "Select an option in the browser by selector.",
    requiredPermissions: ["browser:interact"],
    risk: "high",
    inputSchema: { type: "object", required: ["selector", "value"], properties: { selector: { type: "string" }, value: { type: "string" } } },
    async execute(input) {
      const started = Date.now();
      const { selector, value } = input as { selector: string; value: string };
      return browserOutput("selected", await adapter.select(selector, value), started);
    }
  };
}

function browserScreenshotTool(adapter: BrowserAdapter): Tool {
  return {
    name: "browser_screenshot",
    description: "Capture a browser screenshot as base64.",
    requiredPermissions: ["browser:read"],
    risk: "low",
    inputSchema: { type: "object", properties: { fullPage: { type: "boolean", default: true } } },
    async execute(input) {
      const started = Date.now();
      const { fullPage = true } = input as { fullPage?: boolean };
      const buffer = await adapter.screenshot({ fullPage });
      return { ok: true, output: { summary: "browser screenshot", preview: `${buffer.byteLength} bytes`, base64: buffer.toString("base64") }, metadata: { durationMs: Date.now() - started, truncated: false, bytes: buffer.byteLength } };
    }
  };
}

function browserExtractTool(adapter: BrowserAdapter): Tool {
  return {
    name: "browser_extract",
    description: "Extract text and optional HTML from the current browser page.",
    requiredPermissions: ["browser:read"],
    risk: "low",
    inputSchema: { type: "object", properties: { selector: { type: "string" } } },
    async execute(input) {
      const started = Date.now();
      const result = await adapter.extract((input as { selector?: string }).selector);
      return { ok: true, output: { summary: "browser extract", preview: result.text.slice(0, 4000), ...result }, metadata: { durationMs: Date.now() - started, truncated: false } };
    }
  };
}

function browserCloseTool(adapter: BrowserAdapter): Tool {
  return {
    name: "browser_close",
    description: "Close the current browser session.",
    requiredPermissions: ["browser:read"],
    risk: "low",
    inputSchema: { type: "object", properties: {} },
    async execute() {
      const started = Date.now();
      await adapter.close();
      return { ok: true, output: { summary: "browser closed", preview: "" }, metadata: { durationMs: Date.now() - started, truncated: false } };
    }
  };
}

function browserOutput(action: string, snapshot: BrowserSnapshot, started: number) {
  return {
    ok: true,
    output: {
      summary: `browser ${action}: ${snapshot.url}`,
      preview: snapshot.text.slice(0, 4000),
      ...snapshot
    },
    metadata: { durationMs: Date.now() - started, truncated: snapshot.text.length > 4000, url: snapshot.url }
  };
}

function createPlaywrightAdapter(config: BrowserToolConfig): BrowserAdapter {
  let page: any;
  let browser: any;
  async function ensurePage() {
    if (page) return page;
    const playwright = await import("playwright");
    browser = config.mode === "cdp" ? await playwright.chromium.connectOverCDP(config.cdpUrl ?? "http://127.0.0.1:9222") : await playwright.chromium.launch({ headless: config.headless });
    const context = browser.contexts?.()[0] ?? (await browser.newContext());
    page = context.pages?.()[0] ?? (await context.newPage());
    return page;
  }
  async function snap(): Promise<BrowserSnapshot> {
    const current = await ensurePage();
    const text = await current.locator("body").innerText().catch(async () => stripHtml(await current.content()));
    return { url: current.url(), title: await current.title().catch(() => undefined), text };
  }
  return {
    async open(url) {
      const current = await ensurePage();
      await current.goto(url, { waitUntil: "domcontentloaded" });
      return snap();
    },
    snapshot: snap,
    async click(selector) {
      const current = await ensurePage();
      await current.locator(selector).click();
      return snap();
    },
    async type(selector, text) {
      const current = await ensurePage();
      await current.locator(selector).fill(text);
      return snap();
    },
    async select(selector, value) {
      const current = await ensurePage();
      await current.locator(selector).selectOption(value);
      return snap();
    },
    async screenshot(options) {
      const current = await ensurePage();
      return Buffer.from(await current.screenshot({ fullPage: options?.fullPage ?? true }));
    },
    async extract(selector) {
      const current = await ensurePage();
      if (selector) {
        const locator = current.locator(selector);
        return { text: await locator.innerText(), html: await locator.innerHTML().catch(() => undefined) };
      }
      return { text: await current.locator("body").innerText().catch(async () => stripHtml(await current.content())), html: await current.content() };
    },
    async close() {
      page = undefined;
      await browser?.close();
      browser = undefined;
    }
  };
}

function assertAllowedUrl(value: string, config: BrowserToolConfig): void {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "file:") {
    throw new Error(`Unsupported browser URL protocol: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  if (host && config.deniedDomains?.some((domain) => matchesDomain(host, domain))) {
    throw new Error(`Domain is denied by policy: ${host}`);
  }
  if (host && config.allowedDomains && !config.allowedDomains.some((domain) => matchesDomain(host, domain))) {
    throw new Error(`Domain is not allowlisted: ${host}`);
  }
}

function matchesDomain(host: string, domain: string): boolean {
  const normalized = domain.toLowerCase();
  return host === normalized || host.endsWith(`.${normalized}`);
}

function stripHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
