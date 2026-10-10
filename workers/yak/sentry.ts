// Platform defects use @yaks/tracker/report's capture, coalesce and fanout:
// the same samples and hit counts reach Sentry and yak-errors independently.
// The SDK supplies invocation scope, wrapper exceptions and console errors;
// beforeSend hands them to the shared reporter. Platform faults go to the
// platform tracker; space/app slugs remain tags rather than tenant addresses.
//
// A configured ERRORS queue collects even without SENTRY_DSN. Tests without
// either binding keep their own SDK transport. The release is the deployed
// CF_VERSION_METADATA and the environment is SENTRY_ENVIRONMENT.
//
// caught keeps refusals and accepted Pending writes back. Only scrubbed
// exceptions and tags leave: no headers, query, body or console arguments.
// sentry-runtime.ts retains repeat windows through the runtime's waitUntil.
//
// It speaks @sentry/core, never @sentry/cloudflare, whose types declare the
// Workers runtime as globals and would redefine `Response` for every file the
// repo-wide check reads (conform.ts says the same of workers-types). One copy
// of @sentry/core is bundled, so the client index.ts's wrappers start is the
// one these calls reach.
import {
  type BaseTransportOptions,
  captureConsoleIntegration,
  consoleSandbox,
  createEnvelope,
  createTransport,
  type ErrorEvent,
  type EventHint,
  getAsyncContextStrategy,
  getIsolationScope,
  getMainCarrier,
  setAsyncContextStrategy,
  type Transport,
  withScope,
} from '@sentry/core'
import { type Bundle, type Comp } from '@yaks/graph'
import {
  capture,
  coalesce,
  type Coalesced,
  fanout,
  queue,
  refused as refusal,
  type WindowClock,
} from '@yaks/tracker/report'
import { sentry, type SentryEvent } from '@yaks/tracker/sentry'
import type { Env } from './env.ts'
import { isTestAddress } from './lib/bots.ts'
import { Pending } from './writes.ts'
import type { Ctx } from './tools.ts'

/** Who hit a defect: the person's eid, and whether that account is a person
 * or a test account (lib/bots.ts), so Sentry can filter to people. */
export type Hit = { id: string; account: 'person' | 'test' }

/** What an event keeps: the error, its tags and user, and where it happened
 * — the URL without its query, the method. */
export let scrub = (event: ErrorEvent): ErrorEvent => {
  if (event.request) {
    let { url, method } = event.request
    event.request = {
      ...(url ? { url: url.split('?')[0] } : {}),
      ...(method ? { method } : {}),
    }
  }
  if (event.extra) delete event.extra.arguments
  return event
}

// The Cloudflare SDK installs a fresh AsyncLocalStorage strategy when each
// Durable Object is constructed, including inside an active gateway request.
// Its options callback runs immediately afterward: restore this isolate's
// original carrier so the caller's scope and reporting client remain reachable.
let context: ReturnType<typeof getAsyncContextStrategy> | undefined

type Bindings = Pick<
  Partial<Env>,
  'ERRORS' | 'SENTRY_DSN' | 'SENTRY_ENVIRONMENT' | 'CF_VERSION_METADATA'
>
let reporters = new WeakMap<object, Coalesced>()
let occurrences = new WeakMap<object, WeakSet<object>>()
// One thrown object can pass through several catches in one invocation. A
// later invocation reusing it is another occurrence, unlike SDK lifetime dedup.
let seen = (error: unknown) => {
  if (!error || typeof error != 'object') return false
  let scope = getIsolationScope()
  let errors = occurrences.get(scope)
  if (!errors) occurrences.set(scope, errors = new WeakSet())
  if (errors.has(error)) return true
  errors.add(error)
  return false
}

/** The SDK supplies scope and wrapper errors; both destinations receive the
 * shared reporter's samples. Platform faults always belong to the platform
 * tracker: space/app slugs stay tags, never queue tenant addresses. */
export let delivery = (
  env: Bindings,
  send: (event: SentryEvent) => Promise<void>,
  clock?: WindowClock,
) =>
  coalesce(
    fanout({
      ...env.ERRORS ? { tracker: queue(env.ERRORS) } : {},
      ...env.SENTRY_DSN ? { sentry: sentry(send) } : {},
    }, (...args) =>
      consoleSandbox(() =>
        console.error('tracker delivery failed —', ...args)
      )),
    {
      // waitUntil retains a window within Workers' post-response lifetime.
      window: 10_000,
      clock,
    },
  )

export let sample = (event: ErrorEvent, hint: EventHint = {}) => {
  let value = event.exception?.values?.at(-1)
  let original = hint.data?.defect ?? hint.originalException
  let error = original instanceof Error ? original : Object.assign(
    new Error(value?.value ?? event.message ?? 'Unknown defect'),
    {
      name: value?.type ?? 'Error',
      stack:
        value?.stacktrace?.frames?.toReversed().map((frame) =>
          `    at ${
            frame.function ?? '?'
          } (${frame.filename}:${frame.lineno}:${frame.colno})`
        ).join('\n') ?? '',
    },
  )
  return capture(error, {
    sink: () => {},
    commit: event.release,
    environment: event.environment == 'staging' ? 'staging' : 'production',
    tags: {
      ...event.tags,
      ...event.user?.id ? { user_id: event.user.id } : {},
    },
    mechanism: event.logger == 'console' ? 'console' : 'catch',
  })
}

