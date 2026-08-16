/**
 * zero-leak-guard.js — 程序化零泄露输出守卫（Math_Agent 预设自带插件）。
 *
 * 挂在 `llm/stream` waterfall 上，对教练会话的每次模型输出做整体检查：
 * 命中答案线索模式（数值、区间、对错判断、答案形态）时，整段替换为固定
 * 拦截文案，模型的原始输出一个字都不会到达训练者。
 *
 * - 只对 system 含教练特征（零泄露铁律/数学教练）的请求启用；其余请求
 *   完全透传，不影响任何其他会话。
 * - 拦截发生在流层：会话日志记录的是拦截文案而非泄露文本，模型下一轮
 *   会看到自己被拦截的通知，从而自动改用合规表述。
 * - 本文件随预设目录一起复制、一起加载，无需安装 npm 包。
 */
export default {
  name: 'zero-leak-guard',

  apply(ctx) {
    const LEAK_PATTERNS = [
      // 区间：x 到/至/~/-/和/与/逗号 y（含 之间/范围/左右 等限定）
      /\d+(?:\.\d+)?\s*(?:到|至|~|–|—|-|和|与|,|，)\s*\d+(?:\.\d+)?\s*(?:之间|范围|左右|附近|上下)/,
      // 介于/在/处于 x (和|与|到|至) y
      /(?:介于|在|处于)\s*\d+(?:\.\d+)?\s*(?:和|与|到|至|~|–|—|-)\s*\d+(?:\.\d+)?/,
      // 判断词后接数字/符号（大了/小了/接近/对了/错了/不是/排除 …）
      /(?:不是|不对|错了|正确|接近|大了|小了|对了|排除|差一点|差不多)\s*[0-9φπe]/,
      // 数字/符号后接判断词（“1大了”“1接近了”“1不满足方程”）
      /[0-9φπe]\s*(?:大了|小了|接近|对了|错了|不是|差一点|差不多|还差|不满足|不符合)/,
      // 答案形态表述：答案/结果是/等于/约等于 后接数字或常数
      /(?:答案|结果|极限|就是|等于|约等于|大约是)\s*(?:是|=)?\s*[0-9φπe]/,
      // 教练主动给出带小数的数值（答案候选形态）
      /[0-9]\.[0-9]{2,}/,
      // 数值 + 左右/附近/上下（“1.6左右”），但排除“左右两边”等数学术语
      /\d+(?:\.\d+)?\s*(?:左右|附近|上下)(?!边)/,
    ]

    const BLOCKED_TEXT = '【零泄露守卫拦截】这条回复包含答案线索（数值/区间/对错判断），已按训练原则拦截，未放行。请重新表述，只讨论训练者的论证结构，不评判任何数值。'

    function checkLeak(text) {
      for (const re of LEAK_PATTERNS) {
        if (re.test(text)) return true
      }
      return false
    }

    ctx.on('llm/stream', async function* (options, next) {
      const system = options.system || ''
      // 只对教练会话启用；其他请求完全透传，零影响
      if (!system.includes('零泄露铁律') && !system.includes('数学教练')) {
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
        // 整体替换：模型吐出的原话一个字都不放行
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
