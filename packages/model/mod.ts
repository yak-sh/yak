/**
 * @yaks/model is the interface between a conversation and whoever serves it:
 * the shape of a request, the shape of a reply, and the two entities a graph
 * stores about serving — `provider` and `model`. It implements no provider's
 * transport (`@yaks/model/step` carries a step between two hosts instead),
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

import { after } from '@yaks/fp'
import type { Bundle, Comp, Eid, Hook, Plugin, ReadTx } from '@yaks/graph'
import { dead } from '@yaks/graph/bundle'
import { identityEid, minted } from '@yaks/graph/identity'
import { Refused } from '@yaks/graph/errors'
import type { VocabDoc } from '@yaks/vocab'
import { edgeEid } from '@yaks/edge'
import type { Artifact } from '@yaks/blob'
import {
  MODEL,
  modelDoc,
  type Price,
  PROVIDER,
  type Usage,
  weigh,
} from './vocab.ts'
import type { MediaReceipt } from './media.ts'
import { listPrice } from './prices.ts'
export { listPrice } from './prices.ts'
export { deferredModel } from './deferred.ts'
export { type ModelResult, type ModelResults, modelResults } from './results.ts'
export { message } from './message.ts'
export { type Offer, offerFor, offers, serving } from './offers.ts'
export type { Lent, Native, ProviderFacet, Spending } from './provider.ts'
export {
  type Executor,
  type FrozenModelRequest,
  frozenRequest,
  infer,
  type Inference,
  type InferenceHost,
  type InferenceReceipt,
  inferenceReply,
  thawedRequest,
} from './inference.ts'
export {
  type MediaReceipt,
  type MediaReceipts,
  mediaReceipts,
  type MediaRecord,
  receivedMedia,
  recoveredMedia,
} from './media.ts'

export {
  COST,
  dollars,
  hourly,
  MODEL,
  modelDoc,
  PRICE,
  type Price,
  PROVIDER,
  RATE_LIMIT,
  USAGE,
  type Usage,
  weigh,
} from './vocab.ts'
export {
  attribute,
  generated,
  merged,
  type Paid,
  type Part,
} from './attribute.ts'
export {
  type Affordable,
  affordable,
  charged,
  FRAMING,
  measured,
  promptBound,
  requestBound,
  retained,
} from './afford.ts'
export { cachedPrefixExpires, cacheExpiry, prefixCacheMark } from './cache.ts'
export { acknowledged, began, submitCall, submitted } from './submission.ts'
export type { CacheContext } from './cache.ts'
import type { CacheContext } from './cache.ts'
import type { Affordable } from './afford.ts'

export { accountEid, accountHome, limitEid, limitRows } from './limits.ts'
export type { Limit } from './limits.ts'
import type { Limit } from './limits.ts'
export let TOOL = 'tool'
export let QUESTIONS = 'questions'
export let ANSWER = 'answer'
export let RESPONSE = 'response'

/**
 * A provider or a model named where an eid is expected: `gpt-6-astra` in
 * `using.model`. Each one's eid is derived from its name (the `identity`
 * keyword), so the lookup is one read of the ids the name would have, no scan.
 * A name both a provider and a model hold is refused rather than guessed.
 */
