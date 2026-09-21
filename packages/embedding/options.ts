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
// MISSING CONFIG NEVER PREVENTS BOOT. A host that composes this plugin and
// has not been given a key yet is a host WAITING for one: it comes up, it
// keeps no vectors, its check says what it is waiting for, and the first pass
// after the key appears embeds. So nothing here throws — what a config amounts
// to is a {@link Ready} value, read on every pass rather than once at compose,
// which is what lets a key exported into the environment (or, later, written
// into the graph) start the sweep without a restart.
//
// A name nothing here implements is still a refusal — it will never become an
// embedder by waiting — but it is SAID, once, where it is read, rather than
// taking the host down with it. `{"via": "hash"}` is the offline embedder
// shipped here — instant, deterministic, and no model at all — which is what a
// development box and a test want.

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
  /** how long the index mark may stand before that means nobody is
   * rebuilding, in minutes (default 30) — the check reads it (./tools.ts) */
  stale?: number
}

/** What the config amounts to: the embedder it names, or the one sentence
 * saying why there is none yet. */
export type Ready = {
  /** the vector SPACE — the model name every stored row is stamped with. It
   * comes from the config alone, so the read door can rank `.near` over what
   * is already stored while the sweep is still waiting for a key. */
  model?: string
  /** the embedder itself: absent while the config is incomplete */
  embedder?: Embedder
  /** why there is none, for whoever asks — absent when there is one */
  waiting?: string
}

/** The embedder a config named, or what it is waiting for. Absent config is
 * WAITING: the host comes up with no vectors and starts the moment the config
 * appears. A `via` nothing here implements never will, so that is a refusal —
 * said here, where it is read, and not at boot. */
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
    // A config that NAMES a key and has none is waiting for it: the
    // environment has not got one yet, and every request until it does is a
    // 401 paid for once per entity. A config that names none never wanted one
    // — a box on your own subnet — and goes straight through.
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

/**
 * Everything a pass needs, as the config has it AT THIS MOMENT: the text a
 * vector is made of, the embedder that makes it, and the sentence to say when
 * there is none.
 *
 * Read it on every pass rather than once at compose. That is what makes a key
 * arriving late a host that starts embedding instead of one that has to be
 * restarted — the same call answers a config read out of the environment
 * (@yaks/cli reads `{"env": …}` when it is asked) and one that will come out
 * of the graph.
 *
 * A `text` name nothing declares is the one thing here that cannot wait: it
 * says what it is, and this plugin does nothing, which is the same degrading
 * as a key that has not arrived.
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
