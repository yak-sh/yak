// A space's counted spends and hosted model providers' accounts: the doors
// that write what a space spent for the directory to add to its month. What
// the month is spent against, and what refuses it, is @yaks/platform's
// (`plans`, `meter` and `standing`), and so is the transactional spend rule
// (`meter-graph`). metered.ts holds the counted doors a letter and an app's
// model API pass; facets/directory-effects.ts seeds the directory's recurring
// usage schedule.
import { reached } from './lib/hops.ts'
import type { Host } from '@yaks/platform/host'
import { monthOf } from '@yaks/platform/meter'
import type { Spend } from '@yaks/platform/plans'
import { type Directory, directoryOf, type Space, stamp } from './directory.ts'
import type { Namespace } from '@yaks/durable-object/door'
import type { Env } from './env.ts'
import {
  affordable,
  billed,
  measured,
  type Model,
  ModelError,
  type ModelResults,
  type Price,
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

// ---- the builds (T-34241) ---------------------------------------------------
//
// A build is counted where it happens, like a letter and for the same reason:
// nothing in the analytics knows what the builder did. One count per completed
// build — an `app_deploy` the builder performed — and never per message, so a
// long conversation that ships one app costs one build.
//
// The refusal is a sentence the builder says, not a bounce: the person is
// talking to it, and a door slamming mid-conversation is not an answer. The
// builder asks before it starts and repeats what comes back.

/**
 * One completed build and what it cost: the month's builds, model dollars
 * and container seconds, and the space's lifetime builds, each one higher.
 *
 * This is the call the builder's loop makes with what its `build()` spent on
 * its model (T-34239, weighed by models.ts) and the seconds its workbench held
 * (sandbox.ts `released`). A build that was refused never reaches it, so a
 * refusal costs a person nothing — not a build, and not the model call of the
 * sentence that turned it down.
 */
export let countedBuild = (
  env: { STORE: Namespace },
  space: Pick<Space, 'eid'>,
  cost: number,
  seconds = 0,
  now = new Date(),
) => spending(env, space, { builds: 1, models: cost, seconds }, now)

// ---- the workbench (T-34264) ------------------------------------------------
//
// Container seconds, counted where they happen like the letters and the
// builds: nothing in the analytics knows what the builder compiled. The unit
// is one second of container wall time — what Cloudflare bills on — measured
// from the first sandbox call in a build to the moment the build lets the
// container go (sandbox.ts `Spend`), rounded up.
//
// Two ceilings hold it: the per-build budget the tools refuse at (sandbox.ts
// `BUDGET`), and the month's {@link SECONDS}, which is what bounds the lone
// calls that belong to no build (tools.ts `bench` asks before each).

/**
 * The model dollars and container seconds spent, on the space's month, with
 * no build beside them.
 *
 * The door for a conversation that shipped nothing (builder.ts `end`) — its
 * model calls cost the same whether or not they ended in a deploy — and for a
 * lone sandbox tool call somebody's own agent made over the connector
 * (tools.ts `bench`). Where a build is being counted both go with it
 * ({@link countedBuild}).
 */
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
 * commit is recognized by the ledger rather than charged a second time. */
export let countedMedia = async (
  env: { STORE: Namespace },
  space: Pick<Space, 'eid'>,
  call: string,
  dollars: number,
  reported = true,
  source?: string,
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
        spend: { month: monthOf(new Date()), models: dollars, source },
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

/** Deliver a saved result and finish only its original, idempotent settlement. */
export let resultOf = (
  bind: Partial<Pick<Env, 'STORE'>>,
  results: ModelResults,
): NonNullable<Model['result']> =>
async (call) => {
  let result = await results.read(call)
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

/** A hosted provider spends from the same space budget as every other door.
 * Costs are supplied by the adapter, never guessed from media JSON. A call
 * `visiting` names a visitor for is held to their share as well, and counted
 * among their calls of the day. */
export let accounted = (
  bind: Host & Partial<Pick<Env, 'STORE'>>,
  spaceOf: (dir: Directory) => Promise<Space | null>,
  model: Model,
  price?: (name: string) => Promise<Price | undefined>,
  visiting?: (req: Parameters<Model>[0]) => Promise<string | undefined>,
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
      let tariff = listed && retained(listed, req.cacheRetention)
      let window = info?.context ??
        (tariff && Object.values(tariff).every((p) => p == 0) ? 0 : undefined)
      let unbounded = !own && unboundable(req, tariff, window)
      if (unbounded) throw new ModelError('limit', unbounded)
      let call = req.call ?? mint()
      let visitor = await visiting?.(req)
      let hold = await reserved(
        { STORE: ns },
        space,
        (remaining) => {
          if (own) return model.quote!(req, remaining) ?? null
          // What the provider's own tools may add is reserved beside it.
          let extra = model.hosted
          let input = requestBound(req, window!) + (extra?.input ?? 0)
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
        { visitor, source },
      )
      reached('reserved', hold)
      let submitted = false
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
        })
      } catch (error) {
        // Media the space's files had no room to keep is not charged for,
        // though its provider may have been paid.
        let unkept = error instanceof ModelError && error.code == 'space_full'
        if (!submitted || unkept) await hold.settle(0, false)
        throw error
      }
      let cost = measured(reply, tariff)
      if (cost && (!Number.isFinite(cost.dollars) || cost.dollars < 0)) {
        throw new Error('Hosted provider returned no valid request cost')
      }
      reply = { ...reply, cost: cost?.dollars, costReported: cost?.reported }
      try {
        await results?.save(call, {
          reply,
          mark: model.mark?.(reply, { requestedAt }),
        })
        if (cost) await hold.settle(cost.dollars, cost.reported)
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
            source,
          )
        }
        return reply
      },
    },
  )
