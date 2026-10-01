/** Subscriber-owned runtime activity. A target's channel records bounded,
 * value-free events only while somebody listens; producers use peek() so the
 * unobserved path creates neither channels, events, IDs nor clocks. This module
 * depends only on the web platform, not on a graph, server or UI. */

export type Kind =
  | 'apply'
  | 'phase'
  | 'rule'
  | 'query'
  | 'get'
  | 'effect'
  | 'request'
  | 'fanout'

export type Outcome = 'ok' | 'check' | 'refused' | 'error' | 'interrupted'
export type Counts = Readonly<Record<string, number>>

/** IDs and monotonic times are local to one target's channel. Names identify
 * code (never a query, URL, entity, credential or payload). Zero duration is
 * meaningful on runtimes whose clock advances only during I/O. */
export type Event = {
  readonly id: string
  readonly parent?: string
  readonly kind: Kind
  readonly name: string
  readonly stage: 'start' | 'end' | 'instant'
  readonly time: number
  readonly start?: number
  readonly duration?: number
  readonly package?: string
  readonly plugin?: string
  readonly outcome?: Outcome
  readonly counts?: Counts
}

export type Activity = {
  kind: Kind
  name: string
  parent?: string
  package?: string
  plugin?: string
}
export type End = { outcome?: Outcome; counts?: Counts }
export type Span = {
  readonly id: string
  readonly start: number
  end: (o?: End) => void
}
export type Channel = {
  readonly active: boolean
  subscribe: (listener: (event: Event) => void) => () => void
  history: (limit?: number) => Event[]
  begin: (activity: Activity) => Span | undefined
  instant: (activity: Activity, o?: End) => Event | undefined
}

let channels = new WeakMap<object, Channel>()
let capacity = 256

let counts = (input?: Counts): Counts | undefined => {
  if (!input) return
  let out: Record<string, number> = {}
  for (let [name, value] of Object.entries(input)) {
    if (typeof value == 'number' && Number.isFinite(value)) out[name] = value
  }
  return Object.freeze(out)
}

let create = (): Channel => {
  let listeners = new Set<(event: Event) => void>()
  let ring: Event[] = []
  let next = 0
  let size = 0
  let sequence = 0
  let epoch = 0
  let emit = (event: Event): Event => {
    Object.freeze(event)
    ring[next] = event
    next = (next + 1) % capacity
    size = Math.min(size + 1, capacity)
    for (let listener of listeners) {
      try {
        listener(event)
      } catch (why) {
        console.error('trace subscriber failed', why)
      }
    }
    return event
  }
  let event = (
    a: Activity,
    id: string,
    stage: Event['stage'],
    time: number,
  ): Event => ({
    id,
    parent: a.parent,
    kind: a.kind,
    name: a.name,
    stage,
    time,
    package: a.package,
    plugin: a.plugin,
  })
  return {
    get active() {
      return listeners.size > 0
    },
    subscribe: (listener) => {
      if (!listeners.size) epoch++
      // Each subscription owns its unsubscribe, even for the same callback.
      let subscribed = (e: Event) => listener(e)
      listeners.add(subscribed)
      return () => {
        listeners.delete(subscribed)
      }
    },
    history: (limit = capacity) => {
      let n = Math.min(size, Math.max(0, Math.floor(limit)))
      let out: Event[] = []
      for (let i = n; i > 0; i--) {
        out.push(ring[(next - i + capacity) % capacity])
      }
      return out
    },
    begin: (a) => {
      if (!listeners.size) return
      let id = String(++sequence)
      let start = performance.now()
      let recording = epoch
      let ended = false
      emit({ ...event(a, id, 'start', start), start })
      return {
        id,
        start,
        end: (o = {}) => {
          if (ended) return
          ended = true
          // A disconnected recording cannot finish in a later recording.
          if (!listeners.size || epoch != recording) return
          let time = performance.now()
          emit({
            ...event(a, id, 'end', time),
            start,
            duration: Math.max(0, time - start),
            outcome: o.outcome ?? 'ok',
            counts: counts(o.counts),
          })
        },
      }
    },
    instant: (a, o = {}) => {
      if (!listeners.size) return
      return emit({
        ...event(a, String(++sequence), 'instant', performance.now()),
        outcome: o.outcome,
        counts: counts(o.counts),
      })
    },
  }
}

/** Explicit consumer entry point. Merely creating a channel does not turn
 * tracing on. Subscribe before reading history to avoid a delivery gap. */
export let channel = (target: object): Channel => {
  let found = channels.get(target)
  if (found) return found
  let made = create()
  channels.set(target, made)
  return made
}

/** Producer entry point: never creates anything and exposes only a subscribed
 * channel. Construct activity metadata inside this branch, not before it. */
export let peek = (target: object): Channel | undefined => {
  let found = channels.get(target)
  return found?.active ? found : undefined
}
