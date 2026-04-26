import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FileReadResult } from "@/lib/types";

import { FilePreview } from "./file-preview";

function createFile(overrides: Partial<FileReadResult>): FileReadResult {
  return {
    relativePath: "notes.txt",
    mode: "preview",
    content: "plain text",
    editable: false,
    size: 10,
    lastModified: "2026-04-26T00:00:00.000Z",
    metadata: {},
    ...overrides,
  };
}

describe("FilePreview", () => {
  it("renders read-only text preview content lines", () => {
    const html = renderToStaticMarkup(
      <FilePreview file={createFile({ content: "first line\nsecond line" })} />,
    );

    expect(html).toContain("Read-only preview");
    expect(html).toContain("first line");
    expect(html).toContain("second line");
  });

  it("renders metadata-only details", () => {
    const html = renderToStaticMarkup(
      <FilePreview
        file={createFile({
          mode: "metadata",
          content: null,
          metadata: {
            reason: "File is too large for preview",
            extension: ".bin",
          },
        })}
      />,
    );

    expect(html).toContain("Metadata only");
    expect(html).toContain("File is too large for preview");
    expect(html).toContain(".bin");
  });

  it("renders unsupported preview details", () => {
    const html = renderToStaticMarkup(
      <FilePreview
        file={createFile({
          mode: "unsupported",
          content: null,
          metadata: {
            reason: "Binary files are not supported",
            extension: ".png",
          },
        })}
      />,
    );

    expect(html).toContain("Unsupported preview");
    expect(html).toContain("Binary files are not supported");
  });
});
