# 架构设计

服务端负责工具语义、权限、目标校验和准确执行结果；宿主负责 MCP 之外的访问路径。用户可见边界见[写入保护](safety.md)。

```text
MCP schema → profile 过滤 → 串行调度 → 权限与目标检查
  → CLI 参数数组执行 → 按范围验证 → 审计与结果
```

不提供任意命令工具或写 SQL。CLI 通过 spawn(file, args) 执行，不用 shell 字符串插值。

## 模块

| 文件 | 职责 |
| --- | --- |
| src/index.ts、src/serverMetadata.ts | stdio 入口、版本和初始化规则 |
| src/toolProfiles.ts | 工具暴露集合、核心写能力状态 |
| src/tools.ts | 过滤注册、串行调度、拒绝审计 |
| src/readTools.ts | 读取、搜索、health、导出 |
| src/writeTools.ts | 写入、patch 和全文替换 |
| src/writeSafety.ts | 目标、类型/归属和验证 |
| src/databaseTools.ts、src/dangerousTools.ts | 数据库及管理操作 |
| src/toolHelpers.ts | 注册、权限、审计执行、结果封装 |
| src/cli.ts、src/argBuilders.ts | CLI 执行、超时、参数与输出 |
| src/audit.ts | JSONL 日志、正文脱敏 |

## 权限与发现

minimal 默认只读；standard 提供日常工具和重命名；full 提供管理集合。profile 控制暴露，环境变量控制执行。全文替换在 standard 可见，需要普通写入权限和 Agent 在聊天中取得用户确认。health 与注册共用 profile 定义。

初始化说明、工具描述、schema、失败结果共同说明能力边界。仓库 Markdown 不会自动成为 Agent 指令。缺失能力不能通过直接 HTTP 或文件操作自动补齐。

## 目标检查与调度

writeSafety 仅构造固定 SELECT，严格校验 ID 后拼接值。使用 blocks 表的 d、p 等类型，未知类型拒绝；CLI block get 的 NodeDocument 不会被当作普通内容块。

单操作查询目标；patch 一次查询文档关系元数据，确认归属、parent/previous、重复破坏性目标和祖先冲突。关系查询不读取整篇 Markdown。标题区段破坏性操作单独执行。append/insert 支持多块内容，update 只允许单块。

同进程调用串行执行，但不能锁定思源 UI 或其他进程；队列不是事务、旧版本检查或条件写入。

## 写入与验证

核心写入不再自动导出或创建恢复档案。保留权限、目标元数据、范围和依赖检查，随后执行并按范围验证；无自动回滚。

创建与追加检查 CLI 结果；插入另检查位置；改名只回查标题；单块更新只读取目标；patch 合并查询 update/delete 结果；全文替换读正文一次。没有重试、重写、再验证循环。

全文替换冻结初始顶层块 ID、倒序删除、识别明确的空段落、追加一次正文、清理记录的占位块。占位信息不完整时不猜测删除。追加失败后不继续清理。各失败点保留进度。

Markdown 比较忽略生成 IAL，保留 fenced code 中的字面内容；比较失败不证明写入没发生，也不验证所有属性、引用或并发结果。自动回滚、旧版本令牌和幂等存储未实现。

## 结果与审计

保留 ok、data、warnings、command、必要时有界 raw。失败工具结果映射为 MCP isError:true，执行状态与验证状态分开，字段见[写入保护](safety.md)。

CLI 写调用先记录 intent，再执行，再记录 result。写前日志失败为 not-started；写后日志失败保留执行结果。非零退出和超时保守视为 unknown，禁止盲目重试。明确的 handler 前置拒绝也记录日志。

Markdown 在日志 input 中替换为长度、字节数和 SHA-256。原始 CLI 错误和其他属性不应被当成全部经过正文脱敏，提交诊断前仍需审查。

MCP 不公开 dryRun。内部参数构造保留 dry-run 支持，但正常调用获准后直接执行，没有要求 Agent 先 dry-run 的隐式流程。
