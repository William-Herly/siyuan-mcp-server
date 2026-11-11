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
| src/mcp/ | 窄注册接口、SDK 适配、profile 过滤、串行包装、拒绝审计和协议结果 |
| src/tools/ | 读取、写入、数据库、管理工具的描述、schema 和处理入口 |
| src/operations/ | 文档读取兼容、块写入、patch、全文替换和受权限控制的通用写入 |
| src/safety/ | 权限、目标类型/归属、插入位置和写后验证 |
| src/markdown/ | 无 I/O 的 Markdown 校验、单块判断与内容规范化 |
| src/cli/ | CLI 子进程执行、超时、输出解析、参数、路径与 SQL 校验 |
| src/runtime/ | JSONL 审计、正文脱敏、审计写入执行与进程内串行队列 |

工具模块只依赖 `ToolRegistrar` 的注册能力；`createToolRegistrar` 在入口连接真实 MCP SDK，测试可以注入模拟注册器。SDK 的兼容类型适配集中在此边界，不再把部分对象断言为完整服务端。

主要依赖方向为 `mcp/registerTools → tools → operations → CLI/校验`。操作结果使用 `NormalizedResponse`，在 MCP 层转换为协议结果。参数构造和 Markdown 处理不依赖 MCP SDK；串行队列独立于目标校验。工具入口可直接组合小型操作，复杂批次和全文替换由专用流程模块维护。

## 权限与发现

minimal 默认只读；standard 提供日常工具和重命名；full 提供管理集合。profile 控制暴露，环境变量控制执行。全文替换在 standard 可见，需要普通写入权限和 Agent 在聊天中取得用户确认。health 与注册共用 profile 定义。

初始化说明、工具描述、schema、失败结果共同说明能力边界。仓库 Markdown 不会自动成为 Agent 指令。缺失能力不能通过直接 HTTP 或文件操作自动补齐。

## 目标检查与调度

`safety/targets.ts` 仅构造固定只读查询，严格校验 ID 后拼接值。操作目标使用 blocks 表的类型白名单；其他节点可作为关系元数据读取，但未知操作目标仍拒绝。CLI block get 的 NodeDocument 不会被当作普通内容块。

单操作只查询目标元数据；patch、带锚点的 insert 和 full 的 move 用一次有界递归查询读取本次目标与必要祖先，不扫描整篇关系表，也不读取旧正文。统一位置解析区分标题语义父级和实际容器，兼容历史的直接标题 parent；缺失、循环、过深或截断均停止。具体限制与参数见[工具参考](tool-coverage.md)。标题区段破坏性操作单独执行。append/insert 支持多块内容，update 只允许单块。

CLI 层统一传递可选 home 配置根与固定工作空间。自动发现成功或失败均缓存，失败阻止数据命令；health 只报告配置和已有观测，不额外启动探测或宣称后端兼容。

同进程调用串行执行，但不能锁定思源 UI 或其他进程；队列不是事务、旧版本检查或条件写入。

## 写入与验证

核心写入不再自动导出或创建恢复档案。保留权限、目标元数据、范围和依赖检查，随后执行并按范围验证；无自动回滚。

创建与追加检查 CLI 结果；插入另检查位置；改名只回查标题；单块更新只读取目标；patch 合并查询 update/delete 结果；全文替换读正文一次。没有重试、重写、再验证循环。

全文替换冻结初始顶层块 ID、倒序删除、识别明确的空段落、追加一次正文、清理记录的占位块。占位信息不完整时不猜测删除。追加失败后不继续清理。各失败点保留进度。

Markdown 比较忽略生成 IAL，保留 fenced code 中的字面内容；比较失败不证明写入没发生，也不验证所有属性、引用或并发结果。自动回滚、旧版本令牌和幂等存储未实现。

## 结果与审计

保留 ok、data、warnings、command、必要时有界 raw。失败工具结果映射为 MCP isError:true，执行状态与验证状态分开，字段见[写入保护](safety.md)。

CLI 写调用以 requestId 关联 intent 与 result，记录 CLI 阶段的 code/execution/verification；工具后续定向验证另由工具结果报告。写前日志失败为 not-started；写后日志失败保留执行结果。工作空间前置失败保持 not-started；非零退出、超时或输出超限保守视为 unknown，禁止盲目重试。明确的 handler 前置拒绝也记录日志。

日志 input 中已识别的正文、标题、属性和数据库值字段替换为长度、字节数和 SHA-256。原始 CLI 错误和其他字段不应被当成全部经过脱敏，提交诊断前仍需审查。文本正文保留空白，输出捕获有界，部分 JSON 不作为完整结果解析。

MCP 不公开 dryRun。内部参数构造保留 dry-run 支持，但正常调用获准后直接执行，没有要求 Agent 先 dry-run 的隐式流程。
