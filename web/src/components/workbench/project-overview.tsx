"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatAccessModeLabel,
  formatHeavyTaskBridgeStatusLabel,
  formatHeavyTaskEngineLabel,
  formatHeavyTaskNameLabel,
  formatProjectStatusLabel,
  formatWorkbenchSectionLabel,
} from "@/lib/display-labels";
import type { FileTreeNode, ProjectDetail, WorkbenchSection } from "@/lib/types";

interface ProjectOverviewProps {
  project: ProjectDetail;
  tree: FileTreeNode[];
}

export function ProjectOverview({ project, tree }: ProjectOverviewProps) {
  const visibleSections = getVisibleWorkbenchSections(project.sections);

  return (
    <Card className="border-[color:var(--paper-border)] bg-[color:var(--paper-panel)]/92 shadow-[0_18px_56px_rgba(var(--shadow-panel),0.08)]">
      <CardHeader className="border-b border-[color:var(--paper-border)]">
        <CardTitle>项目信息</CardTitle>
        <CardDescription>已解析项目路由和文件树组成摘要。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4 md:grid-cols-2 xl:grid-cols-3">
        <InfoBlock label="项目名称" value={project.name} />
        <InfoBlock label="项目编号" value={project.id} mono />
        <InfoBlock label="状态" value={formatProjectStatusLabel(project.status)} />
        <InfoBlock label="访问模式" value={formatAccessModeLabel(project.access.mode)} />
        <InfoBlock label="写入权限" value={project.access.canWrite ? "是" : "否"} />
        <InfoBlock label="重任务运行时" value={formatHeavyTaskEngineLabel(project.runtime.activeEngine)} />
        <InfoBlock label="桥接状态" value={formatHeavyTaskBridgeStatusLabel(project.runtime.bridgeStatus)} />
        <InfoBlock
          label="已跟踪重任务"
          value={project.runtime.heavyTasks.map((task) => formatHeavyTaskNameLabel(task.task)).join("、")}
        />
        <InfoBlock label="目标文件" value={project.hasPurpose ? "已存在" : "缺失"} />
        <InfoBlock label="结构文件" value={project.hasSchema ? "已存在" : "缺失"} />
        <InfoBlock label="知识库目录" value={project.hasWikiDirectory ? "已存在" : "缺失"} />
        <InfoBlock
          label="原始资料目录"
          value={project.hasRawSourcesDirectory ? "已存在" : "缺失"}
        />
        <InfoBlock label="工作区" value={visibleSections.map(formatWorkbenchSectionLabel).join("、")} />
        <InfoBlock label="文件树条目" value={String(collectTreePaths(tree).size)} />
      </CardContent>
    </Card>
  );
}

function InfoBlock({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-[20px] border border-[color:var(--paper-border)] bg-[color:var(--paper-muted)]/55 p-4">
      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className={mono ? "mt-2 font-mono text-sm text-[color:var(--ink-strong)]" : "mt-2 text-sm font-medium text-[color:var(--ink-strong)]"}>
        {value}
      </p>
    </div>
  );
}

function collectTreePaths(nodes: FileTreeNode[]): Set<string> {
  const paths = new Set<string>();

  for (const node of nodes) {
    paths.add(node.relativePath);

    if (node.nodeType === "directory") {
      for (const child of collectTreePaths(node.children ?? [])) {
        paths.add(child);
      }
    }
  }

  return paths;
}

function getVisibleWorkbenchSections(sections: WorkbenchSection[]) {
  const allowed = new Set<WorkbenchSection>(["Overview", "Ask", "Insights", "Files"]);

  return sections.filter((item) => allowed.has(item));
}