/** SDK scope collection and shared defect delivery for each runtime handler. */
export let options = (env: Bindings = {}, clock?: WindowClock) => {
  context ??= getAsyncContextStrategy(getMainCarrier())
  setAsyncContextStrategy(context)
  let transport: Transport | undefined
  let enabled = !!(env.ERRORS || env.SENTRY_DSN)
  let send = async (event: SentryEvent) => {
    let { user_id, ...tags } = event.tags
    let result = await transport?.send(createEnvelope({}, [[{ type: 'event' }, {
      ...event,
      event_id: crypto.randomUUID().replaceAll('-', ''),
      timestamp: Date.now() / 1000,
      platform: 'javascript',
      level: 'error',
      release: env.CF_VERSION_METADATA?.id,
      environment: env.SENTRY_ENVIRONMENT ?? 'production',
      tags: Object.fromEntries(
        Object.entries(tags).map(([k, v]) => [k, String(v)]),
      ),
      ...user_id ? { user: { id: String(user_id) } } : {},
    }]]))
    if (result?.statusCode && result.statusCode >= 400) {
      throw Error(`Sentry intake answered ${result.statusCode}`)
    }
  }
  return {
    // The SDK must collect scope/wrapper errors even without a Sentry key.
    ...env.ERRORS && !env.SENTRY_DSN
      ? { dsn: 'https://queue@tracker.invalid/1' }
      : {},
    enableDedupe: false,
    // Errors are the point; a few traces are enough to see a slow door.
    tracesSampleRate: 0.05,
    sendDefaultPii: false,
    // A `console.error` anywhere in the kernel is a defect someone wrote down
    // (a Store answering 500), which is what the old tail worker paged on.
    integrations: [captureConsoleIntegration({ levels: ['error'] })],
    // Immediate transport also works after the originating SDK client has
    // been disposed: a later window flush retains only this transport.
    transport: (opts: BaseTransportOptions) =>
      transport = createTransport(opts, async (request) => {
        if (!env.SENTRY_DSN) return { statusCode: 200 }
        let response = await fetch(opts.url, {
          method: 'POST',
          body: typeof request.body == 'string'
            ? request.body
            : new Uint8Array(request.body),
          headers: opts.headers,
          signal: AbortSignal.timeout(15_000),
        })
        await response.body?.cancel()
        return { statusCode: response.status }
      }),
    beforeSend: async (event: ErrorEvent, hint: EventHint) => {
      if (!enabled) return scrub(event)
      if (!hint.data?.defect && seen(hint.originalException)) return null
      let key = env.ERRORS ?? env
      let sink = reporters.get(key)
      if (!sink) {
        sink = delivery(env, send, clock)
        reporters.set(key, sink)
      }
      await sink(sample(scrub(event), hint))
      return null
    },
  }
}

/** Whether a caught failure is the caller's own no rather than ours: a tool's
 * refusal (`CallError`), an error @yaks/graph's `status` puts below 500 (a
 * refused or stale write, a denied one, a query naming what is not there), or
 * a door that answered a 4xx and said so in its `status` (meta.ts). A write
 * the store's log kept (writes.ts `Pending`) is neither: its failure was
 * reported where it happened. */
export let refused = (e: unknown) => e instanceof Pending || refusal(e)

/** A failure a catch answers on purpose — a fallback, a sentence, an error
 * response — sent to Sentry unless it was a refusal. What the caller is
 * answered stays the catch's own business. */
export let caught = (
  e: unknown,
  tags: Record<string, string | null | undefined>,
) => {
  if (!refused(e)) defect(e, tags)
}

/** One defect, with where it happened as tags and who hit it as the user. A
 * tag with no value is left off. */
export let defect = (
  error: unknown,
  tags: Record<string, string | null | undefined>,
  hit?: Hit,
) =>
  withScope((scope) => {
    if (seen(error)) return
    for (let [k, v] of Object.entries(tags)) if (v) scope.setTag(k, v)
    if (hit) {
      scope.setUser({ id: hit.id })
      scope.setTag('account', hit.account)
    }
    // captureException suppresses an Error instance forever. Explicit reports
    // count every occurrence; the SDK still supplies scope and wrapper capture.
    scope.captureEvent({
      ...error instanceof Error
        ? {
          exception: { values: [{ type: error.name, value: error.message }] },
        }
        : { message: String(error) },
    }, { data: { defect: error } })
  })

// The space and app a call's arguments named, and nothing else it said.
let aimedAt = (args: unknown): { space?: string; app?: string } => {
  let said = (args ?? {}) as Record<string, unknown>
  let slug = (v: unknown) => typeof v == 'string' ? v : undefined
  return { space: slug(said.space), app: slug(said.app) }
}

// Whether the caller is a person or a test account (lib/bots.ts), so Sentry
// can be filtered to what people hit. An address that cannot be read is a
// person's: the safe direction to be wrong in.
let accountOf = async (ctx: Ctx): Promise<Hit | undefined> => {
  if (!ctx.person) return undefined
  let email = await ctx.dir.emailAt(ctx.person).catch(() => null)
  return {
    id: ctx.person,
    account: isTestAddress(email ?? '') ? 'test' : 'person',
  }
}

/** A connector tool's defect, sent with the tool, the space and
 * app its arguments named, the client that connected, and the person who
 * called it. A refusal never arrives here: the runner keeps it back. */
export let reporter =
  (ctx: Ctx, client?: string) =>
  async (err: unknown, call: Bundle, tool?: string) =>
    defect(
      err,
      {
        tool,
        ...aimedAt((call.call as Comp | undefined)?.args),
        client,
      },
      await accountOf(ctx),
    )
