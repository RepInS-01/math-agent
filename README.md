# Math_Agent

A **math training preset** for DeepSeek Harness — not a problem solver.

Rather than solving problems for the trainee, it provides rapid feedback to help sharpen mathematical understanding and build intuition. It features a **programmatic zero-leak output guard** that mechanically prevents the coach from ever revealing the answer.

## Features

- 🧑‍🏫 **Coach, Not Solver**: Never gives complete solutions, key steps, or final answers. Follows the trainee's reasoning, confirms correct parts, and flags issues.
- 📋 **Pre-Session Check**: Before each training session, verifies that the problem is well-defined, conditions are sufficient, and there are no errors.
- 🧠 **Programmatic Attempt Tracking**: Approaches tried by the trainee are recorded as program state via the `attempt_update` tool (status: in-progress / flawed / validated / incomplete), rendered into the system prompt every step, and rebuilt from the session log after a resume. The coach is nudged in the prompt after several rounds without an update. For longer sessions, attempts can additionally be persisted to `notes/attempts.md`.
- 🪜 **Hint Ladder & Per-Session Hint Policy**: Coaching feedback follows a four-level hint ladder (L0 questions → L1 principle-naming → L2 skeleton → L3 partial construction, last resort only). Every L1+ hint is logged via the `hint_log` tool and counted in the system prompt — a rising count is a signal to slow down. At session start the coach asks the trainee for the hint policy via `ask_user_question` (strict = L0/L1 only; normal = full ladder) and records it with the `hint_policy` tool — per-session, resumable, switchable mid-session. The `strictness` value in `agent.cordis.yml` is only the default for sessions that never chose (ships as `strict`); under a strict policy `hint_log` rejects L2/L3 programmatically.
- 🚦 **Summary Discipline**: Only interim summaries are allowed before an approach is fully validated; the final summary is unlocked programmatically — the zero-leak guard stands down only once an attempt is recorded as `validated` through `attempt_update`, never on the model's own say-so.
- 📚 **Final Synthesis**: The final review revisits every approach explored during the session, identifies the trainee's own reasoning patterns, and avoids dismissing "flawed" paths outright.
- 🔒 **Programmatic Zero-Leak Guard** (core highlight): A stream-level guard on `llm/stream` that inspects the coach's entire reply. When answer clues (numerical values, intervals, correctness judgments, answer forms) are detected, the **entire response is replaced** — not a single character of the model's original output reaches the trainee. This does not rely on the model's "self-discipline."
- 🗂️ **Extensible Knowledge Base Interface**: A reserved local/online knowledge-base integration (`knowledge-base` skill). During final synthesis, understandings backed by facts and data are prioritized.

## Directory Structure

```
math-agent/
├── preset.yml              # Preset metadata (name / description)
├── agent.cordis.yml        # Cordis composition: tools, persona, skills, guard registration
├── attempt-tracker.js      # Training-state plugin: attempt_update + hint_log + hint_policy tools, prompt injection, validated flag, stale-update nudge (folds from the session log)
├── zero-leak-guard.js      # Programmatic zero-leak output guard plugin (loaded via relative path; copied with the preset)
├── zero-leak-guard.test.mjs # Test corpus: leak samples that must block, clean replies that must pass, tracker + unlock behavior
├── README.md               # This file
├── LICENSE                 # MIT License
└── skills/
    ├── coaching-protocol/  # Coaching protocol: workflow, red lines, zero-leak rules
    ├── knowledge-base/     # Knowledge base integration interface (reserved)
    └── final-synthesis/    # Final synthesis workflow and output structure
```

## Installation

Prerequisite: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`npx @deepseek-ai/dsh web`). This preset is derived from the `standard` preset and uses the DSH agent-presets mechanism.

```bash
git clone https://github.com/RepInS-01/math-agent.git
mkdir -p ~/.dsh/.agent-presets
cp -r math-agent ~/.dsh/.agent-presets/
```

The preset id is the directory name, so the preset must land as `~/.dsh/.agent-presets/math-agent/` (or `${DSH_HOME}/.agent-presets/math-agent/` if you run with a custom `DSH_HOME`). Discovery is live: the preset appears in the Web GUI immediately, no DSH restart needed.

Mount validation (run after any modification): in the Web GUI, create a new session and select the **Math_Agent** preset. A successful selection means the composition mounted; on a mount failure the GUI reverts the selection to the default preset and shows the error. (Programmatically, the same check is `agentPresets.standingKeyFor('math-agent')`, callable from inside a DSH session.)

## Usage

1. In the DeepSeek Harness Web GUI, create a new session and select the **Math_Agent** preset (id: `math-agent`).
2. Start a training session with a prompt like:

   > I'd like to start a math training exercise. Problem: Let aₙ = √(1 + aₙ₋₁), a₀ = 1. Prove that {aₙ} converges and find its limit. I'm thinking of using monotone convergence but I'm not sure how to prove boundedness.

