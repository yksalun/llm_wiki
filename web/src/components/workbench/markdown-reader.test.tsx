import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownReader } from "./markdown-reader";

describe("MarkdownReader", () => {
  it("renders headings, paragraphs, lists, links, and inline code", () => {
    const html = renderToStaticMarkup(
      <MarkdownReader
        content={[
          "# Project Guide",
          "",
          "A paragraph with [the docs](https://example.com/docs) and `inline code`.",
          "",
          "## Tasks",
          "",
          "- Read purpose",
          "- Review schema",
          "",
          "1. Draft changes",
          "2. Save file",
          "",
          "### Notes",
        ].join("\n")}
      />,
    );

    expect(html).toContain("<h1");
    expect(html).toContain("Project Guide");
    expect(html).toContain("<h2");
    expect(html).toContain("Tasks");
    expect(html).toContain("<h3");
    expect(html).toContain("Notes");
    expect(html).toContain("<p");
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain("the docs</a>");
    expect(html).toContain("<code");
    expect(html).toContain("inline code");
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
    expect(html).toContain("<li");
    expect(html).toContain("Read purpose");
    expect(html).toContain("Save file");
  });

  it("renders fenced code blocks, blockquotes, and horizontal rules", () => {
    const html = renderToStaticMarkup(
      <MarkdownReader
        content={[
          "> Keep the preview readable.",
          "",
          "---",
          "",
          "```ts",
          "const message = \"hello\";",
          "console.log(message);",
          "```",
        ].join("\n")}
      />,
    );

    expect(html).toContain("<blockquote");
    expect(html).toContain("Keep the preview readable.");
    expect(html).toContain("<hr");
    expect(html).toContain("<pre");
    expect(html).toContain("<code");
    expect(html).toContain("const message = &quot;hello&quot;;");
    expect(html).toContain("console.log(message);");
  });

  it("renders an empty state for blank content", () => {
    const html = renderToStaticMarkup(<MarkdownReader content={"  \n\t  "} />);

    expect(html).toContain("This file is empty");
  });
});
