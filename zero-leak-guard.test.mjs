/**
 * zero-leak-guard.test.mjs — Test corpus for the zero-leak output guard and
 * the attempt-tracker training-state plugin.
 *
 * Run with:  node --test zero-leak-guard.test.mjs
 *
 * Zero dependencies: uses node:test + node:assert. The plugins are loaded from
 * source via data: URLs so the tests exercise the real shipped files even
 * though the preset has no package.json (bare .js would default to CJS).
 *
 * Two corpus groups for the guard:
 *  - LEAK_SAMPLES: replies that MUST be blocked while no attempt is validated
 *    (add every newly discovered leak variant here together with its
 *    LEAK_PATTERNS entry). Includes evasion spellings (full-width digits,
 *    LaTeX inline math, Chinese numerals) that the guard's match-time
 *    normalization collapses to canonical form.
 *  - CLEAN_SAMPLES: legitimate coaching replies that MUST pass (add every
 *    reported false positive here).
 *
 * Note: the guard currently blocks ANY decimal with 2+ fraction digits
 * (e.g. "see §3.21"), so CLEAN_SAMPLES deliberately avoid that form; if the
 * bare-decimal rule is ever made context-aware, add such samples here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const loadPlugin = async (file) =>
  (await import('data:text/javascript;base64,' + Buffer.from(readFileSync(join(here, file), 'utf8')).toString('base64'))).default

const guard = await loadPlugin('zero-leak-guard.js')
const tracker = await loadPlugin('attempt-tracker.js')

// Mirrors the persona text in agent.cordis.yml — the guard activates on these
// signatures. If the persona wording changes, update this AND expect the
// "non-coaching passthrough" tests to keep guarding the coupling.
const COACHING_SYSTEM = 'You are a Math Coach ... ## Zero-Leak Iron Rules ...'
const OTHER_SYSTEM = 'You are a helpful coding assistant.'
const SESSION = 'session-1'

// ── corpus ──────────────────────────────────────────────────────────────────

const LEAK_SAMPLES = [
  // intervals (Chinese & English)
  '答案在 1.6 到 1.7 之间。',
  '我觉得它介于 2 和 3。',
  'The limit is between 1 and 2.',
  // right/wrong judgment on a stated value
  '你猜的 2 大了，再想想。',
  '不对，3 不满足条件。',
  '1.6 is too big.',
  'That is close to 2.',
  // answer-form phrasing
  '极限就是 φ。',
  '它约等于 3。',
  'the answer is 4.',
  'The limit is approximately zero point seven five, i.e. 0.75.',
  // coach volunteering a decimal value
  '你可以验证一下 1.61 这个数。',
  // value + 左右/附近/上下
  '在 2 附近找找。',
  '正确答案是 e。',
  // ── evasion spellings: match-time normalization collapses these ──
  '答案约等于１.６１８。', // full-width digits → 1.618
  '答案在 １.６ 到 １.７ 之间。', // full-width interval
  '极限是 $\\frac{3}{2}$。', // LaTeX fraction → 3/2
  'The answer is \\frac{1+\\sqrt{5}}{2}.', // nested LaTeX → 1+√(5)/2
  '它等于 \\sqrt{2}，不信你代入验证。', // LaTeX sqrt → √(2)
  '结果大约是 一点六一八。', // Chinese decimal → 1.618
  '答案是二分之三。', // Chinese fraction → 3/2
  '它约等于百分之七十五。', // → 75%
  '在 根号2 附近找找。', // 根号 → √
]

const CLEAN_SAMPLES = [
  // structural feedback mentioning steps/conditions — no answer info
  '从 a<b 不能推出 a²<b²，这一步有问题。',
  '这一步正确，请继续。',
  '你的方向是对的，继续检查每一步的依据。',
  '用了单调有界定理，但还没用上初始条件，回看第 3 步。',
  '排除两种情况都走不通，还剩第三条路。',
  // regression: a bare `e` in the old [0-9φπe] class matched the leading
  // letter of English words, blocking all of these
  'The correct expression follows directly from the definition.',
  'Your approach is the right one; now justify each step.',
  "Let's not judge that number — tell me how you derived it.",
  'Substitute L into your equation and check both sides yourself.',
  // ── normalization false-positive guards ──
  '三三两两地试几组，结构上没有新信息。', // digit-word prose must stay text
  '这一步十分关键，但还差一个依据。', // lone 十 / 一 are not numbers
  '方法二和方法三都值得一试，先试一个。', // ordinals stay text
  '讨论 1/2 这种分数形式本身没有问题。', // bare fraction without answer phrasing
  'Try \\int x^2 dx on your own first, then show me the setup.', // TeX commands degrade, delivery stays verbatim
]

// ── guard harness ───────────────────────────────────────────────────────────

async function* fakeInnerStream(deltas, extras = []) {
  for (const text of deltas) yield { type: 'text-delta', index: 0, text }
  for (const c of extras) yield c
  yield { type: 'usage', inputTokens: 1, outputTokens: 1 }
  yield { type: 'finish', reason: 'stop' }
}

/**
 * @param {object} [services] - map of cordis service name -> value; the fake
 *   ctx.get() returns from it (undefined when absent, like a missing plugin).
 */
