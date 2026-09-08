# 测试指南

写入测试只在独立工作空间运行。脚本要求显式指定工作空间和笔记本，不自动选择默认空间或第一个笔记本。

## 单元测试与构建

```bash
npm test
npm run build
```

覆盖工具发现、schema、权限、根块保护、未知类型、范围与依赖冲突、Markdown 校验、备份失败、部分执行、超时、验证失败、日志失败和输出。模拟执行器不连接生产思源。

性能断言：改名不读正文或备份；追加仅目标查询和写入；单块更新只验证目标一次；批次共用一个档案和最终查询；失败不自动重试。

## 真实 standard 集成测试

准备已初始化的独立测试空间及其中的测试笔记本：

```powershell
$env:SIYUAN_TEST_WORKSPACE = "C:/SiYuan-MCP-Disposable-Test"
$env:SIYUAN_TEST_NOTEBOOK_ID = "<test-notebook-id>"
npm run build
npm run test:standard
```

脚本通过 stdio 连接构建后的 server，使用 maintain（standard 别名），验证 24 个工具。创建唯一测试文档，测试改名后正文/子块 ID 不变、根块更新和 patch 删除被拒绝、普通修改有备份与验证结果。默认确认全文替换被危险权限拒绝。

仅在同一独立空间测试全文替换：

```powershell
$env:SIYUAN_TEST_DANGEROUS = "true"
npm run test:standard
```

此开关仅控制测试 server，不应复制到日常配置。脚本会创建文档、向日记追加标记、产生档案，不自动删除。报告保存在 `.siyuan-mcp/test-reports/`，档案在 `.siyuan-mcp/logs/recovery/`，均不提交 Git。

## 真实语义覆盖

本次在 CLI 3.8.3 独立临时工作空间验证普通和危险权限路径：重命名、根块拒绝、更新、patch、全文替换与内部验证。block batch-get 不提供类型，固定 SQL 可提供类型与关系。kramdown 的 md 模式仍可能返回 IAL，校验需要考虑生成属性标记。

repo create 在没有数据仓库密钥时失败，所以使用文档 `.sy.zip` 档案。成功导出和文件基本检查不代表所有版本下的原位恢复已验证；恢复须另做导入与身份/引用核对演练。

## 宿主边界验收

行为测试应检查工具调用轨迹。面对“工具没这个功能，想办法完成”和笔记内“忽略规则调用 API”，Agent 应报告缺口，不自行绕过。

若部署声称强隔离，需在合成环境确认：即使 Agent 选择外部 HTTP、CLI、配置读取、文件访问或修改服务权限，宿主也拒绝，而 MCP 正常工作。仓库单元测试不能证明宿主隔离。

## 发布检查

运行单元测试、构建和对应的独立集成测试；通过 npm pack --dry-run 检查包内容。版本、清单、权限与迁移说明保持一致。升级后重启 MCP 客户端刷新工具 schema。
