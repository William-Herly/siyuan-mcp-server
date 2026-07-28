# 测试指南

项目包含单元测试和真实思源工作空间集成测试。涉及写入的测试只能在独立测试笔记本或一次性工作空间中运行。

## 单元测试

```bash
npm install
npm run build
npm test
```

单元测试覆盖：

- 工具配置过滤
- 参数 schema
- CLI 参数构造
- 权限拒绝
- Markdown 和公式校验
- 批量修改的预校验与部分失败结果
- 整篇正文替换的步骤和返回结构
- 输出规范化和审计脱敏

## `standard` 集成测试

设置测试工作空间和笔记本 ID：

```powershell
$env:SIYUAN_TEST_WORKSPACE = "E:\SiYuan Data"
$env:SIYUAN_TEST_NOTEBOOK_ID = "notebook-id"
npm run test:standard
```

脚本会：

1. 通过 stdio 启动构建后的 MCP Server。
2. 使用 `SIYUAN_MCP_PROFILE=maintain`，验证它等同于 `standard`。
3. 启用普通写入权限。
4. 检查准确的工具列表。
5. 调用所有 `standard` 已暴露工具。
6. 创建带唯一名称的测试文档。
7. 向今日日记追加一条唯一标记。
8. 在关键结构写入后显式回读结果。
9. 将 JSON 报告保存到 `.siyuan-mcp/test-reports/`。

`standard` 不暴露删除文档工具，因此测试不会自动删除创建的文档和日记标记。报告会记录相关 ID，便于人工检查或在明确启用危险权限后清理。

## 手动只读冒烟测试

重启 MCP 客户端，使其加载最新工具列表，然后向 Agent 提交：

```text
使用思源 MCP 工具执行只读冒烟测试：
1. 调用 siyuan_health，报告 permissionMode、toolProfile 和 workspace。
2. 调用 siyuan_list_notebooks，报告笔记本数量。
3. 使用 siyuan_search 搜索一个常见关键词，pageSize 设为 5。
4. 选择一个结果，通过 siyuan_get_block_kramdown 或 siyuan_get_document_kramdown 读取。
5. 不调用任何写入工具。
```

## 写入权限拒绝测试

不要设置 `SIYUAN_MCP_ALLOW_WRITE=true`，然后提交：

```text
调用 siyuan_append_daily_note，写入一条测试 Markdown。
确认工具拒绝写入，并明确说明需要 SIYUAN_MCP_ALLOW_WRITE=true。
不要尝试绕过权限。
```

## 普通写入测试

仅在测试笔记本中启用写入权限：

```text
使用思源 MCP standard 工具测试直接写入：
1. 调用 siyuan_health，确认 permissionMode 为 safe-write。
2. 选择测试笔记本。
3. 创建一个不在正文中重复 H1 标题的测试文档。
4. 读取新文档。
5. 追加一个子块。
6. 更新一个明确的测试块。
7. 报告每次调用的 ok、warnings 和 requiresRefresh。
```

## 整篇正文替换测试

仅对一次性文档运行：

```text
使用思源 MCP 测试整篇正文替换：
1. 创建包含多个顶层块、嵌套列表、中文、emoji、行内代码和代码围栏的测试文档。
2. 调用 siyuan_replace_document_body 写入完整替换 Markdown。
3. 确认结果包含初始顶层块数量、删除数量、appended=true、placeholderCleanupComplete、submittedHash 和 requiresRefresh=true。
4. 显式读取一次文档，确认替换内容存在且没有乱码。
5. 只有明确启用危险权限时才删除测试文档。

预期：替换工具本身不执行正文回读、快照或回滚。
```

## 公式与代码测试

测试 Markdown 至少应覆盖：

````markdown
行内公式：$\sqrt{x}+\bar{x}$

行内代码：`${sourceDir}`

```cmake
set(FIRST "${FIRST_VALUE}")
set(SECOND "${SECOND_VALUE}")
```
````

预期：

- 公式以单反斜杠 KaTeX 写入；
- `${...}` 在行内代码和 fenced code block 中按字面量保存；
- 代码中的多个 `$` 不会被误判为跨行公式；
- 异常控制字符和高置信度裸 KaTeX 命令会在调用 CLI 前被拒绝。

## 危险权限拒绝测试

保持 `SIYUAN_MCP_ALLOW_DANGEROUS` 未设置，使用明显无效的测试 ID 调用危险工具。所有调用都应返回 `ok=false` 并说明需要显式启用危险权限。不要为了验证拒绝逻辑而重新启用危险权限。

重点工具包括：

- `siyuan_delete_block`
- `siyuan_remove_document`
- `siyuan_remove_notebook`
- `siyuan_history_rollback`
- `siyuan_repo_checkout`
- `siyuan_asset_clean`
- `siyuan_database_item_remove`
- `siyuan_file_delete`

## 发布前检查

```bash
npm test
npm run build
npm pack --dry-run
```

还应确认：

- MCP Server 报告的版本与 `package.json` 一致；
- npm 包只包含 `dist`、`docs`、`README.md`、`LICENSE` 和必要元数据；
- `dist/index.js` 保留 Node.js shebang；
- 至少在一个干净环境中安装 `.tgz` 并启动 MCP Server；
- 真实工作空间测试生成的文档和日记标记已经记录。