export let addressed = (
  tx: ReadTx,
  ids: string[],
): Map<string, Eid> | Promise<Map<string, Eid>> => {
  let ask = [...new Set(ids)].filter((id) =>
    id && !id.startsWith('$') && !minted(id)
  )
  let at = (id: string) => [PROVIDER, MODEL].map((c) => identityEid(c, [id]))
  return after(tx.get(ask.flatMap(at)), (rows) => {
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
  hooks: { normalize: requesting },
})

/** One line of a conversation as a model sees it. */
export type Item =
  & (
    | { kind: 'image'; bytes: Uint8Array; mediaType: string; label: string }
    /** a document the model reads as it is, such as a PDF; a provider that
     * reads none refuses the request */
    | {
      kind: 'document'
      bytes: Uint8Array
      mediaType: string
      label: string
      /** Original filename, including its extension, separate from display text. */
      filename?: string
    }
    | { kind: 'instruction'; text: string }
    | { kind: 'user'; text: string }
    | { kind: 'assistant'; text: string; id?: string }
    /** a tool call the model asked for: its id, the tool, the arguments as JSON */
    | { kind: 'call'; id: string; name: string; args: string }
    /** what the tool answered, by the call's id */
    | { kind: 'result'; id: string; output: string }
  )
  & {
    /** Who supplied these words, independent of the provider's turn role.
     * Prompt assembly renders this before handing items to any provider. */
    from?: string
  }

/** A tool as it is declared to the model. */
export type Tool = {
  name: string
  description: string
  /** its arguments, as JSON Schema: an object, with no `oneOf`, `anyOf` or
   * `allOf` at its root, which Claude's API and MCP refuse; a choice between
   * arguments is said in the description and checked when the tool runs */
  parameters: Record<string, unknown>
}

/** One request to a model. */
/** Output text only; never private reasoning or partial tool arguments.
 * Index identifies the final assistant item order in Reply.items. */
export type TextDelta = { index: number; id?: string; text: string }
export type Request = {
  /** The original request entity, stable across delivery recovery. */
  call?: string
  /** Durably guard submission before the paid POST. Presence disables replay. */
  onSubmit?: () => Promise<void>
  /** Persist the provider's first acknowledgement before consuming more output. */
  onAck?: (mark: Mark) => Promise<void>
  /** Durably checkpoint private output, including incomplete streamed media. */
  onReceipt?: (receipt: MediaReceipt) => Promise<void>
  /** A private receipt is already durable when this checkpoint runs. */
  onMedia?: (receipt: MediaReceipt) => Promise<void>
  /** The reply's first output reached us: a token of text, reasoning or a
   * tool call, or the whole reply from a request that does not stream. Called
   * once, so the time to it is the request's time to first token. */
  onFirst?: () => void
  /** Optional cancellation of this request, not of independent tool processes. */
  signal?: AbortSignal
  onText?: (delta: TextDelta) => void
  model: string
  /** Explicit model-native inputs, such as lyrics or duration. A provider
   * supporting native inputs validates them; never inferred from prose. */
  input?: Record<string, unknown>
  /** Output modalities requested of a model that can generate media. */
  modalities?: ('text' | 'image' | 'audio')[]
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
  /** the conversation this request continues, the same for each of its
   * requests, so a provider that keys its prompt cache by conversation finds
   * the prefix the last one cached */
  conversation?: string
  /** the only sites the provider's own web tools may read, by hostname (a
   * name under one included), with no search; where absent, the web they
   * offer is the provider's whole web */
  sites?: string[]
  /** how long, in seconds, the request asks its provider to keep the prefix
   * it caches; a provider offers a few lifetimes and keeps the longest one
   * not over this, or its default where none fits or this is absent */
  cacheRetention?: number
  /** how long, in seconds, the reply's stream may go without progress (the
   * connection, its first byte, any gap after) before the request fails as
   * `stalled`; `@yaks/model/stall` `STALL_TIMEOUT` where absent, 0 for no
   * limit. Its provider's row may name its own (`provider{stall_timeout}`). */
  stallTimeout?: number
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
  /** Effective cached-prefix expiry, not response/credential retention. Adapters
   * supply explicit expiry; the resolver applies documented retention. Null
   * means the provider sent an invalid value; it must not gain a fallback. */
  cacheExpiresAt?: string | null
  /** the dollars the provider reported this request cost, where it reports
   * them; a caller weighs `usage` at the model's {@link Price} otherwise */
  cost?: number
  /** False for an adapter-measured tariff; provider-reported by default. */
  costReported?: boolean
  artifacts?: (Artifact & { call: string; revised_prompt?: string })[]
  /** The reply stopped at its output token limit (`Request.tokens`): what it
   * was writing last is unfinished, a tool call's arguments included. */
  cut?: boolean
  /** the plan limits the provider answered with, where it meters a plan */
  limits?: Limit[]
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
  /** Download/store a saved recording only; never calls generation. */
  recover?: (call: string) => Promise<Reply>
  /** A saved complete answer, with any original accounting finished; never generation. */
  result?: (
    call: string,
  ) => Promise<import('./results.ts').ModelResult | undefined>
  list?: () => Promise<Listed[]>
  info?: (name: string) => Promise<Listed | undefined>
  mark?: (reply: Reply, cache?: CacheContext) => Mark
  anchor?: (comps: Record<string, unknown>) => string | undefined
  vocab?: VocabDoc
  /** Takes a later output of a tool call it already has one for. Without it,
   * a call that finishes after its first output is told as user text. */
  lateResults?: true
  /** The media types it reads as they are, beside text, each with the most
   * raw bytes of one file it takes, or Infinity for no published byte cap.
   * A function selects the requested model's capabilities. Request-wide limits
   * still apply. Without it, a file is read as its text. */
  reads?:
    | Record<string, number>
    | ((
      name: string,
    ) => Record<string, number> | Promise<Record<string, number>>)
  /** What a request priced by the call rather than by its tokens (a track of
   * music) would cost within `remaining` dollars, null where it would not
   * fit; undefined for a request its tokens price. */
  quote?: (req: Request, remaining: number) => Affordable | null | undefined
  /** The most its provider-run tools (a hosted web search or page fetch) add
   * to one request, which a meter reserves beside the request's own bound. */
  hosted?: Hosted
}

/** Native file inputs for the selected model, including a provider's lazy lookup. */
export let modelReads = async (
  model: Model,
  name: string,
): Promise<Record<string, number>> =>
  typeof model.reads == 'function' ? await model.reads(name) : model.reads ?? {}

/** What a model's provider-run tools may add to one request: at most
 * `searches` web searches, billed at {@link Price} `web_search`, and `input`
 * tokens of what they read fed back as input. The provider enforces both. */
export type Hosted = { searches: number; input: number }

/** What a provider answered a failed request with, as it arrived: the body of
 * an error status, or the event that ended its stream, and the headers that
 * speak of its limits. Stored as `response{body, headers}` beside the line
 * recording the failure. */
export type Answered = {
  body?: string
  headers?: Record<string, string>
}

/** A failure the caller expects: `code` is the provider's own error code when
 * it gave one, otherwise a name for the kind of failure. */
export class ModelError extends Error {
  code: string
  /** The failure may pass: the caller can ask again, no sooner than `after`
   * milliseconds where the provider said how long to wait. With `defer`, it
   * is no failure but a wait for something outside: asked again as the same
   * attempt, however long that takes (@yaks/effects spends no try on it). */
  retry?: { after?: number; defer?: boolean }
  /** what the provider sent, where it sent anything */
  response?: Answered
  /** the plan limits the provider answered with, where it meters a plan */
  limits?: Limit[]
  constructor(
    code: string,
    message = code,
    retry?: { after?: number; defer?: boolean },
    response?: Answered,
  ) {
    super(message)
    this.name = 'ModelError'
    this.code = code
    this.retry = retry
    this.response = response
  }
}

/** What a provider says about one of its models, in graph vocabulary. */
export type Listed = {
  name: string
  label?: string
  context?: number
  output?: number
  modalities?: string[]
  price?: Price
}

/** A requested name exists before dispatch, but is not offered until answered.
 * A model with no price, met for the first time or held since before the
 * table knew it, is weighed at its list price ({@link listPrice}) unless the
 * batch prices it; a price on a stored row stands. */
export let requesting: Hook = (bundles, tx) => {
  let names = new Map<string, string>()
  let out: Bundle[] = bundles.map((b) => {
    let using = b.using as Comp | undefined
    let name = using?.model
    if (typeof name != 'string' || minted(name) || name.startsWith('$')) {
      return b
    }
    let eid = identityEid(MODEL, [name])
    names.set(eid, name)
    return { ...b, using: { ...using, model: eid } }
  })
  for (let b of out) {
    let name = (b.model as Comp | undefined)?.name
    if (typeof name == 'string' && b.pending !== null) {
      names.set(identityEid(MODEL, [name]), name)
    }
  }
  // by name: a batch's new row is still an alias here, minted after
  let priced = new Set(
    out.filter((b) => b.price).map((b) =>
      identityEid(MODEL, [String((b.model as Comp | undefined)?.name)])
    ),
  )
  return after(
    tx.get([...names.keys()], [MODEL, 'pending', 'price']),
    (rows) => {
      let held = new Map(rows.map((b) => [b.entity.eid, b]))
      return [
        ...out,
        ...[...names].flatMap(([eid, name]): Bundle[] => {
          let row = held.get(eid)
          let price = !priced.has(eid) && !row?.price && listPrice(name)
          if (row?.model) return price ? [{ entity: { eid }, price }] : []
          return [{
            entity: { eid },
            model: { name, offered: false },
            pending: {},
            ...price ? { price } : {},
          }]
        }),
      ]
    },
  )
}

/** A provider's answer confirms a requested model; old asks keep their row. */
export let confirmed = (
  provider: string,
  name: string,
  listing?: Listed,
): Bundle[] => {
  let eid = identityEid(MODEL, [name])
  let { price, ...model } = listing ?? { name }
  return [{
    entity: { eid },
    model: { ...model, name, offered: true },
    pending: null,
    ...price ? { price } : {},
  }, {
    entity: { eid: edgeEid(provider, 'serves', eid) },
    edge: { from: provider, to: eid },
    serves: { name },
  }]
}

/** Reported dollars win; otherwise usage is weighed at the model row's price. */
export let billed = (
  reply: Reply,
  price?: Price,
): { dollars: number; reported: boolean } | undefined =>
  reply.cost != null
    ? { dollars: reply.cost, reported: reply.costReported ?? true }
    : price && reply.usage
    ? { dollars: weigh(price, reply.usage), reported: false }
    : undefined
