// Runtime retention for tracker delivery and its bounded repeat windows.
import { waitUntil } from 'cloudflare:workers'
import { faults } from '@yaks/api'
import { caught, defect, within } from './defects.ts'
import { instrument as tracked } from '@yaks/tracker/instrument'
import { origin } from '@yaks/tracker/report'
import type { Env } from './env.ts'
import { PLATFORM_OBJECT } from './door.ts'
import { learn, restarting } from './running.ts'
import { type Own, replaced, vacating } from '@yaks/durable-object/resets'
import { bounded, type Report } from '@yaks/durable-object/ceiling'
import { timedOut } from '@yaks/platform/routes'
import { watching } from './lib/waits.ts'

let clock = {
  now: Date.now,
  after: (ms: number, run: () => Promise<void>) => {
    let resolve: () => void
    let pending = new Promise<void>((done) => resolve = done)
    let firing = false
    let timer = setTimeout(() => {
      firing = true
      void run().finally(resolve)
    }, ms)
    waitUntil(pending)
    return () => {
      clearTimeout(timer)
      if (!firing) resolve()
    }
  },
}

// What @yaks/api catches and answers, or meets with nobody to answer (a
// socket's message, a subscription's refresh, a store's answer at 500), is a
// failure of ours, reported where it was caught in the invocation it ran in,
// with the tags its door was given (a store's name).
faults((error, where, tags) => caught(error, { ...tags, request: where }))

// A Durable Object's state, when the invocation is one of its own.
let own = (state: unknown): state is { storage: Own } =>
  typeof (state as { storage?: Own } | undefined)?.storage?.transactionSync ==
    'function'

// Every invocation enters here, the Worker's and each object's, so this is
// also where an isolate learns which deploy it runs (running.ts). An object's
// invocation can ask whether the runtime has since moved it off this instance
// (@yaks/durable-object `replaced`).
export let entry = <T>(
  env: Partial<Env>,
  request: string,
  run: () => T,
  http?: Request,
  state?: unknown,
): T => {
  learn(env.CF_VERSION_METADATA)
  let invoke = <R>(work: () => R): R =>
    within(
      env,
      { request },
      work,
      clock,
      {
        retain: waitUntil,
        origin: origin(
          env.WORKER_NAME ?? 'yak',
          env.CF_VERSION_METADATA?.id,
          request,
          http,
        ),
        replaced: own(state)
          ? () => restarting(state) || replaced(state.storage)
          : undefined,
      },
    )
  if (!http) return invoke(run)
  // Give the front time to fall through from Site to the gateway. The
  // outer deadline also bounds time spent waiting for tracker delivery.
  let limit = request == 'Site fetch' ? 20_000 : 50_000
  return watching(
    (signal) =>
      Promise.resolve(
        invoke(() =>
          own(state)
            ? vacating(run, state.storage, env.CLOCK, undefined, signal)
            : run()
        ),
      ) as Promise<Response>,
    limit,
    (ms, waits) =>
      invoke(() => {
        defect(Error('The request reached its response deadline'), {
          elapsed_ms: String(ms),
          waiting: waits.length ? JSON.stringify(waits) : 'handler',
        }, { fault: 'request timeout' })
        return timedOut(http)
      }),
    env.CLOCK,
  ) as T
}

// A statement that scans, and an object past the rows it may read or write,
// told where the statement ran (@yaks/durable-object `bounded`): a scan is
// one bug for its statement whichever object ran it, a runaway one for its
// object.
let costly = (kind: string, id?: { name?: string }): Report =>
(
  error,
  { fault, tags },
) => {
  let object = id?.name ?? String(id ?? '')
  defect(error, { ...tags, class: kind, object }, {
    fault: fault.startsWith('scan|') ? fault : `${fault}|${kind}|${object}`,
  })
}

/** Construction, lifecycle callbacks and RPC methods enter {@link entry}
 * (@yaks/tracker/instrument), given the object's state and env. Every object
 * refuses past its windows (@yaks/durable-object `bounded`), so a runaway
 * costs at most its window's rows, but the platform's directory: every door
 * reads it, so stopping it stops the platform, which costs more than its rows.
 * It is told, never refused, from before its first statement, since a new
 * instance goes on in the window an earlier one kept, and the statements that
 * start it write. Its id names it (`PLATFORM_OBJECT`), as it names the object
 * a report is filed under. */
export let instrument = <C>(Original: C): C =>
  tracked(
    Original,
    ([state, env], name, run, http) =>
      entry((env ?? {}) as Partial<Env>, name, run, http, state),
    ([state], name) => {
      if (!own(state)) return
      let { id } = state as { id?: { name?: string } }
      bounded(state.storage, {
        report: costly(name, id),
        refuse: id?.name != PLATFORM_OBJECT,
      })
    },
  )
