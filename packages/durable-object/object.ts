/**
 * The one Durable Object class: an object whose graph is opened from a
 * {@link Spec}, served at its door, followed live over its sockets, and
 * worked on its own time by one alarm (`./alarm.ts`).
 *
 * The platform requires a class, so this is one; what differs between kinds
 * of object is data, the spec. A subclass hands it to `super`, or answers
 * it from `specify()` where it names the subclass's own members:
 *
 * - `open` composes what the object holds, once an instance: its door, the
 *   subscriptions its sockets serve, and the works its alarm runs. One that
 *   fails is opened again by the next entry; a failed open never leaves the
 *   object rejecting every call.
 * - Every entry (`fetch`, `alarm`, a socket's frame, and a subclass's own
 *   through `enter`, such as an RPC method) opens first and wakes the sockets
 *   the object inherited from hibernation, so a write made by the request
 *   that woke it reaches them. A failure is reported, by its entry.
 * - The object's row ceiling (`./ceiling.ts`) is made before any statement,
 *   with the spec's report. A door's statement past a window is answered as
 *   `Stopped` with how long to wait; an alarm past one rings again then.
 * - A new deploy restarts the object idle: nothing runs at the first entry on
 *   a new `version` but arming the alarm, which takes up what is owed.
 *
 * ```ts
 * import { Durable, type State } from '@yaks/durable-object/object'
 * import { assertEquals } from '@std/assert'
 *
 * class Hello extends Durable {
 *   constructor(ctx: State) {
 *     super(ctx, {
 *       open: () => Promise.resolve({ serve: () => new Response('hello') }),
 *       report: (e) => console.error(e),
 *     })
 *   }
 * }
 * // The runtime's own state; a door that reads nothing needs none of it.
 * let ctx = { storage: {} } as State
 * let answer = await new Hello(ctx).fetch(new Request('https://do/'))
 * assertEquals(await answer.text(), 'hello')
 * ```
 * ```
 *
 * @module
 */

import { refuse } from '@yaks/api/refuse'
import type { Subs } from '@yaks/api'
import {
  type Alarms,
  type Clock,
  clock,
  type Options as Timing,
  type Work,
} from './alarm.ts'
import {
  bounded,
  type Ceiling,
  type Kv,
  type Options as Limits,
  stopped,
} from './ceiling.ts'
import type { Hibernation, Sockets, Wire } from './sockets.ts'
import type { DurableStorage } from './sql.ts'

/** The slice of `DurableObjectState` the class uses. */
export type State = Hibernation & {
  id?: { name?: string }
  storage: DurableStorage & Alarms & { kv?: Kv }
  waitUntil?(work: Promise<unknown>): void
}

/** What an object opened: its door, its subscriptions and its works. */
export type Opened = {
  /** Every request the object is sent. A socket is accepted here, through
   * the object's {@link Durable.accept}, after whatever the door checks. An
   * object with no door, called only through its own entries, answers every
   * request 404. */
  serve?(request: Request): Response | Promise<Response>
  /** The subscriptions its sockets serve; without them it takes none. */
  subs?: Subs
  /** What its alarm works, in order (`./alarm.ts`). */
  works?: Record<string, Work>
  /** Whether the object takes a socket's frame or close now. One it does
   * not is let go unanswered, before anything is asked of its sockets, a
   * clock probe included. */
  admit?(ws: Wire): boolean | Promise<boolean>
  /** The sockets serving now, where the object makes its own over
   * subscriptions it remakes (`subs` makes them once), asked once a frame or
   * close is admitted and a clock probe answered. None hangs a frame's
   * socket up: the page must open another. */
  live?(): Sockets | undefined | Promise<Sockets | undefined>
  /** A frame from one of its sockets, given `take`, the sockets' own reading
   * of it, which answers whether they took it: the object reads frames
   * itself, or around them. */
  frame?(
    ws: Wire,
    data: string | ArrayBuffer,
    take: () => Promise<boolean>,
  ): unknown
}

