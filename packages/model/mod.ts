/**
 * @yaks/model is the interface between a conversation and whoever serves it:
 * the shape of a request, the shape of a reply, and the two entities a graph
 * stores about serving — `provider` and `model`. It implements no transport,
 * and it declares no component another package owns: `tool` belongs to
 * @yaks/tools and `artifact` to @yaks/blob, each composed beside this one.
 * A provider package ({@link https://jsr.io/@yaks/openai | @yaks/openai},
 * {@link https://jsr.io/@yaks/workers-ai | @yaks/workers-ai}) implements
 * {@link Model}; a conversation package (`@yaks/session`) turns its stored
 * transcript into {@link Item}s and calls it. Neither needs the other.
 *
 * ```ts
 * import { type Model, ModelError } from '@yaks/model'
 *
 * let fake: Model = (req) =>
 *   Promise.resolve({
 *     id: 'r1',
 *     model: req.model,
 *     items: [{ kind: 'assistant', text: `${req.items.length} items` }],
 *   })
 * ```
 *
 * An {@link Item} is provider-neutral on purpose: a user turn, an assistant
 * turn, a call the model asked for, the result it was given. The Responses API
 * encodes those four one way; a chat-completions API encodes them another; the
 * conversation should not have to know.
 *
 * A request may also ask typed {@link Questions} about the conversation, in
 * Jev's terms (a `noul`, a `choice`, a `score`), and the reply answers each by
 * name in {@link Reply.answers}. A graph records them as `questions` on the
 * asking entry and one `answer` per question.
 *
 * What a provider stores about a reply — an id that anchors the next request,
 * say — is that provider's own component, declared and written by its package
 * ({@link Model.mark}, {@link Model.vocab}) and read back by it
 * ({@link Model.anchor}). This interface carries the request, never the
 * provider's own bookkeeping.
 *
 * A model that throws a {@link ModelError} failed in a way the caller expects —
 * a refused request, a rate limit, a missing credential. Anything else it
 * throws is a bug, and the caller records it as one.
 *
 * @module
 */

import {
  dead,
  type Eid,
  identityEid,
  minted,
  type Plugin,
  Refused,
  then,
  type Tx,
} from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import type { Artifact } from '@yaks/blob'
import { modelDoc } from './vocab.ts'

export { modelDoc }

export let PROVIDER = 'provider'
export let MODEL = 'model'
export let TOOL = 'tool'
export let QUESTIONS = 'questions'
export let ANSWER = 'answer'

/**
 * A provider or a model named where an eid is expected: `gpt-6-astra` in
 * `using.model`. Each one's eid is derived from its name (the `identity`
 * keyword), so the lookup is one read of the ids the name would have, no scan.
 * A name both a provider and a model hold is refused rather than guessed.
 */
export let addressed = (
  tx: Tx,
  ids: string[],
): Map<string, Eid> | Promise<Map<string, Eid>> => {
  let ask = [...new Set(ids)].filter((id) =>
    id && !id.startsWith('$') && !minted(id)
  )
  let at = (id: string) => [PROVIDER, MODEL].map((c) => identityEid(c, [id]))
  return then(tx.get(ask.flatMap(at)), (rows) => {
    let live = new Set(rows.filter((b) => !dead(b)).map((b) => b.entity.eid))
    let found = new Map<string, Eid>()
    for (let id of ask) {
      let hits = at(id).filter((eid) => live.has(eid))
      if (hits.length > 1) {
        throw new Refused(`${id} names both a provider and a model`)
      }
      if (hits.length) found.set(id, hits[0])
    }
    return found
  })
}

/** The vocabulary as a plugin, for a graph that lists its plugins; a provider
 * and a model are addressed by name ({@link addressed}). */
export let models = (): Plugin => ({
  name: '@yaks/model',
  vocab: [modelDoc],
  address: addressed,
})

/** One line of a conversation as a model sees it. */
export type Item =
  | { kind: 'image'; bytes: Uint8Array; mediaType: string; label: string }
  | { kind: 'instruction'; text: string }
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; id?: string }
  /** a tool call the model asked for: its id, the tool, the arguments as JSON */
  | { kind: 'call'; id: string; name: string; args: string }
  /** what the tool answered, by the call's id */
  | { kind: 'result'; id: string; output: string }

/** A tool as it is declared to the model. */
export type Tool = {
  name: string
  description: string
  /** its arguments, as JSON Schema */
  parameters: Record<string, unknown>
}

/** One request to a model. */
/** Output text only; never private reasoning or partial tool arguments.
 * Index identifies the final assistant item order in Reply.items. */
export type TextDelta = { index: number; id?: string; text: string }
export type Request = {
  /** Optional cancellation of this request, not of independent tool processes. */
  signal?: AbortSignal
  onText?: (delta: TextDelta) => void
  model: string
  effort?: string
  instructions?: string
  items: Item[]
  tools: Tool[]
  /** typed questions about the conversation, answered in
   * {@link Reply.answers} rather than in prose; a model that answers none
   * refuses the request with a {@link ModelError} coded `questions` */
  questions?: Questions
  /** the most tokens the reply may write; the provider's own limit where
   * absent */
  tokens?: number
  /** an anchor to continue from, in which case `items` holds only what
   * followed it: whatever the same model's {@link Model.anchor} returned for an
   * earlier reply. Opaque to the caller. */
  anchor?: string
}

/** Counts for one request. Cached input and reasoning output are subsets,
 * not additional tokens. Missing counts are unknown. */
export type Usage = {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  cached_tokens?: number
  reasoning_tokens?: number
}

/** One typed question, in Jev's terms: a `noul` is answered with the
 * probability that it holds, a `choice` with one of its criteria's names, and
 * a `score` with a number along its criteria, which are ordered. */
export type Question = {
  type: 'noul' | 'choice' | 'score'
  instructions: unknown
  /** a noul's `{true, false}`, a choice's options by name, a score's ordered
   * list */
  criteria?: unknown
}

/** The questions a request asks, by name. */
export type Questions = Record<string, Question>

/** A model's answer to one question: whichever of `noul`, `choice` and
 * `score` its type calls for, how sure it is, and each option's probability. */
export type Answer = {
  type?: Question['type']
  noul?: number
  choice?: string
  score?: number
  confidence?: number
  probabilities?: Record<string, number>
}

/** One reply: the provider's id, the model that served it, and the items it
 * produced. */
export type Reply = {
  id: string
  model: string
  items: Item[]
  /** the answer to each of the request's questions, by the question's name */
  answers?: Record<string, Answer>
  usage?: Usage
  artifacts?: (Artifact & { call: string; revised_prompt?: string })[]
}

/** The components a provider writes on the entry that records a reply. */
export type Mark = Record<string, Record<string, unknown>>

/**
 * A model: one request in, one reply out. A provider that stores something
 * about a reply does so through three optional members, so that the
 * conversation never has to know that provider's components: `mark` returns
 * what to write on the entry recording the reply, `anchor` reads an anchor back
 * off such an entry's components (or returns nothing, in which case the caller
 * replays the conversation), and `vocab` declares the components `mark` writes.
 * A plain function is a model that stores nothing.
 */
export type Model = ((req: Request) => Promise<Reply>) & {
  mark?: (reply: Reply) => Mark
  anchor?: (comps: Record<string, unknown>) => string | undefined
  vocab?: VocabDoc
}

/** A failure the caller expects: `code` is the provider's own error code when
 * it gave one, otherwise a name for the kind of failure. */
export class ModelError extends Error {
  code: string
  constructor(code: string, message = code) {
    super(message)
    this.name = 'ModelError'
    this.code = code
  }
}
