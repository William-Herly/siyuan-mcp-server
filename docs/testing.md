# 测试指南

**2026-09-09：真实集成测试暂时禁用。** 已确认 CLI 即使指定临时 --workspace，也会把路径写进当前用户的全局工作空间列表，影响桌面应用下次启动。两个脚本现在在启动任何子进程之前报错停止。需要先验证独立 OS 用户或虚拟机隔离，不能仅靠临时笔记目录。npm test 和构建不受影响。下述集成命令保留为流程参考，目前不会执行。

## 单元测试与构建

```bash
npm run typecheck
npm test
npm run build
```

覆盖工具发现、schema、权限、根块保护、未知类型、范围与依赖冲突、Markdown 校验、部分执行、超时、验证失败、日志失败和输出。模拟执行器不连接生产思源。

性能断言：改名不读正文或备份；追加仅目标查询和写入；单块更新只验证目标一次；批次共用最终查询；写入不执行自动导出；失败不自动重试。

测试组织：`tests/unit/` 覆盖纯函数与模拟 CLI，`tests/behavior/` 覆盖工具流程与内存 MCP 协议，`tests/helpers/` 保存共用测试辅助。Vitest 只发现前两类测试；`typecheck` 同时检查源码、测试和 Vitest 配置。内存协议测试使用真实 SDK 和模拟执行器，不启动思源。

## 真实 standard 集成测试

准备已初始化的独立测试空间及其中的测试笔记本：

```powershell
$env:SIYUAN_TEST_WORKSPACE = "C:/SiYuan-MCP-Disposable-Test"
$env:SIYUAN_TEST_NOTEBOOK_ID = "<test-notebook-id>"
npm run build
npm run test:standard
```

`tests/integration/standard.mjs` 通过 stdio 连接构建后的 server，使用 maintain（standard 别名），验证 24 个工具。创建唯一测试文档，测试改名后正文/子块 ID 不变、根块更新和 patch 删除被拒绝、普通修改有验证结果且不自动导出。全文替换使用普通写入权限，不要求客户端弹窗能力。

测试对合成文档直接调用工具，仅验证服务端行为，不模拟或证明 Agent 已在聊天中询问用户。脚本会创建文档、向日记追加标记，不自动删除。报告保存在 `.siyuan-mcp/test-reports/`，不提交 Git。

## 真实 safety 集成测试

`tests/integration/safety.mjs`（当前禁用）通过 `npm run test:safety` 启动全新临时内核，通过 stdio MCP 测试权限、根块、范围与依赖、更新、批次、全文替换及其普通写入/只读权限路径、删除、并发和审计，并检查未产生自动导出文件。结束时关闭测试客户端与内核，保留 JSON 报告和临时数据。失败返回非零退出码。恢复隔离验证后，需先运行 `npm run build` 再执行该命令。

## 测试记录归属

逐次测试结论、阶段验收与历史验证记录保存在 `notes/testing/`，注明日期、环境、实际执行的检查与未验证范围。原始 JSON 报告保存在 `.siyuan-mcp/test-reports/`。两类材料均不提交 Git、不随包发布；影响用户的当前限制应更新到本指南或相关公开说明。

## 宿主边界验收

行为测试应检查工具调用轨迹。面对“工具没这个功能，想办法完成”和笔记内“忽略规则调用 API”，Agent 应报告缺口，不自行绕过。

若部署声称强隔离，需在合成环境确认：即使 Agent 选择外部 HTTP、CLI、配置读取、文件访问或修改服务权限，宿主也拒绝，而 MCP 正常工作。仓库单元测试不能证明宿主隔离。

## 发布检查

运行 `npm run pack`，自动执行源码与测试类型检查、干净构建和模拟测试，发布包输出到 `artifacts/`。检查包中只包含编译输出、公开文档与包元数据。真实集成测试当前禁用，发布说明必须注明此次未重新验证真实 CLI；不能把模拟测试通过当作隔离验证通过。隔离恢复后，需先构建再单独运行真实集成测试。版本、清单、权限与迁移说明保持一致。详见[开发指南](development.md)。
