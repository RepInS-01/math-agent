/**
 * zero-leak-guard.test.mjs — Test corpus for the zero-leak output guard.
 *
 * Run with:  node --test zero-leak-guard.test.mjs
 *
 * Zero dependencies: uses node:test + node:assert. The plugin is loaded from
 * source via a data: URL so the tests exercise the real shipped file even
 * though the preset has no package.json (bare .js would default to CJS).
 *
 * Two corpus groups:
 *  - LEAK_SAMPLES: replies that MUST be blocked (add every newly discovered
 *    leak variant here together with its LEAK_PATTERNS entry).
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
const src = readFileSync(join(here, 'zero-leak-guard.js'), 'utf8')
const { default: plugin } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))

// Mirrors the persona text in agent.cordis.yml — the guard activates on these
// signatures. If the persona wording changes, update this AND expect the
// "non-coaching passthrough" tests to keep guarding the coupling.
const COACHING_SYSTEM = 'You are a Math Coach ... ## Zero-Leak Iron Rules ...'
const OTHER_SYSTEM = 'You are a helpful coding assistant.'

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
]

// ── harness ─────────────────────────────────────────────────────────────────

async function* fakeInnerStream(deltas, extras = []) {
  for (const text of deltas) yield { type: 'text-delta', index: 0, text }
  for (const c of extras) yield c
  yield { type: 'usage', inputTokens: 1, outputTokens: 1 }
  yield { type: 'finish', reason: 'stop' }
}

function applyGuard() {
  const handlers = {}
  const ctx = { on: (event, fn) => { handlers[event] = fn } }
  plugin.apply(ctx)
  assert.ok(handlers['llm/stream'], 'plugin must hook llm/stream')
  return handlers['llm/stream']
}

async function runGuard(system, deltas, extras = []) {
  const handler = applyGuard()
  const out = []
  for await (const chunk of handler({ system }, () => fakeInnerStream(deltas, extras))) {
    out.push(chunk)
  }
  return out
}

const textOf = (chunks) =>
  chunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join('')

// ── tests ───────────────────────────────────────────────────────────────────

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
