// An embedder over HTTP — the one transport shipped here, because a model worth
// using is almost always behind a URL.
//
// It holds no credential and reads no environment: the endpoint, the model and
// the token are arguments, which is what lets the same code run on a server
// (where the token arrives from the process), in a Worker (where it arrives on
// `env`), and in a test (where it is made up and the `fetch` is a stub).
//
// Two APIs, one declaration. Ollama answers `/api/embed` with
// `{embeddings: [[…]]}`, and an OpenAI-compatible server answers
// `/v1/embeddings` with `{data: [{embedding: […]}]}`; `api` names which, and
// nothing else here differs. Which server speaks which is the provider row's
// to say (./options.ts), not this file's.
//
// A failure — an error status, an unexpected body, a timeout — is thrown,
// because the sweep is what decides what an unreachable embedder means (it
// stops, and the corpus stays stale), and a vector invented here to avoid the
// error would be worse than no vector at all. A status saying the input itself
// was refused throws {@link Refused}, which the sweep treats as one text it
// cannot embed rather than a model it cannot reach. A server may refuse a text
// past its model's context rather than truncate it, as Ollama does for some
// texts on a 512-token model, so a text refused alone is asked again as its
// opening half, down to {@link SHORTEST} characters.
//
// Calls made together are sent together. Both servers take an array of inputs,
// and a batch of 64 costs a local model about a seventh of the time per vector
// that 64 single requests do, so every `embed()` made in one turn of the event
// loop (the sweep makes a batch's calls at once) waits for that turn to end
// and rides in one request — split by {@link parts} into requests no longer
// than a server takes.

import { type Embedder, Refused } from './embedder.ts'
import { unit } from './vector.ts'

/** The slice of `fetch` this file uses — the web one, and a Worker's. */
export type Fetch = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: AbortSignal
  },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>

/** The APIs spoken here: Ollama's own, and OpenAI-compatible. */
export type Api = 'ollama' | 'openai'

/** A hosted or local embedding endpoint: a provider, and the model asked of
 * it. */
export type Remote = {
  /** which API the server speaks: Ollama's own, or OpenAI-compatible */
  api: Api
  /** what the server calls the model, sent with every request */
  model: string
  /** the space the vectors live in (default {@link space} of the model): the
   * model's own name, whoever serves it, where the provider calls it
   * something else */
  space?: string
  /** the server's root, without a path (`https://ollama.example`) */
  base: string
  /** a bearer token; a server on your own network may need none */
  key?: string
  /** Matryoshka width: keep this many leading coordinates (see {@link cut}) */
  dim?: number
  /** how long to wait for one request (default 30s) */
  timeout?: number
  /** the fetch to call through (default: the global one) */
  fetch?: Fetch
} & Load

// Where each server takes an embedding request, and where it puts the answer.
let PATH = { ollama: '/api/embed', openai: '/v1/embeddings' }

/**
 * How much of a text is sent by default. A model embeds a bounded context, and
 * a server asked for more refuses the request rather than truncating it — which
 * would stop a sweep at the same long document on every pass. So a long text
 * is cut to its opening, which is what the model would have read of it anyway.
 * qwen3-embedding refuses somewhere past 35,000 characters of markdown.
 */
export let CHARS = 30_000

/** The most inputs one request carries by default. */
export let COUNT = 64

/** The most characters one request carries by default: a batch of long texts
 * is split before a server spends the whole timeout on it. */
export let LOAD = 128_000

/** The shortest text asked again after a refusal: one refused at this
 * length is refused for more than its length. */
export let SHORTEST = 256

// The statuses that mean the input was refused, not the request: malformed,
// too large, or unprocessable.
let REFUSED = [400, 413, 422]

