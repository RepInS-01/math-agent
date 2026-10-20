# Math_Agent

[English](README.md) | 中文

一个用于 DeepSeek Harness 的**数学训练预设**——不是解题器。

它不会替学员解题，而是通过快速反馈帮助学员打磨数学理解、建立直觉。核心是一个**程序化的零泄漏输出守卫**，从机制上保证教练永远不会泄露答案。

## 功能特性

- 🧑‍🏫 **教练，而非解题器**：绝不给出完整解答、关键步骤或最终答案。跟随学员的思路，确认正确的部分，指出有问题的部分。
- 📋 **开课前检查**：每次训练开始前，先核实题目定义良好、条件充分、没有错误。
- 🧠 **程序化尝试追踪**：学员尝试的每条思路都通过 `attempt_update` 工具记录为程序状态（状态：in-progress / flawed / validated / incomplete），每一步都渲染进系统提示，会话恢复后从会话日志重建。若连续多轮没有更新，会在提示中提醒教练。长会话还可以额外把尝试记录持久化到 `notes/attempts.md`。
- 🪜 **提示阶梯与逐会话提示策略**：辅导反馈遵循四级提示阶梯（L0 提问 → L1 点明原理 → L2 给出骨架 → L3 部分构造，仅限万不得已）。每一次 L1+ 提示都通过 `hint_log` 工具记录并在系统提示中计数——计数上升就是放慢节奏的信号。会话开始时教练会通过 `ask_user_question` 询问学员的提示策略（strict = 仅 L0/L1；normal = 完整阶梯）并用 `hint_policy` 工具记录——逐会话、可恢复、可中途切换。`cordis.patch.yml` 里的 `strictness` 只是从未选择过的会话的默认值（出厂为 `strict`）；在 strict 策略下，`hint_log` 会以程序方式拒绝 L2/L3。
- 🚦 **总结纪律**：在任何思路被完整验证之前只允许"阶段性总结"；最终总结由程序解锁——只有当某条思路通过 `attempt_update` 被记录为 `validated` 后，零泄漏守卫才会放行，而不是凭模型自己说了算。
- 📚 **最终综合**：最终复盘会回顾训练中探索过的每一条思路，抽象出学员自己的推理模式，并且不轻言"有缺陷"的思路在数学上不可能。
- 🔒 **程序化零泄漏守卫**（核心亮点）：挂在 `llm/stream` 上的流级守卫，整体检查教练的回复。一旦检测到答案线索（数值、区间、对错判断、答案形式），**整个回复被替换**——模型原始输出的一个字符都不会到达学员。这不依赖模型的"自觉"。
- 🗂️ **可扩展知识库接口**：预留的本地/在线知识库集成（`knowledge-base` skill）。最终综合时优先采用有事实和数据支撑的理解。

## 目录结构

```
math-agent/
├── package.json          # Bundle 清单：声明 `dsh.bundle.patch` → cordis.patch.yml
├── cordis.patch.yml      # Bundle 补丁：`preset-math-agent` 声明——展示元数据 + 完整 Cordis 插件列表（工具、persona、技能、守卫注册）
├── attempt-tracker.js    # 训练状态插件：attempt_update + hint_log + hint_policy 工具、提示注入、validated 标志、超时未更新提醒（从会话日志折叠重建）
├── zero-leak-guard.js    # 程序化零泄漏输出守卫插件（经 profile 的 node_modules 符号链接寻址——见 cordis.patch.yml 中的 RESOLUTION ANCHOR 注释）
├── zero-leak-guard.test.mjs # 测试语料：必须拦截的泄漏样本、必须放行的正常回复、追踪器 + 解锁行为
├── README.md             # 英文说明
├── README.zh.md          # 本文件
├── LICENSE               # MIT 许可证
└── skills/
    ├── coaching-protocol/  # 辅导协议：工作流程、红线、零泄漏规则
    ├── knowledge-base/     # 知识库集成接口（预留）
    └── final-synthesis/    # 最终综合的工作流程与输出结构
```

