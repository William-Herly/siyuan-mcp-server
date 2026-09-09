const SUSPICIOUS_BARE_KATEX_COMMAND =
  /(^|[^\\A-Za-z])(?:sqrt|bar|mathrm|mathbf|mathit|mathbb|mathcal|frac|text|overline|underline|operatorname)\s*\{/i;

/**
 * Detects high-confidence signs that a source-language escape damaged Markdown before it reached MCP.
 * This is intentionally local and conservative: it performs no I/O and never rewrites content.
 */
export function validateWritableMarkdown(markdown: string): string[] {
  const issues: string[] = [];
  const forbiddenControl = markdown.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/);
  if (forbiddenControl) {
    issues.push(
      `Markdown contains forbidden control character U+${forbiddenControl[0].codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}; the input may have been damaged while constructing a JSON or JavaScript string.`
    );
  }

  if (/\r(?!\n)/.test(markdown)) {
    issues.push("Markdown contains a standalone carriage return; use a normal line break and ensure caller source strings are escaped correctly.");
  }

  const markdownWithoutCode = maskMarkdownCodeContexts(markdown);
  for (const { delimiter, formula } of extractMathSpans(markdownWithoutCode)) {
    if (delimiter === "$" && /[\u0000-\u001F\u007F]/.test(formula)) {
      issues.push("An inline formula contains a control character; ensure JavaScript or JSON source escapes each LaTeX backslash.");
    }
    if (SUSPICIOUS_BARE_KATEX_COMMAND.test(formula)) {
      issues.push("A formula contains a likely bare KaTeX command such as sqrt{...} or bar{...}; the final Markdown command must retain one backslash.");
    }
  }

  return [...new Set(issues)];
}

interface MathSpan {
  delimiter: "$" | "$$";
  formula: string;
}

function extractMathSpans(markdown: string): MathSpan[] {
  const spans: MathSpan[] = [];
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] !== "$" || isEscapedAt(markdown, index)) {
      continue;
    }

    const delimiter: "$" | "$$" = markdown[index + 1] === "$" ? "$$" : "$";
    const contentStart = index + delimiter.length;
    const closing = findMathClosingDelimiter(markdown, contentStart, delimiter);
    if (closing === undefined) {
      if (delimiter === "$") {
        index = skipToLineEnd(markdown, index);
      } else {
        index += delimiter.length - 1;
      }
      continue;
    }

    spans.push({
      delimiter,
      formula: markdown.slice(contentStart, closing)
    });
    index = closing + delimiter.length - 1;
  }
  return spans;
}

function findMathClosingDelimiter(
  markdown: string,
  start: number,
  delimiter: "$" | "$$"
): number | undefined {
  for (let index = start; index < markdown.length; index += 1) {
    if (delimiter === "$" && (markdown[index] === "\n" || markdown[index] === "\r")) {
      return undefined;
    }
    if (markdown[index] !== "$" || isEscapedAt(markdown, index)) {
      continue;
    }
    if (delimiter === "$$") {
      if (markdown[index + 1] === "$") {
        return index;
      }
      continue;
    }
    if (markdown[index + 1] !== "$" && markdown[index - 1] !== "$") {
      return index;
    }
  }
  return undefined;
}

function skipToLineEnd(markdown: string, start: number): number {
  const lineFeed = markdown.indexOf("\n", start);
  const carriageReturn = markdown.indexOf("\r", start);
  const endings = [lineFeed, carriageReturn].filter((index) => index >= 0);
  return endings.length > 0 ? Math.min(...endings) : markdown.length;
}

function isEscapedAt(value: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function maskMarkdownCodeContexts(markdown: string): string {
  // String indexes in the scanners are UTF-16 code-unit offsets, so split("") must be used here.
  const masked = markdown.split("");
  let fence: { marker: "`" | "~"; length: number } | undefined;
  let offset = 0;

  while (offset < markdown.length) {
    const newline = markdown.indexOf("\n", offset);
    const lineEnd = newline >= 0 ? newline : markdown.length;
    const contentEnd = lineEnd > offset && markdown[lineEnd - 1] === "\r" ? lineEnd - 1 : lineEnd;
    const line = markdown.slice(offset, contentEnd);

    if (fence) {
      maskRange(masked, offset, contentEnd);
      const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
      if (
        closing &&
        closing[1][0] === fence.marker &&
        closing[1].length >= fence.length
      ) {
        fence = undefined;
      }
    } else {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (opening) {
        fence = {
          marker: opening[1][0] as "`" | "~",
          length: opening[1].length
        };
        maskRange(masked, offset, contentEnd);
      } else if (/^(?: {4}|\t)/.test(line)) {
        maskRange(masked, offset, contentEnd);
      }
    }

    offset = newline >= 0 ? newline + 1 : markdown.length;
  }

  maskInlineCodeSpans(markdown, masked);
  return masked.join("");
}

function maskInlineCodeSpans(markdown: string, masked: string[]): void {
  for (let index = 0; index < markdown.length; index += 1) {
    if (masked[index] !== "`") {
      continue;
    }

    const openingLength = countRun(markdown, index, "`");
    let cursor = index + openingLength;
    let closing: number | undefined;
    while (cursor < markdown.length) {
      if (masked[cursor] !== "`") {
        cursor += 1;
        continue;
      }
      const candidateLength = countRun(markdown, cursor, "`");
      if (candidateLength === openingLength) {
        closing = cursor;
        break;
      }
      cursor += candidateLength;
    }

    if (closing === undefined) {
      index += openingLength - 1;
      continue;
    }

    maskRange(masked, index, closing + openingLength);
    index = closing + openingLength - 1;
  }
}

function countRun(value: string, start: number, character: string): number {
  let length = 0;
  while (value[start + length] === character) {
    length += 1;
  }
  return length;
}

function maskRange(target: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (target[index] !== "\r" && target[index] !== "\n") {
      target[index] = " ";
    }
  }
}

export function isSingleBlockMarkdown(markdown: string): boolean {
  const blocks = markdown
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .filter((block) => block.trim() && !/^\s*\{:\s+[^}]+\}\s*$/.test(block.trim()));
  if (blocks.length !== 1) {
    return false;
  }

  const lines = blocks[0].split(/\r?\n/);
  let fenced = false;
  let firstListIndent: number | undefined;
  let topLevelListItems = 0;
  for (const line of lines) {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      continue;
    }

    const listItem = line.match(/^(\s*)(?:[-+*]|\d+[.)])\s+/);
    if (listItem) {
      const indent = listItem[1].replace(/\t/g, "    ").length;
      firstListIndent ??= indent;
      if (indent === firstListIndent) {
        topLevelListItems += 1;
      }
    }
  }

  if (topLevelListItems > 1) {
    return false;
  }

  const meaningfulLines = lines.filter((line) => line.trim() && !/^\s*\{:\s+[^}]+\}\s*$/.test(line));
  return !/^\s{0,3}#{1,6}\s+/.test(meaningfulLines[0] ?? "") || meaningfulLines.length === 1;
}
