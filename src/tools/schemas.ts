import { z } from "zod/v4";
import { validateWritableMarkdown } from "../markdown/validate.js";

export const patchOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("append"),
    parent: z.string().min(1),
    markdown: writableMarkdownSchema()
  }),
  z.object({
    op: z.literal("insert"),
    parent: z.string().min(1),
    previous: z.string().min(1).optional(),
    markdown: writableMarkdownSchema()
  }),
  z.object({
    op: z.literal("update"),
    id: z.string().min(1),
    markdown: writableMarkdownSchema(
      true,
      "Exactly one SiYuan block. One top-level list item counts as one block; use insert or append for multiple sibling items or sections."
    )
  }),
  z.object({
    op: z.literal("delete"),
    id: z.string().min(1).describe("Content block ID to delete. Deleting a parent block also deletes its children.")
  })
]);

export function writableMarkdownSchema(requireContent = true, additionalGuidance?: string) {
  const schema = (requireContent ? z.string().min(1) : z.string()).superRefine((markdown, context) => {
    for (const issue of validateWritableMarkdown(markdown)) {
      context.addIssue({ code: "custom", message: issue });
    }
  });
  const guidance = [
    "Markdown content.",
    "For links, prefer [label](https://example.com).",
    "SiYuan inline formulas must use single-dollar delimiters: $...$.",
    "The final Markdown must contain standard single-backslash KaTeX commands, such as $\\sqrt{x}$.",
    "When constructing raw JSON or JavaScript source, escape backslashes as required, for example $\\\\sqrt{x}$ in source must decode to $\\sqrt{x}$.",
    "Do not store doubled backslashes merely because serialized JSON displays them as \\\\.",
    "Do not use \\(...\\) or bare LaTeX commands for inline formulas.",
    "Dollar signs inside fenced code blocks and inline code are treated literally and are excluded from formula validation.",
    additionalGuidance
  ].filter(Boolean);
  return schema.describe(guidance.join(" "));
}
