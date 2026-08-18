/**
 * zero-leak-guard.js — Programmatic zero-leak output guard (Math_Agent preset plugin).
 *
 * Hooks into the `llm/stream` waterfall and inspects the coach's entire reply
 * for coaching sessions: when answer-clue patterns (numeric values, intervals,
 * correctness judgments, answer forms) are detected, the entire response is
 * replaced — not a single character of the model's original output reaches the
 * trainee.
 *
 * - Activates only for requests whose system prompt carries coaching signatures
 *   ("Zero-Leak Iron Rules" / "Math Coach"); all other requests pass through
 *   untouched.
 * - Interception happens at the stream layer: session logs record the
 *   interception message, not the leaked text. On the next turn, the model
 *   sees its own interception notice and automatically reformulates.
 * - Leak patterns cover both Chinese and English coaching replies, because the
 *   persona replies in the trainee's language (Chinese trainees get Chinese
 *   coaching, so Chinese leak wording must also be caught).
 * - Patterns run on a normalized copy of the reply: NFKC full-width folding
 *   (１.６１８ → 1.618), LaTeX linearization (\frac{3}{2} → 3/2, \sqrt{2} →
 *   √(2)), and Chinese-numeral conversion (一点六一八 → 1.618, 二分之三 →
 *   3/2) collapse evasion spellings to canonical form before matching. The
 *   delivered text itself is never rewritten.
 * - The final-synthesis unlock is programmatic: when the attempt-tracker
 *   plugin (same isolate realm, service `attemptState`) records a validated
 *   attempt for the session, this guard stands down so the coach can deliver
 *   the complete solution. Until then every coaching reply is scanned.
 * - This file ships inside the preset directory and loads via a relative path;
 *   no npm package required.
 */