## 安装

前置条件：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) **0.2.1 或更新版本**——**桌面端 App** 或 Web UI（`npx @deepseek-ai/dsh web`）均可。本预设派生自 `standard` 预设，以 DSH **bundle** 形式发布（`package.json` + `cordis.patch.yml`）。（上一个提交支持 0.1.7；0.2.1 新增了 `dsh-tool-schedule` 和 `dsh-plugin-market`，本预设的插件列表已引用它们。）

> 0.1.7 之前的 DSH 版本使用另一套机制（`$DSH_HOME/.agent-presets/<id>/` 目录，
> 内含 `preset.yml` + `agent.cordis.yml`）。该目录已经没有任何东西读取了；
> 下文的 bundle 形式是唯一受支持的安装方式。

1. 把 bundle 安装进你的 DSH profile，任选一种方式：
   - **GUI（桌面端与 Web 端通用）**：打开左侧边栏的 **插件（Plugins）** 页，选择 **Add plugin**，输入 `github:RepInS-01/math-agent`。桌面端的包操作由 App 自己管理——`dsh plugin --profile desktop` CLI 会被拒绝，请使用插件页；或
   - **Agent**：在运行 Creator 模式的会话中（该模式启用了 `plugin_manager` 工具），让 agent 执行 `install_bundle`，`target` 设为 `github:RepInS-01/math-agent`。安装 bundle 会在 Host 进程中执行插件代码，因此需要 Full access 或一次批准。

   **想开发这个预设？** 克隆仓库并**保持该 checkout 不移动**，安装时改为填写 checkout 的**绝对路径**（例如 `/Users/you/math-agent`）。这样安装器会建立 `link:` 依赖，之后对 checkout 的修改在重启后即生效：

   ```bash
   git clone https://github.com/RepInS-01/math-agent.git
   ```

2. 重启应用（桌面端：完全退出后重新打开；Web：重启 `dsh web`）。**Math_Agent** 预设（id：`math-agent`）会出现在预设列表中。用旧预设录制的会话可以原样恢复，因为 id 相同。

挂载验证（每次修改后都应执行）：新建会话并选择 **Math_Agent** 预设。选择成功即组合挂载成功；挂载失败时 GUI 会把选择回退到默认预设并显示错误。已安装的 bundle 及其插件行的激活状态可以用 `plugin_manager` 工具（`list_bundles` / `list_plugins`）查看。

## 使用方法

1. 在 DeepSeek Harness GUI（桌面端或 Web）中新建会话，选择 **Math_Agent** 预设（id：`math-agent`）。
2. 用这样的开场白开始训练：

   > 我想开始一个数学训练。题目：设 aₙ = √(1 + aₙ₋₁)，a₀ = 1。证明 {aₙ} 收敛并求其极限。我想用单调收敛定理，但不确定怎么证有界性。

3. 无论你多么坚持地索要答案——零泄漏守卫始终挡在你和模型之间。

## 零泄漏守卫的工作原理

- 挂在 `llm/stream` waterfall 上（进程级派发）；**仅对系统提示中包含教练签名（零泄漏铁律 / 数学教练）的请求生效**。其他所有会话原样通过，不受影响。
- 模型的完整输出在送达前经过程序化检查。一旦命中答案线索模式（区间、对错判断、答案形式、小数值等），**整段回复被替换**为固定的拦截消息。
- 拦截发生在流层：会话日志记录的是拦截消息，而非泄漏文本。下一轮模型看到自己的拦截通知，会自动改为合规的表述。
- **解锁是程序状态，不是模型判断**：`attempt-tracker` 插件（挂在同一个 isolate realm 中）持有逐会话的尝试列表。只有当某条思路通过 `attempt_update` 工具被记录为 `validated`，守卫才会放行，让最终综合给出完整解答。追踪器缺失、会话未知、没有已验证的尝试——全部按拦截处理，任何方向都是 fail-closed。
- **计算/搜索工具在同一把锁下被禁用**：预设层的 `tools.guard` 会拒绝 `bash`、`pwsh`、`web_search` 和 `run_code`，直到有思路被验证。流检查看不到工具输出，所以凡是能算出或检索到答案的工具都被直接禁用——解禁与最终综合的解锁使用同一份程序状态。
- **锁定阶段隐藏推理过程**：教练的思考过程常常直接推出答案，而客户端 UI 会把推理行渲染给学员。在没有思路被验证时，reasoning delta 会折叠为固定占位文本，reasoning 块的内容会被改写——保持原始块顺序，使持久化消息与 pi-ai 的 replay 状态保持一致。一旦有思路被验证，推理过程恢复显示。
- 模式定义集中在 `zero-leak-guard.js` 顶部的 `LEAK_PATTERNS` 中，可以自由扩展。

