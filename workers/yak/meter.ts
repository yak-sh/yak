// A space's counted spends and hosted model providers' accounts: the doors
// that write what a space spent for the directory to add to its month. What
// the month is spent against, and what refuses it, is @yaks/platform's
// (`plans`, `meter` and `standing`), and so is the transactional spend rule
// (`meter-graph`). metered.ts holds the counted doors a letter and an app's
// model API pass; facets/directory-effects.ts seeds the directory's recurring
// usage schedule.
import { reached } from './lib/hops.ts'
import { caught } from './defects.ts'
import type { Host } from '@yaks/platform/host'
import { monthOf } from '@yaks/platform/meter'
import type { Spend } from '@yaks/platform/plans'
import { type Directory, directoryOf, type Space, stamp } from './directory.ts'
import type { Namespace } from '@yaks/durable-object/door'
import type { Env } from './env.ts'
import {
  affordable,
  billed,
  likely,
  measured,
  type Model,
  ModelError,
  type ModelResults,
  type Price,
  refused,
  requestBound,
  retained,
} from '@yaks/model'
import { reserved, settled } from './model-spend.ts'
import { outputTokens } from './model-tokens.ts'
import { mint } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { Stale } from '@yaks/graph/errors'

// ---- the letters (T-33688) --------------------------------------------------
//
// Mail rides no store, so nothing in the analytics counts it: a letter is
// counted where it happens, one per letter delivered (post.ts's binding took
// it) and one per letter that arrived (inbox.ts filed it). An attempt is not a
// letter — a bounce costs the space nothing — and an arrival is counted but
// never refused, because turning a letter away at the door loses somebody
// else's words.
//
// Every count is a `spend` the directory adds to the meter in its own
// transaction ({@link added}), never a sum written back: two counts for one
// space at once, or one landing while the sweep runs, would otherwise each
// write their own total and the later would erase the earlier. The month
// turning is a fresh row there, as it is in the sweep: the counters that are
// the analytics' to answer wait for the next reading rather than carrying last
// month's numbers under this month's name.

/** What a space spent, sent for the directory to add to its month. */
let spending = async (
  env: { STORE: Namespace },
  space: Pick<Space, 'eid'>,
  spend: Partial<Record<Spend, number>> & { source?: string },
  now: Date,
) =>
  await stamp(env, {
    entities: [{
      entity: { eid: space.eid },
      spend: { month: monthOf(now), ...spend },
    }],
  })

/** One letter, on the space's month: the count, one higher. */
export let counted = (
  env: { STORE: Namespace },
  space: Pick<Space, 'eid'>,
  now = new Date(),
) => spending(env, space, { emails: 1 }, now)

// ---- the bytes --------------------------------------------------------------
//
// What an app's store holds is its own to say: Cloudflare's storage analytics
// have no per-object figure, and the store is the one place the number exists.
// It says it when a committed write moved it (graph.ts `#tell`), so a store
// nobody writes to is never asked and never tells. Not a month's figure: the
// sweep leaves it where the store put it and adds up a space's from it.

/** An app's stored bytes, as its own store just measured them. */
export let weighed = async (
  env: { STORE: Namespace },
  app: string,
  bytes: number,
) =>
  await stamp(env, { entities: [{ entity: { eid: app }, meter: { bytes } }] })

// ---- the workbench (T-34264) ------------------------------------------------
//
// Container seconds are counted where they happen. The unit is one second
// of container wall time (what Cloudflare bills on), measured
// from a call's first sandbox command to the moment it lets the container go
// (sandbox.ts `Spend`), rounded up.
//
// Two ceilings hold it: the per-build budget the tools refuse at (sandbox.ts
// `BUDGET`), and the month's {@link SECONDS}, which is what bounds the lone
// calls that belong to no build (tools.ts `bench` asks before each).

