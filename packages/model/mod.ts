/**
 * @yaks/model is the seam between a conversation and whoever serves it: the
 * shape of a request, the shape of a reply, and the three entities a graph
 * keeps about serving — `provider`, `model`, `tool`. It carries no transport.
 * A provider package ({@link https://jsr.io/@yaks/openai | @yaks/openai}, an
 * Ollama or a Workers AI sibling) implements {@link Model}; a conversation
 * package (`@yaks/session`) shapes its record into {@link Item}s and hands them
 * over. Neither needs the other.
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
 * spells those four ways; a chat-completions API spells them differently; the
 * conversation should not know.
 *
 * What a provider keeps about a reply — an id that anchors the next request,
 * say — is the provider's own comp, declared and stamped by its package
 * ({@link Model.mark}, {@link Model.vocab}) and read back by it
 * ({@link Model.anchor}). The seam carries the question, never the answer.
 *
 * A model that throws a {@link ModelError} said something the caller expects —
 * a refused request, a rate limit, no credential. Anything else it throws is a
 * defect, and the caller records it as one.
 *
 * @module
 */

import type { Plugin } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The `provider`, `model` and `tool` components, to load beside your own. */
export let modelDoc: VocabDoc = doc

export let PROVIDER = 'provider'
export let MODEL = 'model'
export let TOOL = 'tool'

/** The vocabulary as a plugin, for a graph that lists its plugins. */
export let models = (): Plugin => ({ name: '@yaks/model', vocab: [modelDoc] })

/** One line of a conversation as a model sees it. */
export type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
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

/** One ask of a model. */
export type Request = {
  model: string
  effort?: string
  instructions?: string
  items: Item[]
  tools: Tool[]
  /** an anchor to continue from, with `items` being only what followed it:
   * whatever the same model's {@link Model.anchor} answered for an earlier
   * reply. Opaque to the caller. */
  anchor?: string
}

/** One answer: the provider's id for it, the model that served, what it said
 * and asked for. */
export type Reply = {
  id: string
  model: string
  items: Item[]
}

/** The comps a provider stamps on the entry that records a reply. */
export type Mark = Record<string, Record<string, unknown>>

/**
 * A model: one request in, one reply out. A provider that keeps something
 * about a reply says so in three optional parts, so the conversation never
 * learns a provider's words: `mark` is what to stamp on the entry recording the
 * reply, `anchor` reads an anchor back off such an entry's comps (or answers
 * nothing, and the caller replays the conversation), and `vocab` declares the
 * comps `mark` writes. A bare function is a model that keeps nothing.
 */
export type Model = ((req: Request) => Promise<Reply>) & {
  mark?: (reply: Reply) => Mark
  anchor?: (comps: Record<string, unknown>) => string | undefined
  vocab?: VocabDoc
}

/** The world said no, in a way the caller expects: `code` is the provider's
 * word for it when it has one, else the kind of refusal. */
export class ModelError extends Error {
  code: string
  constructor(code: string, message = code) {
    super(message)
    this.name = 'ModelError'
    this.code = code
  }
}
