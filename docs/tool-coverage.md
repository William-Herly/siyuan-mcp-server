# 工具参考

本文列出当前 MCP 工具、暴露配置和思源 CLI 中容易被忽略的写入语义。日常使用推荐 `standard` 配置。

## 如何选择写入工具

| 任务 | 工具 |
| --- | --- |
| 创建文档 | `siyuan_create_document` |
| 追加一个或多个块 | `siyuan_append_block` |
| 在已知位置插入内容 | `siyuan_insert_block` |
| 替换一个块 | `siyuan_update_block` |
| 执行多项已经确认的块修改 | `siyuan_patch_blocks` |
| 保留文档 ID 替换全部正文 | `siyuan_replace_document_body` |

维护现有笔记时优先读取相关块并局部修改。只有确实需要重写全文时才使用整篇正文替换。

## 工具配置

`SIYUAN_MCP_PROFILE` 控制工具注册：

- `minimal`：默认的最小只读配置。
- `standard`：日常笔记工作，在 `minimal` 基础上增加安全内容维护工具。
- `full`：注册全部工具，包括需要危险权限的操作。

兼容别名：

- `maintain`、`note-maintain` 等同于 `standard`。
- `organize`、`advanced`、`admin` 等同于 `full`。

选择配置只决定工具是否可见。普通写入仍要求 `SIYUAN_MCP_ALLOW_WRITE=true`；危险工具仍要求 `SIYUAN_MCP_ALLOW_DANGEROUS=true`。

## `minimal` 工具

| 类别 | 工具 |
| --- | --- |
| 状态 | `siyuan_health` |
| 笔记本 | `siyuan_list_notebooks` |
| 搜索 | `siyuan_search` |
| 文档 | `siyuan_document_list`、`siyuan_get_document_kramdown` |
| 大纲 | `siyuan_get_outline` |
| 块 | `siyuan_get_block_kramdown`、`siyuan_get_block_children`、`siyuan_batch_get_kramdown`、`siyuan_block_breadcrumb` |
| 引用 | `siyuan_get_backlinks` |

## `standard` 增加的工具

| 类别 | 工具 |
| --- | --- |
| 文档维护 | `siyuan_create_document`、`siyuan_replace_document_body`、`siyuan_document_info`、`siyuan_document_search` |
| 块维护 | `siyuan_append_block`、`siyuan_insert_block`、`siyuan_update_block`、`siyuan_patch_blocks` |
| 块读取 | `siyuan_get_block`、`siyuan_batch_get_blocks`、`siyuan_block_stat` |
| 日记 | `siyuan_append_daily_note` |

`standard` 可以通过经过校验的批量补丁和整篇替换删除普通内容块，但不会暴露删除文档、笔记本、文件、历史和清理数据的独立工具。

## `full` 读取工具

- 工作空间：`siyuan_workspace_list`、`siyuan_workspace_info`
- 笔记本：`siyuan_list_notebooks`
- 文档：`siyuan_document_list`、`siyuan_get_document`、`siyuan_get_document_kramdown`、`siyuan_document_info`、`siyuan_document_search`
- 块：`siyuan_get_block`、`siyuan_get_block_children`、`siyuan_block_breadcrumb`、`siyuan_block_dom`、`siyuan_get_block_kramdown`、`siyuan_block_stat`、`siyuan_batch_get_blocks`、`siyuan_batch_get_kramdown`
- 大纲：`siyuan_get_outline`
- 搜索和 SQL：`siyuan_search`、`siyuan_sql_select`
- 同步：`siyuan_sync_status`
- 导出：`siyuan_export_md`、`siyuan_export_html`、`siyuan_export_preview`、`siyuan_export_sy`、`siyuan_export_md_zip`、`siyuan_export_data`
- 历史：`siyuan_history_list`、`siyuan_history_search`、`siyuan_history_get`
- 仓库：`siyuan_repo_list`、`siyuan_repo_diff`、`siyuan_repo_search`、`siyuan_repo_file_get`、`siyuan_repo_file_open`、`siyuan_repo_file_export`
- 引用：`siyuan_get_backlinks`、`siyuan_ref_mentions`
- 标签和书签：`siyuan_tag_list`、`siyuan_bookmark_list`、`siyuan_bookmark_labels`
- 属性：`siyuan_get_attrs`、`siyuan_batch_get_attrs`
- 资源：`siyuan_asset_unused`、`siyuan_asset_stat`
- 数据库：`siyuan_database_search`、`siyuan_database_get`、`siyuan_database_render`、`siyuan_database_keys`、`siyuan_database_unused`
- 模板：`siyuan_template_search`、`siyuan_template_get`、`siyuan_template_render`
- 工作空间文件：`siyuan_file_list`、`siyuan_file_read`、`siyuan_file_grep`、`siyuan_file_find`、`siyuan_file_stat`
- 系统：`siyuan_system_current_time`

`siyuan_sql_select` 只接受单条只读查询，并拒绝常见修改关键字。

## `full` 普通写入工具

这些工具要求 `SIYUAN_MCP_ALLOW_WRITE=true`：

