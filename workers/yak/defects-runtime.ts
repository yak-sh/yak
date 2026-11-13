// Runtime retention for tracker delivery and its bounded repeat windows.
import { waitUntil } from 'cloudflare:workers'
import { faults } from '@yaks/api'
import { caught, defect, watched, within } from './defects.ts'
import { instrument as tracked } from '@yaks/tracker/instrument'
import { origin } from '@yaks/tracker/report'
import type { Env } from './env.ts'
import { learn, restarting } from './running.ts'
import { type Own, replaced, vacating } from '@yaks/durable-object/resets'
import { bounded, type Report } from '@yaks/durable-object/ceiling'

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
// failure of ours, reported where it was caught in the invocation it ran in.
faults((error, where) => caught(error, { request: where }))

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
): T => (
  learn(env.CF_VERSION_METADATA),
    within(
      env,
      { request },
      // A request whose instance the runtime replaced fails as evicted, so
      // its caller's resend reaches the live one (@yaks/durable-object
      // `vacating`).
      http
        ? () =>
          watched(
            own(state) ? () => vacating(run, state.storage, env.CLOCK) : run,
            env.CLOCK,
          )
        : run,
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
)

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
 * costs at most its window's rows. The platform's directory is spared by its
 * Store once it knows its name (graph.ts `#start`): no id says it before
 * then. */
export let instrument = <C>(Original: C): C =>
  tracked(
    Original,
    ([state, env], name, run, http) =>
      entry((env ?? {}) as Partial<Env>, name, run, http, state),
    ([state], name) => {
      if (!own(state)) return
      let { id } = state as { id?: { name?: string } }
      bounded(state.storage, { report: costly(name, id), refuse: true })
    },
  )
