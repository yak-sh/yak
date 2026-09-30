// An embedder over Cloudflare Workers AI, through the `AI` binding a Worker is
// given. The binding is the credential: there is no key, no endpoint and
// nothing to sign in to, so a Worker makes this embedder from its own binding
// and hands it to what embeds (./sweep.ts `drain`, ./search.ts `meaning`).
// Anywhere else Workers AI is an OpenAI-compatible endpoint (./remote.ts).
//
// One call embeds many texts: `run(model, {text: [...]})` answers
// `{data: [[…], …], shape}`, a vector per text in order, which is the batching
// every provider here shares (./remote.ts `batched`). A model trained for it
// (Qwen3-Embedding, EmbeddingGemma) is kept narrower with `dim`, cut and
// renormalized here, since the binding answers its full width.
//
// A text the model will not take is `Refused`, as a 4xx is over HTTP: the
// sweep drops that one text and carries on. Anything else the binding throws —
// a rate limit, an outage — is thrown as it came, and the work stays owed.

import { type Embedder, Refused } from './embedder.ts'
import { answered, batched, type Load, space } from './remote.ts'

/** The slice of a Worker's `AI` binding this file calls. */
export type Ai = {
  run: (model: string, input: unknown) => Promise<unknown>
}

/** Which Workers AI model, at what width, over which binding. */
export type WorkersAi = {
  /** the model's Workers AI name (`@cf/qwen/qwen3-embedding-0.6b`) */
  model: string
  /** Matryoshka width: keep this many leading coordinates (./remote.ts `cut`) */
  dim?: number
  /** the Worker's `AI` binding */
  ai: Ai
} & Load

// How the binding says the input itself was the problem, in its own words.
let unfit = (e: unknown) =>
  /invalid input|context (window|length)|too (long|many tokens)/i.test(
    e instanceof Error ? e.message : String(e),
  )

/** An {@link Embedder} that asks Workers AI for every vector, batching the
 * calls made together. */
export let workersAi = (said: WorkersAi): Embedder =>
  batched(space(said), async (input) => {
    let got: unknown
    try {
      got = await said.ai.run(said.model, { text: input })
    } catch (e) {
      if (!unfit(e)) throw e
      throw new Refused(`@yaks/embedding: workers-ai refused — ${e}`)
    }
    return answered(
      'workers-ai',
      input,
      (got as { data?: number[][] } | null)?.data,
      said.dim,
    )
  }, said)
