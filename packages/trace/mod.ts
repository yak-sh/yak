/** Subscriber-owned runtime activity. A target's channel records bounded,
 * value-free events only while somebody listens; producers use peek() so the
 * unobserved path creates neither channels, events, IDs nor clocks. This module
 * depends only on the web platform, not on a graph, server or UI. */

export type Kind =
  | 'process-start'
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
  subscribe: (
    listener: (event: Event) => void,
    options?: { history?: boolean },
  ) => () => void
  history: (limit?: number) => Event[]
  begin: (activity: Activity) => Span | undefined
  instant: (activity: Activity, o?: End) => Event | undefined
}

let channels = new WeakMap<object, Channel>()
type Scope = Context & { outer?: Scope; ancestor?: string }
let scopes = new WeakMap<Span, Scope>()
let current: Scope | undefined

/** A host-provided asynchronous context carrier. The trace package remains
 * web-only; hosts may adapt AsyncLocalStorage or another task-local carrier. */
export type ContextCarrier = {
  get: () => Context | undefined
  run: <T>(ctx: Context | undefined, work: () => T) => T
}
let carrier: ContextCarrier | undefined

/** Install task-local propagation once in a host. The returned cleanup restores
 * the prior carrier, useful for isolated hosts and tests. Without a carrier,
 * scopes retain their synchronous-only behavior. Pass undefined to isolate
 * that behavior from a host-installed carrier, and restore it after the scope. */
export let installContext = (next: ContextCarrier | undefined): () => void => {
  let before = carrier
  carrier = next
  return () => {
    if (carrier == next) carrier = before
  }
}
let forwards = new WeakMap<
  Channel,
  (ctx: Context, events: readonly Event[], origin: number) => void
>()
let capacity = 256
let recordings = new WeakMap<Channel, number>()
let roots = new WeakMap<
  Channel,
  (id: string) => { parent?: string } | undefined
