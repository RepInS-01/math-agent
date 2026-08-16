# Math_Agent

A **math training preset** for DeepSeek Harness — not a problem solver.

Rather than solving problems for the trainee, it provides rapid feedback to help sharpen mathematical understanding and build intuition. It features a **programmatic zero-leak output guard** that mechanically prevents the coach from ever revealing the answer.

## Features

- 🧑‍🏫 **Coach, Not Solver**: Never gives complete solutions, key steps, or final answers. Follows the trainee's reasoning, confirms correct parts, and flags issues.
- 📋 **Pre-Session Check**: Before each training session, verifies that the problem is well-defined, conditions are sufficient, and there are no errors.
- 🧠 **Attempt Tracking**: Continuously records all approaches tried by the trainee (status: in-progress / flawed / validated / incomplete). For longer sessions, attempts can be persisted to `notes/attempts.md`.
- 🚦 **Summary Discipline**: Only interim summaries are allowed before an approach is fully validated; a final summary is permitted only after successful completion.
- 📚 **Final Synthesis**: The final review revisits every approach explored during the session, identifies the trainee's own reasoning patterns, and avoids dismissing "flawed" paths outright.
- 🔒 **Programmatic Zero-Leak Guard** (core highlight): A stream-level guard on `llm/stream` that inspects the coach's entire reply. When answer clues (numerical values, intervals, correctness judgments, answer forms) are detected, the **entire response is replaced** — not a single character of the model's original output reaches the trainee. This does not rely on the model's "self-discipline."
- 🗂️ **Extensible Knowledge Base Interface**: A reserved local/online knowledge-base integration (`knowledge-base` skill). During final synthesis, understandings backed by facts and data are prioritized.

## Directory Structure

```
math-coach/
├── preset.yml              # Preset metadata (name / description)
├── agent.cordis.yml        # Cordis composition: tools, persona, skills, guard registration
├── zero-leak-guard.js      # Programmatic zero-leak output guard plugin (loaded via relative path; copied with the preset)
├── README.md               # This file
├── LICENSE                 # MIT License
└── skills/
    ├── coaching-protocol/  # Coaching protocol: workflow, red lines, zero-leak rules
    ├── knowledge-base/     # Knowledge base integration interface (reserved)
    └── final-synthesis/    # Final synthesis workflow and output structure
```

## Installation

Prerequisite: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) installed. This preset is derived from the `standard` preset and uses the DSH agent-presets mechanism.

```bash
# Option 1: Copy directly into the user presets root
mkdir -p ~/.dsh/.agent-presets
cp -r math-coach ~/.dsh/.agent-presets/

# Option 2: Inside a DSH session (recommended; auto-loads and validates)
# Use agentPresets.copy, or place this directory under
# ${DSH_HOME:-$HOME/.dsh}/.agent-presets/ and restart DSH.
```

Mount validation (run after any modification):

```
agentPresets.standingKeyFor('math-coach')  # → mounted OK
```

## Usage

1. In the DeepSeek Harness Web GUI, create a new session and select the **Math_Agent** preset (id: `math-coach`).
2. Start a training session with a prompt like:

   > I'd like to start a math training exercise. Problem: Let aₙ = √(1 + aₙ₋₁), a₀ = 1. Prove that {aₙ} converges and find its limit. I'm thinking of using monotone convergence but I'm not sure how to prove boundedness.

3. No matter how insistently you ask for the answer — the zero-leak guard stands between you and the model.

## How the Zero-Leak Guard Works

- Hooked into the `llm/stream` waterfall; **only activates for requests whose system prompt contains coaching signatures** (zero-leak iron rules / math coach). All other sessions pass through untouched.
- The model's full output text is inspected programmatically before delivery. If answer-clue patterns (intervals, correctness judgments, answer forms, decimal values, etc.) match, the **entire segment is replaced** with a fixed interception message.
- Interception happens at the stream layer: session logs record the interception message, not the leaked text. On the next turn, the model sees its own interception notice and automatically reformulates in compliance.
- Pattern definitions are centralized in `LEAK_PATTERNS` at the top of `zero-leak-guard.js` and can be extended freely.

### Known Boundaries

The programmatic guard blocks **enumerable leak forms** (numeric values, intervals, judgment words). **Semantic-level** hints without numbers (e.g., "this number happens to be the root of the equation you just derived") are constrained by persona iron rules. When new variants are discovered, simply add them to `LEAK_PATTERNS`.

## Knowledge Base Integration (Reserved)

`skills/knowledge-base/SKILL.md` defines a unified `search` interface contract (local directory + online retrieval), currently in reserved state:

- **Local**: Workspace `kb/` directory with Markdown files organized by topic; retrieved via `glob` + `grep`.
- **Online**: `web_search` retrieval, cited by source URL.
- All results are tagged with `confidence` (fact / data / reference / heuristic). Final synthesis prioritizes understandings supported by facts and data.

## Customization

- Modify persona / coaching protocol: edit the `persona` section in `agent.cordis.yml` and `skills/coaching-protocol/SKILL.md`.
- Modify guard patterns: edit `LEAK_PATTERNS` in `zero-leak-guard.js`.
- Always re-run `standingKeyFor('math-coach')` after changes.

## Acknowledgments

This project was inspired by the math coaching concept originally proposed by Bilibili creator **PiKaChu345**. The original creator has not yet released their implementation publicly. This is an independent reimplementation based solely on the publicly described idea. No source code or proprietary materials from the original work were used. All credit for the original concept goes to PiKaChu345.

## License

[MIT](LICENSE)
