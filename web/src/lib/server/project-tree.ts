import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";

import type { FileTreeNode } from "@/lib/types";

export async function listProjectTree(projectRoot: string): Promise<FileTreeNode[]> {
  const rootDir = path.resolve(projectRoot);

  return readDirectoryNodes(rootDir, "");
}

async function readDirectoryNodes(rootDir: string, relativeDir: string): Promise<FileTreeNode[]> {
  const directoryPath = relativeDir === "" ? rootDir : path.join(rootDir, relativeDir);
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const visibleEntries = entries.filter((entry) => !(relativeDir === "" && entry.name === ".llm-wiki"));

  visibleEntries.sort(compareEntries);

  return Promise.all(
    visibleEntries.map(async (entry) => {
      const relativePath = relativeDir === "" ? entry.name : path.posix.join(relativeDir, entry.name);

      if (entry.isDirectory()) {
        return {
          name: entry.name,
          relativePath,
          nodeType: "directory",
          children: await readDirectoryNodes(rootDir, relativePath),
        } satisfies FileTreeNode;
      }

      return {
        name: entry.name,
        relativePath,
        nodeType: "file",
      } satisfies FileTreeNode;
    }),
  );
}

function compareEntries(left: Dirent, right: Dirent): number {
  if (left.isDirectory() && !right.isDirectory()) {
    return -1;
  }

  if (!left.isDirectory() && right.isDirectory()) {
    return 1;
  }

  return left.name.localeCompare(right.name);
}
