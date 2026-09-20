// What a CONFIG says to this plugin, and the embedder it names.
//
// The vectors are this package's business; the MODEL is not. So a host names
// one beside the plugin and both facets build it from that one sentence — the
// rules facet for the space it NAMES (a stored vector is only comparable
// inside its own), the effects facet for the function it IS:
//
// ```json
// { "use": "@yaks/embedding",
//   "with": { "embedder": { "via": "ollama",
//                           "model": "qwen3-embedding",
//                           "base": "https://ollama.example",
//                           "key": { "env": "OLLAMA_API_KEY" },
//                           "dim": 384 },
//             "text": ["doc.title", "doc.body"] } }
// ```
//
// A config that composes this plugin and names no embedder is a typo, not a
// host with no semantics: the refusal is at boot, where it can be read, rather
// than as an empty answer to every search forever. `{"via": "hash"}` is the
// offline embedder shipped here — instant, deterministic, and no model at all
// — which is what a development box and a test want.

import type { Vocab } from '@yaks/vocab'
import type { Embedder } from './embedder.ts'
import { hashEmbedder } from './embedder.ts'
import { type Field, fields } from './fields.ts'
import { type Remote, remote } from './remote.ts'

/** An embedder, as a config names one. */
export type Named = Remote | {
  /** the offline embedder: word buckets, no model, no network */
  via: 'hash'
  /** how many buckets (default 64) */
  dim?: number
}

/** What a config says to `@yaks/embedding`. */
export type Options = {
  /** which embedder the vectors are made with — required, and it names the
   * space every stored row is stamped with */
  embedder?: Named
  /** which text feeds a vector, as `comp.prop` pairs. The default is every
   * stored text column the vocabulary declares. */
  text?: string[]
  /** how many neighbours a `.near` selects (default 8) */
  neighbours?: number
  /** the similarity a neighbour must reach to be one at all (default 0) */
  floor?: number
  /** how many entities one sweep embeds before stopping (default: all) */
  batch?: number
  /** how long a burst of writes settles before the sweep runs, in
   * milliseconds (default 3000) */
  after?: number
}

/** The embedder a config named. An unknown `via` is a refusal: a host that
 * thinks it has semantic search and does not is worse than one that will not
 * boot. */
export let embedderOf = (options: Options): Embedder => {
  let said = options.embedder
  if (!said) {
    throw new Error(
      '@yaks/embedding: name an `embedder` — `{"via": "hash"}` is the offline one',
    )
  }
  if (said.via == 'hash') return hashEmbedder(said.dim)
  if (said.via == 'ollama' || said.via == 'openai') return remote(said)
  throw new Error(
    `@yaks/embedding: no embedder called ${
      JSON.stringify((said as Named).via)
    }`,
  )
}

/** The fields a config chose, or every textual one. A name nothing declares is
 * a refusal rather than a field silently embedding nothing. */
export let chosen = (vocab: Vocab, options: Options): Field[] => {
  if (!options.text) return fields(vocab)
  return options.text.map((said) => {
    let [comp, prop, ...rest] = said.split('.')
    if (!prop || rest.length || !vocab.column(comp, prop)) {
      throw new Error(
        `@yaks/embedding: \`text\` names ${
          JSON.stringify(said)
        }, which is not a comp.prop column`,
      )
    }
    return { comp, prop }
  })
}
