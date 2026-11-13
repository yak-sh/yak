/**
 * The one Durable Object class: an object whose graph is opened from a
 * {@link Spec}, served at its door, followed live over its sockets, and
 * worked on its own time by one alarm (`./alarm.ts`).
 *
 * The platform requires a class, so this is one; what differs between kinds
 * of object is data, the spec, which a subclass hands to `super`:
 *
 * - `open` composes what the object holds, once an instance: its door, the
 *   subscriptions its sockets serve, and the works its alarm runs. One that
 *   fails is opened again by the next entry; a failed open never leaves the
 *   object rejecting every call.
 * - Every entry (`fetch`, `alarm`, a socket's frame) opens first and wakes
 *   the sockets the object inherited from hibernation, so a write made by the
 *   request that woke it reaches them.
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
 *     super(ctx, () => ({
 *       open: () => Promise.resolve({ serve: () => new Response('hello') }),
 *       report: (e) => console.error(e),
 *     }))
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

import { refuse, type Subs } from '@yaks/api'
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
import {
  type Hibernation,
  type Sockets,
  sockets,
  type Wire,
} from './sockets.ts'
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
   * the object's {@link Durable.accept}, after whatever the door checks. */
  serve(request: Request): Response | Promise<Response>
  /** The subscriptions its sockets serve; without them it takes none. */
  subs?: Subs
  /** What its alarm works, in order (`./alarm.ts`). */
  works?: Record<string, Work>
  /** A frame from one of its sockets: the sockets' own `message` unless the
   * object reads frames first. */
  frame?(ws: Wire, data: string | ArrayBuffer): unknown
}

/** What makes one kind of object. */
export type Spec = {
  /** Compose what the object holds, once an instance. */
  open(): Promise<Opened>
  /** A failure the object caught, by the entry it was caught in. */
  report(error: unknown, entry: string): unknown
  /** The row ceiling's options; refusing by default. */
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
  #made: (object: Durable) => Spec
  #spec?: Spec
  #ceiling?: Ceiling
  #clock?: Clock
  #opened?: Promise<Opened>
  #held?: Opened
  #live?: Sockets
  #restarted = false

  /** `spec` is asked for once, at the object's first entry, so a subclass's
   * spec may name the subclass's own members. */
  constructor(ctx: State, spec: (object: Durable) => Spec) {
    this.ctx = ctx
    this.#made = spec
  }

  /** What makes this object. */
  get spec(): Spec {
    return this.#spec ??= this.#made(this)
  }

  /** The object's row ceiling, made at its first statement through the
   * object. A subclass that opens a driver of its own before (`open` is the
   * object's) names its ceiling first, with `this.ceiling` at the end of its
   * constructor: every driver counts against the ceiling made first. */
  get ceiling(): Ceiling {
    return this.#ceiling ??= bounded(this.ctx.storage, {
      refuse: true,
      ...this.spec.ceiling,
    })
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
    this.#opened ??= this.spec.open().then((opened) => {
      this.ceiling
      if (opened.subs) this.#live = sockets(opened.subs, this.ctx)
      return this.#held = opened
    }, (e) => {
      this.#opened = undefined
      throw e
    })
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
    return this.#around(`${request.method} ${pathname}`, async () => {
      try {
        return await (await this.open()).serve(request)
      } catch (error) {
        if (stopped(error)) return refuse(error)
        await this.spec.report(error, 'fetch')
        await this.#later(1000)
        return Response.json({ error: 'temporarily unavailable' }, {
          status: 503,
        })
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

  /** A frame from one of the object's sockets. */
  webSocketMessage(ws: Wire, data: string | ArrayBuffer): Promise<void> {
    return this.#around('socket', async () => {
      try {
        let opened = await this.open()
        await (opened.frame
          ? opened.frame(ws, data)
          : this.#live?.message(ws, data))
      } catch (error) {
        await this.spec.report(error, 'webSocketMessage')
      }
    })
  }

  /** One of its sockets went away. */
  webSocketClose(ws: Wire): void | Promise<void> {
    return this.#live?.close(ws)
  }
}
