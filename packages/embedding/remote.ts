// An embedder over HTTP — the one transport shipped here, because a model a
// host actually wants is almost always behind a URL.
//
// It holds no credential and reads no environment: the endpoint, the model and
// the token are arguments, which is what lets the same code run on a server
// (where the token arrives from the process), in a Worker (where it arrives on
// `env`), and in a test (where it is made up and the `fetch` is a stub).
//
// Two servers, one sentence. Ollama answers `/api/embed` with
// `{embeddings: [[…]]}` and an OpenAI-compatible one answers `/v1/embeddings`
// with `{data: [{embedding: […]}]}`; `via` names which, and nothing else here
// differs. A fault — a status, a shape, a timeout — is THROWN, because the
// sweep is the one that decides what a dark embedder means (it stops, and the
// corpus stays stale) and a vector quietly invented here would be worse than
// no vector at all.

import type { Embedder } from './embedder.ts'
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
  /** a bearer token; a box on your own subnet may need none */
  key?: string
  /** Matryoshka width: keep this many leading coordinates (see {@link cut}) */
  dim?: number
  /** how long to wait for one vector (default 30s) */
  timeout?: number
  /** the fetch to call through (default: the global one) */
  fetch?: Fetch
}

// Where each server takes an embedding request, and where it puts the answer.
// One input in, one vector out: this package embeds an entity at a time
// because the sweep already bounds how many it asks for.
let PATH = { ollama: '/api/embed', openai: '/v1/embeddings' }

let vectorOf = (via: Remote['via'], body: unknown): number[] | undefined => {
  let said = body as {
    embeddings?: number[][]
    data?: { embedding?: number[] }[]
  }
  return via == 'ollama' ? said.embeddings?.[0] : said.data?.[0]?.embedding
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

/** An {@link Embedder} that asks a server for every vector. */
export let remote = (said: Remote): Embedder => {
  let root = said.base.trim().replace(/\/+$/, '')
  let go: Fetch = said.fetch ?? (fetch as unknown as Fetch)
  return {
    model: said.model,
    embed: async (text) => {
      let headers: Record<string, string> = {
        'content-type': 'application/json',
      }
      if (said.key) headers.authorization = `Bearer ${said.key}`
      let res = await go(`${root}${PATH[said.via]}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: said.model, input: text }),
        signal: AbortSignal.timeout(said.timeout ?? 30_000),
      })
      let raw = await res.text()
      if (!res.ok) {
        throw new Error(
          `@yaks/embedding: ${said.via} answered ${res.status} — ${
            raw.slice(0, 200)
          }`,
        )
      }
      let got = vectorOf(said.via, JSON.parse(raw))
      if (!got?.length) {
        throw new Error(
          `@yaks/embedding: ${said.via} answered no vector — ${
            raw.slice(0, 200)
          }`,
        )
      }
      let vec = Float32Array.from(got)
      return said.dim ? cut(vec, said.dim) : vec
    },
  }
}