let vectorsOf = (api: Api, body: unknown): number[][] | undefined => {
  let said = body as {
    embeddings?: number[][]
    data?: { embedding?: number[]; index?: number }[]
  }
  return api == 'ollama' ? said.embeddings : said.data
    ?.toSorted((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => d.embedding ?? [])
}

/**
 * Texts split into runs of at most `count` of them and `load` characters,
 * in order. A text longer than `load` rides alone.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(parts(['ab', 'cd', 'e', 'fghij'], 2, 4), [['ab', 'cd'], ['e'], ['fghij']])
 * ```
 */
export let parts = (
  texts: string[],
  count: number,
  load: number,
): string[][] => {
  let runs: string[][] = []
  let size = Infinity
  for (let t of texts) {
    let run = runs.at(-1)
    if (!run || run.length >= count || size + t.length > load) {
      runs.push([t])
      size = t.length
    } else {
      run.push(t)
      size += t.length
    }
  }
  return runs
}

/**
 * Matryoshka truncation: an MRL-trained model's leading coordinates are
 * themselves a valid smaller embedding, so a corpus is kept at one width
 * without a second model — and renormalized, so a cosine stays a cosine.
 * A model that answers narrower than asked is a misconfiguration, not a
 * vector to pad.
 */
export let cut = (v: Float32Array, dim: number): Float32Array => {
  if (v.length < dim) {
    throw new Error(
      `@yaks/embedding: the model answered ${v.length} dimensions, fewer than the ${dim} asked for`,
    )
  }
  return unit(v.slice(0, dim))
}

/** The space an embedder's vectors live in: the model, and its width when
 * {@link cut}, since two widths of one model are two spaces. */
export let space = (said: { model: string; dim?: number }): string =>
  said.dim ? `${said.model}#${said.dim}` : said.model

/** How many texts ride one request, and how much of each is sent. */
export type Load = {
  /** the most characters sent for one vector (default {@link CHARS}) */
  chars?: number
  /** the most inputs one request carries (default {@link COUNT}) */
  count?: number
  /** the most characters one request carries (default {@link LOAD}) */
  load?: number
}

/**
 * A provider's answer as vectors, one per input and in order, each cut to
 * `dim` where one is asked for. An answer short of a vector is a provider
 * that did not do what it says, and throws.
 */
export let answered = (
  who: string,
  input: string[],
  got: number[][] | undefined,
  dim?: number,
): Float32Array[] => {
  if (got?.length != input.length || got.some((v) => !v?.length)) {
    throw new Error(
      `@yaks/embedding: ${who} answered no vector for ${input.length} ` +
        `input${input.length == 1 ? '' : 's'} — ${
          JSON.stringify(got).slice(0, 200)
        }`,
    )
  }
  return got.map((v) => {
    let vec = Float32Array.from(v)
    return dim ? cut(vec, dim) : vec
  })
}

/**
 * An {@link Embedder} over a provider that answers many texts at once. Every
 * `embed()` made in one turn of the event loop waits for that turn to end and
 * rides one call of `ask`, split by {@link parts} into calls no larger than
 * `load` allows; a call that fails fails every text in it. `ask` answers a
 * vector per text, in order ({@link answered}).
 */
export let batched = (
  model: string,
  ask: (input: string[]) => Promise<Float32Array[]>,
  load: Load = {},
): Embedder => {
  type Wait = {
    text: string
    ok: (v: Float32Array) => void
    no: (e: unknown) => void
  }
  let waiting: Wait[] = []
  // Send what this turn asked for, a run at a time.
  let flush = async (): Promise<void> => {
    let all = waiting
    waiting = []
    let at = 0
    for (
      let run of parts(
        all.map((w) => w.text),
        load.count ?? COUNT,
        load.load ?? LOAD,
      )
    ) {
      let mine = all.slice(at, at += run.length)
      try {
        let got = await ask(run)
        mine.forEach((w, i) => w.ok(got[i]))
      } catch (error) {
        for (let w of mine) w.no(error)
      }
    }
  }
  return {
    model,
    embed: (text) =>
      new Promise((ok, no) => {
        if (!waiting.length) setTimeout(flush)
        waiting.push({ text: text.slice(0, load.chars ?? CHARS), ok, no })
      }),
  }
}

/** An {@link Embedder} that asks a server for every vector, batching the
 * calls made together. */
export let remote = (said: Remote): Embedder => {
  let root = said.base.trim().replace(/\/+$/, '')
  let go: Fetch = said.fetch ?? (fetch as unknown as Fetch)
  // One request: texts in, a vector each out, in order.
  let ask = async (input: string[]): Promise<Float32Array[]> => {
    let headers: Record<string, string> = {
      'content-type': 'application/json',
    }
    if (said.key) headers.authorization = `Bearer ${said.key}`
    let res = await go(`${root}${PATH[said.api]}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: said.model, input }),
      signal: AbortSignal.timeout(said.timeout ?? 30_000),
    })
    let raw = await res.text()
    if (!res.ok) {
      let Fault = REFUSED.includes(res.status) ? Refused : Error
      throw new Fault(
        `@yaks/embedding: ${said.api} answered ${res.status} — ${
          raw.slice(0, 200)
        }`,
      )
    }
    return answered(
      said.api,
      input,
      vectorsOf(said.api, JSON.parse(raw)),
      said.dim,
    )
  }
  // One text, alone and refused, is asked again as its opening half.
  let fit = async (input: string[]): Promise<Float32Array[]> => {
    try {
      return await ask(input)
    } catch (error) {
      let [text] = input
      if (
        !(error instanceof Refused) || input.length > 1 ||
        text.length <= SHORTEST
      ) throw error
      return fit([text.slice(0, text.length >> 1)])
    }
  }
  return batched(said.space ?? space(said), fit, said)
}
