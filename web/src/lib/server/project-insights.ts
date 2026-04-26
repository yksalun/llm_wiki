import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import { isMarkdownFileExtension } from "@/lib/file-view-policy";
import type {
  ProjectInsightEdge,
  ProjectInsightFinding,
  ProjectInsightNode,
  ProjectInsightResearchPrompt,
  ProjectInsightsResponse,
} from "@/lib/types";

import { scanProjectTextFiles } from "./project-text-scan";

const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;
const MAX_RESEARCH_PROMPTS = 6;

interface AnalyzedFile {
  relativePath: string;
  content: string;
  isMarkdown: boolean;
}

interface BrokenLink {
  sourcePath: string;
  targetPath: string;
  lineNumber: number;
  linkText: string;
  idTarget: string;
}

interface OrphanPage {
  relativePath: string;
}

export async function buildProjectInsights(
  projectRoot: string,
): Promise<ProjectInsightsResponse> {
  const rootDir = path.resolve(projectRoot);
  const analyzedFiles: AnalyzedFile[] = [];
  const scan = scanProjectTextFiles(rootDir);

  for await (const file of scan.files) {
    analyzedFiles.push({
      relativePath: file.relativePath,
      content: file.content,
      isMarkdown: isMarkdownFileExtension(file.extension),
    });
  }

  const targetPaths = new Set(analyzedFiles.map((file) => file.relativePath));
  const nodes = analyzedFiles.map((file) => createNode(file.relativePath));
  const edges: ProjectInsightEdge[] = [];
  const findings: ProjectInsightFinding[] = [];
  const incomingMarkdownLinkCounts = new Map<string, number>();
  const brokenLinks: BrokenLink[] = [];
  const edgeIds = new Set<string>();
  const findingIds = new Set<string>();
  const brokenLinkIds = new Set<string>();

  for (const file of analyzedFiles) {
    if (!file.isMarkdown) {
      continue;
    }

    for (const link of parseMarkdownLinks(file.relativePath, file.content)) {
      if (shouldIgnoreHref(link.href)) {
        continue;
      }

      const targetPath = resolveMarkdownTarget(file.relativePath, link.href);

      if (
        targetPath === null ||
        targetPath.startsWith("..") ||
        path.posix.isAbsolute(targetPath) ||
        isWindowsAbsoluteHref(targetPath)
      ) {
        addFindingOnce(
          findings,
          findingIds,
          createFinding(
            "risk",
            "Unsafe markdown link",
            `Markdown link "${link.href}" points outside the project and was not linked.`,
            file.relativePath,
            link.lineNumber,
            link.href,
          ),
        );
        addBrokenLinkOnce(brokenLinks, brokenLinkIds, {
          sourcePath: file.relativePath,
          targetPath: link.href,
          lineNumber: link.lineNumber,
          linkText: link.text,
          idTarget: link.href,
        });
        continue;
      }

      if (!targetPaths.has(targetPath)) {
        if (await projectPathExists(rootDir, targetPath)) {
          continue;
        }

        addFindingOnce(
          findings,
          findingIds,
          createFinding(
            "risk",
            "Broken markdown link",
            `Markdown link "${link.href}" resolves to missing file "${targetPath}".`,
            file.relativePath,
            link.lineNumber,
            targetPath,
          ),
        );
        addBrokenLinkOnce(brokenLinks, brokenLinkIds, {
          sourcePath: file.relativePath,
          targetPath,
          lineNumber: link.lineNumber,
          linkText: link.text,
          idTarget: targetPath,
        });
        continue;
      }

      const edgeId = `edge:${file.relativePath}:${link.lineNumber}:${targetPath}`;

      if (edgeIds.has(edgeId)) {
        continue;
      }

      edgeIds.add(edgeId);
      edges.push({
        id: edgeId,
        sourceId: `file:${file.relativePath}`,
        targetId: `file:${targetPath}`,
        kind: "links-to",
        label: link.text.trim() || "links to",
        sourceLineNumber: link.lineNumber,
      });
      incomingMarkdownLinkCounts.set(targetPath, (incomingMarkdownLinkCounts.get(targetPath) ?? 0) + 1);
    }
  }

  const orphans = findWikiOrphans(analyzedFiles, incomingMarkdownLinkCounts);

  for (const orphan of orphans) {
    findings.push(
      createFinding(
        "warning",
        "Orphan wiki page",
        "Wiki markdown page has no incoming markdown links.",
        orphan.relativePath,
      ),
    );
  }

  if (edges.length === 0) {
    findings.push(
      createFinding(
        "info",
        "No project relationships found",
        "No valid markdown links were found between analyzed project files.",
      ),
    );
  }

  const researchPrompts = buildResearchPrompts(brokenLinks, orphans, edges.length === 0);

  return {
    summary: {
      analyzedFiles: analyzedFiles.length,
      markdownFiles: analyzedFiles.filter((file) => file.isMarkdown).length,
      graphNodes: nodes.length,
      graphEdges: edges.length,
      findings: findings.length,
      researchPrompts: researchPrompts.length,
    },
    graph: {
      nodes,
      edges,
    },
    findings,
    researchPrompts,
  };
}

