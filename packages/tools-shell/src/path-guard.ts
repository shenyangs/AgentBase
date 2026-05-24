import { realpath } from "node:fs/promises";
import path from "node:path";
import { PolicyError } from "@agentbase/core";

export async function resolveShellCwd(workspaceRoot: string, userCwd = "."): Promise<string> {
  const root = await realpath(workspaceRoot);
  const candidate = path.resolve(root, userCwd);
  const actual = await realpath(candidate);
  const relative = path.relative(root, actual);

  if (relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative))) {
    throw new PolicyError(`Shell cwd escapes workspace root: ${userCwd}`);
  }

  return actual;
}