### 已知边界

程序化守卫拦截的是**可枚举的泄漏形式**（数值、区间、判断词），工具闸门覆盖计算/搜索通道。还有一个通道只能靠 persona 约束，守卫无法强制：

- **不含数字的语义级**提示（例如"这个数恰好是你刚才推导的方程的根"）。

发现新的泄漏变体时，把它加进 `LEAK_PATTERNS` 即可（同时在 `zero-leak-guard.test.mjs` 里补一个样本）。

## 测试

守卫附带零依赖的测试语料（Node 内置测试运行器）：

```bash
node --test zero-leak-guard.test.mjs
```

每次修改 `LEAK_PATTERNS`、`attempt-tracker.js` 或守卫的解锁逻辑后都要运行。语料覆盖：必须拦截的泄漏样本、必须放行的正常辅导回复、已验证会话的解锁（及其 fail-closed 回退）、尝试追踪器的状态记录、提示日志（包括 strict 策略对 L2/L3 的拒绝）、超时未更新提醒、提示渲染和会话日志折叠。每发现一种新的泄漏变体就加入拦截样本，每收到一个误报就加入放行样本。

> **重载注意事项**：相对路径的预设插件（`./attempt-tracker.js`、`./zero-leak-guard.js`）通过 Node 的 ESM 加载器导入，没有缓存清除。修改插件代码或 `cordis.patch.yml` 后，**重启 DSH host**（桌面端：完全退出并重新打开；Web：重启 `dsh web`）——如果组合本身有改动，还要在插件页重新安装 bundle。只在 UI 里重新选择预设是不够的，因为重新挂载会复用缓存的模块。技能文件（`skills/**/SKILL.md`）每个会话从磁盘重新读取，不需要重启。

## 知识库集成（预留）

`skills/knowledge-base/SKILL.md` 定义了统一的 `search` 接口契约（本地目录 + 在线检索），目前处于预留状态：

- **本地**：工作区 `kb/` 目录，按主题组织的 Markdown 文件；通过 `glob` + `grep` 检索。
- **在线**：`web_search` 检索，按来源 URL 引用。
- 所有结果都带有 `confidence` 标签（fact / data / reference / heuristic）。最终综合优先采用有事实和数据支撑的理解。

## 自定义

- 修改 persona / 辅导协议：编辑 `cordis.patch.yml` 中的 `persona` 行和 `skills/coaching-protocol/SKILL.md`。
- 修改守卫模式：编辑 `zero-leak-guard.js` 中的 `LEAK_PATTERNS`。
- 修改后务必重新验证挂载：在 GUI 中重新选择预设（挂载失败会回退到默认预设），或用 `plugin_manager` 工具（`list_plugins`）查看 `preset-math-agent` 行的激活状态。

## 致谢

本项目的灵感来自 Bilibili UP主 **PiKaChu345** 最初提出的数学教练概念。原作者尚未公开发布其实现。本项目仅基于公开描述的想法进行独立重实现，未使用原作的任何源代码或专有材料。原始概念的全部功劳归于 PiKaChu345。

## 许可证

[MIT](LICENSE)
