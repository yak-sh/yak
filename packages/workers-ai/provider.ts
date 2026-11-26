// @yaks/workers-ai as a provider a config names (@yaks/model `ProviderFacet`):
// `workers-ai`, over the `AI` binding its options are lent (`ai`, written
// `{"binding": "AI"}` in a Worker's config) and the AI Gateway a partner
// model is routed through (`gateway`). The binding is the authorization, so a
// host lends no key; where it lends no binding, every call is refused.
//
// Beside the model it offers the binding's own door (`native`): one call as
// Workers AI takes it, priced from the catalogue before it is made and held
// to what the host's spending affords, then settled at what it cost.

import {
  affordable,
  charged,
  type Lent,
  type Model,
  ModelError,
  type Native,
  promptBound,
  type Spending,
} from '@yaks/model'
import { music, musicQuote, pricedAudio } from './audio.ts'
import { modelInfo, type Published } from './list.ts'
import {
  type Binding,
  failure,
  routing,
  said,
  successor,
  unfit,
  usageOf,
  workersAi,
} from './mod.ts'

/** The plugin's options in a config. */
export type Options = {
  /** the `AI` binding */
  ai?: Binding
  /** the AI Gateway a partner model (one not `@…`) is routed through */
  gateway?: string
  /** each retired model's name, and the model that answers for it */
  successors?: Record<string, string>
}

// No binding lent: every call, and every question about a model, is refused
// before anything is held or sent.
let unbound = () =>
  new ModelError('unbound', 'No Workers AI binding is lent here')
let refusing: Model = Object.assign(() => Promise.reject(unbound()), {
  info: () => Promise.reject(unbound()),
  list: () => Promise.reject(unbound()),
})

/** `workers-ai`, over the binding it is lent. */
export let providers = (
  lent: Lent,
  options: Options = {},
): Record<string, Model> => ({
  'workers-ai': options.ai
    ? workersAi(options.ai, {
      media: { store: lent.store },
      fetch: lent.fetch,
      gateway: options.gateway,
      receipts: lent.receipts,
      scope: lent.scope,
      successors: options.successors,
    })
    : refusing,
})

// A model the catalogue prices nothing for, said once per transport.
let unpriced = new WeakMap<typeof fetch, Set<string>>()
let priceless = (
  model: string,
  fetcher: typeof fetch,
  spending: Spending,
) => {
  let error = new ModelError(
    'model',
    `No published price for ${model}; ask another model`,
  )
  let said = unpriced.get(fetcher) ?? new Set<string>()
  unpriced.set(fetcher, said)
  if (!said.has(model)) spending.report?.(error, model)
  said.add(model)
  return error
}

let speechResponse = async (answer: unknown): Promise<Response> => {
  if (answer instanceof ReadableStream) {
    return new Response(answer, {
      headers: { 'content-type': 'application/octet-stream' },
    })
  }
  if (!(answer instanceof Response)) {
    throw new Error('Workers AI returned no speech audio')
  }
  if (!answer.ok) {
    let body = await answer.text()
    let error = new Error(`Workers AI HTTP ${answer.status}: ${body}`)
    try {
      let details = JSON.parse(body)
      let code = details?.internalCode ?? details?.errors?.[0]?.code
      if (code != null) error = new Error(`${code}: ${error.message}`)
    } catch { /* Keep the upstream body when it is not JSON. */ }
    throw error
  }
  let type = answer.headers.get('content-type') ?? 'application/octet-stream'
  if (!answer.body || !/^(audio\/|application\/octet-stream\b)/i.test(type)) {
    throw new Error('Workers AI returned no speech audio')
  }
  return new Response(answer.body, { headers: { 'content-type': type } })
}

/**
 * The binding's own door. A model the catalogue does not price is refused
 * before anything is spent, and so is an input whose price has no bound (a
 * batch, a hosted tool, a modality beside text). Over what `spending` holds
 * it is refused with its `ModelError` coded `limit`. The account's own
 * credits spent are a ceiling too ({@link failure}), refused the same way
 * and reported, since only the host can buy more. An input the model refuses
 * ({@link unfit}) is refunded and refused as `bad_request`, the caller's to
 * correct. The answer is what the model said, out of any envelope AI Gateway
 * put it in ({@link said}).
 */
