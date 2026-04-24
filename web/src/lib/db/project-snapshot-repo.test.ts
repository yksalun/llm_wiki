import { describe, expect, it } from "vitest";

import type { ProjectStatus } from "@/lib/types";

import { mapProjectSnapshotToSummary } from "./project-snapshot-repo";

describe("mapProjectSnapshotToSummary", () => {
  it("maps a snapshot row into the shared project summary contract", () => {
    const status: ProjectStatus = "ready";
    const updatedAt = new Date("2026-04-24T10:00:00.000Z");

    expect(
      mapProjectSnapshotToSummary({
        id: "snapshot-1",
        projectId: "project-1",
        rootPath: "F:/projects/demo",
        name: "Demo",
        status,
        hasPurpose: true,
        hasSchema: true,
        hasWikiDirectory: true,
        hasRawSourcesDirectory: false,
        lastKnownUpdatedAt: updatedAt,
        lastScannedAt: new Date("2026-04-24T10:05:00.000Z"),
      }),
    ).toEqual({
      id: "project-1",
      name: "Demo",
      status: "ready",
      hasPurpose: true,
      hasSchema: true,
      hasWikiDirectory: true,
      hasRawSourcesDirectory: false,
      updatedAt: "2026-04-24T10:00:00.000Z",
    });
  });
});