/** Add model dollars and container seconds to the space's month. */
export let countedSpend = async (
  env: { STORE: Namespace },
  space: Pick<Space, 'eid'>,
  cost: number,
  seconds: number,
  now = new Date(),
  source?: string,
) => {
  if (cost <= 0 && seconds <= 0) return
  await spending(
    env,
    space,
    { models: cost, seconds, ...source ? { source } : {} },
    now,
  )
}

/** The original media call and its spend commit together, once. A crash after
 * commit is recognized by the ledger rather than charged a second time. The
 * spend is sold by `source` for `person`'s work, where they are known. */
export let countedMedia = async (
  env: { STORE: Namespace },
  space: Pick<Space, 'eid'>,
  call: string,
  dollars: number,
  reported = true,
  { source, person }: Whose & { source?: string } = {},
) => {
  if (!Number.isFinite(dollars) || dollars < 0) {
    throw new Error('Generated media returned no valid request cost')
  }
  if (await settled(env, call, dollars, reported)) return
  let eid = derivedEid('generated-media-spend|' + call)
  try {
    await stamp(env, {
      entities: [{
        entity: { eid },
        $was: { cost: { dollars: null } },
        cost: { dollars, reported },
      }, {
        entity: { eid: space.eid },
        spend: {
          month: monthOf(new Date()),
          models: dollars,
          ...source ? { source } : {},
          ...person ? { person } : {},
        },
      }],
    })
  } catch (error) {
    if (!(error instanceof Stale) || error.eid != eid) throw error
  }
}

/** The dollars an app's voices received, weighed at a lease's renewal
 * (rtc.ts), on the space's month. */
export let countedRealtime = async (
  env: { STORE: Namespace },
  space: Pick<Space, 'eid'>,
  cost: number,
  now = new Date(),
) => {
  if (cost <= 0) return
  await spending(env, space, { realtime: cost }, now)
}

/** The dollars an app's texts cost (app-texts.ts), on the space's month. */
export let countedTexts = async (
  env: { STORE: Namespace },
  space: Pick<Space, 'eid'>,
  cost: number,
  now = new Date(),
) => {
  if (cost <= 0) return
  await spending(env, space, { texts: cost }, now)
}

/** Deliver the original generation and finish its idempotent settlement. */
export let resultOf = (
  bind: Partial<Pick<Env, 'STORE'>>,
  results: ModelResults,
  providers?: Record<string, Model>,
): NonNullable<Model['result']> =>
async (call, signal) => {
  let result = await results.read(call) ??
    await recovered(results, providers, call, signal)
  if (!result) return
  let cost = result.reply.cost
  if (cost != null) {
    if (!bind.STORE) throw new ModelError('unbound')
    if (
      !await settled(
        { STORE: bind.STORE },
        call,
        cost,
        result.reply.costReported,
      )
    ) {
      throw new Error(
        'Completed model result has no original reservation',
      )
    }
  }
  return result
}

let recovered = async (
  results: ModelResults,
  providers: Record<string, Model> | undefined,
  call: string,
  signal?: AbortSignal,
) => {
  if (!providers) return
  let pending = await results.pending?.(call)
  if (!pending) return
  let model = providers[pending.provider]
  let reply = await model?.retrieve?.(pending.mark, signal)
  if (!reply) return
  let result = {
    reply: pricedReply(reply, pending.tariff),
    mark: model.mark?.(reply, { requestedAt: pending.requestedAt }),
  }
  await results.save(call, result)
  return result
}

let pricedReply = (reply: Awaited<ReturnType<Model>>, tariff?: Price) => {
  let cost = measured(reply, tariff)
  if (cost && (!Number.isFinite(cost.dollars) || cost.dollars < 0)) {
    throw new Error('Hosted provider returned no valid request cost')
  }
  return { ...reply, cost: cost?.dollars, costReported: cost?.reported }
}

/** Why a request's most cost cannot be known before it runs, or null: its
 * model has no listed price, its provider lists no context window to bound
 * the input by, or it asks for output that is not priced by the token. Such a
 * call is refused before anything is held, saying which. */
