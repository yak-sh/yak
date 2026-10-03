// One Durable Object is one tracker graph. Boot is retried on each wake; a
// failed installation never leaves a permanently rejected constructor promise.

import {
  type DurableStorage,
  type Hibernation,
  type Sockets,
  sockets,
  storage,
  type Wire,
} from '@yaks/durable-object'
import { subscriptions } from '@yaks/api'
import { caught, queue, type Sink } from '@yaks/tracker/report'
import { options, platform, store, type TrackerStore, vocab } from './core.ts'
import { batch } from './queue.ts'
import { door, json } from './door.ts'
import { authorize } from './auth.ts'
import { monitor } from './monitor.ts'
import type { Bundle } from '@yaks/graph'

export type State = Hibernation & {
  id: { name?: string }
  storage: DurableStorage & {
    setAlarm: (at: number) => Promise<void>
    get: <T>(key: string) => Promise<T | undefined>
    put: (key: string, value: unknown) => Promise<void>
  }
}
export type Settings = {
  TRACKER_SECRET?: string
  ERRORS?: { send: (rows: Bundle[]) => Promise<void> }
  MAIL?: {
    send: (
      letter: {
        from: string
        to: string
        subject: string
        text: string
        html: string
      },
    ) => Promise<{ messageId?: string }>
  }
  MAIL_FROM?: string
  MAIL_TO?: string
}
export class Tracker {
  tracker?: TrackerStore
  live?: Sockets
  scope: string
  sink: Sink
  constructor(public ctx: State, public env: Settings = {}) {
    this.scope = ctx.id.name ?? platform
    this.sink = env.ERRORS
      ? queue(env.ERRORS)
      : (rows) => console.error(JSON.stringify(rows))
  }
  boot = async () => {
    if (this.tracker) return this.tracker
    let saved = storage(this.ctx.storage, vocab, options)
    saved.install()
    let tracker = store(saved, {
      sink: this.sink,
      store: this.scope,
      ...this.scope == platform && this.env.MAIL_TO
        ? {
          to: platform,
          from: this.env.MAIL_FROM,
        }
        : {},
      ...this.env.MAIL
        ? {
          sender: {
            send: async (m) => {
              let sent = await this.env.MAIL!.send(m)
              return { id: sent.messageId }
            },
          },
        }
        : {},
    })
    if (this.scope == platform && this.env.MAIL_TO) {
      await tracker.graph.apply([{
        entity: { eid: platform },
        email: { address: this.env.MAIL_TO },
      }], { trusted: true })
    }
    this.live = sockets(subscriptions(tracker.graph), this.ctx)
    this.tracker = tracker
    return tracker
  }
  recover = async (error: unknown) => {
    await caught(error, { sink: this.sink })
    try {
      await this.ctx.storage.setAlarm(Date.now() + 1000)
    } catch { /* next queue delivery retries */ }
  }
  ingest = async (rows: Bundle[]): Promise<void> => {
    if (batch(rows).scope != this.scope) {
      throw Error('tracker intake scope mismatch')
    }
    try {
      let tracker = await this.boot()
      await this.live?.wake()
      await tracker.ingest(rows)
      await this.ctx.storage.setAlarm(Date.now() + 1000)
    } catch (error) {
      await this.recover(error)
      throw error
    }
  }
  fetch = async (request: Request): Promise<Response> => {
    try {
      let access = await authorize(request, this.env.TRACKER_SECRET, this.scope)
      if (!access) return json({ error: 'tracker scope denied' }, 403)
      if (
        new URL(request.url).pathname == '/heartbeat' &&
        request.method == 'POST'
      ) {
        if (this.scope != platform || !access.admin) {
          return json({ error: 'platform only' }, 403)
        }
        await this.ctx.storage.put('heartbeat', Date.now())
        return json({ ok: true })
      }
      let tracker = await this.boot()
      await this.live?.wake()
      return await door(
        tracker,
        this.scope,
        this.env.TRACKER_SECRET,
        (request) => this.live!.accept(request),
      )(request)
    } catch (error) {
      await this.recover(error)
      return json({ error: 'tracker temporarily unavailable' }, 503)
    }
  }
  monitor = async () => {
    try {
      let tracker = await this.boot()
      await monitor(tracker, await this.ctx.storage.get<number>('heartbeat'))
      await this.ctx.storage.setAlarm(Date.now() + 1000)
    } catch (error) {
      await this.recover(error)
    }
  }
  alarm = async () => {
    try {
      let tracker = await this.boot()
      await this.live?.wake()
      await tracker.drain()
      // Wakes and retryable effects must progress even without new reports.
      let pending = await tracker.graph.read('.effect.state=pending .limit=1')
      let wakes = await tracker.graph.read('.wake.at>0 .limit=1')
      if (pending.length || wakes.length) {
        await this.ctx.storage.setAlarm(Date.now() + 1000)
      }
    } catch (error) {
      await this.recover(error)
    }
  }
  webSocketMessage = async (ws: Wire, data: string | ArrayBuffer) => {
    try {
      await this.boot()
      let frame = JSON.parse(
        typeof data == 'string' ? data : new TextDecoder().decode(data),
      )
      // The box subscribes here; arbitrary graph writes are not a tracker RPC.
      if (
        !('subscribe' in frame) && !('unsubscribe' in frame) &&
        !('ack' in frame)
      ) {
        ws.send(
          JSON.stringify({
            id: frame.id,
            error: 'tracker sockets are read only',
          }),
        )
        return
      }
      await this.live?.message(ws, data)
    } catch (error) {
      await this.recover(error)
    }
  }
  webSocketClose = (ws: Wire) => this.live?.close(ws)
}
