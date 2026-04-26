import type { ProjectSearchResponse, ProjectSearchResult } from "@/lib/types";

import { scanProjectTextFiles } from "./project-text-scan";
import type { ProjectTextScanResult } from "./project-text-scan";

export const MAX_PROJECT_SEARCH_RESULTS = 50;
export const MAX_PROJECT_SEARCH_LINE_TEXT_LENGTH = 160;
export const MAX_PROJECT_SEARCH_QUERY_LENGTH = 120;

const MAX_MATCHES_PER_FILE = 5;
const PREVIEW_RADIUS = 48;

type ProjectSearchDependencies = {
  scanTextFiles?: (projectRoot: string) => ProjectTextScanResult;
};

type ValidQuerySearchState = {
  query: string;
  lowerQuery: string;
  searchResults: ProjectSearchResult[];
  scannedFiles: number;
  matchedFiles: number;
  totalMatches: number;
  truncatedByPerFileCap: boolean;
  truncatedByGlobalCap: boolean;
};

export async function searchProjectFiles(
  projectRoot: string,
  query: string,
): Promise<ProjectSearchResponse> {
  const [response] = await searchProjectFilesForQueries(projectRoot, [query]);

  return response;
}

export async function searchProjectFilesForQueries(
  projectRoot: string,
  queries: string[],
  dependencies: ProjectSearchDependencies = {},
): Promise<ProjectSearchResponse[]> {
  const responses = queries.map((query) => {
    const trimmedQuery = query.trim();

    if (!isValidSearchQuery(trimmedQuery)) {
      return {
        response: emptySearchResponse(trimmedQuery),
        state: null,
      };
    }

    return {
      response: null,
      state: createSearchState(trimmedQuery),
    };
  });
  const validStates = responses.flatMap((response) => (response.state ? [response.state] : []));

  if (validStates.length === 0) {
    return responses.map((response) => response.response ?? finalizeSearchState(response.state!, 0));
  }

  const scan = (dependencies.scanTextFiles ?? scanProjectTextFiles)(projectRoot);

  for await (const file of scan.files) {
    for (const state of validStates) {
      state.scannedFiles += 1;

      const fileSearchResult = findLineMatches(file.relativePath, file.content, state.query);

      if (fileSearchResult.totalMatches > 0) {
        state.matchedFiles += 1;
        state.totalMatches += fileSearchResult.totalMatches;
        state.truncatedByPerFileCap ||= fileSearchResult.truncated;
        state.searchResults.push(...fileSearchResult.results);
        state.truncatedByGlobalCap ||= trimToTopResults(state.searchResults, state.lowerQuery);
      }
    }
  }

  return responses.map((response) =>
    response.response ?? finalizeSearchState(response.state!, scan.stats.skippedFiles),
  );
}

function isValidSearchQuery(trimmedQuery: string): boolean {
  return trimmedQuery.length >= 2 && trimmedQuery.length <= MAX_PROJECT_SEARCH_QUERY_LENGTH;
}

function createSearchState(query: string): ValidQuerySearchState {
  return {
    query,
    lowerQuery: query.toLowerCase(),
    searchResults: [],
    scannedFiles: 0,
    matchedFiles: 0,
    totalMatches: 0,
    truncatedByPerFileCap: false,
    truncatedByGlobalCap: false,
  };
}

function finalizeSearchState(
  state: ValidQuerySearchState,
  skippedFiles: number,
): ProjectSearchResponse {
  const sortedResults = state.searchResults.sort((left, right) =>
    compareSearchResults(left, right, state.lowerQuery),
  );
  const truncated = state.truncatedByPerFileCap || state.truncatedByGlobalCap;

  return {
    query: state.query,
    results: sortedResults.slice(0, MAX_PROJECT_SEARCH_RESULTS),
    summary: {
      scannedFiles: state.scannedFiles,
      skippedFiles,
      matchedFiles: state.matchedFiles,
      totalMatches: state.totalMatches,
      truncated,
    },
  };
}

function findLineMatches(
  relativePath: string,
  content: string,
  query: string,
): { results: ProjectSearchResult[]; totalMatches: number; truncated: boolean } {
  const matches: ProjectSearchResult[] = [];
  let totalMatches = 0;
  const lines = content.split(/\r?\n/);
  const queryPattern = new RegExp(escapeRegExp(query), "iu");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineText = lines[lineIndex];
    const match = queryPattern.exec(lineText);

    if (!match) {
      continue;
    }

    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    totalMatches += 1;

    if (matches.length < MAX_MATCHES_PER_FILE) {
      const croppedLine = cropLineAroundMatch(lineText, matchStart, matchEnd);

      matches.push({
        relativePath,
        lineNumber: lineIndex + 1,
        lineText: croppedLine.lineText,
        preview: croppedLine.lineText,
        matchStart: croppedLine.matchStart,
        matchEnd: croppedLine.matchEnd,
      });
    }
  }

  return {
    results: matches,
    totalMatches,
    truncated: totalMatches > matches.length,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cropLineAroundMatch(
  lineText: string,
  matchStart: number,
  matchEnd: number,
): { lineText: string; matchStart: number; matchEnd: number } {
  let beforeContextLength = Math.min(matchStart, PREVIEW_RADIUS);
  let afterContextLength = Math.min(lineText.length - matchEnd, PREVIEW_RADIUS);

  while (true) {
    const start = matchStart - beforeContextLength;
    const end = matchEnd + afterContextLength;
    const prefixLength = start > 0 ? 3 : 0;
    const suffixLength = end < lineText.length ? 3 : 0;
    const croppedLength = prefixLength + (end - start) + suffixLength;

    if (croppedLength <= MAX_PROJECT_SEARCH_LINE_TEXT_LENGTH) {
      break;
    }

    const overflow = croppedLength - MAX_PROJECT_SEARCH_LINE_TEXT_LENGTH;

    if (afterContextLength >= beforeContextLength && afterContextLength > 0) {
      afterContextLength -= Math.min(afterContextLength, overflow);
      continue;
    }

    if (beforeContextLength > 0) {
      beforeContextLength -= Math.min(beforeContextLength, overflow);
      continue;
    }

    if (afterContextLength > 0) {
      afterContextLength -= Math.min(afterContextLength, overflow);
      continue;
    }

    break;
  }

  const start = matchStart - beforeContextLength;
  const end = matchEnd + afterContextLength;
  const prefix = start > 0 ? "..." : "";
  const suffix = end < lineText.length ? "..." : "";
  const croppedPrefixLength = prefix.length;

  return {
    lineText: `${prefix}${lineText.slice(start, end)}${suffix}`,
    matchStart: croppedPrefixLength + matchStart - start,
    matchEnd: croppedPrefixLength + matchEnd - start,
  };
}

function trimToTopResults(results: ProjectSearchResult[], lowerQuery: string): boolean {
  if (results.length <= MAX_PROJECT_SEARCH_RESULTS) {
    return false;
  }

  results.sort((left, right) => compareSearchResults(left, right, lowerQuery));
  results.splice(MAX_PROJECT_SEARCH_RESULTS);

  return true;
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