/** What makes one kind of object. */
export type Spec = {
  /** Compose what the object holds, once an instance, given the object: its
   * state, its clock and its ceiling; nothing by default. */
  open?(object: Durable): Promise<Opened>
  /** A failure the object caught, by the entry it was caught in. */
  report(error: unknown, entry: string): unknown
  /** The row ceiling's options, refusing by default. Without them the
   * object counts against the ceiling its storage already has: the one named
   * first, or one that reports and refuses nothing. */
  ceiling?: Limits
  /** The alarm's timing (`./alarm.ts`). */
  alarm?: Pick<Timing, 'slice' | 'backstop' | 'retry' | 'keep' | 'now'>
  /** The deploy the object runs, whose first entry arms the alarm. */
  version?: string
  /** Each entry's work, run inside what the object measures it by. */
  around?<T>(entry: string, work: () => Promise<T>): Promise<T>
}

// Where the deploy an object last ran is kept, in its synchronous kv.
let VERSION = '@yaks/durable-object:version'

/** One Durable Object, of the kind its spec makes. */
export class Durable {
  /** The object's own state: its storage and its sockets. */
  readonly ctx: State
  #spec?: Spec
  #ceiling?: Ceiling
  #clock?: Clock
  #opened?: Promise<Opened>
  #held?: Opened
  #live?: Sockets
  #restarted = false

  /** Without a `spec`, the object asks its `specify()` for one. */
  constructor(ctx: State, spec?: Spec) {
    this.ctx = ctx
    this.#spec = spec
  }

  /** What makes this kind of object, asked once, at the object's first
   * entry or its ceiling: a subclass whose spec names its own members
   * answers it here. */
  protected specify(): Spec {
    throw new Error(`${this.constructor.name} has no spec`)
  }

  /** What makes this object. */
  get spec(): Spec {
    return this.#spec ??= this.specify()
  }

  /** The object's row ceiling, made at its first statement through the
   * object. A subclass that opens a driver of its own before (`open` is the
   * object's) names its ceiling first, with `this.ceiling` at the end of its
   * constructor: every driver counts against the ceiling made first. */
  get ceiling(): Ceiling {
    let named = this.spec.ceiling
    return this.#ceiling ??= named
      ? bounded(this.ctx.storage, { refuse: true, ...named })
      : bounded(this.ctx.storage)
  }

