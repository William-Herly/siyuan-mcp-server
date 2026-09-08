# 工具参考

本文列出当前 MCP 工具、暴露配置和思源 CLI 中容易被忽略的写入语义。日常使用推荐 `standard` 配置。

## 如何选择写入工具

| 任务 | 工具 |
| --- | --- |
| 创建文档 | `siyuan_create_document` |
| 修改文档标题 | `siyuan_rename_document` |
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
| 文档维护 | `siyuan_rename_document`、`siyuan_create_document`、`siyuan_replace_document_body`、`siyuan_document_info`、`siyuan_document_search` |
| 块维护 | `siyuan_append_block`、`siyuan_insert_block`、`siyuan_update_block`、`siyuan_patch_blocks` |
| 块读取 | `siyuan_get_block`、`siyuan_batch_get_blocks`、`siyuan_block_stat` |
| 日记 | `siyuan_append_daily_note` |

standard 可通过校验后的 patch 删除内容块；全文替换虽然可见，但需要危险权限。标准配置不暴露独立文档删除或文件管理工具。所有内容更新和删除入口均拒绝文档根。

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
- 文档：`siyuan_create_document`、`siyuan_reorganize_document`、`siyuan_rename_document`、`siyuan_move_document`、`siyuan_duplicate_document`
- 块：`siyuan_insert_block`、`siyuan_append_block`、`siyuan_prepend_block`、`siyuan_update_block`、`siyuan_patch_blocks`、`siyuan_move_block`
- 日记：`siyuan_create_daily_note`、`siyuan_append_daily_note`、`siyuan_prepend_daily_note`
- 仓库：`siyuan_create_snapshot`、`siyuan_repo_tag`、`siyuan_repo_untag`
- 引用：`siyuan_ref_refresh`
- 标签和书签：`siyuan_tag_rename`、`siyuan_tag_remove`、`siyuan_bookmark_rename`、`siyuan_bookmark_remove`
- 属性：`siyuan_set_attrs`
- 资源：`siyuan_asset_upload`
- 数据库：`siyuan_database_key_add`、`siyuan_database_item_add`、`siyuan_database_item_update`
- 模板：`siyuan_template_create`、`siyuan_template_save_as`
- 导入：`siyuan_import_md`
- 同步：`siyuan_sync_push`
- 文件导出：`siyuan_export_docx`；其他带 `output` 的导出调用也需要写入权限并记录审计

`siyuan_create_document` 使用 `parentPath` 指定思源内部父路径。兼容参数 `path` 仍可使用，但 Agent 应先解析人类可读路径，再传入内部路径和 `title`。

MCP 不公开 dryRun 参数。正常调用在权限允许后直接执行，不存在先传 dryRun 再执行的额外步骤。属性工具禁止修改 id、title、type、created、updated 等保留字段。

## 危险工具

全文替换在 standard 和 full 中可见，但要求危险权限。full 的 `siyuan_file_write`、`siyuan_file_rename`、`siyuan_file_copy`、`siyuan_import_sy`、`siyuan_import_data`、`siyuan_sync_pull` 也要求危险权限。

以下独立管理工具只在 `full` 中注册，并要求 `SIYUAN_MCP_ALLOW_DANGEROUS=true`：

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

patch 只作用于指定 documentId，接受 1–20 个有序操作，例如：

```json
{
  "documentId": "20260908154051-h3ysj72",
  "operations": [
    { "op": "append", "parent": "20260908154051-h3ysj72", "markdown": "追加段落" },
    { "op": "update", "id": "20260908154051-8wu6gis", "markdown": "更新已有段落" }
  ]
}
```

append/insert 允许多块 Markdown；update 只允许单块；delete 只允许内容块。父子冲突、重复破坏性目标、跨文档目标在首次写入前拒绝。标题块更新/删除应单独调用。file 输入已移除。

包含 update/delete 时创建一次文档恢复档案；执行失败停止并返回已完成列表、失败位置和 recovery。不会自动回滚。最终一次查询合并验证被更新/删除目标；验证成功返回 requiresRefresh=false，不要求 Agent 回读全文。

## 整篇正文替换

参数为 id（文档 ID）和 markdown（完整正文；空字符串清空）。只用于明确的全文重写，不得用于改名或局部修改。必须有危险权限。

类型检查与文档档案成功后，冻结初始顶层块集合、倒序删除、识别明确空占位块、追加一次、清理已识别占位块。最后内部读取正文一次验证。返回删除数量、追加状态、占位清理结果、submittedHash、verification 和 recovery。submittedHash 仅代表提交内容，不是旧版本或写入证明。

占位块信息不足时不猜测删除；清理失败不会撤销已追加的正文。多步失败报告进度和状态，不自动回滚。恢复和验证限制见[写入保护](safety.md)。

## CLI 兼容性

本次在 CLI 3.8.3 验证：block get 的文档类型为 NodeDocument；内部 SQL 类型为 d；batch-get 不提供类型。块更新可能返回纯文本 ok，不能靠返回值猜新 ID；工具定向验证原目标，无法确认时要求检查而不重复写入。kramdown 的 md 模式可能含生成 IAL，验证时忽略已识别标记。

不要把 CLI 对文档根的更新行为当成可用业务入口；MCP 会主动拒绝。命令差异以安装版本帮助为准。

## Markdown 与公式

- 思源行内公式使用 `$...$`，不要使用 `\(...\)`。
- 最终写入的 KaTeX 命令使用单反斜杠，例如 `$\sqrt{x}$`。
- JSON 或 JavaScript 源码需要按语言规则转义反斜杠，但序列化显示的 `\\` 不代表思源中应保存两个反斜杠。
- fenced code block、缩进代码块和行内代码中的 `$` 按字面量处理，不参与公式校验。
- 输入校验器不改写内容；写入后的定向验证由对应工具负责，不执行无条件全文回读。
