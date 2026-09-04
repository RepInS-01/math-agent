/**
 * attempt-tracker.js — Programmatic training-state tracker (Math_Agent preset plugin).
 *
 * Owns the session's attempt state as PROGRAM state instead of conversational
 * self-discipline:
 *
 * - Registers the `attempt_update` tool (whole-list snapshot semantics, latest
 *   write wins — the same philosophy as the built-in todo_write tool). The
 *   coach records every approach the trainee tries, each with a status of
 *   in-progress / flawed / validated / incomplete.
 * - Renders the current state into the system prompt on every step via a
 *   dynamic `attempts:status` prompt section, so the model always sees the
 *   authoritative state (and whether the final summary is still locked).
 * - Publishes a minimal read-only `attemptState` service ({ isValidated })
 *   inside this preset's isolate realm; the zero-leak-guard plugin (mounted
 *   in the same cordis group) consults it to decide whether the final
 *   synthesis is unlocked. Until an attempt is recorded as `validated` here,
 *   the guard keeps blocking answer clues — the unlock condition no longer
 *   depends on the model's own say-so.
 * - Registers the `hint_log` tool (append-only) so every L1+ hint the coach
 *   gives is auditable program state; the running count renders into the
 *   prompt as a self-regulating signal. Plugin config `strictness: 'strict'`
 *   rejects L2/L3 hints programmatically (only L0 questions / L1
 *   principle-naming allowed).
 * - Nudges in the prompt section after several rendered steps without an
 *   `attempt_update` call, so the record cannot quietly go stale.
 *
 * Persistence: state is held in an in-memory mirror keyed by SessionId and
 * rebuilt on demand by folding the session event log (`tool/call` records of
 * `attempt_update`; whole-list snapshots replay as latest-write-wins). Custom
 * session event types are deliberately NOT used: the durable log rejects
 * unknown event types on restore, which would make sessions un-resumable.
 *
 * Zero dependencies: the tool definition is a plain literal (no defineTool
 * import) so the file loads from the preset directory without node_modules
 * resolution. Ships inside the preset and loads via a relative path.
 */

const STATUSES = ['in-progress', 'flawed', 'validated', 'incomplete']
const HINT_LEVELS = ['L1', 'L2', 'L3']
/** Steps (prompt renders) without attempt_update before the section nudges. */
const STALE_NUDGE_STEPS = 3

/** Attempt list = whole-list snapshot; folding replay = latest write wins. */
function foldAttempts(events) {
  let attempts
  for (const event of events) {
    if (event.type !== 'tool/call' || event.data?.name !== 'attempt_update') continue
    try {
      const parsed = JSON.parse(event.data.arguments)
      if (Array.isArray(parsed.attempts)) attempts = sanitize(parsed.attempts)
    } catch {
      // malformed historical record — skip it, keep folding
    }
  }
  return attempts
}

function sanitize(raw) {
  if (!Array.isArray(raw)) throw new Error('attempts must be an array')
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`attempt #${index + 1} must be an object`)
    const approach = typeof entry.approach === 'string' ? entry.approach.trim() : ''
    if (!approach) throw new Error(`attempt #${index + 1} needs a non-empty approach`)
    if (!STATUSES.includes(entry.status)) {
      throw new Error(`attempt #${index + 1} status must be one of: ${STATUSES.join(' / ')}`)
    }
    return {
      id: Number.isInteger(entry.id) ? entry.id : index + 1,
      approach,
      status: entry.status,
      note: typeof entry.note === 'string' && entry.note.trim() ? entry.note.trim() : undefined,
    }
  })
}

function isValidatedList(attempts) {
  return Array.isArray(attempts) && attempts.some((a) => a.status === 'validated')
}

/**
 * dsh-session ≥ 0.1.2-rc.1 removed the `session.events` getter in favor of
 * `snapshotEvents()`; keep a fallback so the preset still mounts on older hosts.
 */
function eventsOf(session) {
  if (typeof session.snapshotEvents === 'function') return session.snapshotEvents()
  return session.events ?? []
}

/** Hint log = append-only; folding replay collects every hint_log call. */
function foldHints(events) {
  const hints = []
  for (const event of events) {
    if (event.type !== 'tool/call' || event.data?.name !== 'hint_log') continue
    try {
      hints.push(sanitizeHint(JSON.parse(event.data.arguments)))
    } catch {
      // malformed historical record — skip it, keep folding
    }
  }
  return hints
}

