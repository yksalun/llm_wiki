import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { FILE_VIEW_SIZE_LIMIT_BYTES } from "../file-policy";
import { scanProjectTextFiles } from "../project-text-scan";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.restoreAllMocks();

  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();

    if (cleanup) {
      await cleanup();
    }
  }
});

describe("scanProjectTextFiles", () => {
  it("yields searchable UTF-8 text files in stable path order and skips root llm wiki internals", async () => {
    const projectRoot = await createProject("stable-order");
    await writeProjectFile(projectRoot, "zeta.md", "# Zeta\n");
    await writeProjectFile(projectRoot, "alpha/readme.txt", "Alpha\n");
    await writeProjectFile(projectRoot, "alpha/config.json", '{ "name": "alpha" }\n');
    await writeProjectFile(projectRoot, ".llm-wiki/cache.md", "Hidden\n");
    await writeProjectFile(projectRoot, "nested/.llm-wiki/visible.md", "Nested hidden name only at root\n");

    const scan = scanProjectTextFiles(projectRoot);
    const files = await collectAsync(scan.files);

    expect(files).toEqual([
      {
        relativePath: "alpha/config.json",
        content: '{ "name": "alpha" }\n',
        size: Buffer.byteLength('{ "name": "alpha" }\n'),
        extension: ".json",
      },
      {
        relativePath: "alpha/readme.txt",
        content: "Alpha\n",
        size: Buffer.byteLength("Alpha\n"),
        extension: ".txt",
      },
      {
        relativePath: "nested/.llm-wiki/visible.md",
        content: "Nested hidden name only at root\n",
        size: Buffer.byteLength("Nested hidden name only at root\n"),
        extension: ".md",
      },
      {
        relativePath: "zeta.md",
        content: "# Zeta\n",
        size: Buffer.byteLength("# Zeta\n"),
        extension: ".md",
      },
    ]);
    expect(scan.stats.skippedFiles).toBe(0);
  });

  it("counts unsupported extensions, oversized files, invalid UTF-8, and stat/read failures as skipped files", async () => {
    const projectRoot = await createProject("skipped-files");
    await writeProjectFile(projectRoot, "valid.md", "Valid\n");
    await writeProjectFile(projectRoot, "unsupported.png", "image bytes\n");
    await fs.writeFile(path.join(projectRoot, "big.md"), Buffer.alloc(FILE_VIEW_SIZE_LIMIT_BYTES + 1));
    await fs.writeFile(path.join(projectRoot, "broken.txt"), Buffer.from([0xc3, 0x28]));
    await writeProjectFile(projectRoot, "stat-fails.md", "Stat fails\n");
    await writeProjectFile(projectRoot, "read-fails.md", "Read fails\n");

    vi.spyOn(fs, "stat").mockImplementation(async (filePath) => {
      if (filePath.toString().endsWith("stat-fails.md")) {
        throw new Error("stat failed");
      }

      return await vi.importActual<typeof fs>("node:fs/promises").then((actualFs) =>
        actualFs.stat(filePath),
      );
    });
    vi.spyOn(fs, "open").mockImplementation(async (filePath, flags) => {
      if (filePath.toString().endsWith("read-fails.md")) {
        throw new Error("open failed");
      }

      return await vi.importActual<typeof fs>("node:fs/promises").then((actualFs) =>
        actualFs.open(filePath, flags),
      );
    });

    const scan = scanProjectTextFiles(projectRoot);
    const files = await collectAsync(scan.files);

    expect(files).toEqual([
      {
        relativePath: "valid.md",
        content: "Valid\n",
        size: Buffer.byteLength("Valid\n"),
        extension: ".md",
      },
    ]);
    expect(scan.stats.skippedFiles).toBe(5);
  });

  it("uses a bounded read buffer and closes file handles after reading", async () => {
    const projectRoot = await createProject("bounded-read");
    const relativePath = "bounded.md";
    await writeProjectFile(projectRoot, relativePath, "Bounded\n");
    const content = Buffer.from("Bounded\n", "utf8");
    const read = vi.fn(async (buffer: Buffer) => {
      content.copy(buffer);

      return { bytesRead: content.byteLength, buffer };
    });
    const close = vi.fn(async () => undefined);
    const openSpy = vi.spyOn(fs, "open").mockResolvedValue({
      read,
      close,
    } as unknown as Awaited<ReturnType<typeof fs.open>>);
    const readFileSpy = vi.spyOn(fs, "readFile");

    const scan = scanProjectTextFiles(projectRoot);
    const files = await collectAsync(scan.files);

    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({
      relativePath,
      content: "Bounded\n",
      size: Buffer.byteLength("Bounded\n"),
      extension: ".md",
    });
    expect(openSpy).toHaveBeenCalledWith(path.join(projectRoot, relativePath), "r");
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][0]).toBeInstanceOf(Buffer);
    expect(read.mock.calls[0][0].byteLength).toBe(FILE_VIEW_SIZE_LIMIT_BYTES + 1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(readFileSpy).not.toHaveBeenCalled();
    expect(scan.stats.skippedFiles).toBe(0);
  });
});

async function collectAsync<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const values: T[] = [];

  for await (const value of generator) {
    values.push(value);
  }

  return values;
}

async function createProject(name: string): Promise<string> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "llm-wiki-web-text-scan-"));
  const projectRoot = path.join(tempRoot, name);

  await fs.mkdir(projectRoot, { recursive: true });
  cleanupTasks.push(() => fs.rm(tempRoot, { recursive: true, force: true }));

  return projectRoot;
}

async function writeProjectFile(
  projectRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const filePath = path.join(projectRoot, relativePath);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}
