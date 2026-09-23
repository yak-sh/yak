// What a config declares to this plugin, and the embedder it names. "The
// server" below means whichever process opened the graph and loaded this
// package.
//
// The vectors are this package's business; the model is not. So the config
// names one beside the plugin, and both exports build what they need from that
// one declaration — `./rules` needs the vector space it names (a stored vector
// is only comparable with others in the same space), `./effects` needs the
// embedding function itself:
//
// ```json
// { "use": "@yaks/embedding",
//   "with": { "embedder": { "via": "ollama",
//                           "model": "qwen3-embedding",
//                           "base": "https://ollama.example",
//                           "key": { "secret": "OLLAMA_API_KEY" },
//                           "dim": 384 },
//             "text": ["doc.title", "doc.body"] } }
// ```
//
// Missing config never prevents startup. A server that composes this plugin
// and has not been given a key yet is a server waiting for one: it starts, it
// stores no vectors, its check reports what it is waiting for, and the first
// pass after the key appears is the one that embeds. So nothing here throws —
// a config amounts to a {@link Ready} value, read on every pass rather than
// once when the plugin is composed, which is what lets a key written into the
// graph start the sweep without a restart.
//
// A `via` nothing here implements is still an error — waiting will never turn
// it into an embedder — but it is reported, once, where it is read, rather than
// taking the server down with it. `{"via": "hash"}` is the offline embedder
// shipped here — instant, deterministic, and no model at all — which is what a
// development machine and a test want.

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

/** What a config declares to `@yaks/embedding`. */
export type Options = {
  /** which embedder the vectors are made with — required, and it names the
   * space every stored row is stamped with */
  embedder?: Named
  /** which text feeds a vector, as `comp.prop` pairs. The default is every
   * stored text property the vocabulary declares. */
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
  /** how long the index mark may stand before that means nobody is
   * rebuilding, in minutes (default 30) — the check reads it (./tools.ts) */
  stale?: number
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

/** The embedder a config named, or what it is waiting for. Missing config
 * means waiting: the server starts with no vectors and begins embedding the
 * moment the config appears. A `via` nothing here implements never will, so
 * that is an error — reported here, where it is read, and not at startup. */
export let embedderOf = (options: Options): Ready => {
  let said = options.embedder
  if (!said) {
    return {
      waiting:
        'no `embedder` is named — `{"via": "hash"}` is the offline one, and a model is named beside the plugin',
    }
  }
  if (said.via == 'hash') {
    let embedder = hashEmbedder(said.dim)
    return { model: embedder.model, embedder }
  }
  if (said.via == 'ollama' || said.via == 'openai') {
    // A config that names a key but has no value for it is waiting: the
    // environment does not have one yet, and every request until it does would
    // be a 401 paid for once per entity. A config that names no key never
    // wanted one — a machine on your own network — and goes straight through.
    return 'key' in said && said.key == null
      ? {
        model: said.model,
        waiting:
          `waiting for a key: ${said.via} at ${said.base} is named with one the environment has not got`,
      }
      : { model: said.model, embedder: remote(said) }
  }
  return {
    waiting: `no embedder called ${JSON.stringify((said as Named).via)}`,
  }
}

/** The fields a config chose, or every text property. A name the vocabulary
 * does not declare is an error rather than a field that silently embeds
 * nothing. */
export let chosen = (vocab: Vocab, options: Options): Field[] => {
  if (!options.text) return fields(vocab)
  return options.text.map((said) => {
    let [comp, prop, ...rest] = said.split('.')
    if (!prop || rest.length || !vocab.prop(comp, prop)) {
      throw new Error(
        `@yaks/embedding: \`text\` names ${
          JSON.stringify(said)
        }, which is not a declared comp.prop`,
      )
    }
    return { comp, prop }
  })
}

/**
 * Everything a pass needs, as the config stands at this moment: the text a
 * vector is made from, the embedder that makes it, and the message to report
 * when there is none.
 *
 * Read it on every pass rather than once when the plugin is composed. That is
 * what makes a key arriving late a server that starts embedding instead of one
 * that has to be restarted: @yaks/cli resolves `{"secret": …}` each time it is
 * asked for, so a key written into the graph is seen on the next pass.
 *
 * A `text` name the vocabulary does not declare is the one thing here that
 * cannot wait: it is reported, and this plugin does nothing, which degrades the
 * same way a key that has not arrived does.
 */
export let ready = (
  vocab: Vocab,
  options: Options,
): Ready & { text: Field[] } => {
  try {
    return { text: chosen(vocab, options), ...embedderOf(options) }
  } catch (error) {
    return { text: [], waiting: (error as Error).message }
  }
}
