// Context that only reads a local transcript must not open the graph or wait
// behind its writers. SessionStart still delegates to the ordinary tool.
import type { CliFacet } from '@yaks/cli/host'
import { promptContext, promptHook } from './prompt.ts'

export let tools: NonNullable<CliFacet['tools']> = {
  session_context: (args, context) => {
    // Structured output retains the ordinary tool runner's bundle contract.
    if (context.json) return undefined
    let prompt = promptHook(args.hook)
    if (prompt) {
      let body = promptContext(prompt)
      if (body) context.out(body)
      return 0
    }
    // Missing/malformed hooks without an explicit session are no-ops too.
    if (args.session) return undefined
    try {
      if (JSON.parse(String(args.hook))?.session_id) return undefined
    } catch { /* A malformed hook says nothing. */ }
    return 0
  },
}
