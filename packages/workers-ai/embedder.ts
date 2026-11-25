// Workers AI as an embedder (@yaks/embedding `Batched`), through the `AI`
// binding a Worker is given. The binding is the credential: there is no key,
// no endpoint and nothing to sign in to, so a Worker lends this plugin its
// binding (./graph.ts) and hands what it makes to what embeds (@yaks/embedding
// `drain`, `meaning`). Anywhere else Workers AI is an OpenAI-compatible
// endpoint (@yaks/embedding `remote`).
//
// One call embeds many texts: `run(model, {text: [...]})` answers
// `{data: [[…], …], shape}`, a vector per text in order, which is the batching
// every provider shares (@yaks/embedding `batched`). A model trained for it
// (Qwen3-Embedding, EmbeddingGemma) is kept narrower with `dim`, cut and
// renormalized here, since the binding answers its full width.
//
// A text the model will not take is `Refused`, as a 4xx is over HTTP: a batch
// it rode in is asked again a text at a time, a text alone is asked again as
// its opening half (@yaks/embedding `halving`), and one refused even then is
// dropped while the sweep carries on. Anything else the binding throws
// (Workers AI failing on its side, a rate limit, an outage) is asked again
// after each pause of @yaks/embedding `retries`; one that outlasts them is
// thrown once as `Unanswered`, and the work stays owed.

import {
  answered,
  type Batched,
  batched,
  halving,
  type Load,
  Refused,
  retrying,
  space,
} from '@yaks/embedding'

/** The slice of a Worker's `AI` binding the embedder calls. */
export type Ai = {
  run: (model: string, input: unknown) => Promise<unknown>
}

/** Which Workers AI model, at what width, over which binding. */
export type Embeds = {
  /** the model's Workers AI name (`@cf/qwen/qwen3-embedding-0.6b`) */
  model: string
  /** its published context window in tokens, where the host knows it */
  context?: number
  /** Matryoshka width: keep this many leading coordinates (./remote.ts `cut`) */
  dim?: number
  /** the Worker's `AI` binding */
  ai: Ai
} & Load

// How the binding says the input itself was the problem, in its own words.
let unfit = (e: unknown) =>
  /invalid input|input too big|context (window|length)|too (long|many tokens)/i
    .test(
      e instanceof Error ? e.message : String(e),
    )

let utf8 = new TextEncoder()

// A text token can cover one byte. Leave room for the model's framing and
// end marker, and cut at a Unicode character boundary.
let fit = (text: string, context: number): string => {
  let bytes = Math.floor(context * 0.9)
  if (text.length * 3 <= bytes) return text
  let { read } = utf8.encodeInto(text, new Uint8Array(bytes))
  return text.slice(0, read)
}

/** A {@link Batched} embedder that asks Workers AI for every vector,
 * batching the calls made together. */
export let embedder = (said: Embeds): Batched => {
  let { context } = said
  let made = batched(
    space(said),
    halving(
      retrying('workers-ai', said.model, async (input) => {
        let got: unknown
        try {
          got = await said.ai.run(said.model, { text: input })
        } catch (e) {
          if (!unfit(e)) throw e
          let bytes = utf8.encode(JSON.stringify({ text: input })).length
          throw new Refused(
            `@yaks/workers-ai: ${said.model} refused ${input.length} text(s), ${bytes} input bytes — ${e}`,
            { cause: e },
          )
        }
        return answered(
          'workers-ai',
          input,
          (got as { data?: number[][] } | null)?.data,
          said.dim,
        )
      }),
      context ? { retries: 1, shortest: 1 } : undefined,
    ),
    {
      ...said,
      measure: (text) => utf8.encode(JSON.stringify(text)).length + 1,
    },
  )
  return context
    ? { ...made, embed: (text) => made.embed(fit(text, context)) }
    : made
}
