// The `AI` binding, scripted (not part of the published package; see
// deno.json): Workers AI answering in its own shapes, so a test drives the
// whole provider and not just the loop, with no account anywhere.

// What a binding stand-in answers: a call to a model, as the binding runs it.
type Runs = {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>
}

/** The model a host makes its vectors with, and how wide they are. */
export type Space = { model: string; dimensions: number }

/** One turn, as a scripted model answers it. */
export type Turn = {
  text?: string
  calls?: { name: string; arguments: unknown }[]
}

/**
 * `ai` answering `space`'s model as Workers AI does, a vector per text, so a
 * host's own embedding never spends a turn a test scripted.
 */
export let embeds = <A extends Runs>(ai: A, space: Space): A => ({
  ...ai,
  run: (model: string, input: unknown, options?: unknown) =>
    model == space.model
      ? Promise.resolve({
        usage: { prompt_tokens: 0, completion_tokens: 0 },
        data: (input as { text: string[] }).text.map((_, i) =>
          Array.from(
            { length: space.dimensions },
            (_, j) => j == i % space.dimensions ? 1 : 0,
          )
        ),
      })
      : ai.run(model, input, options),
})

/** A window wide enough for the instructions and tools a test's requests
 * carry, as GLM-5.3's is on Workers AI. */
export let WINDOW = 1_048_576

/** A model's page in the Workers AI catalogue: its window and prices. */
export let modelPage = (input: number, output: number, context = WINDOW) =>
  new Response(
    `Context Window ${context} tokens\n$${input} per M input tokens, $${output} per M output tokens`,
  )

/**
 * Workers AI, scripted: the binding answering the turns it was given, in its
 * own shape (`{response, tool_calls, usage}`), and `space`'s model with
 * vectors. Past the end of the script it says nothing, which ends a loop.
 */
export let ai = (script: Turn[], space: Space) => {
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
    // The gateway a binding can name, which reaches nobody here.
    gateway: () => ({ getUrl: () => Promise.resolve('') }),
  }, space)
}
