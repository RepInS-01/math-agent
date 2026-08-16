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
 * - This file ships inside the preset directory and loads via a relative path;
 *   no npm package required.
 */
export default {
  name: 'zero-leak-guard',

  apply(ctx) {
    const LEAK_PATTERNS = [
      // ── intervals: x to/from y (Chinese & English) ──
      // x到y之间 / x和y之间 / x~y / 介于x与y
      /\d+(?:\.\d+)?\s*(?:到|至|~|–|—|-|和|与|,|，)\s*\d+(?:\.\d+)?\s*(?:之间|范围|左右|附近|上下)/,
      /(?:介于|在|处于)\s*\d+(?:\.\d+)?\s*(?:和|与|到|至|~|–|—|-)\s*\d+(?:\.\d+)?/,
      // between x and y / from x to y
      /(?:between|from)\s*\d+(?:\.\d+)?\s*(?:and|to)\s*\d+(?:\.\d+)?/,
      // ── judgment words followed by a number (Chinese & English) ──
      /(?:不是|不对|错了|正确|接近|大了|小了|对了|排除|差一点|差不多)\s*[0-9φπe]/,
      /[0-9φπe]\s*(?:大了|小了|接近|对了|错了|不是|差一点|差不多|还差|不满足|不符合)/,
      /(?:too (?:big|small|high|low|close)|close to|almost|nearly|right|wrong|correct|incorrect|not (?:right|wrong|correct|that|the number))\s*[0-9φπe]/,
      /[0-9φπe]\s*(?:is\s+)?(?:too (?:big|small|high|low|close)|wrong|right|correct|incorrect|close|almost|nearly|not\s+it)/,
      // ── answer-form phrasing followed by a number (Chinese & English) ──
      /(?:答案|结果|极限|就是|等于|约等于|大约是)\s*(?:是|=)?\s*[0-9φπe]/,
      /(?:the answer|answer is|result is|limit is|equals|approximately|about)\s*(?:is|=)?\s*[0-9φπe]/,
      // ── coach volunteering a decimal value (answer-candidate form) ──
      /[0-9]\.[0-9]{2,}/,
      // ── value + 左右/附近/上下 ("1.6左右"), excluding "左右两边" math idioms ──
      /\d+(?:\.\d+)?\s*(?:左右|附近|上下)(?!边)/,
    ]

    const BLOCKED_TEXT = '[Zero-Leak Guard] This reply contained answer clues (numeric value / interval / right-wrong judgment) and was blocked by the training principle — nothing was delivered. Please rephrase and discuss only the trainee\'s argument structure, without judging any value.'

    function checkLeak(text) {
      for (const re of LEAK_PATTERNS) {
        if (re.test(text)) return true
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
      const inner = next()
      const deltas = []
      let text = ''
      const rest = []
      for await (const chunk of inner) {
        if (chunk.type === 'text-delta') {
          deltas.push(chunk)
          text += chunk.text
        } else {
          rest.push(chunk)
        }
      }
      if (checkLeak(text)) {
        // Replace the whole reply: not a single character of the model's original output reaches the trainee
        yield { type: 'text-delta', index: 0, text: BLOCKED_TEXT }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: BLOCKED_TEXT } }
        for (const chunk of rest) {
          if (chunk.type === 'usage' || chunk.type === 'finish') yield chunk
        }
        return
      }
      for (const d of deltas) yield d
      for (const c of rest) yield c
    })
  },
}
