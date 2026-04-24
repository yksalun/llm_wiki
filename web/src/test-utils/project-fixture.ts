import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface FixtureProject {
  rootDir: string;
  cleanup: () => Promise<void>;
}

export async function createFixtureProject(name = "demo-project"): Promise<FixtureProject> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "llm-wiki-web-"));
  const rootDir = path.join(tempRoot, name);

  await fs.mkdir(path.join(rootDir, "wiki"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "raw", "sources"), { recursive: true });
  await fs.writeFile(path.join(rootDir, "purpose.md"), "# Purpose\n\nDemo project.\n", "utf8");
  await fs.writeFile(path.join(rootDir, "schema.md"), "# Schema\n\n- Entity\n", "utf8");
  await fs.writeFile(path.join(rootDir, "wiki", "index.md"), "# Wiki Home\n", "utf8");
  await fs.writeFile(path.join(rootDir, "raw", "sources", "demo.pdf"), "fake-pdf", "utf8");

  return {
    rootDir,
    cleanup: () => fs.rm(tempRoot, { recursive: true, force: true }),
  };
}