function applyGuard(services = {}) {
  const handlers = {}
  const ctx = {
    on: (event, fn) => { handlers[event] = fn },
    get: (name) => services[name],
  }
  guard.apply(ctx)
  assert.ok(handlers['llm/stream'], 'guard must hook llm/stream')
  return handlers['llm/stream']
}

async function runGuard(system, deltas, extras = [], { services = {}, sessionId = SESSION } = {}) {
  const handler = applyGuard(services)
  const out = []
  for await (const chunk of handler({ system, sessionId }, () => fakeInnerStream(deltas, extras))) {
    out.push(chunk)
  }
  return out
}

const textOf = (chunks) =>
  chunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join('')

const attemptStateStub = (validatedIds) => ({ isValidated: (id) => validatedIds.has(id) })

// ── guard tests ─────────────────────────────────────────────────────────────

test('leak samples are fully replaced, no original character delivered', async () => {
  for (const sample of LEAK_SAMPLES) {
    const out = await runGuard(COACHING_SYSTEM, [sample])
    const text = textOf(out)
    assert.ok(text.includes('[Zero-Leak Guard]'), `should block: ${sample}`)
    assert.ok(!text.includes(sample), `no original text must survive: ${sample}`)
  }
})

test('clean coaching replies pass through untouched', async () => {
  for (const sample of CLEAN_SAMPLES) {
    const out = await runGuard(COACHING_SYSTEM, [sample])
    assert.equal(textOf(out), sample, `should pass: ${sample}`)
  }
})

test('non-coaching sessions pass through even when the text leaks', async () => {
  for (const sample of LEAK_SAMPLES) {
    const out = await runGuard(OTHER_SYSTEM, [sample])
    assert.equal(textOf(out), sample, `no system signature, must pass: ${sample}`)
  }
})

test('streaming order is preserved for clean multi-delta replies', async () => {
  const parts = ['这一步正确，', '继续检查', '每一步的依据。']
  const out = await runGuard(COACHING_SYSTEM, parts)
  const deltas = out.filter((c) => c.type === 'text-delta')
  assert.deepEqual(deltas.map((d) => d.text), parts)
})

test('on block: usage/finish are forwarded, reasoning chunks are dropped', async () => {
  const out = await runGuard(COACHING_SYSTEM, ['答案是 2。'], [
    { type: 'reasoning-delta', text: 'the answer is 2' },
  ])
  assert.ok(out.some((c) => c.type === 'usage'), 'usage must be forwarded')
  assert.ok(out.some((c) => c.type === 'finish'), 'finish must be forwarded')
  assert.ok(!out.some((c) => c.type === 'reasoning-delta'), 'reasoning must not leak')
  assert.ok(out.some((c) => c.type === 'block-end'), 'block-end must close the text block')
})

test('on pass: reasoning chunks are forwarded normally', async () => {
  const reasoning = { type: 'reasoning-delta', text: 'checking the argument structure' }
  const out = await runGuard(COACHING_SYSTEM, ['这一步正确。'], [reasoning])
  assert.ok(out.includes(reasoning), 'reasoning chunk must pass through')
})

test('validated session: guard stands down, answer-bearing synthesis passes', async () => {
  const services = { attemptState: attemptStateStub(new Set([SESSION])) }
  for (const sample of LEAK_SAMPLES) {
    const out = await runGuard(COACHING_SYSTEM, [sample], [], { services })
    assert.equal(textOf(out), sample, `validated session, must pass: ${sample}`)
  }
})

test('validated flag is per-session: other sessions stay blocked', async () => {
  const services = { attemptState: attemptStateStub(new Set(['someone-else'])) }
  const out = await runGuard(COACHING_SYSTEM, ['答案是 2。'], [], { services })
  assert.ok(textOf(out).includes('[Zero-Leak Guard]'), 'unrelated validation must not unlock this session')
})

test('missing attemptState service fails closed (keeps blocking)', async () => {
  const out = await runGuard(COACHING_SYSTEM, ['答案是 2。'], [], { services: {} })
  assert.ok(textOf(out).includes('[Zero-Leak Guard]'), 'no tracker service → must still block')
})

// ── attempt-tracker harness ─────────────────────────────────────────────────

