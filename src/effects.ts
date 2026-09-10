// Fleet composition of @yaks/effects. The fleet journal still carries its
// relational after-images and Trace (T-33820); only that translation and the
// commit/feed routing live here. Matching, ownership, isolation, documentation
// and pending-row reconciliation belong to the package registry.
import {
  effects,
  type Event,
  type Handler as Observer,
  type Policy,
} from '@yaks/effects'
import { fleetVocab } from './vocab/fleet_vocab.ts'
import { type Change } from './types.ts'

export type Where = 'serve' | 'do'
export type Handler = (eid: string, comp: Record<string, unknown>) => unknown
export type Effect = Omit<Policy, 'where'> & {
  created?: Handler
  changed?: Record<string, Handler>
  removed?: (eid: string) => unknown
  where?: Where
}

// Existing fleet handlers close over their apply()/commitEffects write doors;
// they never write through a detached Tx. No durable ledger is enabled: journal
// dispatch remains at-most-once, with declared idempotent sweeps at boot.
let registry = effects(fleetVocab())
let observer = (run: Handler): Observer => (e) =>
  run(e.entity.eid, e.comp ?? {})
export let on = (comp: string, e: Effect) =>
  registry.on(comp, {
    ...e,
    created: e.created && observer(e.created),
    changed: e.changed && Object.fromEntries(
      Object.entries(e.changed).map(([col, run]) => [col, observer(run)]),
    ),
    removed: e.removed && ((event) => e.removed!(event.entity.eid)),
  })
export let docs = registry.docs

// What apply() learned that the wire doesn't say: which comp rows the
// batch inserted, and which rows its deletes took (keyed by eid). Hand a
// fresh one to apply(), then to dispatch() with the batch it returned.
export type Trace = {
  created: Set<string>
  removed: Map<string, string[]>
  // Dispatch belongs to the journal FEED (catchup.ts), not the call site:
  // apply() journals a fed trace beside the batch, and the feed fires the
  // effects when its cursor passes the row — own writes and a foreign
  // process's uniformly. A plain trace() keeps dispatch at the call site in
  // inline mode (and for deliberate low-level callers) and journals no trace,
  // so the feed can never fire those effects a second time.
  fed?: boolean
}
export let trace = (): Trace => ({ created: new Set(), removed: new Map() })
export let fed = (): Trace => ({ ...trace(), fed: true })

// The one post-commit routing policy for this process. Library users, tests,
// probes, and the unsplit server keep the inline default. A split process
// installs its owner and local journal-feed nudge once at boot. Callers never
// choose fed-vs-plain or a process filter themselves: that choice has to remain
// stable through handler-written consequences as well as top-level writes.
type Driver = {
  split: boolean
  want: (w: Where) => boolean
  settle: () => void
  oops: (comp: string, e: unknown) => void
}

let driver: Driver = {
  split: false,
  want: () => true,
  settle: () => {},
  oops: (comp, e) => console.warn(`effect ${comp} failed —`, e),
}

// Returns a restore hook so a focused test/probe can configure a split pair
// without leaking process policy into its neighbours.
export let configureEffects = (next: Partial<Driver>) => {
  let prior = driver
  driver = { ...driver, ...next }
  return () => driver = prior
}

export let effectTrace = (): Trace => driver.split ? fed() : trace()

// Atomic commit, then best-effort notification + routing. Once commit returns,
// the mutation is durable: neither a broken socket cast nor a feed nudge may
// turn that success back into an apparent apply refusal. Both failures still
// reach the configured durable effect reporter under their own type, and a
// cast failure cannot prevent effect routing.
export let commitEffects = (
  commit: (t: Trace) => Change[],
  cast: (changes: Change[]) => void,
  oops?: (comp: string, e: unknown) => void,
): Change[] => {
  let t = effectTrace()
  let out = commit(t)
  let report = (comp: string, e: unknown) => {
    try {
      ;(oops ?? driver.oops)(comp, e)
    } catch (reportError) {
      console.warn(`effect ${comp} reporting failed —`, reportError)
    }
  }
  try {
    cast(out)
  } catch (e) {
    report('cast', e)
  }
  try {
    routeEffects(out, t, report)
  } catch (e) {
    report('route', e)
  }
  return out
}

// The companion for a commit helper that must construct its batch/trace
// itself (entries.append is the one production case). New mutation doors
// should prefer commitEffects so trace selection cannot drift from apply().
export let routeEffects = (
  out: Change[],
  t: Trace,
  oops?: (comp: string, e: unknown) => void,
) => {
  if (t.fed) driver.settle()
  else dispatch(out, t, oops ?? driver.oops, driver.want)
}

// Translate the fleet's committed trace, without inferring before-images or
// changing journal semantics. Entity deaths include the cascade's component
// casualties; an absent component deletion is not an event.
export let effectEvents = (changes: Change[], t: Trace): Event[] =>
  changes.flatMap(({ eid, name, comp }): Event[] => {
    let entity = { eid }
    if (name == 'entity') {
      return comp == null
        ? (t.removed.get(eid) ?? []).map((name) => ({
          kind: 'removed',
          entity,
          name,
        }))
        : []
    }
    if (comp == null) {
      return t.removed.get(eid)?.includes(name)
        ? [{ kind: 'removed', entity, name }]
        : []
    }
    return [{
      kind: t.created.has(`${name} ${eid}`) ? 'created' : 'changed',
      entity,
      name,
      comp,
    }]
  })

let pass = (oops: Driver['oops'], want: Driver['want']) => ({
  report: (err: unknown, { event }: { event: Event }) => oops(event.name, err),
  want: (where: string) => want(where as Where),
})

// Dispatch starts handlers synchronously; only their completion is asynchronous.
// The feed owns its cursor and never waits on a worldly effect to commit.
export let dispatch = (
  changes: Change[],
  t: Trace,
  oops = driver.oops,
  want = driver.want,
): Promise<unknown[]> =>
  registry.dispatch(effectEvents(changes, t), undefined, pass(oops, want))

export let relay = (
  rows: (comp: string, pending: string) => Record<string, unknown>[],
  oops = driver.oops,
  want = driver.want,
): Promise<unknown[]> => registry.relay(rows, undefined, pass(oops, want))