export let native = (
  lent: Lent,
  options: Options,
  spending: Spending,
): Native => ({
  run: async (asked, input, opts) => {
    let model = successor(options.successors)(asked)
    let ai = options.ai
    if (!ai) throw unbound()
    let track = music(model)
    let info: Published = track
      ? { name: model }
      : await modelInfo(model, lent.fetch, { scope: lent.scope })
    let { price, speechPerThousand } = info
    if (!track && !price && speechPerThousand == null) {
      throw priceless(model, lent.fetch, spending)
    }
    let sent = input && typeof input == 'object'
      ? input as Record<string, unknown>
      : {}
    let structured = 'questions' in sent
    let choices = Number(sent.n ?? 1)
    if (
      'requests' in sent ||
      Array.isArray(sent.tools) &&
        sent.tools.some((t) =>
          !t || typeof t != 'object' || Reflect.get(t, 'type') != 'function'
        ) ||
      !Number.isSafeInteger(choices) || choices < 1 ||
      Array.isArray(sent.modalities) && sent.modalities.some((m) => m != 'text')
    ) {
      throw new ModelError(
        'limit',
        'This request has no bounded text-generation price',
      )
    }
    let desired = price?.output == 0
      ? 0
      : structured
      ? Number(info.context)
      : Number(sent.max_completion_tokens ?? sent.max_tokens ?? 4096)
    let speechCost: number | undefined
    if (speechPerThousand != null) {
      if (typeof sent.text != 'string' || !sent.text.trim()) {
        throw new ModelError('bad_request', 'Speech needs nonempty text')
      }
      speechCost = sent.text.length / 1000 * speechPerThousand
    }
    let hold = await spending.hold((remaining) => {
      if (speechCost != null) {
        return speechCost <= remaining
          ? { dollars: speechCost, tokens: 0 }
          : null
      }
      if (track) return musicQuote(model, sent, remaining)
      if (info.context == null) return null
      // Every choice bills the prompt again; each embedded text fills at
      // most its own context window.
      let { tools, ...said } = sent
      let texts = price!.output == 0 && Array.isArray(sent.text)
        ? sent.text.length
        : 1
      let quote = affordable(
        { ...price!, output: price!.output * choices },
        choices * promptBound(said, info.context * texts, tools),
        remaining,
        desired,
      )
      return structured && quote?.tokens != desired ? null : quote
    })
    if (speechCost == null && !track && !structured && price!.output) {
      input = {
        ...sent,
        max_tokens: hold.value.tokens,
        ...'max_completion_tokens' in sent
          ? { max_completion_tokens: hold.value.tokens }
          : {},
      }
    }
    let answer = await ai.run(
      model,
      input,
      routing(
        model,
        speechCost == null ? opts : { ...opts, returnRawResponse: true },
        options.gateway,
      ),
    ).then((answer) => speechCost == null ? answer : speechResponse(answer))
      .catch(async (e) => {
        let why = failure(e)
        if (
          unfit(e) ||
          why instanceof ModelError &&
            ['busy', 'model', 'limit'].includes(why.code)
        ) {
          await hold.settle(0, false)
        }
        if (unfit(e)) {
          let message = e instanceof Error ? e.message : String(e)
          throw new ModelError(
            'bad_request',
            `${model} refused this input: ${message}`,
          )
        }
        if (why instanceof ModelError && why.code == 'limit') {
          spending.report?.(e, model)
        }
        throw why
      })
    if (speechCost != null) {
      await hold.settle(speechCost, false)
      return answer
    }
    await spending.answered?.(model, info)
    let out = said(answer)
    let cost = track
      ? (await pricedAudio(model, input, out)).cost
      : charged({ usage: usageOf(answer) }, price, hold.value.dollars).dollars
    await hold.settle(cost, false)
    return out
  },
})
