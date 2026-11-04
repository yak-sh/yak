import type { Binding as AiBinding } from '@yaks/workers-ai'
import { DIM, MODEL as EMBEDDER } from './embedding.ts'

/** One turn, as a scripted model answers it. */
export type Turn = {
  text?: string
  calls?: { name: string; arguments: unknown }[]
}

/**
 * An `AI` binding stand-in that also answers the model every store embeds its
 * text with (embedding.ts) as Workers AI does, a vector per text, so a store's
 * own embedding never spends a turn a test scripted.
 */
export let embeds = <A extends AiBinding>(ai: A): A => ({
  ...ai,
  run: (
    model: string,
    input: unknown,
    options?: Parameters<AiBinding['run']>[2],
  ) =>
    model == EMBEDDER
      ? Promise.resolve({
        usage: { prompt_tokens: 0, completion_tokens: 0 },
        data: (input as { text: string[] }).text.map((_, i) =>
          Array.from({ length: DIM }, (_, j) => j == i % DIM ? 1 : 0)
        ),
      })
      : ai.run(model, input, options),
})

export let modelPage = (input: number, output: number, context = 100_000) =>
  new Response(
    `Context Window ${context} tokens\n$${input} per M input tokens, $${output} per M output tokens`,
  )

/**
 * Workers AI, scripted: the `AI` binding answering the turns it was given, in
 * the binding's own shape (`{response, tool_calls, usage}`), so a test drives
 * the whole provider (@yaks/workers-ai, as builder.ts hands it the loop) — the
 * messages it writes, the tool calls it reads back — and not just the loop.
 * Past the end of the script it says nothing, which ends the loop.
 */
export let ai = (script: Turn[]) => {
  let asked: { model: string; input: Record<string, unknown> }[] = []
  let at = 0
  return embeds({
    asked,
    run: (model: string, input: unknown) => {
      asked.push({ model, input: input as Record<string, unknown> })
      let turn = script[at++] ?? {}
      return Promise.resolve({
        response: turn.text ?? '',
        tool_calls: turn.calls ?? [],
        usage: { prompt_tokens: 20, completion_tokens: 5 },
      })
    },
    // The gateway a Workers AI binding can name is nobody's here: nothing on
    // this platform reaches OpenAI (builder.ts, T-34238).
    gateway: () => ({ getUrl: () => Promise.resolve('') }),
  })
}
