import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";
import { TextDecoder } from "node:util";

import { getFileExtension, isSearchableTextFileExtension } from "@/lib/file-view-policy";
import type { ProjectSearchResponse, ProjectSearchResult } from "@/lib/types";

import { FILE_VIEW_SIZE_LIMIT_BYTES } from "./file-policy";

export const MAX_PROJECT_SEARCH_RESULTS = 50;

const MAX_MATCHES_PER_FILE = 5;
const PREVIEW_RADIUS = 48;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export async function searchProjectFiles(
  projectRoot: string,
  query: string,
): Promise<ProjectSearchResponse> {
  const trimmedQuery = query.trim();

  if (trimmedQuery.length < 2) {
    return emptySearchResponse(trimmedQuery);
  }

  const rootDir = path.resolve(projectRoot);
  const searchResults: ProjectSearchResult[] = [];
  const lowerQuery = trimmedQuery.toLowerCase();
  let scannedFiles = 0;
  let skippedFiles = 0;
  let matchedFiles = 0;
  let totalMatches = 0;
  let truncatedByPerFileCap = false;

  for await (const relativePath of walkProjectFiles(rootDir, "")) {
    const extension = getFileExtension(relativePath);

    if (!isSearchableTextFileExtension(extension)) {
      skippedFiles += 1;
      continue;
    }

    const absolutePath = path.join(rootDir, relativePath);
    const stats = await safeStatFile(absolutePath);

    if (!stats || stats.size > FILE_VIEW_SIZE_LIMIT_BYTES) {
      skippedFiles += 1;
      continue;
    }

    const content = await safeReadUtf8(absolutePath);

    if (content === null) {
      skippedFiles += 1;
      continue;
    }

    scannedFiles += 1;

    const fileSearchResult = findLineMatches(relativePath, content, trimmedQuery, lowerQuery);

    if (fileSearchResult.totalMatches > 0) {
      matchedFiles += 1;
      totalMatches += fileSearchResult.totalMatches;
      truncatedByPerFileCap ||= fileSearchResult.truncated;
      searchResults.push(...fileSearchResult.results);
    }
  }

  const sortedResults = searchResults.sort((left, right) =>
    compareSearchResults(left, right, lowerQuery),
  );
  const truncated =
    truncatedByPerFileCap || sortedResults.length > MAX_PROJECT_SEARCH_RESULTS;

  return {
    query: trimmedQuery,
    results: sortedResults.slice(0, MAX_PROJECT_SEARCH_RESULTS),
    summary: {
      scannedFiles,
      skippedFiles,
      matchedFiles,
      totalMatches,
      truncated,
    },
  };
}

async function* walkProjectFiles(
  rootDir: string,
  relativeDir: string,
): AsyncGenerator<string> {
  const directoryPath = relativeDir === "" ? rootDir : path.join(rootDir, relativeDir);
  let entries: Dirent[];

  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (relativeDir === "" && entry.name === ".llm-wiki") {
      continue;
    }

    const relativePath = relativeDir === "" ? entry.name : path.posix.join(relativeDir, entry.name);

    if (entry.isDirectory()) {
      yield* walkProjectFiles(rootDir, relativePath);
      continue;
    }

    if (entry.isFile()) {
      yield relativePath;
    }
  }
}

async function safeStatFile(filePath: string): Promise<{ size: number } | null> {
  try {
    const stats = await fs.stat(filePath);

    if (!stats.isFile()) {
      return null;
    }

    return { size: stats.size };
  } catch {
    return null;
  }
}

async function safeReadUtf8(filePath: string): Promise<string | null> {
  try {
    const buffer = await fs.readFile(filePath);

    return utf8Decoder.decode(buffer);
  } catch {
    return null;
  }
}

function findLineMatches(
  relativePath: string,
  content: string,
  query: string,
  lowerQuery: string,
): { results: ProjectSearchResult[]; totalMatches: number; truncated: boolean } {
  const matches: ProjectSearchResult[] = [];
  let totalMatches = 0;
  const lines = content.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineText = lines[lineIndex];
    const matchStart = lineText.toLowerCase().indexOf(lowerQuery);

    if (matchStart === -1) {
      continue;
    }

    totalMatches += 1;

    if (matches.length < MAX_MATCHES_PER_FILE) {
      matches.push({
        relativePath,
        lineNumber: lineIndex + 1,
        lineText,
        preview: buildPreview(lineText, matchStart, matchStart + query.length),
        matchStart,
        matchEnd: matchStart + query.length,
      });
    }
  }

  return {
    results: matches,
    totalMatches,
    truncated: totalMatches > matches.length,
  };
}

function buildPreview(lineText: string, matchStart: number, matchEnd: number): string {
  const start = Math.max(0, matchStart - PREVIEW_RADIUS);
  const end = Math.min(lineText.length, matchEnd + PREVIEW_RADIUS);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < lineText.length ? "..." : "";

  return `${prefix}${lineText.slice(start, end)}${suffix}`;
}

function compareSearchResults(
  left: ProjectSearchResult,
  right: ProjectSearchResult,
  lowerQuery: string,
): number {
  const leftPathMatches = left.relativePath.toLowerCase().includes(lowerQuery);
  const rightPathMatches = right.relativePath.toLowerCase().includes(lowerQuery);

  if (leftPathMatches !== rightPathMatches) {
    return leftPathMatches ? -1 : 1;
  }

  if (left.lineNumber !== right.lineNumber) {
    return left.lineNumber - right.lineNumber;
  }

  return left.relativePath.localeCompare(right.relativePath);
}

function emptySearchResponse(query: string): ProjectSearchResponse {
  return {
    query,
    results: [],
    summary: {
      scannedFiles: 0,
      skippedFiles: 0,
      matchedFiles: 0,
      totalMatches: 0,
      truncated: false,
    },
  };
}
