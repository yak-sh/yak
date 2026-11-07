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
import { modelInfo } from './list.ts'
import {
  type Binding,
  failure,
  routing,
  said,
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
  run: async (model, input, opts) => {
    let ai = options.ai
    if (!ai) throw unbound()
    let info = music(model)
      ? { name: model }
      : await modelInfo(model, lent.fetch)
    let price = info.price
    if (!music(model) && !price) throw priceless(model, lent.fetch, spending)
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
    let hold = await spending.hold((remaining) => {
      if (music(model)) return musicQuote(model, sent, remaining)
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
    if (!music(model) && !structured && price!.output) {
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
      routing(model, opts, options.gateway),
    ).catch(async (e) => {
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
    await spending.answered?.(model, info)
    let out = said(answer)
    let cost = music(model)
      ? (await pricedAudio(model, input, out)).cost
      : charged({ usage: usageOf(answer) }, price, hold.value.dollars).dollars
    await hold.settle(cost, false)
    return out
  },
})
