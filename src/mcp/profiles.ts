import { ServerConfig, ToolProfile } from "../config.js";

const MINIMAL_TOOLS = new Set([
  "siyuan_health",
  "siyuan_list_notebooks",
  "siyuan_search",
  "siyuan_document_list",
  "siyuan_get_document_kramdown",
  "siyuan_get_outline",
  "siyuan_get_block_kramdown",
  "siyuan_get_block_children",
  "siyuan_batch_get_kramdown",
  "siyuan_block_breadcrumb",
  "siyuan_get_backlinks"
]);

export const STANDARD_WRITE_TOOLS = [
  "siyuan_create_document",
  "siyuan_rename_document",
  "siyuan_append_block",
  "siyuan_insert_block",
  "siyuan_update_block",
  "siyuan_patch_blocks",
  "siyuan_replace_document_body",
  "siyuan_append_daily_note"
];

const STANDARD_EXTRA_TOOLS = [
  "siyuan_document_info",
  "siyuan_document_search",
  "siyuan_get_block",
  "siyuan_batch_get_blocks",
  "siyuan_block_stat"
];

const STANDARD_TOOLS = new Set([...MINIMAL_TOOLS, ...STANDARD_WRITE_TOOLS, ...STANDARD_EXTRA_TOOLS]);

export function isToolExposed(name: string, profile: ToolProfile): boolean {
  return profile === "full" || (profile === "standard" ? STANDARD_TOOLS : MINIMAL_TOOLS).has(name);
}

export function writeCapabilities(config: ServerConfig) {
  return Object.fromEntries(STANDARD_WRITE_TOOLS.map((tool) => [tool, {
    status: !isToolExposed(tool, config.toolProfile) ? "unavailable" :
      (config.allowWrite || config.allowDangerous) ? "available" : "permission-denied",
    requiredPermission: "safe-write",
    ...(tool === "siyuan_replace_document_body" ? { requiresUserConfirmation: true, confirmationMethod: "agent-chat", confirmationEnforcedByServer: false } : {})
  }]));
}