>()
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
  // Delivery owns a snapshot. Subscription changes replace it, so reentrant
  // delivery remains isolated without copying the listeners for every event.
  let delivery: ((event: Event) => void)[] = []
  let ring: Event[] = []
  let next = 0
  let size = 0
  let sequence = 0
  let open = new Map<
    string,
    { parent?: string; counts: Record<string, number> }
  >()
  let epoch = 0
  let historians = 0
  let emit = (event: Event): Event => {
    Object.freeze(event)
    if (historians) {
      ring[next] = event
      next = (next + 1) % capacity
      size = Math.min(size + 1, capacity)
    }
    for (let listener of delivery) {
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
  ): { -readonly [K in keyof Event]: Event[K] } => ({
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
    subscribe: (listener, options) => {
      let history = options?.history !== false
      if (history) historians++
      if (!listeners.size) {
        open.clear()
        recordings.set(out, ++epoch)
      }
      // Each subscription owns its unsubscribe, even for the same callback.
      let subscribed = (e: Event) => listener(e)
      listeners.add(subscribed)
      delivery = [...listeners]
      return () => {
        if (listeners.delete(subscribed)) {
          if (history) historians--
          delivery = [...listeners]
          if (!listeners.size) open.clear()
        }
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
      let start = performance.now()
      // Copy code metadata before delivering: a listener may mutate its caller.
      let at = context()
      let id = `${epoch}.${++sequence}`
      let root = roots.get(out)?.(id)
      a = {
        ...a,
        parent: a.parent ?? root?.parent ??
          (!root && at?.channel == out ? at.parent : undefined),
      }
      let recording = epoch
      let ended = false
      let accumulated = {
        parent: a.parent,
        counts: {} as Record<string, number>,
      }
      open.set(id, accumulated)
      let begun = event(a, id, 'start', start)
      begun.start = start
      emit(begun)
      let span: Span = {
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
          open.delete(id)
          // Normalizing counts and constructing the event belong to this
          // span's work, rather than gaps between its parent's children.
          let finished = event(a, id, 'end', 0)
          finished.start = start
          finished.outcome = o?.outcome ?? 'ok'
          finished.counts = counts(
            Object.keys(accumulated.counts).length
              ? { ...o?.counts, ...accumulated.counts }
              : o?.counts,
          )
          finished.duration = 0
          finished.time = performance.now()
          finished.duration = Math.max(0, finished.time - start)
          emit(finished)
        },
      }
      scopes.set(span, {
        channel: out,
        parent: id,
        recording,
        ancestor: a.parent,
        outer: at?.channel == out && at.parent == a.parent
          ? at as Scope
          : undefined,
      })
      return span
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
  forwards.set(out, (ctx, events, origin) => {
    if (!live(ctx) || (ctx.parent && !open.has(ctx.parent)) || !events.length) {
      return
    }
    let shift = origin - performance.timeOrigin
    let ids = new Map(events.map((e) => [e.id, `${epoch}.${++sequence}`]))
    let copied = events.map((e): Event => ({
      ...e,
      id: ids.get(e.id)!,
      parent: e.parent && ids.has(e.parent) ? ids.get(e.parent) : ctx.parent,
      time: e.time + shift,
      ...e.start != null ? { start: e.start + shift } : {},
      ...e.counts ? { counts: counts(e.counts) } : {},
    }))
    // The worker already accumulated each span's inclusive measurements. Only
    // its root charges the still-open caller; charging every child doubles it.
    if (copied[0].counts) meters.get(out)?.(ctx.parent, copied[0].counts)
    for (let e of copied) {
      if (e.stage == 'instant') emit(e)
      else {
        let {
          duration: _duration,
          outcome: _outcome,
          counts: _counts,
          ...start
        } = e
        emit({ ...start, stage: 'start', time: e.start ?? e.time })
      }
    }
    // Parents close after descendants, even when the worker's coarse clock
    // gives them identical timestamps. No local execution is being timed here.
    for (let e of copied.toReversed()) {
      if (e.stage == 'end') emit(e)
    }
  })
  meters.set(out, (id, input) => {
    let visited = new Set<string>()
    while (id && !visited.has(id)) {
      visited.add(id)
      let at = open.get(id)
      if (!at) break
      for (let [name, n] of Object.entries(input)) {
        if (Number.isFinite(n)) at.counts[name] = (at.counts[name] ?? 0) + n
      }
      id = at.parent
    }
  })
  return out
}

let meters = new WeakMap<
  Channel,
  (id: string | undefined, counts: Counts) => void
>()

/** Add measured work once to the current span and its open ancestors. Inclusive
 * totals follow parent ids rather than shared channel state, so interleaved
 * requests and siblings cannot charge each other. Nothing is kept unobserved. */
export let measure = (input: Counts): void => {
  let at = context()
  if (at) meters.get(at.channel)?.(at.parent, input)
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

/** Give another object the source's channel. Hosts use a stable source when
 * the graph it observes can be replaced; producers still use peek(target).
 * Sharing a channel creates no subscription and records no activity. */
export let shareChannel = (target: object, source: object): void => {
  channels.set(target, channel(source))
}

/** Producer entry point: never creates anything and exposes only a subscribed
 * channel. Construct activity metadata inside this branch, not before it. */
export let peek = (target?: object): Channel | undefined => {
  let found = target ? channels.get(target) : context()?.channel
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
  options?: { parent?: string; history?: boolean },
): T extends PromiseLike<unknown> ? Promise<Recorded<Awaited<T>>> : Recorded<T>
export function record<T>(
  target: object,
  run: () => T | PromiseLike<T>,
  options: { parent?: string; history?: boolean } = {},
): Recorded<T> | Promise<Recorded<T>> {
  let c = channel(target)
  let events = new Map<string, Event>()
  let root: string | undefined
  let stop = c.subscribe((e) => {
    if (e.stage == 'end' || !events.has(e.id)) events.set(e.id, e)
  }, { history: options.history })
  let before = roots.get(c)
  // Nominate before delivery: another subscriber can reenter the producer
  // before this recorder receives the original root's start event.
  roots.set(c, (id) => {
    let nominated = root == null
    root ??= id
    before?.(id)
    return nominated ? { parent: options.parent } : undefined
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

/** The subscribed context on this call stack or the host's optional task-local
 * carrier. Without a carrier, asynchronous boundaries restore it explicitly. */
export let context = (ancestor?: string): Context | undefined => {
  let active = (carrier?.get() ?? current) as Scope | undefined
  if (!active || !live(active)) return
  if (!ancestor) return active
  for (let at: Scope | undefined = active; at; at = at.outer) {
    if (at.parent == ancestor || at.ancestor == ancestor) return active
  }
}

/** Run under an operation's context, restoring the caller even on failure.
 * A host-installed carrier also keeps the operation's asynchronous work local. */
export let scope = <T>(ctx: Context | undefined, run: () => T): T => {
  let scoped = () => {
    let before = current
    current = ctx
    try {
      return run()
    } finally {
      current = before
    }
  }
  return carrier ? carrier.run(ctx, scoped) : scoped()
}

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
export function during<T>(
  span: Span | undefined,
  run: () => T,
  ok?: Outcome,
  count?: (value: Awaited<T>) => Counts,
): T
export function during<T>(
  span: Span | undefined,
  run: () => T | Promise<T>,
  ok: Outcome = 'ok',
  count?: (value: T) => Counts,
): T | Promise<T> {
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
    let value = span ? scope(scopes.get(span), run) : run()
    return value && typeof (value as Promise<T>).then == 'function'
      ? (value as Promise<T>).then(done, failed)
      : done(value as T)
  } catch (error) {
    return failed(error)
  }
}

/** Import a recorded child tree from a worker into its waiting caller. IDs are
 * reminted on the caller's channel, clocks are translated from the worker's
 * performance.timeOrigin, and inclusive root counts charge the caller once.
 * A disconnected recording or a caller that already ended receives nothing. */
export let forward = (
  ctx: Context,
  events: readonly Event[],
  origin: number = performance.timeOrigin,
): void => forwards.get(ctx.channel)?.(ctx, events, origin)
