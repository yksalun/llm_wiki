// @vitest-environment jsdom

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
  sections: ["Overview", "Ask", "Insights", "Files"],
  rootPathHint: null,
  access: {
    mode: "read-write",
    canRead: true,
    canWrite: true,
  },
  runtime: {
    activeEngine: "node",
    bridgeStatus: "not-configured",
    heavyTasks: [
      { task: "project-search", engine: "node", bridgeStatus: "not-configured" },
      { task: "project-insights", engine: "node", bridgeStatus: "not-configured" },
    ],
  },
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
  it("renders project metadata summary", () => {
    const html = renderToStaticMarkup(<ProjectOverview project={project} tree={tree} />);

    expect(html).toContain("项目信息");
    expect(html).toContain("项目名称");
    expect(html).toContain("Project Alpha");
    expect(html).toContain("项目编号");
    expect(html).toContain("project-alpha");
    expect(html).toContain("访问模式");
    expect(html).toContain("可读写");
    expect(html).toContain("写入权限");
    expect(html).toContain("是");
    expect(html).toContain("桥接状态");
    expect(html).toContain("未配置");
    expect(html).toContain("文件树条目");
  });
});
