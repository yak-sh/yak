// A model is given what it accepts: its catalogue's output limit, else what
// its context window has room for after the input (Workers AI's GLM-5.3 lists
// none and accepts up to its 1,048,576-token window). Catalogue limits can
// grow without a release; one hosted turn stays bounded at `TURN`.
import type { Listed } from '@yaks/model'

let TURN = 65_536

let counted = (n?: number) =>
  n != null && Number.isSafeInteger(n) && n > 0 ? n : undefined

/** The output tokens a hosted turn asks for: what was requested, within what
 * the model accepts for an input of at most `input` tokens.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(outputTokens({ output: 32_000, context: 200_000 }), 32_000)
 * assertEquals(outputTokens({ context: 1_048_576 }), 65_536)
 * assertEquals(outputTokens({ context: 8192 }, undefined, 6192), 2000)
 * assertEquals(outputTokens({ context: 8192 }, 1000, 6192), 1000)
 * ```
 */
export let outputTokens = (
  info?: Pick<Listed, 'output' | 'context'>,
  requested?: number,
  input = 0,
): number => {
  let context = counted(info?.context)
  // An input bound that fills the window is pessimistic; the provider says
  // when the two do not fit.
  let accepted = counted(info?.output) ??
    (context && (counted(context - input) ?? context))
  return Math.min(requested ?? TURN, accepted ?? TURN, TURN)
}
