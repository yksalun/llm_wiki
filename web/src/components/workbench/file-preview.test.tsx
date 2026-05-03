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
  it("renders localized read-only text preview content lines", () => {
    const html = renderToStaticMarkup(
      <FilePreview file={createFile({ content: "first line\nsecond line" })} />,
    );

    expect(html).toContain("只读预览");
    expect(html).toContain("first line");
    expect(html).toContain("second line");
  });

  it("delegates markdown preview content to MarkdownReader", () => {
    const html = renderToStaticMarkup(
      <FilePreview file={createFile({ relativePath: "README.md", content: "# Title" })} />,
    );

    expect(html).toContain("<h1");
    expect(html).toContain("Title");
  });

  it("previews editable markdown files as markdown content", () => {
    const html = renderToStaticMarkup(
      <FilePreview
        file={createFile({
          relativePath: "wiki/schema.md",
          mode: "editable",
          content: "# Editable Schema",
          editable: true,
        })}
      />,
    );

    expect(html).toContain("<h1");
    expect(html).toContain("Editable Schema");
  });

  it("renders an empty state for empty preview content", () => {
    const html = renderToStaticMarkup(<FilePreview file={createFile({ content: "" })} />);

    expect(html).toContain("这个文件为空。");
  });

  it("uses monospace styling for structured text previews", () => {
    const html = renderToStaticMarkup(
      <FilePreview file={createFile({ relativePath: "config.json", content: '{ "enabled": true }' })} />,
    );

    expect(html).toContain("font-mono");
    expect(html).toContain("&quot;enabled&quot;");
  });

  it("preserves whitespace-only text preview content", () => {
    const html = renderToStaticMarkup(<FilePreview file={createFile({ content: "   \n\t" })} />);

    expect(html).toContain("<pre");
    expect(html).not.toContain("这个文件为空。");
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

    expect(html).toContain("仅显示元数据");
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

    expect(html).toContain("无法预览");
    expect(html).toContain("Binary files are not supported");
  });
});