function applyTracker() {
  const provided = {}
  const tools = new Map()
  const sections = new Map()
  const ctx = {
    provide: (name, value) => { provided[name] = value },
    tools: { register: (def) => tools.set(def.name, def) },
    systemPrompt: { section: (sec) => sections.set(sec.name, sec) },
  }
  tracker.apply(ctx)
  assert.ok(provided.attemptState, 'tracker must provide attemptState')
  assert.ok(tools.has('attempt_update'), 'tracker must register attempt_update')
  assert.ok(sections.has('attempts:status'), 'tracker must register the attempts:status section')
  return { provided, tools, sections }
}

const fakeExec = (session) => ({ agent: { id: session.id, session } })
const fakeSession = (id, events = []) => ({ id, events })
const callEvent = (attempts) => ({
  type: 'tool/call',
  data: { name: 'attempt_update', arguments: JSON.stringify({ attempts }) },
})

const VALID_ARGUMENT = { approach: 'monotone convergence', status: 'in-progress' }

// ── attempt-tracker tests ───────────────────────────────────────────────────

test('attempt_update records state and flips isValidated', async () => {
  const { provided, tools } = applyTracker()
  const session = fakeSession('s1')
  const tool = tools.get('attempt_update')

  const r1 = await tool.execute({ attempts: [VALID_ARGUMENT] }, fakeExec(session))
  assert.deepEqual(r1, { count: 1, validated: false })
  assert.equal(provided.attemptState.isValidated('s1'), false)

  const r2 = await tool.execute(
    { attempts: [{ ...VALID_ARGUMENT, status: 'validated' }] },
    fakeExec(session),
  )
  assert.deepEqual(r2, { count: 1, validated: true })
  assert.equal(provided.attemptState.isValidated('s1'), true)
  assert.equal(provided.attemptState.isValidated('s2'), false, 'other sessions unaffected')
})

test('attempt_update render carries counts and lock state, never answer info', async () => {
  const { tools } = applyTracker()
  const tool = tools.get('attempt_update')
  const locked = tool.output.render({}, { count: 2, validated: false })
  const unlocked = tool.output.render({}, { count: 2, validated: true })
  assert.match(locked[0].text, /remains locked/)
  assert.match(unlocked[0].text, /unlocked/)
})

test('attempt_update rejects malformed input and agent-less calls', async () => {
  const { tools } = applyTracker()
  const tool = tools.get('attempt_update')
  await assert.rejects(tool.execute({ attempts: [{ approach: '', status: 'in-progress' }] }, fakeExec(fakeSession('s1'))))
  await assert.rejects(tool.execute({ attempts: [{ approach: 'x', status: 'maybe' }] }, fakeExec(fakeSession('s1'))))
  await assert.rejects(tool.execute({ attempts: 'nope' }, fakeExec(fakeSession('s1'))))
  await assert.rejects(tool.execute({ attempts: [VALID_ARGUMENT] }, { agent: undefined }))
})

test('section renders empty-state reminder, then the live table with lock status', async () => {
  const { tools, sections } = applyTracker()
  const section = sections.get('attempts:status')
  const session = fakeSession('s1')

  assert.equal(section.text({}), '', 'no agent → no section')
  assert.match(section.text({ agent: { session } }), /No attempts recorded yet/)

  await tools.get('attempt_update').execute({ attempts: [VALID_ARGUMENT] }, fakeExec(session))
  const locked = section.text({ agent: { session } })
  assert.match(locked, /monotone convergence/)
  assert.match(locked, /Validated: no/)

  await tools.get('attempt_update').execute(
    { attempts: [{ ...VALID_ARGUMENT, status: 'validated' }] },
    fakeExec(session),
  )
  assert.match(section.text({ agent: { session } }), /Validated: yes/)
})

test('state folds back from session tool/call log after a resume', async () => {
  const { provided, sections } = applyTracker()
  // fresh process: Map is empty, only the durable log survives
  const session = fakeSession('resumed', [
    { type: 'user/message', data: {} },
    callEvent([VALID_ARGUMENT]),
    callEvent([VALID_ARGUMENT, { id: 2, approach: 'contradiction', status: 'validated' }]),
    { type: 'tool/call', data: { name: 'attempt_update', arguments: '{broken json' } },
    { type: 'tool/call', data: { name: 'bash', arguments: '{"cmd":"ls"}' } },
  ])
  const text = sections.get('attempts:status').text({ agent: { session } })
  assert.match(text, /Validated: yes/, 'latest whole-list snapshot wins')
  assert.match(text, /contradiction/)
  assert.equal(provided.attemptState.isValidated('resumed'), true, 'fold must warm the guard-visible state')
})
