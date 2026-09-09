import MarkdownIt from "markdown-it";

const markdownParser = new MarkdownIt({ html: true, linkify: false, typographer: false });

type MarkdownToken = ReturnType<typeof markdownParser.parse>[number];

/** Compare parsed content, not serializer spacing; never modify the stored Markdown. */
export function normalizeMarkdown(value: string): string {
  const source = value.replace(/\r\n/g, "\n");
  const protectedLines = new Set<number>();
  for (const token of markdownParser.parse(source, {})) {
    if (token.map && (["fence", "code_block", "html_block"].includes(token.type) || token.children?.some((child) => child.type === "code_inline"))) {
      for (let line = token.map[0]; line < token.map[1]; line += 1) protectedLines.add(line);
    }
  }
  // Remove block IAL before table parsing, where it otherwise becomes a spurious table row.
  const withoutBlockAttrs = source.split("\n").map((line, index) => {
    const attribute = line.match(/^(\s*(?:>\s*)*)\{:\s+id="\d{14}-[a-z0-9]{7}"[^\r\n]*\}\s*$/);
    return !protectedLines.has(index) && attribute ? attribute[1].trimEnd() : line;
  }).join("\n");
  return JSON.stringify(canonicalTokens(markdownParser.parse(withoutBlockAttrs, {})));
}

function canonicalTokens(tokens: MarkdownToken[], inline = false): unknown[] {
  const output: { type: string; tag: string; nesting: number; attrs: unknown; content: string; info: string; children: unknown[] | null }[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    let content = token.content;
    // Only text at a block/line start can be generated IAL. Code, HTML and link labels stay literal.
    if (inline && token.type === "text" && (index === 0 || tokens[index - 1].type === "softbreak")) {
      content = content.replace(/^\{:\s+id="\d{14}-[a-z0-9]{7}"[^\r\n]*?\}/, "");
      if (!content) {
        if (output.at(-1)?.type === "softbreak") output.pop();
        continue;
      }
    }
    const children = token.children ? canonicalTokens(token.children, true) : null;
    if (token.type === "inline" && children?.length === 0 && output.at(-1)?.type === "paragraph_open" && tokens[index + 1]?.type === "paragraph_close") {
      output.pop(); index += 1; continue;
    }
    // map, markup, level and hidden encode source formatting, including tight/loose lists.
    output.push({ type: token.type, tag: token.tag, nesting: token.nesting, attrs: token.attrs,
      content: token.type === "inline" ? "" : content, info: token.info, children });
  }
  return output;
}
