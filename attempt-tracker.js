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

function renderSection(attempts) {
  const header = '## Attempt Tracking (programmatic state)'
  if (!attempts || attempts.length === 0) {
    return `${header}\nNo attempts recorded yet. Record every approach the trainee tries with the attempt_update tool (whole list, each round). The final summary stays locked until one attempt is marked "validated" — and "validated" means a complete, self-consistent, reviewable argument from the trainee, never a mere candidate answer.`
  }
  const rows = attempts
    .map((a) => `| ${a.id} | ${a.approach} | ${a.status} | ${a.note ?? '—'} |`)
    .join('\n')
  const footer = isValidatedList(attempts)
    ? 'Validated: yes — the final synthesis is unlocked; follow the final-synthesis skill.'
    : 'Validated: no — the final summary stays locked (interim summaries only). Keep coaching; only mark an attempt "validated" once the trainee has produced a complete, self-consistent, reviewable argument including verification.'
  return `${header}\n| # | Approach | Status | Note |\n|---|----------|--------|------|\n${rows}\n\n${footer}`
}

export default {
  name: 'attempt-tracker',
  // Cordis resolves service property reads (ctx.tools / ctx.systemPrompt) only
  // for fibers that declare them — without this the mount fails with
  // "cannot get property ... without inject" and the preset falls back to default.
  inject: ['tools', 'systemPrompt'],

  apply(ctx) {
    /** Runtime mirror: SessionId -> sanitized attempt list. */
    const states = new Map()

    // Read-only minimal surface for the zero-leak guard (same isolate realm).
    ctx.provide('attemptState', {
      isValidated: (sessionId) => isValidatedList(states.get(sessionId)),
    })

    /** Map lookup with log-fold fallback (resume self-healing). */
    function stateFor(session) {
      let attempts = states.get(session.id)
      if (attempts === undefined) {
        attempts = foldAttempts(session.events)
        states.set(session.id, attempts)
      }
      return attempts
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
        return { count: attempts.length, validated: isValidatedList(attempts) }
      },
    })

    ctx.systemPrompt.section({
      name: 'attempts:status',
      order: 55, // after persona (0) and plan:policy (50), before tool guidance (100+)
      text: (context) => {
        if (context.agent === undefined) return ''
        return renderSection(stateFor(context.agent.session))
      },
    })
  },
}
