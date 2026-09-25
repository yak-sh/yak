// An embedder over HTTP — the one transport shipped here, because a model worth
// using is almost always behind a URL.
//
// It holds no credential and reads no environment: the endpoint, the model and
// the token are arguments, which is what lets the same code run on a server
// (where the token arrives from the process), in a Worker (where it arrives on
// `env`), and in a test (where it is made up and the `fetch` is a stub).
//
// Two kinds of server, one declaration. Ollama answers `/api/embed` with
// `{embeddings: [[…]]}`, and an OpenAI-compatible one answers `/v1/embeddings`
// with `{data: [{embedding: […]}]}`; `via` names which, and nothing else here
// differs. A failure — an error status, an unexpected body, a timeout — is
// thrown, because the sweep is what decides what an unreachable embedder means
// (it stops, and the corpus stays stale), and a vector invented here to avoid
// the error would be worse than no vector at all. A status saying the input
// itself was refused throws {@link Refused}, which the sweep treats as one
// text it cannot embed rather than a model it cannot reach.
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

/** A hosted or local embedding endpoint, as a config names one. */
export type Remote = {
  /** which endpoint shape: Ollama's native one, or OpenAI-compatible */
  via: 'ollama' | 'openai'
  /** the model to ask for — it names the space every stored vector lives in */
  model: string
  /** the server's root, without a path (`https://ollama.example`) */
  base: string
  /** a bearer token; a server on your own network may need none */
  key?: string
  /** Matryoshka width: keep this many leading coordinates (see {@link cut}) */
  dim?: number
  /** how long to wait for one request (default 30s) */
  timeout?: number
  /** the most characters sent for one vector (default {@link CHARS}) */
  chars?: number
  /** the most inputs one request carries (default {@link COUNT}) */
  count?: number
  /** the most characters one request carries (default {@link LOAD}) */
  load?: number
  /** the fetch to call through (default: the global one) */
  fetch?: Fetch
}

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

// The statuses that mean the input was refused, not the request: malformed,
// too large, or unprocessable.
let REFUSED = [400, 413, 422]

let vectorsOf = (via: Remote['via'], body: unknown): number[][] | undefined => {
  let said = body as {
    embeddings?: number[][]
    data?: { embedding?: number[]; index?: number }[]
  }
  return via == 'ollama' ? said.embeddings : said.data
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
    let res = await go(`${root}${PATH[said.via]}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: said.model, input }),
      signal: AbortSignal.timeout(said.timeout ?? 30_000),
    })
    let raw = await res.text()
    if (!res.ok) {
      let Fault = REFUSED.includes(res.status) ? Refused : Error
      throw new Fault(
        `@yaks/embedding: ${said.via} answered ${res.status} — ${
          raw.slice(0, 200)
        }`,
      )
    }
    let got = vectorsOf(said.via, JSON.parse(raw))
    if (got?.length != input.length || got.some((v) => !v?.length)) {
      throw new Error(
        `@yaks/embedding: ${said.via} answered no vector for ${input.length} ` +
          `input${input.length == 1 ? '' : 's'} — ${raw.slice(0, 200)}`,
      )
    }
    return got.map((v) => {
      let vec = Float32Array.from(v)
      return said.dim ? cut(vec, said.dim) : vec
    })
  }
  type Wait = {
    text: string
    ok: (v: Float32Array) => void
    no: (e: unknown) => void
  }
  let waiting: Wait[] = []
  // Send what this turn asked for, a run at a time; a run that fails fails
  // every call in it.
  let flush = async (): Promise<void> => {
    let all = waiting
    waiting = []
    let at = 0
    for (
      let run of parts(
        all.map((w) => w.text),
        said.count ?? COUNT,
        said.load ?? LOAD,
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
    model: said.model,
    embed: (text) =>
      new Promise((ok, no) => {
        if (!waiting.length) setTimeout(flush)
        waiting.push({ text: text.slice(0, said.chars ?? CHARS), ok, no })
      }),
  }
}
