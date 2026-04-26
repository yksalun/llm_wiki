import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildProjectInsights } from "../project-insights";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();

    if (cleanup) {
      await cleanup();
    }
  }
});

describe("buildProjectInsights", () => {
  it("builds graph nodes and edges from markdown links", async () => {
    const projectRoot = await createProject("linked-markdown");
    await writeProjectFile(projectRoot, "README.md", "# Home\n\nSee [Guide](docs/guide.md).\n");
    await writeProjectFile(projectRoot, "docs/guide.md", "# Guide\n");
    await writeProjectFile(projectRoot, "notes.txt", "not markdown [Guide](docs/guide.md)\n");

    const response = await buildProjectInsights(projectRoot);

    expect(response.graph.nodes).toEqual(
      expect.arrayContaining([
        {
          id: "file:README.md",
          label: "README.md",
          kind: "file",
          relativePath: "README.md",
        },
        {
          id: "file:docs/guide.md",
          label: "guide.md",
          kind: "file",
          relativePath: "docs/guide.md",
        },
        {
          id: "file:notes.txt",
          label: "notes.txt",
          kind: "file",
          relativePath: "notes.txt",
        },
      ]),
    );
    expect(response.graph.edges).toEqual([
      {
        id: "edge:README.md:3:docs/guide.md",
        sourceId: "file:README.md",
        targetId: "file:docs/guide.md",
        kind: "links-to",
        label: "Guide",
        sourceLineNumber: 3,
      },
    ]);
    expect(response.summary).toEqual({
      analyzedFiles: 3,
      markdownFiles: 2,
      graphNodes: 3,
      graphEdges: 1,
      findings: response.findings.length,
      researchPrompts: response.researchPrompts.length,
    });
  });

  it("creates a risk finding for broken markdown links without creating an edge", async () => {
    const projectRoot = await createProject("broken-link");
    await writeProjectFile(projectRoot, "README.md", "See [Missing](docs/missing.md).\n");

    const response = await buildProjectInsights(projectRoot);

    expect(response.graph.edges).toEqual([]);
    expect(response.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "risk",
          relativePath: "README.md",
          lineNumber: 1,
        }),
      ]),
    );
    expect(response.findings.find((finding) => finding.severity === "risk")?.message).toContain(
      "docs/missing.md",
    );
    expect(response.researchPrompts.some((prompt) => prompt.question.includes("docs/missing.md"))).toBe(
      true,
    );
  });

  it("creates an unsafe link finding for absolute markdown paths without creating an edge", async () => {
    const projectRoot = await createProject("absolute-link");
    await writeProjectFile(projectRoot, "README.md", "See [Absolute](/abs.md).\n");
    await writeProjectFile(projectRoot, "abs.md", "# Abs\n");

    const response = await buildProjectInsights(projectRoot);

    expect(response.graph.edges).toEqual([]);
    expect(response.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "risk",
          title: "Unsafe markdown link",
          relativePath: "README.md",
          lineNumber: 1,
        }),
      ]),
    );
    expect(response.findings.find((finding) => finding.title === "Unsafe markdown link")?.message).toContain(
      "/abs.md",
    );
  });

  it("ignores external and anchor markdown hrefs without broken link findings", async () => {
    const projectRoot = await createProject("external-links");
    await writeProjectFile(
      projectRoot,
      "README.md",
      [
        "[Http](http://example.com/a.md)",
        "[Https](https://example.com/a.md)",
        "[Upper](HTTPS://example.com/a.md)",
        "[Ftp](ftp://example.com/a.md)",
        "[ProtocolRelative](//example.com/a.md)",
        "[Mail](mailto:test@example.com)",
        "[Anchor](#section)",
      ].join("\n"),
    );

    const response = await buildProjectInsights(projectRoot);

    expect(response.graph.edges).toEqual([]);
    expect(response.findings.filter((finding) => finding.title === "Broken markdown link")).toEqual([]);
    expect(response.findings.filter((finding) => finding.title === "Unsafe markdown link")).toEqual([]);
    expect(response.researchPrompts.filter((prompt) => prompt.id.startsWith("prompt:broken-link:"))).toEqual([]);
  });

  it("deduplicates markdown link edges with the same source line and target", async () => {
    const projectRoot = await createProject("duplicate-edges");
    await writeProjectFile(projectRoot, "README.md", "See [Guide](docs/guide.md) and [Guide again](docs/guide.md).\n");
    await writeProjectFile(projectRoot, "docs/guide.md", "# Guide\n");

    const response = await buildProjectInsights(projectRoot);

    expect(response.graph.edges).toEqual([
      expect.objectContaining({
        id: "edge:README.md:1:docs/guide.md",
        sourceId: "file:README.md",
        targetId: "file:docs/guide.md",
      }),
    ]);
  });

  it("keeps finding and research prompt ids unique for repeated broken links on one line", async () => {
    const projectRoot = await createProject("duplicate-broken-links");
    await writeProjectFile(
      projectRoot,
      "README.md",
      "See [Missing](docs/missing.md), [Missing again](docs/missing.md), [Unsafe](/abs.md), and [Unsafe again](/abs.md).\n",
    );

    const response = await buildProjectInsights(projectRoot);
    const riskFindings = response.findings.filter((finding) => finding.severity === "risk");
    const promptIds = response.researchPrompts.map((prompt) => prompt.id);

    expect(riskFindings.length).toBeGreaterThan(1);
    expect(new Set(riskFindings.map((finding) => finding.id)).size).toBe(riskFindings.length);
    expect(new Set(promptIds).size).toBe(promptIds.length);
  });

  it("limits research prompts to six after link deduplication", async () => {
    const projectRoot = await createProject("prompt-limit");
    await writeProjectFile(
      projectRoot,
      "README.md",
      [
        "[Missing 1](missing-1.md)",
        "[Missing 2](missing-2.md)",
        "[Missing 3](missing-3.md)",
        "[Missing 4](missing-4.md)",
        "[Missing 5](missing-5.md)",
        "[Missing 6](missing-6.md)",
        "[Missing 7](missing-7.md)",
      ].join("\n"),
    );

    const response = await buildProjectInsights(projectRoot);

    expect(response.researchPrompts).toHaveLength(6);
    expect(new Set(response.researchPrompts.map((prompt) => prompt.id)).size).toBe(6);
  });

  it("creates a warning finding and research prompt for orphan wiki pages", async () => {
    const projectRoot = await createProject("orphan-wiki");
    await writeProjectFile(projectRoot, "wiki/index.md", "# Index\n");
    await writeProjectFile(projectRoot, "wiki/orphan.md", "# Orphan\n");

    const response = await buildProjectInsights(projectRoot);

    expect(response.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          relativePath: "wiki/orphan.md",
        }),
      ]),
    );
    expect(response.researchPrompts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceIds: ["file:wiki/orphan.md"],
        }),
      ]),
    );
  });

  it("skips .llm-wiki metadata files at the project root", async () => {
    const projectRoot = await createProject("metadata-skip");
    await writeProjectFile(projectRoot, ".llm-wiki/hidden.md", "[Missing](missing.md)\n");
    await writeProjectFile(projectRoot, "README.md", "# Visible\n");

    const response = await buildProjectInsights(projectRoot);

    expect(response.graph.nodes.map((node) => node.relativePath)).toEqual(["README.md"]);
    expect(response.summary.analyzedFiles).toBe(1);
    expect(response.findings.some((finding) => finding.relativePath === ".llm-wiki/hidden.md")).toBe(
      false,
    );
  });

  it("creates an info finding and research prompt when there are no valid edges", async () => {
    const projectRoot = await createProject("no-edges");
    await writeProjectFile(projectRoot, "README.md", "# Home\n");
    await writeProjectFile(projectRoot, "notes.txt", "plain text\n");

    const response = await buildProjectInsights(projectRoot);

    expect(response.graph.edges).toEqual([]);
    expect(response.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "info",
        }),
      ]),
    );
    expect(response.researchPrompts.length).toBeGreaterThan(0);
    expect(response.researchPrompts.length).toBeLessThanOrEqual(6);
  });
});

async function createProject(name: string): Promise<string> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "llm-wiki-web-insights-"));
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
