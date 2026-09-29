/**
 * @yaks/model2vec — an embedder fast enough to run on every prompt: a
 * {@link https://github.com/MinishLab/model2vec | Model2Vec} static model,
 * in-process, in plain TypeScript.
 *
 * A static model is a table with one vector per token. A text's vector is the
 * mean of its tokens' rows, normalized: a tokenizer pass and a sum, about a
 * millisecond for 500 tokens on one core, with no native code, no thread pool
 * and no network once the model is loaded. It runs wherever a web platform
 * does — a server, a Worker, a browser tab — and answers the same vector in
 * each. What it gives up against a transformer is context: every token means
 * the same thing wherever it stands.
 *
 * {@link model2vec} names a model on the Hugging Face hub and answers an
 * embedder for it; the model is fetched on the first embed and kept in the
 * platform's `caches`, so a later process reads it from disk. {@link embedder}
 * is the same thing over a tokenizer and a table already in hand.
 *
 * ```ts
 * import { assert, assertEquals } from '@std/assert'
 * import { files } from './testing.ts' // a tokenizer.json and a table
 * let e = await load('tiny', files)
 * let [a, b, c] = ['a red dragon', 'dragon, red', 'a blue whale'].map(e.embed)
 * let dot = (x: Float32Array, y: Float32Array) => x.reduce((s, v, i) => s + v * y[i], 0)
 * assert(dot(a, b) > 0.99 && dot(a, c) < 0.5)
 * assertEquals(e.model, 'tiny')
 * ```
 *
 * @module
 */

import { type Table, table } from './table.ts'

export { type Table, table }

/** Text in, vector out, and the name of the space the vectors live in: the
 * shape @yaks/embedding takes. */
export type Embedder = {
  model: string
  embed: (text: string) => Float32Array | Promise<Float32Array>
}

/** A text as token ids, without special tokens. */
export type Encode = (text: string) => number[]

/** How much of a text is read by default, in tokens: Model2Vec's own default.
 * A static model's mean dilutes as a text grows, so a longer window reads
 * more and says less. */
export let MAX = 512

/** What a text is read as. `unk` is dropped, as Model2Vec drops it; `chars`
 * cuts the text before tokenizing, so a long one costs no more than its
 * window. */
export type Window = { max?: number; chars?: number; unk?: number }

/**
 * An embedder over a tokenizer and a token table: the mean of the rows of a
 * text's first `max` tokens, at length 1. A text with no known tokens embeds to
 * the zero vector, which is unrelated to everything.
 */
export let embedder = (
  model: string,
  encode: Encode,
  t: Table,
  { max = MAX, chars = Infinity, unk }: Window = {},
): { model: string; embed: (text: string) => Float32Array } => ({
  model,
  embed: (text) => {
    let v = new Float32Array(t.dim)
    let n = 0
    for (let id of encode(text.slice(0, chars))) {
      if (id == unk || id >= t.count) continue
      if (n++ == max) break
      let row = t.rows.subarray(id * t.dim, (id + 1) * t.dim)
      for (let j = 0; j < t.dim; j++) v[j] += row[j]
    }
    let sum = 0
    for (let x of v) sum += x * x
    let len = Math.sqrt(sum)
    if (len) { for (let j = 0; j < t.dim; j++) v[j] /= len }
    return v
  },
})

/** A Model2Vec model on the hub, as a config names one. */
export type Model2Vec = {
  /** the hub repo, pinned to a revision: `minishlab/potion-retrieval-32M@6fc8051`.
   * Unpinned, the first revision this machine fetches is the one it keeps. */
  model: string
  /** keep this many leading columns of the table (default: all of them) */
  dim?: number
  /** read at most this many tokens of a text (default {@link MAX}) */
  max?: number
  /** the hub (default https://huggingface.co) */
  hub?: string
  /** the fetch to call through (default: the global one) */
  fetch?: typeof fetch
}