function createNode(relativePath: string): ProjectInsightNode {
  return {
    id: `file:${relativePath}`,
    label: path.posix.basename(relativePath),
    kind: "file",
    relativePath,
  };
}

function parseMarkdownLinks(
  relativePath: string,
  content: string,
): Array<{ text: string; href: string; lineNumber: number }> {
  const links: Array<{ text: string; href: string; lineNumber: number }> = [];

  for (const match of content.matchAll(MARKDOWN_LINK_PATTERN)) {
    if (match.index !== undefined && content[match.index - 1] === "!") {
      continue;
    }

    links.push({
      text: match[1] ?? "",
      href: match[2] ?? "",
      lineNumber: getLineNumber(content, match.index ?? 0),
    });
  }

  return links.map((link) => ({
    ...link,
    href: link.href.trim(),
  }));
}

function getLineNumber(content: string, index: number): number {
  let lineNumber = 1;

  for (let cursor = 0; cursor < index; cursor += 1) {
    if (content[cursor] === "\n") {
      lineNumber += 1;
    }
  }

  return lineNumber;
}

function shouldIgnoreHref(href: string): boolean {
  if (isWindowsAbsoluteHref(href)) {
    return false;
  }

  return (
    href.startsWith("#") ||
    href.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(href)
  );
}

function resolveMarkdownTarget(sourcePath: string, href: string): string | null {
  const hrefWithoutHash = normalizeMarkdownHrefPath(stripHashAndQuery(href));

  if (hrefWithoutHash.length === 0) {
    return null;
  }

  if (path.posix.isAbsolute(hrefWithoutHash) || isWindowsAbsoluteHref(hrefWithoutHash)) {
    return hrefWithoutHash;
  }

  return path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), hrefWithoutHash));
}

function isWindowsAbsoluteHref(href: string): boolean {
  return /^[a-z]:[\\/]/i.test(href);
}

function normalizeMarkdownHrefPath(href: string): string {
  if (isWindowsAbsoluteHref(href)) {
    return href;
  }

  return href.replace(/\\/g, "/");
}

function stripHashAndQuery(href: string): string {
  const hashIndex = href.indexOf("#");
  const queryIndex = href.indexOf("?");
  const indexes = [hashIndex, queryIndex].filter((index) => index >= 0);
  const endIndex = indexes.length > 0 ? Math.min(...indexes) : href.length;

  return href.slice(0, endIndex);
}

