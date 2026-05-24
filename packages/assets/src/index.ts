import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

export type SeedAssetEntry = {
  path: string;
  hash: string;
  source: string;
  updatedAt: string;
};

export type SeedAssetManifest = {
  version: 1;
  assets: SeedAssetEntry[];
};

export type SeedAssetWriteResult = {
  path: string;
  action: "created" | "updated" | "preserved" | "overwritten" | "unchanged";
  hash: string;
};

export async function writeSeedAsset(options: {
  workspaceRoot: string;
  relativePath: string;
  content: string;
  source: string;
  force?: boolean;
  manifestPath?: string;
}): Promise<SeedAssetWriteResult> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const relativePath = normalizeRelativePath(options.relativePath);
  const file = path.resolve(workspaceRoot, relativePath);
  assertInsideWorkspace(workspaceRoot, file);

  const manifestPath = path.resolve(workspaceRoot, options.manifestPath ?? ".agentbase/seed-manifest.json");
  assertInsideWorkspace(workspaceRoot, manifestPath);
  const manifest = await readSeedManifest(manifestPath);
  const nextHash = hashContent(options.content);
  const previous = manifest.assets.find((asset) => asset.path === relativePath);
  const existing = await readOptional(file);

  if (existing === undefined) {
    await writeText(file, options.content);
    await upsertManifest(manifestPath, manifest, { path: relativePath, hash: nextHash, source: options.source });
    return { path: relativePath, action: "created", hash: nextHash };
  }

  const currentHash = hashContent(existing);
  if (currentHash === nextHash) {
    await upsertManifest(manifestPath, manifest, { path: relativePath, hash: nextHash, source: options.source });
    return { path: relativePath, action: "unchanged", hash: nextHash };
  }

  if (options.force) {
    await writeText(file, options.content);
    await upsertManifest(manifestPath, manifest, { path: relativePath, hash: nextHash, source: options.source });
    return { path: relativePath, action: "overwritten", hash: nextHash };
  }

  if (previous && previous.hash === currentHash) {
    await writeText(file, options.content);
    await upsertManifest(manifestPath, manifest, { path: relativePath, hash: nextHash, source: options.source });
    return { path: relativePath, action: "updated", hash: nextHash };
  }

  return { path: relativePath, action: "preserved", hash: currentHash };
}

export async function readSeedManifest(file: string): Promise<SeedAssetManifest> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as SeedAssetManifest;
    if (parsed.version === 1 && Array.isArray(parsed.assets)) {
      return parsed;
    }
  } catch {
    // Missing or invalid manifests are treated as empty. Existing user files
    // will still be preserved because they have no matching managed hash.
  }
  return { version: 1, assets: [] };
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function upsertManifest(file: string, manifest: SeedAssetManifest, entry: Omit<SeedAssetEntry, "updatedAt">): Promise<void> {
  const next: SeedAssetManifest = {
    version: 1,
    assets: [
      ...manifest.assets.filter((asset) => asset.path !== entry.path),
      {
        ...entry,
        updatedAt: new Date().toISOString()
      }
    ].sort((left, right) => left.path.localeCompare(right.path))
  };
  await writeText(file, `${JSON.stringify(next, null, 2)}\n`);
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

async function writeText(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..")) {
    throw new Error(`Seed asset path must stay inside the workspace: ${value}`);
  }
  return normalized;
}

function assertInsideWorkspace(workspaceRoot: string, file: string): void {
  const relative = path.relative(workspaceRoot, file);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return;
  }
  throw new Error(`Seed asset path escapes workspace: ${file}`);
}
