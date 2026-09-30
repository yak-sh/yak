// What a config declares to this plugin, and the embedder it names. "The
// server" below means whichever process opened the graph and loaded this
// package.
//
// The vectors are this package's business; the model is not. So the config
// names one beside the plugin, the way a session names what serves it: a
// provider and a model, two choices. `./rules` needs the vector space the
// model names (a stored vector is only comparable with others in the same
// space), `./service` needs the embedding function itself:
//
// ```json
// { "use": "@yaks/embedding",
//   "with": { "embedder": { "provider": "ollama",
//                           "model": "granite-embedding-30m-english" },
//             "text": ["doc.title", "doc.body"] } }
// ```
//
// A provider reached over HTTP is a row in the graph, as it is for a chat
// (@yaks/model): `provider{name, base, api}` says where it answers and which
// API it speaks, and its `serves` edge to the `model` row says what it calls
// that model. Nothing here knows Ollama beyond the shape of its API
// (./remote.ts). The space is the model's own name, whoever serves it, so the
// same model moved to another provider keeps its vectors. Two providers run
// in this process and need no row: `hash`, the offline embedder shipped here
// (instant, deterministic, and no model at all, which is what a development
// machine and a test want), and `model2vec`, a static model from the Hugging
// Face hub (@yaks/model2vec), whose `model` is the pinned repo it loads.
//
// Missing config never prevents startup. A server that composes this plugin
// and has not been given a key, a provider row or a model yet is a server
// waiting for one: it starts, it stores no vectors, its check reports what it
// is waiting for, and the first pass after it arrives is the one that embeds.
// So nothing here throws: a config and the rows it names amount to a
// {@link Ready} value, read on every pass rather than once when the plugin is
// composed, which is what lets a key or a row written into the graph start the
// sweep without a restart.

import type { Bundle, Comp } from '@yaks/graph'
import { dead, identityEid } from '@yaks/graph'
import { edgeEid } from '@yaks/edge'
import { MODEL, PROVIDER } from '@yaks/model'
import type { Vocab } from '@yaks/vocab'
import { model2vec, space as m2vSpace } from '@yaks/model2vec'
import type { Embedder } from './embedder.ts'
import { hashEmbedder } from './embedder.ts'
import { type Field, fields, searched, unembedded } from './fields.ts'
import { type Api, type Fetch, remote } from './remote.ts'

/** An embedder, as a config names one: a provider and the model it serves. */
export type Named = {
  /** `hash` or `model2vec` in this process, or the name of a `provider` row
   * reached over HTTP */
  provider: string
  /** the `model` row's name, which names the vector space; for `model2vec`,
   * the pinned hub repo (`owner/name@revision`); none for `hash` */
  model?: string
  /** keep this many leading coordinates (Matryoshka); a second width of one
   * model is a second space. For `hash`, how many buckets (default 64). */
  dim?: number
  /** a bearer token for a provider that wants one */
  key?: string
  /** the most characters sent for one vector (./remote.ts `CHARS`) */
  chars?: number
  /** how long to wait for one request, in milliseconds */
  timeout?: number
  /** the most inputs one request carries (./remote.ts `COUNT`) */
  count?: number
  /** the most characters one request carries (./remote.ts `LOAD`) */
  load?: number
  /** the fetch to call through: a test's */
  fetch?: Fetch
}

/** What a config declares to `@yaks/embedding`. */
export type Options = {
  /** which embedder the vectors are made with — required, and its model
   * names the space every stored row is stamped with */
  embedder?: Named
  /** which text feeds a vector, as `comp.prop` pairs. The default is every
   * property the vocabulary marks `search: true` (./fields.ts `searched`). */
  text?: string[]
  /** how many neighbours a `.near` selects (default 8) */
  neighbours?: number
  /** the similarity a neighbour must reach to be one at all (default 0) */
  floor?: number
  /** how many queued entities one sweep takes (default 64, ./sweep.ts
   * `BATCH`); the next sweep follows at once while any are left */
  batch?: number
  /** how long an empty queue waits before the service looks again, in
   * milliseconds (default 3000) — how soon a new text is embedded */
  after?: number
  /** how long the index may stay behind the vectors before that means nobody
   * is building it, in minutes (default 30) — the check reads it (./tools.ts) */
  stale?: number
}

/** Where the rows a config names are read: the graph's `get`, which leaves
 * out an entity that does not exist. */
export type Rows = {
  get: (eids: string[]) => Bundle[] | Promise<Bundle[]>
}

/** What the config amounts to: the embedder it names, or the single message
 * explaining why there is none yet. */
export type Ready = {
  /** the vector space — the model name stored on every row. It comes from the
   * config alone, so a query can rank `.near` over what is already stored
   * while the sweep is still waiting for a key. */
  model?: string
  /** the embedder itself: absent while the config is incomplete */
  embedder?: Embedder
  /** why there is none, for whoever asks — absent when there is one */
  waiting?: string
}

// The two providers this package runs in its own process.
let HASH = 'hash'
let MODEL2VEC = 'model2vec'

