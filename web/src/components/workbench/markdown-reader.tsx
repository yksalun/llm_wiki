import type { ReactNode } from "react";

type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "unordered-list"; items: string[] }
  | { type: "ordered-list"; items: string[] }
  | { type: "blockquote"; text: string }
  | { type: "code"; code: string; language: string | null }
  | { type: "rule" };

export function MarkdownReader({ content }: { content: string }) {
  if (!content.trim()) {
    return (
      <div className="rounded-[20px] border border-dashed border-black/10 bg-[linear-gradient(180deg,rgba(255,252,246,0.72),rgba(245,239,229,0.46))] p-6 text-sm leading-7 text-muted-foreground">
        This file is empty.
      </div>
    );
  }

  const blocks = parseMarkdownBlocks(content);

  return (
    <article className="space-y-5 rounded-[20px] border border-black/8 bg-white/70 px-5 py-5 text-sm leading-7 text-[color:var(--ink-strong)]">
      {blocks.map((block, index) => renderBlock(block, index))}
    </article>
  );
}

function parseMarkdownBlocks(content: string) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const fence = trimmed.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push({
        type: "code",
        code: codeLines.join("\n"),
        language: fence[1] ?? null,
      });
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      });
      index += 1;
      continue;
    }

    if (isHorizontalRule(trimmed)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (isUnorderedListItem(line)) {
      const items: string[] = [];

      while (index < lines.length && isUnorderedListItem(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, "").trim());
        index += 1;
      }

      blocks.push({ type: "unordered-list", items });
      continue;
    }

    if (isOrderedListItem(line)) {
      const items: string[] = [];

      while (index < lines.length && isOrderedListItem(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+[.)]\s+/, "").trim());
        index += 1;
      }

      blocks.push({ type: "ordered-list", items });
      continue;
    }

    if (isBlockquoteLine(line)) {
      const quoteLines: string[] = [];

      while (index < lines.length && isBlockquoteLine(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, "").trim());
        index += 1;
      }

      blocks.push({ type: "blockquote", text: quoteLines.join(" ") });
      continue;
    }

    const paragraphLines: string[] = [];

    while (index < lines.length && shouldContinueParagraph(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function renderBlock(block: MarkdownBlock, index: number) {
  if (block.type === "heading") {
    const className = "font-semibold leading-tight text-[color:var(--ink-strong)]";

    if (block.level === 1) {
      return (
        <h1 key={index} className={`${className} text-2xl`}>
          {renderInlineMarkdown(block.text)}
        </h1>
      );
    }

    if (block.level === 2) {
      return (
        <h2 key={index} className={`${className} text-xl`}>
          {renderInlineMarkdown(block.text)}
        </h2>
      );
    }

    return (
      <h3 key={index} className={`${className} text-lg`}>
        {renderInlineMarkdown(block.text)}
      </h3>
    );
  }

  if (block.type === "paragraph") {
    return (
      <p key={index} className="text-[color:var(--ink-strong)]">
        {renderInlineMarkdown(block.text)}
      </p>
    );
  }

  if (block.type === "unordered-list") {
    return (
      <ul key={index} className="list-disc space-y-1 pl-6">
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>
    );
  }

  if (block.type === "ordered-list") {
    return (
      <ol key={index} className="list-decimal space-y-1 pl-6">
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
        ))}
      </ol>
    );
  }

  if (block.type === "blockquote") {
    return (
      <blockquote
        key={index}
        className="border-l-4 border-black/10 bg-black/[0.02] px-4 py-3 text-muted-foreground"
      >
        {renderInlineMarkdown(block.text)}
      </blockquote>
    );
  }

  if (block.type === "code") {
    return (
      <pre
        key={index}
        className="overflow-x-auto rounded-[16px] border border-black/8 bg-[color:var(--ink-strong)] px-4 py-3 font-mono text-xs leading-6 text-white"
      >
        <code data-language={block.language ?? undefined}>{block.code}</code>
      </pre>
    );
  }

  return <hr key={index} className="border-black/10" />;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const inlinePattern = /(`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlinePattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];

    if (token.startsWith("`")) {
      nodes.push(
        <code
          key={`code-${match.index}`}
          className="rounded border border-black/10 bg-black/[0.04] px-1 py-0.5 font-mono text-[0.92em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);

      if (link) {
        nodes.push(
          <a key={`link-${match.index}`} href={link[2]} className="font-medium underline">
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function isHorizontalRule(line: string) {
  return /^(-{3,}|\*{3,}|_{3,})$/.test(line);
}

function isUnorderedListItem(line: string) {
  return /^\s*[-*+]\s+/.test(line);
}

function isOrderedListItem(line: string) {
  return /^\s*\d+[.)]\s+/.test(line);
}

function isBlockquoteLine(line: string) {
  return /^\s*>\s?/.test(line);
}

function shouldContinueParagraph(line: string) {
  const trimmed = line.trim();

  return (
    Boolean(trimmed) &&
    !trimmed.startsWith("```") &&
    !/^(#{1,3})\s+/.test(trimmed) &&
    !isHorizontalRule(trimmed) &&
    !isUnorderedListItem(line) &&
    !isOrderedListItem(line) &&
    !isBlockquoteLine(line)
  );
}
