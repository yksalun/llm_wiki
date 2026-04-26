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
        name: "data",
        relativePath: "wiki/data.json",
        nodeType: "file",
      },
      {
        name: "brief",
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
    expectMetric(html, "Markdown files", "1");
    expectMetric(html, "Preview files", "1");
    expectMetric(html, "Metadata files", "1");
  });
});

function expectMetric(html: string, label: string, value: string) {
  expect(html).toMatch(new RegExp(`${label}</p><p class="[^"]*">${value}</p>`));
}