/** The space a config's vectors live in: the pinned model, and its width when
 * it is cut, since two widths of one model are two spaces. */
export let space = (said: Model2Vec): string =>
  said.dim ? `${said.model}#${said.dim}` : said.model

// Where the fetched files are kept, keyed by their URL: a pinned revision's
// file never changes, so a hit is always right.
let SHELF = '@yaks/model2vec'

// A file of the model: from the shelf, or from the hub and then shelved.
// Without a `caches` (some runtimes have none) every load fetches.
let file = async (url: string, go: typeof fetch): Promise<Uint8Array> => {
  let shelf = await globalThis.caches?.open(SHELF)
  let hit = await shelf?.match(url)
  if (hit) return new Uint8Array(await hit.arrayBuffer())
  let res = await go(url)
  if (!res.ok) {
    throw new Error(`@yaks/model2vec: ${url} answered ${res.status}`)
  }
  let bytes = new Uint8Array(await res.arrayBuffer())
  await shelf?.put(url, new Response(bytes))
  return bytes
}

// The median length of a vocabulary's tokens: Model2Vec cuts a text at `max`
// times this many characters before tokenizing it.
let median = (vocab: Record<string, number> | [string, number][]): number => {
  let lengths = (Array.isArray(vocab) ? vocab.map(([t]) => t) : Object.keys(
    vocab,
  )).map((t) => t.length).sort((a, b) => a - b)
  return lengths[lengths.length >> 1] ?? 1
}

/** The model's own files, read into an embedder. */
export let load = async (
  model: string,
  files: { tokenizer: Uint8Array; safetensors: Uint8Array },
  { dim, max = MAX }: { dim?: number; max?: number } = {},
): Promise<{ model: string; embed: (text: string) => Float32Array }> => {
  let { Tokenizer } = await import('@huggingface/tokenizers')
  let json = JSON.parse(new TextDecoder().decode(files.tokenizer))
  let tok = new Tokenizer(json, {})
  let unk = json.model?.unk_token
  return embedder(
    model,
    (text) => tok.encode(text, { add_special_tokens: false }).ids,
    table(files.safetensors, dim),
    {
      max,
      chars: max * median(json.model?.vocab ?? {}),
      unk: unk == null ? undefined : tok.token_to_id(unk),
    },
  )
}

type Embed = (text: string) => Float32Array

// The models this process has loaded, or is loading, by what they were read
// as: a config is read again on every pass, and a model is loaded once.
let loading = new Map<string, Promise<Embed>>()
let loaded = new Map<string, Embed>()

/**
 * An embedder for a Model2Vec model on the hub. Nothing is fetched until the
 * first embed; that one waits for the model, and every one after is
 * synchronous. The same model named again in this process is the one already
 * loaded. A load that fails rejects the embeds waiting on it and is tried
 * again on the next.
 */
export let model2vec = (said: Model2Vec): Embedder => {
  let name = space(said)
  let [repo, rev = 'main'] = said.model.split('@')
  let root = `${
    (said.hub ?? 'https://huggingface.co').replace(/\/+$/, '')
  }/${repo}/resolve/${rev}/`
  let key = `${root} ${name} ${said.max ?? MAX}`
  let go = said.fetch ?? fetch
  let start = (): Promise<Embed> => {
    let now = loading.get(key)
    if (now) return now
    let next = Promise.all([
      file(root + 'tokenizer.json', go),
      file(root + 'model.safetensors', go),
    ])
      .then(([tokenizer, safetensors]) =>
        load(name, { tokenizer, safetensors }, said)
      )
      .then(({ embed }) => (loaded.set(key, embed), embed))
      .catch((error) => {
        loading.delete(key)
        throw error
      })
    loading.set(key, next)
    return next
  }
  return {
    model: name,
    embed: (text) => loaded.get(key)?.(text) ?? start().then((f) => f(text)),
  }
}
