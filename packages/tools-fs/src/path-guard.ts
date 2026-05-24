import { realpathSync } from "node:fs";
import { mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { PolicyError } from "@agentbase/core";

export type ResolveWorkspacePathOptions = {
  mustExist?: boolean;
  forWrite?: boolean;
};

export async function resolveWorkspacePath(workspaceRoot: string, userPath = ".", options: ResolveWorkspacePathOptions = {}): Promise<string> {
  const root = await realpath(workspaceRoot);
  const candidate = path.resolve(root, userPath);
  assertInside(root, candidate);

  if (options.mustExist ?? !options.forWrite) {
    const actual = await realpath(candidate);
    assertInside(root, actual);
    return actual;
  }

  const parent = path.dirname(candidate);
  await mkdir(parent, { recursive: true });
  const realParent = await realpath(parent);
  assertInside(root, realParent);
  return path.join(realParent, path.basename(candidate));
}

export async function pathExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

export function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string {
  return normalizePath(path.relative(realpathSync(workspaceRoot), absolutePath) || ".");
}

export function normalizePath(file: string): string {
  return file.split(path.sep).join("/");
}

function assertInside(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative === "") {
    return;
  }

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PolicyError(`Path escapes workspace root: ${candidate}`);
  }
}