// The APIs ./remote.ts speaks.
let APIS: Api[] = ['ollama', 'openai']

/** The space a config's vectors live in, from the config alone: the model,
 * and its width when it is cut. `undefined` where the config names none. */
export let spaceOf = (said?: Named): string | undefined =>
  !said?.provider
    ? undefined
    : said.provider == HASH
    ? hashEmbedder(said.dim).model
    : !said.model
    ? undefined
    : said.provider == MODEL2VEC
    ? m2vSpace({ model: said.model, dim: said.dim })
    : said.dim
    ? `${said.model}#${said.dim}`
    : said.model

let live = (b: Bundle | undefined, comp: string): Comp | undefined =>
  b && !dead(b) ? b[comp] as Comp | undefined : undefined

// A provider row, the model row and the edge between them, read as an
// embedder, or what is missing.
let served = async (said: Named, rows: Rows): Promise<Embedder | string> => {
  let p = identityEid(PROVIDER, [said.provider])
  let m = identityEid(MODEL, [said.model!])
  let e = edgeEid(p, 'serves', m)
  let got = new Map((await rows.get([p, m, e])).map((b) => [b.entity.eid, b]))
  let provider = live(got.get(p), PROVIDER)
  if (!provider) return `no provider called ${JSON.stringify(said.provider)}`
  let api = provider.api as Api | undefined
  if (!api || !APIS.includes(api)) {
    return `${said.provider} names no API this package speaks (` +
      `${APIS.join(', ')}) in \`provider.api\``
  }
  if (typeof provider.base != 'string' || !provider.base) {
    return `${said.provider} says nowhere to reach it in \`provider.base\``
  }
  let serves = live(got.get(e), 'serves')
  if (!live(got.get(m), MODEL) || !serves) {
    return `${said.provider} serves no model called ${
      JSON.stringify(said.model)
    }`
  }
  return remote({
    ...said,
    api,
    base: provider.base,
    model: typeof serves.name == 'string' ? serves.name : said.model!,
    space: spaceOf(said),
  })
}

/** The embedder a config and the rows it names amount to, or what it is
 * waiting for. Missing config means waiting: the server starts with no
 * vectors and begins embedding the moment what is missing appears. */
export let embedderOf = async (
  options: Options,
  rows: Rows,
): Promise<Ready> => {
  let said = options.embedder
  let model = spaceOf(said)
  if (!said?.provider) {
    return {
      waiting:
        'no `embedder` is named — `{"provider": "hash"}` is the offline one, and a provider and a model are named beside the plugin',
    }
  }
  if (!model) {
    return { waiting: `${said.provider} is named with no \`model\`` }
  }
  if (said.provider == HASH) return { model, embedder: hashEmbedder(said.dim) }
  if (said.provider == MODEL2VEC) {
    return {
      model,
      embedder: model2vec({ model: said.model!, dim: said.dim }),
    }
  }
  // A config that names a key but has no value for it is waiting: the
  // environment does not have one yet, and every request until it does would
  // be a 401 paid for once per entity. A config that names no key never
  // wanted one — a machine on your own network — and goes straight through.
  if ('key' in said && said.key == null) {
    return {
      model,
      waiting:
        `waiting for a key: ${said.provider} is named with one the environment has not got`,
    }
  }
  let made = await served(said, rows)
  return typeof made == 'string'
    ? { model, waiting: made }
    : { model, embedder: made }
}

/** The fields a config chose, or every searched one. A name the vocabulary
 * does not declare is an error rather than a field that silently embeds
 * nothing. */
export let chosen = (vocab: Vocab, options: Options): Field[] => {
  if (!options.text) return fields(vocab, searched)
  return options.text.map((said) => {
    let [comp, prop, ...rest] = said.split('.')
    if (!prop || rest.length || !vocab.prop(comp, prop)) {
      throw new Error(
        `@yaks/embedding: \`text\` names ${
          JSON.stringify(said)
        }, which is not a declared comp.prop`,
      )
    }
    return { comp, prop, ...unembedded(vocab) }
  })
}

/**
 * Everything a pass needs, as the config and the rows stand at this moment:
 * the text a vector is made from, the embedder that makes it, and the message
 * to report when there is none.
 *
 * Read it on every pass rather than once when the plugin is composed. That is
 * what makes a key or a provider arriving late a server that starts embedding
 * instead of one that has to be restarted: @yaks/cli resolves `{"secret": …}`
 * each time it is asked for, so a key written into the graph is seen on the
 * next pass, and the rows are read again with it.
 *
 * A `text` name the vocabulary does not declare is the one thing here that
 * cannot wait: it is reported, and this plugin does nothing, which degrades the
 * same way a key that has not arrived does.
 */
export let ready = async (
  vocab: Vocab,
  options: Options,
  rows: Rows,
): Promise<Ready & { text: Field[] }> => {
  let text: Field[]
  try {
    text = chosen(vocab, options)
  } catch (error) {
    return { text: [], waiting: (error as Error).message }
  }
  return { text, ...await embedderOf(options, rows) }
}