3. No matter how insistently you ask for the answer — the zero-leak guard stands between you and the model.

## How the Zero-Leak Guard Works

- Hooked into the `llm/stream` waterfall (dispatched process-wide); **only activates for requests whose system prompt contains coaching signatures** (zero-leak iron rules / math coach). All other sessions pass through untouched.
- The model's full output text is inspected programmatically before delivery. If answer-clue patterns (intervals, correctness judgments, answer forms, decimal values, etc.) match, the **entire segment is replaced** with a fixed interception message.
- Interception happens at the stream layer: session logs record the interception message, not the leaked text. On the next turn, the model sees its own interception notice and automatically reformulates in compliance.
- **The unlock is program state, not model judgment**: the `attempt-tracker` plugin (mounted in the same isolate realm) holds the per-session attempt list. Once an attempt is recorded as `validated` via the `attempt_update` tool, the guard stands down so the final synthesis can deliver the complete solution. A missing tracker, an unknown session, or no validated attempt all fall through to blocking — fail-closed in every direction.
- **The unlock is program state, not model judgment**: the `attempt-tracker` plugin (mounted in the same isolate realm) holds the per-session attempt list. Once an attempt is recorded as `validated` via the `attempt_update` tool, the guard stands down so the final synthesis can deliver the complete solution. A missing tracker, an unknown session, or no validated attempt all fall through to blocking — fail-closed in every direction.
- **Compute/search tools are denied under the same lock**: a preset-layer `tools.guard` rejects `bash`, `pwsh`, `web_search`, and `run_code` until an attempt is validated. The stream inspection cannot see tool output, so the tools that could compute or retrieve the answer are disabled outright — and the denial lifts on the same program state as the final-synthesis unlock.
- **Reasoning is hidden during the locked phase**: the coach's thinking routinely derives the answer outright, and the client UI renders reasoning rows to the trainee. While no attempt is validated, reasoning deltas collapse to a fixed placeholder and reasoning block payloads are rewritten — in original block order, keeping the persisted message consistent with pi-ai replay state. Reasoning flows again once an approach is validated.
- Pattern definitions are centralized in `LEAK_PATTERNS` at the top of `zero-leak-guard.js` and can be extended freely.

### Known Boundaries

The programmatic guard blocks **enumerable leak forms** (numeric values, intervals, judgment words) in the coach's own reply text, and the tool gate covers the compute/search channels. One channel remains persona-constrained rather than guard-enforced:

- **Semantic-level** hints without numbers (e.g., "this number happens to be the root of the equation you just derived").

When new variants are discovered, simply add them to `LEAK_PATTERNS` (plus a sample in `zero-leak-guard.test.mjs`).

## Testing

The guard ships with a zero-dependency test corpus (Node's built-in test runner):

```bash
node --test zero-leak-guard.test.mjs
```

Run it after every change to `LEAK_PATTERNS`, `attempt-tracker.js`, or the guard's unlock logic. The corpus covers: leak samples that must be blocked, legitimate coaching replies that must pass, the validated-session unlock (and its fail-closed fallbacks), and the attempt tracker's state recording, hint logging (including the strict-policy rejection of L2/L3), stale-update nudge, prompt rendering, and session-log fold. Add every newly discovered leak variant to the block list and every reported false positive to the pass list.

> **Reload caveat**: relative-path preset plugins (`./attempt-tracker.js`, `./zero-leak-guard.js`) are imported through Node's ESM loader with no cache busting. After editing plugin code or `agent.cordis.yml`, **restart the DSH host** (`dsh web`) — re-selecting the preset in the UI is not enough, as re-mounting reuses the cached module. Skill files (`skills/**/SKILL.md`) are re-read from disk per session and do not need a restart.

## Knowledge Base Integration (Reserved)

`skills/knowledge-base/SKILL.md` defines a unified `search` interface contract (local directory + online retrieval), currently in reserved state:

- **Local**: Workspace `kb/` directory with Markdown files organized by topic; retrieved via `glob` + `grep`.
- **Online**: `web_search` retrieval, cited by source URL.
- All results are tagged with `confidence` (fact / data / reference / heuristic). Final synthesis prioritizes understandings supported by facts and data.

## Customization

- Modify persona / coaching protocol: edit the `persona` section in `agent.cordis.yml` and `skills/coaching-protocol/SKILL.md`.
- Modify guard patterns: edit `LEAK_PATTERNS` in `zero-leak-guard.js`.
- Always re-check the mount after changes: re-select the preset in the Web GUI (a failed mount reverts the selection to the default), or call `agentPresets.standingKeyFor('math-agent')` from a DSH session.

## Acknowledgments

This project was inspired by the math coaching concept originally proposed by Bilibili creator **PiKaChu345**. The original creator has not yet released their implementation publicly. This is an independent reimplementation based solely on the publicly described idea. No source code or proprietary materials from the original work were used. All credit for the original concept goes to PiKaChu345.

## License

[MIT](LICENSE)
