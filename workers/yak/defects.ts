// Platform failures enter the tracker's queue where they are caught. Invocation
// context keeps tags and duplicate catches together without retaining request
// headers, queries, bodies or console arguments. Repeat windows retain counts.
import { AsyncLocalStorage } from 'node:async_hooks'
import { type Bundle, type Comp } from '@yaks/graph'
import {
  capture,
  coalesce,
  type Coalesced,
  type origin,
  queue,
  refused as refusal,
  type WindowClock,
} from '@yaks/tracker/report'
import type { Env } from './env.ts'
import { isTestAddress } from './lib/bots.ts'
import { Pending } from './writes.ts'
import type { Ctx } from './tools.ts'

export type Hit = { id: string; account: 'person' | 'test' }
type Tags = Record<string, string | null | undefined>
type Bindings = Pick<
  Partial<Env>,
  'ERRORS' | 'ENVIRONMENT' | 'CF_VERSION_METADATA' | 'WORKER_NAME'
>
type Invocation = {
  env: Bindings
  tags: Tags
  seen: WeakSet<object>
  pending: Set<Promise<void>>
  clock?: WindowClock
  retain?: (pending: Promise<void>) => void
  origin?: ReturnType<typeof origin>
}
let context = new AsyncLocalStorage<Invocation>()
let reporters = new WeakMap<object, Coalesced>()

/** Keep detached work alive without joining the request's awaited reports. */
export let background = (work: Promise<void>): void =>
  context.getStore()?.retain?.(work)

export let delivery = (env: Bindings, clock?: WindowClock): Coalesced =>
  coalesce(env.ERRORS ? queue(env.ERRORS) : () => {}, {
    window: 10_000,
    clock,
  })

/** A runtime entry keeps delivery alive and reports a failure escaping its
 * own catch. Nested entries retain the caller's tags and duplicate catches. */
export let within = <T>(
  env: Bindings,
  tags: Tags,
  run: () => T,
  clock?: WindowClock,
  options: {
    retain?: (pending: Promise<void>) => void
    origin?: ReturnType<typeof origin>
  } = {},
): T => {
  let parent = context.getStore()
  let invocation: Invocation = {
    env: { ...parent?.env, ...env },
    tags: { ...parent?.tags, ...tags },
    seen: parent?.seen ?? new WeakSet(),
    pending: new Set(),
    clock: clock ?? parent?.clock,
    retain: options.retain ?? parent?.retain,
    origin: options.origin ?? parent?.origin,
  }
  return context.run(invocation, () => {
    let failed = (error: unknown): never => {
      caught(error, tags)
      throw error
    }
    try {
      let result = run()
      if (result instanceof Promise) {
        return result.catch(failed).finally(async () => {
          await Promise.all(invocation.pending)
        }) as T
      }
      return result
    } catch (error) {
      return failed(error)
    }
  })
}

/** An accepted write has already been reported where it failed. */
export let refused = (error: unknown) =>
  error instanceof Pending || refusal(error)

/** A caught failure is still ours when the catch answers a fallback. */
export let caught = (error: unknown, tags: Tags) => {
  if (!refused(error)) defect(error, tags)
}

/** A tenant catch delivered through its own tracker scope. An outer catch
 * must retain that single occurrence rather than reporting a platform bug. */
export let reported = (error: unknown) => {
  if (error && typeof error == 'object') context.getStore()?.seen.add(error)
}

/** Only exception data and explicit tags leave. One thrown object can pass
 * several catches; a later invocation reusing it is another occurrence. */
export let defect = (
  error: unknown,
  tags: Tags,
  details: { hit?: Hit; fault?: string } = {},
) => {
  let invocation = context.getStore()
  if (!invocation?.env.ERRORS) return
  if (error && typeof error == 'object') {
    if (invocation.seen.has(error)) return
    invocation.seen.add(error)
  }
  let { env } = invocation
  let sink = reporters.get(env.ERRORS!)
  if (!sink) {
    sink = delivery(env, invocation.clock)
    reporters.set(env.ERRORS!, sink)
  }
  let rows = capture(error, {
    ...invocation.origin,
    sink,
    commit: env.CF_VERSION_METADATA?.id,
    fault: details.fault,
    environment: env.ENVIRONMENT == 'staging' ? 'staging' : 'production',
    tags: Object.fromEntries(
      Object.entries({
        ...invocation.origin?.tags,
        ...invocation.tags,
        ...tags,
        ...details.hit
          ? { user_id: details.hit.id, account: details.hit.account }
          : {},
      }).filter(([, value]) => value != null),
    ),
  })
  let pending = Promise.resolve(sink(rows))
  invocation.retain?.(pending)
  invocation.pending.add(pending)
  void pending.then(() => invocation.pending.delete(pending))
}

let aimedAt = (args: unknown): { space?: string; app?: string } => {
  let said = (args ?? {}) as Record<string, unknown>
  let slug = (v: unknown) => typeof v == 'string' ? v : undefined
  return { space: slug(said.space), app: slug(said.app) }
}

let accountOf = async (ctx: Ctx): Promise<Hit | undefined> => {
  if (!ctx.person) return undefined
  let email = await ctx.dir.emailAt(ctx.person).catch((error) => {
    caught(error, { request: 'read reporting account', person: ctx.person })
    return null
  })
  return {
    id: ctx.person,
    account: isTestAddress(email ?? '') ? 'test' : 'person',
  }
}

/** A connector failure keeps the named tool, space, app, client and account. */
export let reporter =
  (ctx: Ctx, client?: string) =>
  async (err: unknown, call: Bundle, tool?: string) =>
    defect(err, {
      tool,
      ...aimedAt((call.call as Comp | undefined)?.args),
      client,
    }, { hit: await accountOf(ctx) })
