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
  | 'sql'
  | 'bench'

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
  /** False after end or after its subscriber recording disconnects. */
  readonly active?: boolean
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
let recordings = new WeakMap<Channel, number>()
let roots = new WeakMap<Channel, (id: string) => void>()
let links = new WeakMap<
  object,
  WeakMap<object, { id: string; recording: number }>
>()

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
    for (let listener of [...listeners]) {
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
  let out: Channel = {
    get active() {
      return listeners.size > 0
    },
    subscribe: (listener) => {
      if (!listeners.size) recordings.set(out, ++epoch)
      // Each subscription owns its unsubscribe, even for the same callback.
      let subscribed = (e: Event) => listener(e)
      listeners.add(subscribed)
      return () => {
        listeners.delete(subscribed)
      }
    },
    history: (limit = capacity) => {
      let n = Number.isNaN(limit)
        ? 0
        : Math.min(size, Math.max(0, Math.floor(limit)))
      let out: Event[] = []
      for (let i = n; i > 0; i--) {
        out.push(ring[(next - i + capacity) % capacity])
      }
      return out
    },
    begin: (a) => {
      if (!listeners.size) return
      // Copy code metadata before delivering: a listener may mutate its caller.
      a = { ...a }
      let id = `${epoch}.${++sequence}`
      roots.get(out)?.(id)
      let start = performance.now()
      let recording = epoch
      let ended = false
      emit({ ...event(a, id, 'start', start), start })
      return {
        get active() {
          return !ended && !!listeners.size && epoch == recording
        },
        id,
        start,
        end: (o) => {
          if (ended) return
          ended = true
          // A disconnected recording cannot finish in a later recording.
          if (!listeners.size || epoch != recording) return
          let time = performance.now()
          emit({
            ...event(a, id, 'end', time),
            start,
            duration: Math.max(0, time - start),
            outcome: o?.outcome ?? 'ok',
            counts: counts(o?.counts),
          })
        },
      }
    },
    instant: (a, o) => {
      if (!listeners.size) return
      let id = `${epoch}.${++sequence}`
      roots.get(out)?.(id)
      return emit({
        ...event(a, id, 'instant', performance.now()),
        outcome: o?.outcome,
        counts: counts(o?.counts),
      })
    },
  }
  return out
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

/** One call's result and parent-linked span tree. Each span is its end event,
 * or its start event if still open when the call returns; instants stay whole. */
export type Recorded<T> = { result: T; spans: Event[] }

let tree = (events: Map<string, Event>, root?: string): Event[] => {
  if (!root) return []
  let children = new Map<string, Event[]>()
  for (let e of events.values()) {
    if (!e.parent || e.id == root) continue
    let siblings = children.get(e.parent)
    if (!siblings) children.set(e.parent, siblings = [])
    siblings.push(e)
  }
  let found: Event[] = []
  let pending = [events.get(root)!]
  while (pending.length) {
    let e = pending.pop()!
    found.push(e)
    pending.push(...(children.get(e.id) ?? []).toReversed())
  }
  return found
}

/** Subscribe for a single operation, whose root must begin synchronously in
 * run(). Descendants are selected by parent IDs, including across awaits.
 * Capturing directly from delivery leaves every subscriber's history intact. */
export function record<T>(
  target: object,
  run: () => T,
): T extends PromiseLike<unknown> ? Promise<Recorded<Awaited<T>>> : Recorded<T>
export function record<T>(
  target: object,
  run: () => T | PromiseLike<T>,
): Recorded<T> | Promise<Recorded<T>> {
  let c = channel(target)
  let events = new Map<string, Event>()
  let root: string | undefined
  let stop = c.subscribe((e) => {
    if (e.stage == 'end' || !events.has(e.id)) events.set(e.id, e)
  })
  let before = roots.get(c)
  // Nominate before delivery: another subscriber can reenter the producer
  // before this recorder receives the original root's start event.
  roots.set(c, (id) => {
    root ??= id
    before?.(id)
  })
  let done = (result: T): Recorded<T> => {
    stop()
    return { result, spans: tree(events, root) }
  }
  let failed = (error: unknown): never => {
    stop()
    throw error
  }
  try {
    let result: T | PromiseLike<T>
    try {
      result = run()
    } finally {
      if (before) roots.set(c, before)
      else roots.delete(c)
    }
    return result && typeof (result as PromiseLike<T>).then == 'function'
      ? Promise.resolve(result).then(done, failed)
      : done(result as T)
  } catch (error) {
    return failed(error)
  }
}

/** A parent carried through a local callback, never through persisted rows.
 * Both keys matter: a read overlay must not quietly become another graph's
 * recording. Expired recordings cannot supply parents to later subscribers. */
export let link = (target: object, carrier: object, id: string): void => {
  let c = peek(target)
  if (!c || !id.startsWith(`${recordings.get(c)}.`)) return
  let at = links.get(target)
  if (!at) links.set(target, at = new WeakMap())
  at.set(carrier, { id, recording: recordings.get(c)! })
}

export let parent = (target: object, carrier: object): string | undefined => {
  let c = peek(target)
  if (!c) return
  let found = links.get(target)?.get(carrier)
  return found?.recording == recordings.get(c) ? found?.id : undefined
}

export let unlink = (target: object, carrier: object): void => {
  links.get(target)?.delete(carrier)
}

export type Context = {
  channel: Channel
  parent?: string
  plugin?: string
  recording?: number
}

/** The recording a producer began in; a reconnect cannot revive its work. */
export let recording = (c: Channel): number | undefined => recordings.get(c)
export let live = (ctx: Context): boolean =>
  ctx.channel.active &&
  (ctx.recording == null || ctx.recording == recording(ctx.channel))

/** Only the error's category, never its text or properties, is observable. */
export let outcome = (error: unknown): Outcome => {
  let name = error instanceof Error ? error.name : undefined
  if (name == 'AbortError') return 'interrupted'
  if (name == 'Checked') return 'check'
  return [
      'Refused',
      'Unsupported',
      'SyntaxError',
      'Unknown',
      'UnknownSession',
      'Unnamed',
      'Unauthorized',
      'Denied',
      'Paced',
      'NotFound',
      'Stale',
      'Bounced',
    ].includes(name ?? '')
    ? 'refused'
    : 'error'
}

/** Called only inside a producer's active branch. It preserves a synchronous
 * return and observes thenables without assuming a particular Promise realm. */
export let during = <T>(
  span: Span | undefined,
  run: () => T | Promise<T>,
  ok: Outcome = 'ok',
  count?: (value: T) => Counts,
): T | Promise<T> => {
  let done = (value: T): T => {
    if (span && span.active !== false) {
      span.end({ outcome: ok, counts: count?.(value) })
    }
    return value
  }
  let failed = (error: unknown): never => {
    if (span && span.active !== false) span.end({ outcome: outcome(error) })
    throw error
  }
  try {
    let value = run()
    return value && typeof (value as Promise<T>).then == 'function'
      ? (value as Promise<T>).then(done, failed)
      : done(value as T)
  } catch (error) {
    return failed(error)
  }
}