let unboundable = (
  req: Parameters<Model>[0],
  tariff: Price | undefined | null | false,
  window: number | undefined,
) => {
  let cannot = `so the most this call could cost can't be known, and it is ` +
    `not made`
  let other = req.modalities?.filter((m) => m != 'text')
  if (other?.length) {
    return `${req.model} is asked for ${other.join(' and ')} output, which ` +
      `is not priced by the token, ${cannot}`
  }
  if (!tariff) return `${req.model} has no listed price, ${cannot}`
  if (window == null) {
    return `${req.model}'s provider lists no context window for it, ${cannot}`
  }
  return null
}

/** How long a model call can run in the isolate that asked it: a hold still
 * open past it outlived its caller, and the hourly sweep settles it at what
 * the call most likely cost (model-spend.ts `expired`). */
export let CALL = 3_600_000

// Bytes of streamed text a token covers on average.
let BYTES = 4

/** The input tokens a call is held for: its provider's own count of the
 * request where it counts one, which is what it bills, anchored history
 * included; else the bound worked out from the request (@yaks/model
 * `requestBound`), which for an anchored request is the whole window. A
 * count that fails is a defect, and the call is held to the bound. */
let inputOf = async (
  model: Model,
  req: Parameters<Model>[0],
  window: number,
) => {
  if (model.count && window > 0) {
    try {
      return Math.min(window, await model.count(req))
    } catch (error) {
      req.signal?.throwIfAborted()
      caught(error, { request: 'model input count', model: req.model })
    }
  }
  return requestBound(req, window)
}

/** Who a model call is for: the visitor whose share of the space's budget it
 * spends, if it is a visitor's, and the person whose work it is, if a person
 * started it (model-spend.ts `Paying`). */
export type Whose = { visitor?: string; person?: string }

/** A hosted provider spends from the same space budget as every other door.
 * Costs are supplied by the adapter, never guessed from media JSON. A call
 * `whose` names a visitor for is held to their share as well, and counted
 * among their calls of the day; the person it names is whose work the call's
 * dollars are kept under (model-spend.ts `Paying`). A call that fails once the provider may have
 * worked on it settles at the usage the provider reported, else at what it
 * most likely cost (@yaks/model `likely`), never at the worst case it held. */