async function projectPathExists(rootDir: string, targetPath: string): Promise<boolean> {
  if (
    targetPath.length === 0 ||
    targetPath.startsWith("..") ||
    path.posix.isAbsolute(targetPath) ||
    isWindowsAbsoluteHref(targetPath)
  ) {
    return false;
  }

  const normalizedTargetPath = path.posix.normalize(targetPath);

  if (normalizedTargetPath.startsWith("..") || path.posix.isAbsolute(normalizedTargetPath)) {
    return false;
  }

  const absolutePath = path.resolve(rootDir, ...normalizedTargetPath.split("/"));
  const relativeFromRoot = path.relative(rootDir, absolutePath);

  if (
    relativeFromRoot.length === 0 ||
    relativeFromRoot.startsWith("..") ||
    path.isAbsolute(relativeFromRoot)
  ) {
    return false;
  }

  try {
    const stats = await fs.stat(absolutePath);

    return stats.isFile();
  } catch {
    return false;
  }
}

function createFinding(
  severity: ProjectInsightFinding["severity"],
  title: string,
  message: string,
  relativePath?: string,
  lineNumber?: number,
  identity?: string,
): ProjectInsightFinding {
  const location = relativePath ? `${relativePath}:${lineNumber ?? 0}` : "project";
  const identitySuffix = identity ? `:${createIdSegment(identity)}` : "";

  return {
    id: `finding:${severity}:${slugify(title)}:${location}${identitySuffix}`,
    severity,
    title,
    message,
    ...(relativePath ? { relativePath } : {}),
    ...(lineNumber ? { lineNumber } : {}),
  };
}

function addFindingOnce(
  findings: ProjectInsightFinding[],
  findingIds: Set<string>,
  finding: ProjectInsightFinding,
): void {
  if (findingIds.has(finding.id)) {
    return;
  }

  findingIds.add(finding.id);
  findings.push(finding);
}

function addBrokenLinkOnce(
  brokenLinks: BrokenLink[],
  brokenLinkIds: Set<string>,
  brokenLink: BrokenLink,
): void {
  const id = `${brokenLink.sourcePath}:${brokenLink.lineNumber}:${brokenLink.idTarget}`;

  if (brokenLinkIds.has(id)) {
    return;
  }

  brokenLinkIds.add(id);
  brokenLinks.push(brokenLink);
}

function findWikiOrphans(
  analyzedFiles: AnalyzedFile[],
  incomingMarkdownLinkCounts: Map<string, number>,
): OrphanPage[] {
  return analyzedFiles
    .filter(
      (file) =>
        file.isMarkdown &&
        file.relativePath.startsWith("wiki/") &&
        file.relativePath !== "wiki/index.md" &&
        !incomingMarkdownLinkCounts.has(file.relativePath),
    )
    .map((file) => ({ relativePath: file.relativePath }));
}

function buildResearchPrompts(
  brokenLinks: BrokenLink[],
  orphans: OrphanPage[],
  hasNoEdges: boolean,
): ProjectInsightResearchPrompt[] {
  const prompts: ProjectInsightResearchPrompt[] = [];

  for (const brokenLink of brokenLinks) {
    prompts.push({
      id: `prompt:broken-link:${brokenLink.sourcePath}:${brokenLink.lineNumber}:${createIdSegment(brokenLink.idTarget)}`,
      title: "Resolve broken project link",
      question: `What should "${brokenLink.linkText || brokenLink.targetPath}" in ${brokenLink.sourcePath} link to instead of ${brokenLink.targetPath}?`,
      reason: "Broken markdown links make the project graph incomplete.",
      sourceIds: [`file:${brokenLink.sourcePath}`],
    });
  }

  for (const orphan of orphans) {
    prompts.push({
      id: `prompt:orphan:${orphan.relativePath}`,
      title: "Connect orphan wiki page",
      question: `Which wiki or project page should link to ${orphan.relativePath}?`,
      reason: "Orphan wiki pages are harder to discover during research.",
      sourceIds: [`file:${orphan.relativePath}`],
    });
  }

  if (hasNoEdges) {
    prompts.push({
      id: "prompt:no-relationships",
      title: "Map project relationships",
      question: "Which markdown files should link to each other to explain the project structure?",
      reason: "No valid relationships were found in markdown links.",
      sourceIds: [],
    });
  }

  return prompts.slice(0, MAX_RESEARCH_PROMPTS);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function createIdSegment(value: string): string {
  const normalized = value.trim() || "link";

  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}