export default {
  name: 'zero-leak-guard',

  apply(ctx) {
    // ── match-time normalization ─────────────────────────────────────────
    // Evasion spellings of the same value collapse to one canonical form
    // BEFORE the patterns run: full-width digits/punctuation (NFKC), LaTeX
    // inline math (\frac{1}{2} → 1/2, \sqrt{2} → √(2), \pi → π), and Chinese
    // numerals (一点六一八 → 1.618, 二分之三 → 3/2). Match-only: the text
    // delivered to the trainee is never rewritten.

    const CN_DIGIT = {
      零: '0', 〇: '0', 一: '1', 二: '2', 两: '2', 三: '3', 四: '4',
      五: '5', 六: '6', 七: '7', 八: '8', 九: '9',
    }
    const CN_UNIT = { 十: 10, 百: 100, 千: 1000 }
    const CN_NUM = '零〇一二三四五六七八九两' // digit words
    const CN_RUN_CHARS = CN_NUM + '十百千' // digit words + units

    // 二十三 → 23, 十五 → 15, 一百零二 → 102 (万 and above intentionally unsupported)
    function cnInteger(s) {
      let total = 0, pending = 0
      for (const ch of s) {
        if (ch in CN_DIGIT) pending = Number(CN_DIGIT[ch])
        else { total += (pending || 1) * CN_UNIT[ch]; pending = 0 }
      }
      return String(total + pending)
    }

    function normalizeForMatch(text) {
      // Full-width → half-width (１.６１８ → 1.618), ² → 2; NFKC leaves
      // U+2212 minus and U+2044 fraction slash alone, so map them by hand.
      let t = text.normalize('NFKC').replace(/−/g, '-').replace(/⁄/g, '/')

      // LaTeX inline math → linear form (skipped entirely for TeX-free text)
      if (/[\\$]/.test(t)) {
        t = t.replace(/\$\$?|\\[\[\]()]/g, '')
        t = t.replace(/\\(?:left|right|middle|big[lrg]{0,2}[lr]?)\b/g, '')
        t = t.replace(/\\(?:q?quad|[,;:!]|\s)/g, '')
        let prev
        do {
          // innermost first: \frac{1}{2} → 1/2, \sqrt{2} → √(2), \sqrt[3]{8} → √(8)
          prev = t
          t = t.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2')
          t = t.replace(/\\sqrt(?:\s*\[[^\]]*\])?\s*\{([^{}]*)\}/g, '√($1)')
          t = t.replace(/\\sqrt\s*(\d)/g, '√$1')
        } while (t !== prev)
        t = t
          .replace(/\\(?:varphi|phi)\b/g, 'φ')
          .replace(/\\pi\b/g, 'π')
          .replace(/\\infty\b/g, '∞')
          .replace(/\\(?:times|cdot)\b/g, '*')
          .replace(/\\div\b/g, '/')
          .replace(/\\pm\b/g, '±')
          .replace(/\\leq?\b/g, '≤')
          .replace(/\\geq?\b/g, '≥')
          .replace(/\\neq?\b/g, '≠')
          .replace(/\\approx\b/g, '≈')
          .replace(/\\([{}%&])/g, '$1')
          .replace(/\\[a-zA-Z]+ ?/g, ' ') // unknown commands degrade to a space
          .replace(/[{}]/g, '')
      }

      // Chinese numerals → digits. Order matters: 百分之/分之 before bare runs.
      t = t.replace(/根号/g, '√')
      t = t.replace(new RegExp(`百分之([${CN_RUN_CHARS}]+)`, 'g'), (_, n) => cnInteger(n) + '%')
      t = t.replace(
        new RegExp(`([${CN_RUN_CHARS}]+)分之([${CN_RUN_CHARS}]+)`, 'g'),
        (_, den, num) => cnInteger(num) + '/' + cnInteger(den),
      )
      t = t.replace(new RegExp(`负(?=[\\d${CN_RUN_CHARS}√])`, 'g'), '-')
      t = t.replace(new RegExp(`(?<=[\\d${CN_NUM}])点|点(?=[${CN_NUM}])`, 'g'), '.')
      t = t.replace(new RegExp(`[${CN_RUN_CHARS}]+`, 'g'), (m, off, s) => {
        const near = /[\d.%√πφ]/.test(s[off - 1] || '') || /[\d.%√πφ]/.test(s[off + m.length] || '')
        // A unit word converts once it has company (十二 → 12); a lone 十 stays
        // text (十分高兴). Pure digit-word runs convert only in numeric context —
        // keeps prose like 三三两两 / 方法一 from becoming bogus digits.
        if (/[十百千]/.test(m)) return m.length >= 2 ? cnInteger(m) : m
        return near ? [...m].map((c) => CN_DIGIT[c]).join('') : m
      })
      return t
    }

    // Numeric-answer token: an ASCII digit, φ/π/√, or the standalone constant e.
    // `e` must stay word-boundaried (`\be\b`) and OUTSIDE the digit class —
    // a bare `e` in a character class also matches the first letter of any
    // word like "expression", turning "the correct expression" into a false block.
    // `√` is in the class so normalized \sqrt / 根号 leaks are caught.
    const LEAK_PATTERNS = [
      // ── intervals: x to/from y (Chinese & English) ──
      // x到y之间 / x和y之间 / x~y / 介于x与y
      /\d+(?:\.\d+)?\s*(?:到|至|~|–|—|-|和|与|,|，)\s*\d+(?:\.\d+)?\s*(?:之间|范围|左右|附近|上下)/,
      /(?:介于|在|处于)\s*\d+(?:\.\d+)?\s*(?:和|与|到|至|~|–|—|-)\s*\d+(?:\.\d+)?/,
      // between x and y / from x to y
      /(?:between|from)\s*\d+(?:\.\d+)?\s*(?:and|to)\s*\d+(?:\.\d+)?/,
      // ── judgment words followed by a number (Chinese & English) ──
      /(?:不是|不对|错了|正确|接近|大了|小了|对了|排除|差一点|差不多)\s*(?:[0-9φπ√]|\be\b)/,
      /(?:[0-9φπ√]|\be\b)\s*(?:大了|小了|接近|对了|错了|不是|差一点|差不多|还差|不满足|不符合)/,
      /(?:too (?:big|small|high|low|close)|close to|almost|nearly|right|wrong|correct|incorrect|not (?:right|wrong|correct|that|the number))\s*(?:[0-9φπ√]|\be\b)/,
      /(?:[0-9φπ√]|\be\b)\s*(?:is\s+)?(?:too (?:big|small|high|low|close)|wrong|right|correct|incorrect|close|almost|nearly|not\s+it)/,
      // ── answer-form phrasing followed by a number (Chinese & English) ──
      /(?:答案|结果|极限|就是|等于|约等于|大约是)\s*(?:是|=)?\s*(?:[0-9φπ√]|\be\b)/,
      /(?:the answer|answer is|result is|limit is|equals|approximately|about)\s*(?:is|=)?\s*(?:[0-9φπ√]|\be\b)/,
      // ── coach volunteering a decimal value (answer-candidate form) ──
      /[0-9]\.[0-9]{2,}/,
      // ── value + 左右/附近/上下 ("1.6左右"), excluding "左右两边" math idioms ──
      /\d+(?:\.\d+)?\s*(?:左右|附近|上下)(?!边)/,
    ]

    const BLOCKED_TEXT = '[Zero-Leak Guard] This reply contained answer clues (numeric value / interval / right-wrong judgment) and was blocked by the training principle — nothing was delivered. Please rephrase and discuss only the trainee\'s argument structure, without judging any value.'

    function checkLeak(text) {
      const normalized = normalizeForMatch(text)
      for (const re of LEAK_PATTERNS) {
        if (re.test(normalized)) return true
      }
      return false
    }

    ctx.on('llm/stream', async function* (options, next) {
      const system = options.system || ''
      // Only enable for coaching sessions; all other requests pass through untouched
      if (!system.includes('Zero-Leak Iron Rules') && !system.includes('Math Coach')) {
        yield* next()
        return
      }
      // Final-synthesis unlock is PROGRAM state, not the model's say-so: once the
      // attempt tracker (same isolate realm) holds a validated attempt for this
      // session, the coach may deliver the full solution and this guard stands
      // down. Missing service / unknown session / no validated attempt all fall
      // through to blocking — fail-closed in every direction.
      const tracker = ctx.get('attemptState')
      if (tracker && options.sessionId && tracker.isValidated(options.sessionId)) {
        yield* next()
        return
      }
      const inner = next()
      const chunks = []
      let text = ''
      for await (const chunk of inner) {
        chunks.push(chunk)
        if (chunk.type === 'text-delta') text += chunk.text
      }
      if (!checkLeak(text)) {
        // Clean reply: replay verbatim in ORIGINAL order. Reordering chunks
        // (e.g. text-deltas first) desyncs the persisted assistant message
        // from the finish chunk's replayState, and pi-ai's strict positional
        // check then rejects the poisoned history on the NEXT turn
        // (INVALID_REPLAY_STATE) — one reordered step breaks every later turn.
        for (const c of chunks) yield c
        return
      }
      // Blocked: replace the text block's content IN PLACE, keeping the
      // original block order (reasoning before text) so the persisted message
      // stays consistent with replayState. Both the deltas and the block-end
      // payload must be rewritten — BlockAssembler prefers the block-end
      // payload, so leaving it intact would persist the leaked text.
      // Reasoning content is redacted (deltas dropped, block-end payload
      // emptied): a blocked reply's reasoning typically contains the very
      // answer clues being intercepted.
      let replaced = false
      for (const c of chunks) {
        if (c.type === 'reasoning-delta') continue
        if (c.type === 'text-delta') {
          if (!replaced) {
            yield { ...c, text: BLOCKED_TEXT }
            replaced = true
          }
          continue
        }
        if (c.type === 'block-end' && c.block?.type === 'text') {
          yield { ...c, block: { ...c.block, text: BLOCKED_TEXT } }
          continue
        }
        if (c.type === 'block-end' && c.block?.type === 'reasoning') {
          yield { ...c, block: { ...c.block, text: '' } }
          continue
        }
        yield c
      }
    })
  },
}
