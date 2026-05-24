import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { MemoryBlock } from "@agentbase/core";
import { JsonMemoryStore } from "@agentbase/memory";

export type WikiPage = {
  id: string;
  title: string;
  path: string;
  summary: string;
  links: string[];
  updatedAt: string;
};

export class RepoWiki {
  readonly workspaceRoot: string;
  readonly dir: string;
  readonly memory?: JsonMemoryStore;

  constructor(options: { workspaceRoot: string; dir: string; memory?: JsonMemoryStore }) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.dir = path.resolve(options.dir);
    this.memory = options.memory;
  }

  async index(): Promise<WikiPage[]> {
    const files: string[] = [];
    await walk(this.workspaceRoot, files);
    const pages: WikiPage[] = [];
    for (const file of files) {
      const relative = normalize(path.relative(this.workspaceRoot, file));
      const content = await readFile(file, "utf8");
      const page: WikiPage = {
        id: relative,
        title: titleFor(relative, content),
        path: relative,
        summary: summarize(relative, content),
        links: extractLinks(content),
        updatedAt: new Date().toISOString()
      };
      pages.push(page);
      if (this.memory) {
        await this.memory.add({ scope: "wiki", text: `${page.title}\n${page.summary}`, kind: "summary", tags: ["wiki", relative], source: relative });
      }
    }
    await mkdir(this.dir, { recursive: true });
    await writeFile(path.join(this.dir, "index.json"), `${JSON.stringify(pages, null, 2)}\n`, "utf8");
    await writeFile(path.join(this.dir, "README.md"), renderMarkdown(pages), "utf8");
    return pages;
  }

  async query(query: string, limit = 10): Promise<WikiPage[]> {
    const pages = await this.readIndex();
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return pages
      .map((page) => ({ page, score: terms.reduce((score, term) => score + (`${page.title} ${page.summary} ${page.path}`.toLowerCase().includes(term) ? 1 : 0), 0) }))
      .filter((hit) => terms.length === 0 || hit.score > 0)
      .sort((a, b) => b.score - a.score || a.page.path.localeCompare(b.page.path))
      .slice(0, limit)
      .map((hit) => hit.page);
  }

  async readIndex(): Promise<WikiPage[]> {
    try {
      return JSON.parse(await readFile(path.join(this.dir, "index.json"), "utf8")) as WikiPage[];
    } catch {
      return [];
    }
  }
}

function renderMarkdown(pages: WikiPage[]): string {
  return [`# AgentBase Wiki`, "", ...pages.map((page) => `## ${page.title}\n\n- Path: \`${page.path}\`\n- Summary: ${page.summary}\n`)].join("\n");
}

async function walk(root: string, files: string[]): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldSkip(entry.name)) {
      continue;
    }
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walk(absolute, files);
    } else if (entry.isFile() && isIndexable(entry.name)) {
      files.push(absolute);
    }
  }
}

function shouldSkip(name: string): boolean {
  return name === "node_modules" || name === ".git" || name === "dist" || name === "coverage" || name === ".agentbase";
}

function isIndexable(name: string): boolean {
  return /\.(md|mdx|txt|ts|tsx|js|jsx|json|yaml|yml)$/i.test(name);
}

function titleFor(relative: string, content: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1];
  return heading ?? relative;
}

function summarize(relative: string, content: string): string {
  const text = content.replace(/\s+/g, " ").trim();
  return `${relative}: ${text.slice(0, 240)}${text.length > 240 ? "..." : ""}`;
}

function extractLinks(content: string): string[] {
  return [...content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]).slice(0, 20);
}

function normalize(value: string): string {
  return value.split(path.sep).join("/");
}

export function wikiPagesToMemory(pages: WikiPage[]): MemoryBlock[] {
  const now = new Date().toISOString();
  return pages.map((page) => ({
    id: `wiki:${page.path}`,
    scope: "wiki",
    text: `${page.title}\n${page.summary}`,
    kind: "summary",
    tags: ["wiki", page.path],
    source: page.path,
    createdAt: now,
    updatedAt: now
  }));
}