  /** The object's alarm: a write that owes work arms it. */
  get clock(): Clock {
    return this.#clock ??= clock(
      this.ctx.storage,
      () => this.#held?.works ?? {},
      {
        wait: () => this.ceiling.stopped(true),
        report: (e, work) => this.spec.report(e, `alarm ${work}`),
        ...this.spec.alarm,
      },
    )
  }

  /** The object's sockets, once it has opened subscriptions. */
  get live(): Sockets | undefined {
    return this.#live
  }

  /** What the object holds, opened once an instance; its sockets woken. */
  async open(): Promise<Opened> {
    let open = this.spec.open ?? (() => Promise.resolve<Opened>({}))
    this.#opened ??= open(this).then(
      async (opened) => {
        this.ceiling
        // The sockets' plumbing is loaded only by an object that has some.
        if (opened.subs) {
          let { sockets } = await import('./sockets.ts')
          this.#live = sockets(opened.subs, this.ctx)
        }
        return this.#held = opened
      },
      (e) => {
        this.#opened = undefined
        throw e
      },
    )
    let opened = await this.#opened
    await this.#live?.wake()
    await this.#restart()
    return opened
  }

  // The first entry on a new deploy arms the alarm, once an instance.
  async #restart() {
    let { version } = this.spec, kv = this.ctx.storage.kv
    if (this.#restarted || !version || !kv) return
    this.#restarted = true
    if (kv.get(VERSION) == version) return
    kv.put(VERSION, version)
    await this.clock.arm(this.spec.alarm?.now?.() ?? Date.now())
  }

  #around<T>(entry: string, work: () => Promise<T>): Promise<T> {
    return this.spec.around ? this.spec.around(entry, work) : work()
  }

  /** A socket for this object's subscriptions: the door's to call. */
  accept(...args: Parameters<Sockets['accept']>): Response {
    if (!this.#live) throw new Error('this object serves no subscriptions')
    return this.#live.accept(...args)
  }

  /** A request: the door's answer, `Stopped`'s with how long to wait, or a
   * 503 for a failure the door did not answer, which is reported. */
  fetch(request: Request): Promise<Response> {
    let { pathname } = new URL(request.url)
    return this.#enter(
      `${request.method} ${pathname}`,
      'fetch',
      (opened) =>
        opened.serve
          ? opened.serve(request)
          : Response.json({ error: 'not found' }, { status: 404 }),
    ).catch((error) =>
      stopped(error)
        ? refuse(error)
        : Response.json({ error: 'temporarily unavailable' }, { status: 503 })
    )
  }

  /** An entry of the subclass's own, such as an RPC method: `work`, given
   * what the object opened, inside `around` as `entry`. What it throws is
   * thrown on to its caller, and a failure other than the ceiling's
   * `Stopped` is reported by `entry` first, as a request's is. */
  protected enter<T>(
    entry: string,
    work: (opened: Opened) => T | Promise<T>,
  ): Promise<T> {
    return this.#enter(entry, entry, work)
  }

  // An entry, named `name` to `around` and `entry` to `report`: opened, its
  // sockets woken, and a failure reported, with the alarm a second on to
  // take up what the object owes.
  #enter<T>(
    name: string,
    entry: string,
    work: (opened: Opened) => T | Promise<T>,
  ): Promise<T> {
    return this.#around(name, async () => {
      try {
        return await work(await this.open())
      } catch (error) {
        if (!stopped(error)) {
          await this.spec.report(error, entry)
          await this.#later(1000)
        }
        throw error
      }
    })
  }

  /** The runtime's clock going off: one slice of every work. */
  alarm(): Promise<void> {
    return this.#around('alarm', async () => {
      let wait = this.ceiling.stopped(true)
      if (wait) return await this.#later(wait)
      try {
        await this.open()
      } catch (error) {
        if (stopped(error)) return await this.#later(error.retry.after)
        await this.spec.report(error, 'alarm')
        return await this.#later(this.spec.alarm?.retry ?? 60_000)
      }
      await this.clock.ring()
    })
  }

  // The alarm `ms` from now, or sooner where it stands so.
  #later(ms: number): Promise<void> {
    let now = this.spec.alarm?.now?.() ?? Date.now()
    return this.clock.arm(now + ms).catch((e) => {
      this.spec.report(e, 'arm')
    })
  }

  // What a socket's entry finds: what the object opened, if it takes the
  // socket now.
  async #admitted(ws: Wire): Promise<Opened | undefined> {
    let opened = await this.open()
    if (!opened.admit || await opened.admit(ws)) return opened
  }

  // The sockets serving now.
  #sockets(opened: Opened) {
    return opened.live ? opened.live() : this.#live
  }

  /** A frame from one of the object's sockets. A clock probe is answered
   * once the frame is admitted, before the sockets are asked; each frame
   * they read runs inside `around`, as `ws <kind>`. */
  webSocketMessage(ws: Wire, data: string | ArrayBuffer): void | Promise<void> {
    let received = Date.now()
    return this.#around('socket', async () => {
      try {
        let opened = await this.#admitted(ws)
        if (!opened) return
        let { probed } = await import('./sockets.ts')
        if (probed(ws, data, received)) return
        let take = async () => {
          let live = await this.#sockets(opened)
          if (!live) return hangUp(ws)
          await live.message(
            ws,
            data,
            (kind, work) =>
              this.#around(`ws ${kind}`, async () => await work()),
          )
          return true
        }
        await (opened.frame ? opened.frame(ws, data, take) : take())
      } catch (error) {
        await this.spec.report(error, 'webSocketMessage')
      }
    })
  }

  /** One of its sockets went away. */
  webSocketClose(ws: Wire): void | Promise<void> {
    return this.#around('socket close', async () => {
      try {
        let opened = await this.#admitted(ws)
        if (opened) await (await this.#sockets(opened))?.close(ws)
      } catch (error) {
        await this.spec.report(error, 'webSocketClose')
      }
    })
  }

  /** One of its sockets failed, which is it going away. */
  webSocketError(ws: Wire, _error: unknown): void | Promise<void> {
    return this.webSocketClose(ws)
  }
}

// A socket the object will not serve, closed for the page to open another:
// it was not taken.
let hangUp = (ws: Wire) => {
  try {
    ws.close?.(1012, 'refused')
  } catch { /* already gone */ }
  return false
}
