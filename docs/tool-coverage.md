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

standard 可通过校验后的 patch 删除内容块；全文替换虽然可见，但必须由 Agent 在聊天中取得用户确认。标准配置不暴露独立文档删除或文件管理工具。所有内容更新和删除入口均拒绝文档根。

## `full` 读取工具

- 工作空间：`siyuan_workspace_list`、`siyuan_workspace_info`
- 笔记本：`siyuan_list_notebooks`
- 文档：`siyuan_document_list`、`siyuan_get_document`、`siyuan_get_document_kramdown`、`siyuan_document_info`、`siyuan_document_search`
- 块：`siyuan_get_block`、`siyuan_get_block_children`、`siyuan_block_breadcrumb`、`siyuan_block_dom`、`siyuan_get_block_kramdown`、`siyuan_block_stat`、`siyuan_batch_get_blocks`、`siyuan_batch_get_kramdown`
- 大纲：`siyuan_get_outline`
- 搜索和 SQL：`siyuan_search`、`siyuan_sql_select`
- 同步：`siyuan_sync_status`
- 文本导出：不传 `output` 的 `siyuan_export_md`、`siyuan_export_html`、`siyuan_export_preview`；生成文件的导出见普通写入工具
- 历史：`siyuan_history_list`、`siyuan_history_search`、`siyuan_history_get`
- 仓库：`siyuan_repo_list`、`siyuan_repo_diff`、`siyuan_repo_search`、`siyuan_repo_file_get`、`siyuan_repo_file_open`
- 引用：`siyuan_get_backlinks`、`siyuan_ref_mentions`
- 标签和书签：`siyuan_tag_list`、`siyuan_bookmark_list`、`siyuan_bookmark_labels`
- 属性：`siyuan_get_attrs`、`siyuan_batch_get_attrs`
- 资源：`siyuan_asset_unused`、`siyuan_asset_stat`
- 数据库：`siyuan_database_search`、`siyuan_database_get`、`siyuan_database_render`、`siyuan_database_keys`、`siyuan_database_unused`
- 模板：`siyuan_template_search`、`siyuan_template_get`、`siyuan_template_render`
- 工作空间文件：`siyuan_file_list`、`siyuan_file_read`、`siyuan_file_grep`、`siyuan_file_find`、`siyuan_file_stat`
- 系统：`siyuan_system_current_time`

`siyuan_sql_select` 只接受单条只读查询，并拒绝常见修改关键字。`limit` 默认 100、最多 1000，同时约束 SQL 与 CLI 行数上限；SQL 自带更小的限制仍生效。后端报告截断时返回 `truncated:true` 和警告，成功执行不等于结果完整。

`siyuan_health` 不启动后端探测。`data.backend` 报告工作空间配置/发现状态，以及已有 workspace info 结果中的版本；未知版本返回 null，`compatibility:unverified` 不承诺真实 CLI 兼容。`writeCapabilities` 描述 profile 和配置权限，不证明后端支持。

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
- 文件导出：`siyuan_export_docx`、`siyuan_export_md_zip`、`siyuan_export_data`、`siyuan_repo_file_export`；后三项不传 `output` 也会生成临时文件，始终需要写入权限和审计。文本导出传 `output` 时同样需要写入权限

`siyuan_export_sy` 保留工具名以兼容旧客户端，但目前始终返回 `UNSUPPORTED_CAPABILITY`，不执行 CLI。当前上游转换路径的原生 `.sy` 归档/恢复语义尚未核验，不能作为可靠备份；不得自动换一种导出格式来完成原生备份请求。

`siyuan_create_document` 使用 `parentPath` 指定思源内部父路径。兼容参数 `path` 仍可使用，但 Agent 应先解析人类可读路径，再传入内部路径和 `title`。

MCP 不公开 dryRun 参数。正常调用在权限允许后直接执行，不存在先传 dryRun 再执行的额外步骤。属性工具禁止修改 id、title、type、created、updated 等保留字段。

## 危险工具

全文替换在 standard 和 full 中可见，要求普通写入权限及 Agent 在聊天中取得用户确认。full 的 `siyuan_file_write`、`siyuan_file_rename`、`siyuan_file_copy`、`siyuan_import_sy`、`siyuan_import_data`、`siyuan_sync_pull` 也要求危险权限。

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

## 块插入位置

`parent` 是可接收子块的容器 ID。文档、引用、列表/列表项、超级块及已识别的新容器可用于定位；标题和段落是叶子块，不能直接 append/prepend，也不能作为无锚点 insert 的父级。具体列表嵌套仍受后端约束。

`previous` 是插在其后的已有内容块。应与 `parent` 位于同一文档，并属于该容器。标题区段内的块，其 SQL `parent_id` 可能是标题；服务端会根据必要祖先解析实际容器，兼容旧调用传入该块的直接区段标题作为 parent。不会猜测另一个插入目标。

例如：在标题下第一处插入，传文档/实际容器作为 parent，标题作为 previous；在已知区段末尾插入，使用该处最后一个块作为 previous。`get_block_children` 对容器返回实际子块，对标题返回按标题层级计算的区段内容，不能直接将后者当成物理父子关系。

