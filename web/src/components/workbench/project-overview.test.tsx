import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FileTreeNode, ProjectDetail } from "@/lib/types";

import { ProjectOverview } from "./project-overview";

const project: ProjectDetail = {
  id: "project-alpha",
  name: "Project Alpha",
  status: "ready",
  hasPurpose: true,
  hasSchema: true,
  hasWikiDirectory: true,
  hasRawSourcesDirectory: false,
  updatedAt: "2026-04-26T00:00:00.000Z",
  sections: ["Overview", "Files", "Purpose", "Schema", "Project Info"],
  rootPathHint: null,
};

const tree: FileTreeNode[] = [
  {
    name: "wiki",
    relativePath: "wiki",
    nodeType: "directory",
    children: [
      {
        name: "intro",
        relativePath: "wiki/intro.md",
        nodeType: "file",
      },
      {
        name: "data.json",
        relativePath: "wiki/data.json",
        nodeType: "file",
      },
      {
        name: "brief.pdf",
        relativePath: "wiki/brief.pdf",
        nodeType: "file",
      },
    ],
  },
];

describe("ProjectOverview", () => {
  it("renders reading structure metrics and a wiki entry point", () => {
    const html = renderToStaticMarkup(
      <ProjectOverview project={project} tree={tree} onChangeSection={() => undefined} />,
    );

    expect(html).toContain("Markdown files");
    expect(html).toContain("Preview files");
    expect(html).toContain("Metadata files");
    expect(html).toContain("Start with wiki");
    expect(html).toMatch(/Markdown files<\/p><p class="[^"]*">1<\/p>/);
  });
});