function sanitizeHint(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('hint must be an object')
  if (!HINT_LEVELS.includes(raw.level)) throw new Error(`level must be one of: ${HINT_LEVELS.join(' / ')}`)
  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : ''
  if (!summary) throw new Error('hint needs a non-empty summary')
  return { level: raw.level, summary }
}

function renderSection(attempts, { hints = [], staleSteps = 0, strictness = 'normal' } = {}) {
  const header = '## Attempt Tracking (programmatic state)'
  let body
  if (!attempts || attempts.length === 0) {
    body = `${header}\nNo attempts recorded yet. Record every approach the trainee tries with the attempt_update tool (whole list, each round). The final summary stays locked until one attempt is marked "validated" — and "validated" means a complete, self-consistent, reviewable argument from the trainee, never a mere candidate answer.`
  } else {
    const rows = attempts
      .map((a) => `| ${a.id} | ${a.approach} | ${a.status} | ${a.note ?? '—'} |`)
      .join('\n')
    const footer = isValidatedList(attempts)
      ? 'Validated: yes — the final synthesis is unlocked; follow the final-synthesis skill.'
      : 'Validated: no — the final summary stays locked (interim summaries only). Keep coaching; only mark an attempt "validated" once the trainee has produced a complete, self-consistent, reviewable argument including verification.'
    body = `${header}\n| # | Approach | Status | Note |\n|---|----------|--------|------|\n${rows}\n\n${footer}`
  }
  const counts = HINT_LEVELS.map((l) => `${l} ×${hints.filter((h) => h.level === l).length}`).join(' · ')
  const hintLine = `Hints given this session: ${hints.length} (${counts}). Log every L1+ hint with hint_log in the same reply, before giving it; a rising count is a signal to slow down, not a quota to spend.`
  const policyLine =
    strictness === 'strict'
      ? 'Hint policy: STRICT — L2/L3 hints are disabled (hint_log rejects them). Only L0 questions and L1 principle-naming are allowed.'
      : 'Hint policy: normal — follow the hint ladder in coaching-protocol: L1+ only after the trainee says they are stuck and states what they tried; L3 only after ≥3 rounds stuck on the same step.'
  const nudge =
    staleSteps >= STALE_NUDGE_STEPS
      ? `\nReminder: ${staleSteps} steps without attempt_update — update the record now, or say in your reply why nothing changed.`
      : ''
  return `${body}\n\n${hintLine}\n${policyLine}${nudge}`
}