位置错误在首次写入前返回原因与已知关系，例如 `providedParentId`、`previousId`、`anchorSemanticParentId`、`anchorContainerId`；patch 还返回 `failedIndex`。这些信息用于解释冲突，不授权 Agent 改到另一个位置。

创建、追加、插入成功时，后端明确返回的有效 ID 会额外放在顶层 `createdId`，原有 `data` 保留。多块内容可能只返回一个 ID，不代表列出了所有新块。已有位置和 ID 足够时不需要再搜索或回读。

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

预检只查询本次目标和必要祖先，不扫描整篇关系表，也不读取旧正文。祖先查询最多遍历 64 层；截断、缺失、循环或过深时返回 `TARGET_LOOKUP_INCOMPLETE` 并停止，不将不完整结果解释为可写。未知操作目标仍拒绝；文档其他位置的新类型不会阻止无关修改。

包含 update/delete 时也不自动备份；执行失败停止并返回已完成列表和失败位置。不会自动回滚。最终一次查询合并验证被更新/删除目标；验证成功返回 requiresRefresh=false，不要求 Agent 回读全文。

## 整篇正文替换

参数为 id（文档 ID）和 markdown（完整正文；空字符串清空）。只用于明确的全文重写，不得用于改名或局部修改。要求普通写入权限和 Agent 聊天确认，具体确认规则见[写入保护](safety.md#全文替换的用户确认)。

权限与类型检查成功后，冻结初始顶层块集合、倒序删除、识别明确空占位块、追加一次、清理已识别占位块。最后内部读取正文一次验证。返回删除数量、追加状态、占位清理结果、submittedHash、verification。submittedHash 仅代表提交内容，不是旧版本或写入证明。

占位块信息不足时不猜测删除；清理失败不会撤销已追加的正文。多步失败报告进度和状态，不自动回滚。写入风险和验证限制见[写入保护](safety.md)。

## CLI 兼容性

历史真实验证基线为 CLI 3.8.3。2.0.1 根据上游 3.8.9/3.8.10 源码对齐参数和类型；真实集成仍受[隔离门禁](testing.md)阻止，不能把源码适配写成真实兼容验证通过。

当前适配依据包括 [CLI block](https://github.com/siyuan-note/siyuan/blob/v3.8.10/kernel/cli/cmd/block.go)、[容器类型](https://github.com/siyuan-note/siyuan/blob/v3.8.10/kernel/treenode/blocktree.go)、[SQL 行数限制](https://github.com/siyuan-note/siyuan/blob/v3.8.10/kernel/cli/cmd/sql.go)及 [home 参数测试](https://github.com/siyuan-note/siyuan/blob/v3.8.10/kernel/cli/cmd/home_test.go)。block get 的文档类型为 NodeDocument，SQL 类型为 d；batch-get 不提供可用于安全校验的块类型。块更新仍可能返回纯文本 ok，不能据此猜新 ID；工具定向验证原目标。kramdown 的 md 模式可能含生成 IAL，验证时忽略已识别标记，保留正文的缩进和空白。

`SIYUAN_MCP_HOME_DIR` 会统一传给数据命令和工作空间发现；只在支持 `--home-dir` 的 CLI 上配置，不支持时明确失败，不移除参数重试。它不启用 HTTP 或开放原始 CLI 给 Agent。新增字体、桌面进程观察等 CLI 能力不自动加入 standard。`--lock-type` 尚未默认启用，保留现有显式块类型转换语义。

不要把 CLI 对文档根的更新行为当成可用业务入口；MCP 会主动拒绝。命令差异以安装版本帮助为准。

## 2.0.1 兼容说明

- 工具名、profile 和正常 MCP 参数保持兼容；已有 parent/previous 调用保留，补齐标题与容器语义。错误目标、叶子父级和 full 的循环移动会在写入前拒绝。
- 工作空间发现成功后固定使用该路径；发现失败不再执行隐式默认空间的数据命令。失败结果缓存，显式 workspace info 成功可恢复；也可修正配置后重启。
- 生成临时文件的导出需要普通写入权限，即使没有 output；`.sy` 导出工具保留但停止执行。客户端应处理权限拒绝和不支持结果，不自行绕过。
- 文本正文保留原始空白；只对确认是单行文件路径的导出结果去掉一个输出换行。新增 createdId、backend、truncated 和结构化错误信息，不替换既有 data。
- 子进程 stdout/stderr 合计捕获上限为 16 MiB，超过后请求终止并返回 `CLI_OUTPUT_LIMIT`。不解析部分输出；写入状态仍可能未知，不能自动重试。raw 和单条后端警告最多保留 8000 字符。

版本升级后重启服务以刷新构建、工具描述和缓存。权限与聊天确认规则以[写入保护](safety.md)为准。

## Markdown 与公式

- 思源行内公式使用 `$...$`，不要使用 `\(...\)`。
- 最终写入的 KaTeX 命令使用单反斜杠，例如 `$\sqrt{x}$`。
- JSON 或 JavaScript 源码需要按语言规则转义反斜杠，但序列化显示的 `\\` 不代表思源中应保存两个反斜杠。
- fenced code block、缩进代码块和行内代码中的 `$` 按字面量处理，不参与公式校验。
- 输入校验器不改写内容；写入后的定向验证由对应工具负责，不执行无条件全文回读。