- 笔记本：`siyuan_create_notebook`、`siyuan_rename_notebook`、`siyuan_open_notebook`、`siyuan_close_notebook`、`siyuan_set_notebook_icon`、`siyuan_random_notebook_icon`
- 文档：`siyuan_create_document`、`siyuan_replace_document_body`、`siyuan_reorganize_document`、`siyuan_rename_document`、`siyuan_move_document`、`siyuan_duplicate_document`
- 块：`siyuan_insert_block`、`siyuan_append_block`、`siyuan_prepend_block`、`siyuan_update_block`、`siyuan_patch_blocks`、`siyuan_move_block`
- 日记：`siyuan_create_daily_note`、`siyuan_append_daily_note`、`siyuan_prepend_daily_note`
- 仓库：`siyuan_create_snapshot`、`siyuan_repo_tag`、`siyuan_repo_untag`
- 引用：`siyuan_ref_refresh`
- 标签和书签：`siyuan_tag_rename`、`siyuan_tag_remove`、`siyuan_bookmark_rename`、`siyuan_bookmark_remove`
- 属性：`siyuan_set_attrs`
- 资源：`siyuan_asset_upload`
- 数据库：`siyuan_database_key_add`、`siyuan_database_item_add`、`siyuan_database_item_update`
- 模板：`siyuan_template_create`、`siyuan_template_save_as`
- 导入：`siyuan_import_md`、`siyuan_import_sy`、`siyuan_import_data`
- 工作空间文件：`siyuan_file_write`、`siyuan_file_rename`、`siyuan_file_copy`
- 同步：`siyuan_sync_push`、`siyuan_sync_pull`
- 文件导出：`siyuan_export_docx`；其他带 `output` 的导出调用也需要写入权限并记录审计

`siyuan_create_document` 使用 `parentPath` 指定思源内部父路径。兼容参数 `path` 仍可使用，但 Agent 应先解析人类可读路径，再传入内部路径和 `title`。

为避免误操作，`full` 中不少管理类写入工具将 `dryRun` 默认为 `true`。写入权限只代表允许执行；需要真正落盘时仍应在审核空运行结果后显式传入 `dryRun: false`。`standard` 的核心内容维护工具不采用这一额外步骤。

## 危险工具

以下工具只在 `full` 中注册，并要求 `SIYUAN_MCP_ALLOW_DANGEROUS=true`：

- `siyuan_delete_block`
- `siyuan_remove_document`
- `siyuan_remove_notebook`
- `siyuan_history_rollback`
- `siyuan_history_clear`
- `siyuan_repo_checkout`
- `siyuan_repo_purge`
- `siyuan_repo_file_rollback`
- `siyuan_asset_clean`
- `siyuan_database_item_remove`
- `siyuan_database_key_remove`
- `siyuan_database_clean`
- `siyuan_template_remove`
- `siyuan_file_delete`

## 批量块修改

`siyuan_patch_blocks` 接受 1 至 20 个有序操作：

```json
[
  { "op": "append", "parent": "<block-id>", "markdown": "..." },
  { "op": "insert", "parent": "<block-id>", "previous": "<sibling-id>", "markdown": "..." },
  { "op": "update", "id": "<block-id>", "markdown": "..." },
  { "op": "delete", "id": "<block-id>" }
]
```

完整批次会在写入前统一校验。运行时按顺序执行并在首次失败时停止，已经成功的操作不会回滚。删除父块也会删除其子块。

`append` 和 `insert` 支持多块 Markdown；`update` 只接受一个 Markdown 块。补丁包含 `update` 或 `delete` 时，结果返回 `requiresRefresh: true`，因为后续操作不应继续依赖旧块 ID。

## 整篇正文替换

```ts
siyuan_replace_document_body({
  id: string,
  markdown: string
})
```

工具冻结初始直接子块 ID 集合并倒序删除，识别思源生成的空段落，一次性追加完整 Markdown，再删除记录的占位块。空字符串会清空正文，并保留思源正常的空文档占位块。

该工具：

- 保留文档 ID；
- 不创建隐式快照；
- 不自动回滚；
- 不回读整篇正文；
- 返回 `documentId`、初始顶层块数量、删除数量、追加状态、占位块清理状态、提交内容哈希和 `requiresRefresh`。

占位块清理失败不会删除已经写入的正文，而是返回警告。

## 已验证的 CLI 语义

在思源 CLI v3.7.1 的本地集成测试中确认：

- `block append`、`block prepend` 和 `block insert` 支持多块 Markdown。
- `block update` 只更新一个块，并可能生成新的块 ID；额外 Markdown 块会被忽略。
- MCP 会在调用 CLI 前拒绝多块 `update` 输入。
- 文档根块不能通过一次 `block update` 替换正文。
- 部分成功的 CLI 写入命令返回纯文本、ID 或空 stdout，MCP 会统一规范化。
- `document info --id` 对可读文档也可能失败，因此 `siyuan_document_info` 保留回退读取逻辑。

底层 CLI 的命令和参数以[思源官方项目](https://github.com/siyuan-note/siyuan)及当前安装版本的 `siyuan --help` 为准。

## Markdown 与公式

- 思源行内公式使用 `$...$`，不要使用 `\(...\)`。
- 最终写入的 KaTeX 命令使用单反斜杠，例如 `$\sqrt{x}$`。
- JSON 或 JavaScript 源码需要按语言规则转义反斜杠，但序列化显示的 `\\` 不代表思源中应保存两个反斜杠。
- fenced code block、缩进代码块和行内代码中的 `$` 按字面量处理，不参与公式校验。
- 校验器只检查输入，不会自动改写或回读写入后的正文。
