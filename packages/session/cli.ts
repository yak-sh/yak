// Prompt timing is local; earlier words come from the running server with a
// short deadline. The hook never opens a graph or waits behind its writers.
import { promptContext, promptHook } from './prompt.ts'

export let tools: {
  session_context: (
    args: Record<string, unknown>,
    context: { json: boolean; config?: string; out: (text: string) => void },
  ) => Promise<number | undefined>
} = {
  session_context: async (args, context) => {
    // Structured output retains the ordinary tool runner's bundle contract.
    if (context.json) return undefined
    let prompt = promptHook(args.hook)
    if (prompt) {
      let body = promptContext(prompt)
      if (body) context.out(body)
      if (
        context.config && typeof prompt.prompt == 'string' &&
        prompt.prompt.trim()
      ) {
        try {
          let config = JSON.parse(Deno.readTextFileSync(context.config))
          let response = await fetch(
            `http://127.0.0.1:${config.port ?? 8787}/session/earlier`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                words: prompt.prompt,
                before: new Date().toISOString(),
              }),
              signal: AbortSignal.timeout(650),
            },
          )
          if (response.ok) {
            let text = await response.text()
            if (text) context.out(text)
          }
        } catch { /* A busy or absent server must never delay the prompt. */ }
      }
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