export default {
  name: 'attempt-tracker',
  // Cordis resolves service property reads (ctx.tools / ctx.systemPrompt) only
  // for fibers that declare them — without this the mount fails with
  // "cannot get property ... without inject" and the preset falls back to default.
  inject: ['tools', 'systemPrompt'],

  apply(ctx, config) {
    // 'strict' disables L2/L3 hints programmatically (hint_log rejects them).
    const strictness = config?.strictness === 'strict' ? 'strict' : 'normal'
    /** Runtime mirrors: SessionId -> sanitized attempt list / hint array. */
    const states = new Map()
    const hintLogs = new Map()
    /** SessionId -> prompt renders since the last attempt_update call. */
    const staleSteps = new Map()

    // Read-only minimal surface for the zero-leak guard (same isolate realm).
    ctx.provide('attemptState', {
      isValidated: (sessionId) => isValidatedList(states.get(sessionId)),
    })

    /** Map lookups with log-fold fallback (resume self-healing). */
    function stateFor(session) {
      let attempts = states.get(session.id)
      if (attempts === undefined) {
        attempts = foldAttempts(eventsOf(session))
        states.set(session.id, attempts)
      }
      return attempts
    }

    function hintsFor(session) {
      let hints = hintLogs.get(session.id)
      if (hints === undefined) {
        hints = foldHints(eventsOf(session))
        hintLogs.set(session.id, hints)
      }
      return hints
    }

    // IMPORTANT: ctx.tools.register() takes RAW JSON Schema (supported subset:
    // type/properties/required/additionalProperties/items/enum/const +
    // annotations), NOT the author-facing shorthand used inside defineTool —
    // `required` must be an object-level array of names. register() asserts
    // output.schema at mount time, so a shorthand node here fails the whole
    // preset mount. (defineTool would compile the shorthand for us, but it is
    // not importable from a preset directory — bare specifiers don't resolve.)
    ctx.tools.register({
      name: 'attempt_update',
      description:
        'Record the training attempts as PROGRAM state: replaces the whole attempt list (latest write wins). Call it every round the trainee tries or revises an approach. Status values: in-progress | flawed | validated | incomplete. Mark an attempt "validated" ONLY when the trainee independently produced a complete, self-consistent, reviewable argument including verification — a stated or guessed candidate answer never counts. The zero-leak guard unlocks the final summary solely based on this record. Entries describe approaches and argument status only — never write answer values, intervals, or correctness hints into approach/note.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['attempts'],
        properties: {
          attempts: {
            type: 'array',
            description: 'The COMPLETE attempt list, replacing any previous list.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['approach', 'status'],
              properties: {
                id: { type: 'integer', description: 'Stable attempt number (1-based); re-use to update an existing attempt.' },
                approach: { type: 'string', description: 'What the approach is — one short line, no answer information.' },
                status: { type: 'string', enum: [...STATUSES], description: 'in-progress | flawed | validated | incomplete.' },
                note: { type: 'string', description: 'Where it breaks down / why ruled out — structural level only, never answer information.' },
              },
            },
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['count', 'validated'],
          properties: {
            count: { type: 'integer' },
            validated: { type: 'boolean' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: value.validated
              ? `Recorded ${value.count} attempt(s). An attempt is validated — the final synthesis is now unlocked (follow the final-synthesis skill).`
              : `Recorded ${value.count} attempt(s). None validated — the final summary remains locked; keep coaching.`,
          },
        ],
      },
      async execute(args, exec) {
        if (!exec.agent) throw new Error('attempt_update requires an owning agent session')
        const attempts = sanitize(args?.attempts)
        states.set(exec.agent.id, attempts)
        staleSteps.set(exec.agent.id, 0)
        return { count: attempts.length, validated: isValidatedList(attempts) }
      },
    })

    // Append-only hint log: every L1+ hint the coach gives becomes auditable
    // program state, and the running count renders into the prompt as a
    // self-regulating signal. Under `strictness: 'strict'` this tool is the
    // enforcement point: L2/L3 calls are rejected outright.
    ctx.tools.register({
      name: 'hint_log',
      description:
        'Log a directional hint you are giving the trainee, at hint-ladder level L1 (name a general principle, no application), L2 (skeleton with blanks), or L3 (partial construction, last resort). Plain questions (L0) need no logging. Call this in the SAME reply that contains the hint, BEFORE giving it. The running count is rendered into your system prompt every step — treat a rising count as a signal to slow down. The summary must be structural only — never answer information.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['level', 'summary'],
        properties: {
          level: {
            type: 'string',
            enum: [...HINT_LEVELS],
            description: 'L1 principle-naming | L2 skeleton with blanks | L3 partial construction (only after ≥3 rounds stuck on the same step).',
          },
          summary: { type: 'string', description: 'One short line: what the hint is about — structural level only, never answer information.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['hints', 'level'],
          properties: {
            hints: { type: 'integer' },
            level: { type: 'string' },
          },
        },
        render: (_args, value) => [
          { type: 'text', text: `Hint logged (${value.level}). Total hints this session: ${value.hints}.` },
        ],
      },
      async execute(args, exec) {
        if (!exec.agent) throw new Error('hint_log requires an owning agent session')
        const hint = sanitizeHint(args)
        if (strictness === 'strict' && hint.level !== 'L1') {
          throw new Error(`Strict hint policy: ${hint.level} hints are disabled — only L0 questions and L1 principle-naming are allowed.`)
        }
        const hints = hintsFor(exec.agent.session)
        hints.push(hint)
        return { hints: hints.length, level: hint.level }
      },
    })

    ctx.systemPrompt.section({
      name: 'attempts:status',
      order: 55, // after persona (0) and plan:policy (50), before tool guidance (100+)
      text: (context) => {
        if (context.agent === undefined) return ''
        const session = context.agent.session
        // Renders ≈ steps; a run of renders without attempt_update means the
        // record is going stale — surface a nudge in the section itself.
        const stale = staleSteps.get(session.id) ?? 0
        staleSteps.set(session.id, stale + 1)
        return renderSection(stateFor(session), {
          hints: hintsFor(session),
          staleSteps: stale,
          strictness,
        })
      },
    })
  },
}