export let accounted = (
  bind: Host & Partial<Pick<Env, 'STORE'>>,
  spaceOf: (dir: Directory) => Promise<Space | null>,
  model: Model,
  price?: (name: string) => Promise<Price | undefined>,
  whose?: (req: Parameters<Model>[0]) => Promise<Whose>,
  source?: string,
  results?: ModelResults,
): Model =>
  Object.assign(
    async (req: Parameters<Model>[0]) => {
      let ns = bind.STORE
      let dir = ns ? directoryOf(ns) : null
      let space = dir ? await spaceOf(dir) : null
      if (!ns || !dir || !space) {
        throw new ModelError(
          'unbound',
          'No account is bound to this model call',
        )
      }
      // A request priced by the call is quoted by its model alone.
      let own = model.quote?.(req, 0) !== undefined
      let info = own ? undefined : await model.info?.(req.model)
      let listed = reached('priced', info?.price ?? await price?.(req.model))
      // Held and charged at what the request can be billed.
      let tariff = listed &&
        retained(listed, req.cacheRetention, req.cachePrefix?.retention)
      let window = info?.context ??
        (tariff && Object.values(tariff).every((p) => p == 0) ? 0 : undefined)
      let unbounded = !own && unboundable(req, tariff, window)
      if (unbounded) throw new ModelError('limit', unbounded)
      let call = req.call ?? mint()
      let { visitor, person } = await whose?.(req) ?? {}
      let counted = own ? 0 : await inputOf(model, req, window!)
      let hold = await reserved(
        { STORE: ns },
        space,
        (remaining) => {
          if (own) return model.quote!(req, remaining) ?? null
          // What the provider's own tools may add is reserved beside it.
          let extra = model.hosted
          let input = counted + (extra?.input ?? 0)
          let output = req.questions
            ? window
            : outputTokens(info, req.tokens, input)
          let quote = affordable(
            tariff!,
            input,
            remaining,
            output,
            extra?.searches,
          )
          return req.questions && quote?.tokens != output ? null : quote
        },
        call,
        {
          visitor,
          person,
          source,
          likely: own ? undefined : likely(req, tariff!, Infinity),
          until: new Date(Date.now() + CALL),
        },
      )
      reached('reserved', hold)
      let submitted = false, begun = false, output = false, written = 0
      let acknowledged = false
      let requestedAt = Date.now()
      let reply: Awaited<ReturnType<Model>>
      try {
        reply = await model({
          ...req,
          call,
          tokens: hold.value.tokens,
          onSubmit: async () => {
            if (submitted) {
              throw new ModelError(
                'submitted',
                'This call has already been submitted',
              )
            }
            await req.onSubmit?.()
            submitted = true
          },
          onAck: async (mark) => {
            begun = true
            if (source && model.retrieve && results?.acknowledge) {
              await results.acknowledge(call, {
                provider: source,
                mark,
                tariff: tariff || undefined,
                requestedAt,
              })
              acknowledged = true
            }
            await req.onAck?.(mark)
          },
          onFirst: () => {
            begun = output = true
            req.onFirst?.()
          },
          onText: req.onText && ((delta) => {
            begun = output = true
            written += delta.text.length
            req.onText!(delta)
          }),
        })
      } catch (error) {
        if (
          acknowledged && !req.signal?.aborted &&
          error instanceof ModelError &&
          ['transport', 'stalled', 'disconnected'].includes(error.code)
        ) {
          throw new ModelError('model_result_delivery', error.message, {
            after: 1000,
          })
        }
        // A call never sent, or one its provider refused before any output
        // (@yaks/model `refused`: no such model, or its account dry), ran
        // nothing, so the next model holds the same call. Media the space
        // had no room to keep is free to the person too, but the provider may
        // already have generated it.
        let unkept = error instanceof ModelError && error.code == 'space_full'
        if (unkept) await hold.settle(0, false)
        else if (!begun && !submitted || !output && refused(error)) {
          await hold.release()
        } else {
          // The provider may have worked on it: what it said it used, else
          // what it most likely cost.
          let said = error instanceof ModelError
            ? measured({ usage: error.usage }, tariff || undefined)
            : undefined
          if (said) await hold.settle(said.dollars, false)
          else {
            await hold.estimate(
              own ? hold.value.dollars : likely(
                req,
                tariff!,
                hold.value.dollars,
                Math.ceil(written / BYTES),
              ),
            )
          }
        }
        throw error
      }
      reply = pricedReply(reply, tariff || undefined)
      try {
        await results?.save(call, {
          reply,
          mark: model.mark?.(reply, { requestedAt }),
        })
        if (reply.cost != null) {
          await hold.settle(reply.cost, reply.costReported ?? true)
        }
      } catch (error) {
        if (!results) throw error
        throw new ModelError('model_result_delivery', String(error), {
          after: 1000,
        })
      }
      return reply
    },
    model,
    {
      ...results
        ? {
          result: resultOf(bind, results),
        }
        : {},
      recover: async (call: string) => {
        if (!model.recover) {
          throw new ModelError(
            'media_missing',
            'This provider has no media recovery',
          )
        }
        let ns = bind.STORE
        let space = ns ? await spaceOf(directoryOf(ns)) : null
        if (!ns || !space) {
          throw new ModelError(
            'unbound',
            'No account is bound to this model call',
          )
        }
        // Delivery needs no allowance: the original generation already spent it.
        let reply = await model.recover(call)
        let cost = billed(reply, await price?.(reply.model))
        if (!cost) {
          throw new Error(
            'Recovered provider returned no request cost',
          )
        }
        if (!await settled({ STORE: ns }, call, cost.dollars, cost.reported)) {
          await countedMedia(
            { STORE: ns },
            space,
            call,
            cost.dollars,
            cost.reported,
            { source },
          )
        }
        return reply
      },
    },
  )
