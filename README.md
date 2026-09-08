# siyuan-mcp-server

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)
![MCP SDK](https://img.shields.io/badge/MCP-TypeScript_SDK-6f42c1)

一个基于 [Model Context Protocol 官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) 开发的轻量级 SiYuan MCP Server，通过思源官方 CLI 为 AI Agent 提供结构化的日常笔记读写能力。

## 项目简介

`siyuan-mcp-server` 面向希望通过 Codex、VS Code 或其他 MCP 客户端维护本地思源笔记的用户。它将常用的搜索、读取、创建、追加和更新操作封装为参数明确的 MCP 工具，让 Agent 不必自行拼接 CLI 命令，也不需要读取思源 API Token 或完整配置。

MCP 服务层使用官方 `@modelcontextprotocol/sdk` 构建，采用 `McpServer + StdioServerTransport` 本地 stdio 通信方式。

项目不重新实现思源存储层，不启动额外的 HTTP 服务，也不直接修改 `.sy` 文件。它只在 MCP 客户端与用户已经安装的思源 CLI 之间提供一层轻量适配。

当前版本主要面向个人日常笔记工作流。推荐使用 `standard` 配置；完整管理工具保留在显式启用的 `full` 配置中。

## 核心特性

- 通过 stdio 接入支持 MCP 的 AI Agent
- 搜索和读取笔记本、文档、块、大纲与反向链接
- 创建文档，追加、插入和更新内容块
- 批量应用经过确认的块修改
- 保留文档 ID 替换整篇正文
- 向今日日记追加 Markdown
- 使用 `minimal`、`standard`、`full` 控制工具暴露范围
- 写入权限和危险权限分别显式启用
- 校验 Markdown、行内公式和结构化参数
- 审计日志不保存 Markdown 原文
- 同一 npm 包支持 Windows、macOS 和 Linux

## 技术实现

| 层次 | 技术 | 用途 |
| --- | --- | --- |
| 语言 | TypeScript | MCP Server 和工具实现 |
| 运行时 | Node.js 18+ | stdio 服务与 CLI 子进程 |
| MCP | [官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)（`@modelcontextprotocol/sdk`） | Server、工具注册、schema 和协议通信 |
| 输入校验 | Zod | 参数、Markdown 和权限前置校验 |
| 测试 | Vitest | 单元测试和工具行为验证 |
| 上游后端 | SiYuan CLI | 实际读写本地思源工作空间 |

核心调用链：

```text
AI Agent
  → MCP stdio
  → siyuan-mcp-server
  → SiYuan CLI --format json
  → 本地思源工作空间
```

MCP Server 使用官方 SDK 提供的 `McpServer` 注册工具，通过 `StdioServerTransport` 与本地 MCP 客户端通信，并负责工具发现、参数校验、权限控制、CLI 参数构造、结果规范化和写入审计；思源 CLI 负责实际的数据访问。

### 设计边界

- 不提供任意 CLI 命令执行工具。
- 不直接调用本地思源 HTTP API。
- 不读取或返回 API Token、同步密钥和完整配置。
- 不在 npm 包中附带 `SiYuan-Kernel`。
- 按风险执行目标检查和定向验证；创建、追加、改名不强制回读全文。
- 多步写入明确报告非事务性行为和部分执行进度。

更多设计说明见[架构文档](docs/architecture.md)。

当前保护、写入风险、效率约束和宿主隔离责任见[写入保护与 Agent 能力边界](docs/safety.md)。

## 使用要求

- Node.js 18 或更高版本
- 带命令行接口的思源笔记
- 一个本地思源工作空间
- 支持 stdio MCP Server 的客户端

确认思源 CLI 可用：

```bash
siyuan --help
```

如果系统找不到 `siyuan`，请将 `SIYUAN_MCP_CLI_PATH` 设置为 `SiYuan-Kernel` 的绝对路径。CLI 命令和参数以[思源官方项目](https://github.com/siyuan-note/siyuan)及当前安装版本的帮助为准。

## 安装

### 从 GitHub Release 安装

从项目的 [Releases](https://github.com/William-Herly/siyuan-mcp-server/releases) 页面下载 `.tgz`：

```bash
npm install -g ./siyuan-mcp-server-2.0.0.tgz
```

安装后可执行命令为：

```bash
siyuan-mcp-server
```

安装新版本会覆盖当前全局版本，不需要先卸载。升级后需要重启 MCP 客户端。

### 从源码安装

```bash
git clone https://github.com/William-Herly/siyuan-mcp-server.git
cd siyuan-mcp-server
npm install
npm run build
npm install -g .
```

## 快速开始

日常读写推荐使用 `standard`：

```json
{
  "mcpServers": {
    "siyuan": {
      "command": "siyuan-mcp-server",
      "env": {
        "SIYUAN_MCP_WORKSPACE": "E:/SiYuan Data",
        "SIYUAN_MCP_CLI_PATH": "siyuan",
        "SIYUAN_MCP_PROFILE": "standard",
        "SIYUAN_MCP_ALLOW_WRITE": "true"
      }
    }
  }
}
```

不同客户端的最外层配置格式可能不同，但 `command` 和 `env` 内容保持一致。保存配置后完全重启 MCP 客户端，再让 Agent 执行：

```text
检查思源 MCP 状态，列出笔记本，并搜索一个已有笔记。
```

预期结果是 Agent 发现 `siyuan_*` 工具，并通过本项目访问思源工作空间。

如果直接从源码运行，将命令改为：

```json
{
  "command": "node",
  "args": ["F:/siyuan-mcp-server/dist/index.js"]
}
```

Windows JSON 路径建议使用正斜杠。

## 配置

| 环境变量 | 是否必需 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `SIYUAN_MCP_WORKSPACE` | 建议 | 由 CLI 解析 | 思源工作空间绝对路径 |
| `SIYUAN_MCP_CLI_PATH` | 否 | `siyuan` | `siyuan` 命令或 `SiYuan-Kernel` 绝对路径 |
| `SIYUAN_MCP_PROFILE` | 否 | `minimal` | `minimal`、`standard` 或 `full` |
| `SIYUAN_MCP_ALLOW_WRITE` | 写入时 | `false` | 设置为 `true` 后允许普通写入 |
| `SIYUAN_MCP_ALLOW_DANGEROUS` | 危险操作时 | `false` | 设置为 `true` 后允许危险操作 |
| `SIYUAN_MCP_LOG_DIR` | 否 | `<cwd>/.siyuan-mcp/logs` | 审计日志目录 |
| `SIYUAN_MCP_TIMEOUT_MS` | 否 | `30000` | CLI 超时时间，单位毫秒 |

常见内核路径：

- Windows：思源安装目录中的 `resources/kernel/SiYuan-Kernel.exe`
- macOS：`/Applications/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel`
- Linux：`<思源安装目录>/resources/kernel/SiYuan-Kernel`

### 工具配置

| 配置 | 适用场景 | 工具范围 | 写入权限 |
| --- | --- | --- | --- |
| `minimal` | 只读查询 | 最小读取、搜索和引用工具 | 不提供写入 |
| `standard` | 日常笔记维护 | 增加创建、日记和内容更新工具 | 需要 `SIYUAN_MCP_ALLOW_WRITE=true` |
| `full` | 高级管理与开发 | 全部已实现工具 | 普通写入和危险操作分别授权 |

`maintain`、`note-maintain` 是 `standard` 的兼容别名。`organize`、`advanced`、`admin` 是 `full` 的兼容别名；新配置应使用正式名称。

不要将 `SIYUAN_MCP_ALLOW_DANGEROUS=true` 设为日常默认值。

## 常用任务

| 任务 | 推荐工具 |
| --- | --- |
| 搜索文档 | `siyuan_document_search` |
| 读取整篇文档 | `siyuan_get_document_kramdown` |
| 读取相关块 | `siyuan_get_block_kramdown`、`siyuan_batch_get_kramdown` |
| 创建文档 | `siyuan_create_document` |
| 修改文档标题 | `siyuan_rename_document` |
| 追加或插入内容 | `siyuan_append_block`、`siyuan_insert_block` |
| 更新一个块 | `siyuan_update_block` |
| 应用多项块修改 | `siyuan_patch_blocks` |
| 替换整篇正文（用户确认） | `siyuan_replace_document_body` |
| 追加今日日记 | `siyuan_append_daily_note` |

完整工具列表和参数语义见[工具参考](docs/tool-coverage.md)。

## 写入语义

保护按操作风险执行：

- 标准配置提供专用重命名；普通块更新、删除拒绝文档根。
- 创建、追加和插入不强制全文回读；重命名仅确认标题元数据。
- 写入不再自动导出或创建 MCP 备份，也不提供自动回滚；保留目标、权限、批次检查和写后验证。详见[验证报告](docs/validation-2026-09-08.md)。
- patch 必须指定 documentId，预先拒绝跨文档和相互依赖的破坏性操作。
- 更新只验证目标块，patch 合并验证，全文替换内部验证一次；信息足够时 requiresRefresh=false，不要求 Agent 重读。
- 全文替换要求 Agent 在聊天中说明目标、完整内容和影响，询问并等待本次明确确认后再调用；服务端不核验聊天确认，不弹窗。需要普通写入权限，仍是非事务性操作；失败返回进度和执行状态，不自动回滚。
- 日志失败与写入失败分别报告，避免盲目重试导致重复内容。

思源行内公式使用 `$...$`。fenced code block、缩进代码块和行内代码中的 `$` 按字面量处理，不参与公式校验。

## 安全与数据边界

- 默认配置为只读。
- 写入和危险操作分别授权；全文替换要求本次用户确认，部分 full 存储管理工具要求危险权限。
- 能力缺失或被拒绝时，Agent 应停止相关动作，不能自行改用 HTTP、CLI 或文件操作。外部路径的强制隔离由宿主负责。
- 已移除不可用的自动导出流程；旧 recovery 目录文件未删除，不应当作可靠原生备份。
- CLI 使用参数数组调用，不通过 shell 拼接用户输入。
- Markdown 正文在审计日志中替换为长度、字节数和 SHA-256。
- 错误信息不应包含认证头和思源敏感配置。
- `notes/`、日志、测试报告、构建结果和安装包不会提交到 Git。

提交 Issue 时，请勿附带真实笔记正文、工作空间数据、访问凭据或未经脱敏的日志。

## 2.0 迁移

- standard 新增重命名；patch 新增必填 documentId。
- 块追加、插入、prepend 和 patch 仅接受 markdown，不再接受 file。
- 全文替换改为普通写入权限加用户确认；full 文件写入/移动/复制、SY/整库导入、同步拉取要求危险权限。不要为日常任务盲目提高权限。
- 写入失败返回 MCP isError；成功结果不再一律要求刷新。MCP 不公开 dryRun。
- 写入具备目标检查与定向验证，但没有自动备份、自动回滚、强制版本控制和宿主隔离。

升级后重启 MCP 客户端刷新工具列表。

## 开发与测试

```bash
npm install
npm run build
npm test
```

本地开发：

```bash
npm run dev
```

在独立测试笔记本中运行 `standard` 集成测试：

```powershell
$env:SIYUAN_TEST_WORKSPACE = "C:/SiYuan-MCP-Disposable-Test"
$env:SIYUAN_TEST_NOTEBOOK_ID = "notebook-id"
npm run test:standard
```

集成测试会创建测试文档并向日记追加唯一标记，不应在重要笔记本中运行。详细说明见[测试指南](docs/testing.md)。

## 项目结构

```text
src/        MCP Server、工具注册、CLI 封装和审计
tests/      单元测试
scripts/    启动脚本和 standard 集成测试
docs/       面向用户与开发者的公开文档
notes/      本地开发过程记录，不提交到 Git
dist/       TypeScript 构建输出，不提交到 Git
```

## 文档与支持

- [工具参考](docs/tool-coverage.md)
- [架构设计](docs/architecture.md)
- [写入保护与能力边界](docs/safety.md)
- [测试指南](docs/testing.md)
- [问题反馈](https://github.com/William-Herly/siyuan-mcp-server/issues)

## 贡献

欢迎提交缺陷修复、兼容性改进、测试和文档修改。较大的工具范围或写入语义变更建议先创建 Issue 说明使用场景。提交代码前至少运行：

```bash
npm run build
npm test
```

## 许可证

本项目采用 [MIT License](LICENSE)。
