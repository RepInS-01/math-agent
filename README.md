# Math_Agent · 数学思维教练

一个基于 DeepSeek Harness 的 **Agent 预设（preset）**：数学训练/教练模式，不是解题模式。

它不替训练者做题，而是通过快速反馈帮助训练者打磨数学理解、建立数学直觉——并配有一个**程序化的零泄露输出守卫**，从机制上保证教练不会"忍不住"把答案说出口。

## 特性

- 🧑‍🏫 **教练而非解题器**：不直接给出完整解法、关键步骤或答案；沿训练者的思路走，确认正确的部分、指出有问题的部分。
- 📋 **题前检查**：每次训练开始前先确认题目意义明确、条件充足、无错误，再进入正式训练。
- 🧠 **思路追踪**：持续记录训练者尝试过的所有思路（状态：进行中 / 有瑕疵 / 已跑通 / 未完成），长训练可写入 `notes/attempts.md`。
- 🚦 **总结纪律**：思路跑通前只允许阶段性总结；一旦跑通才进入最终总结。
- 📚 **最终复盘**：最终总结会重跑训练中出现过的所有思路，归纳训练者自己的思路模式，不武断否定"有瑕疵"路线。
- 🔒 **程序化零泄露守卫**（核心亮点）：`llm/stream` 层守卫，对教练回复做整体检查，命中答案线索（数值、区间、对错判断、答案形态）时**整段替换**，模型的原始输出一个字都不会到达训练者——不依赖模型的"自觉"。
- 🗂️ **可扩展知识库接口**：预留本地/在线知识库接入方案（`knowledge-base` 技能），最终总结时优先引用有事实与数据支撑的理解。

## 目录结构

```
math-coach/
├── preset.yml              # 预设元数据（name / description）
├── agent.cordis.yml        # Cordis 组合：工具、persona、技能挂载、守卫注册
├── zero-leak-guard.js      # 程序化零泄露输出守卫插件（相对路径加载，随预设复制）
└── skills/
    ├── coaching-protocol/  # 训练协议：流程、红线、零泄露细则
    ├── knowledge-base/     # 知识库接入接口（预留）
    └── final-synthesis/    # 最终总结流程与输出结构
```

## 安装

前提：已安装 [DeepSeek Harness](https://github.com/deepseek-ai)（本预设基于 `standard` 复制，适用于 dsh 的 agent-presets 机制）。

```bash
# 方式一：直接拷贝到用户预设根目录
mkdir -p ~/.dsh/.agent-presets
cp -r math-coach ~/.dsh/.agent-presets/

# 方式二：在 dsh 会话内（推荐，自动完成加载与校验）
# 使用 agentPresets.copy 复制，或直接将该目录放入
# ${DSH_HOME:-$HOME/.dsh}/.agent-presets/ 后重启 dsh。
```

挂载校验（任何改动后都应执行）：

```
agentPresets.standingKeyFor('math-coach')  # → mounted OK
```

## 使用

1. 在 DeepSeek Harness Web GUI 新建会话，选择预设 **Math_Agent**（id: `math-coach`）。
2. 用类似开场白开始训练：

   > 我想开始一道数学题训练，题目是：设 aₙ = √(1 + aₙ₋₁)，a₀ = 1，证明数列 {aₙ} 收敛并求极限。我目前想从单调有界入手，但不太确定怎么证有界。

3. 反复逼问答案也没用——零泄露守卫会挡在模型前面。

## 零泄露守卫的工作原理

- 挂在 `llm/stream` waterfall 上，**只对 system 含教练特征（零泄露铁律/数学教练）的请求生效**，其他会话完全透传。
- 模型输出的整段文本先经程序检查：命中答案线索模式（区间、对错判断、答案形态、小数数值等）→ 整段替换为固定拦截文案。
- 拦截发生在流层：会话日志记录的是拦截文案而非泄露文本；模型下一轮会看到自己被拦截的通知，自动改用合规表述。
- 模式集集中在 `zero-leak-guard.js` 顶部的 `LEAK_PATTERNS`，可自行扩展。

### 已知边界

程序守卫封死的是**可枚举的泄露形态**（数值、区间、判断词）。不含数字的**语义级**暗示（如"这个数恰好是你推出方程的那个根"）依赖 persona 铁律约束。发现新变体时，把句子加入 `LEAK_PATTERNS` 即可。

## 知识库接入（预留）

`skills/knowledge-base/SKILL.md` 定义了统一的 `search` 接口契约（本地目录 + 在线检索），当前为预留状态：

- **本地**：工作区 `kb/` 目录，Markdown 文件按主题组织，`glob` + `grep` 检索。
- **在线**：`web_search` 检索，以 source URL 作为引用。
- 所有结果标注 `confidence`（fact / data / reference / heuristic），最终总结优先引用事实与数据支撑的理解。

## 自定义

- 改 persona / 训练协议：编辑 `agent.cordis.yml` 的 `persona` 段落、`skills/coaching-protocol/SKILL.md`。
- 改守卫模式：编辑 `zero-leak-guard.js` 的 `LEAK_PATTERNS`。
- 改完记得重新跑 `standingKeyFor('math-coach')` 校验。

## 许可证

[MIT](LICENSE)
