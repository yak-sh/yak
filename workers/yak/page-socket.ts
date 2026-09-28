// One page socket over the app store and every component home it uses. Each
// source's raw change feed invalidates the page's own query; the answer is
// read through page-graph, where ownership and cross-store composition live.
// A lost source closes the page socket so @yaks/sync reconnects and refills.
import { type Frame, queue, refusal } from '@yaks/api'
import { workerUpgrade } from '@yaks/workerd'
import { type App, appStore, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { reading, sources } from './page-graph.ts'
import { caught } from './sentry.ts'
import { vouched, type Who } from './session.ts'

type Socket = {
  readyState: number
  accept(): void
  send(data: string): void
  close(): void
  addEventListener(
    type: string,
    fn: (e: Event & { data?: unknown }) => void,
  ): void
}

let opened = (socket: Socket) =>
  new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () =>
      reject(new Error('source socket failed')))
    socket.addEventListener('close', () =>
      reject(new Error('source socket closed')))
    socket.accept()
    if (socket.readyState == 1) {
      resolve()
    }
  })

let linked = async (
  req: Request,
  env: Env,
  space: Space,
  app: App,
  who: Who,
) => {
  let res = await appStore(env.STORE, space, app, env)(
    '/ws',
    req,
    vouched(who),
  ) as Response & { webSocket?: Socket | null }
  if (res.status != 101 || !res.webSocket) {
    await res.body?.cancel()
    return null
  }
  return res.webSocket
}

export let pageSocket = async (
  req: Request,
  env: Env,
  space: Space,
  app: App,
  graph: Awaited<ReturnType<typeof sources>>,
) => {
  let links: (Socket | null)[] = []
  try {
    for (let r of graph.reach) {
      let link = await linked(req, env, r.space, r.app, r.who)
      links.push(link)
      if (link) await opened(link)
    }
    if (!links[0]) throw new Error('app socket unavailable')
  } catch (error) {
    for (let link of links) link?.close()
    throw error
  }
  let { socket, response } = workerUpgrade(req)
  let front = socket as Socket
  let out = queue(front, undefined, () => front.readyState == 1)
  let subs = new Map<string, { line: string | true; version: number }>()
  let closed = false

  let refresh = (id: string) => {
    let sub = subs.get(id)
    if (!sub || sub.line === true) return
    let version = ++sub.version
    reading(env, graph, sub.line).then(
      (answer) => {
        if (subs.get(id)?.version != version || closed) return
        let frame = Array.isArray(answer)
          ? { id, bundles: answer, reset: true }
          : { id, ...answer as Record<string, unknown> }
        out.send(frame as Frame)
      },
      (error) => {
        if (subs.get(id)?.version != version || closed) return
        caught(error, {
          request: 'page socket',
          space: space.slug,
          app: app.slug,
        })
        out.send({ id, refused: refusal(error) })
      },
    )
  }
  let changed = () => {
    for (let id of subs.keys()) refresh(id)
  }
  let close = () => {
    if (closed) return
    closed = true
    out.close()
    for (let link of links) link?.close()
    front.close()
  }

  for (let [index, link] of links.entries()) {
    if (!link) continue
    link.addEventListener('message', (e) => {
      let frame: Frame
      try {
        frame = JSON.parse(String(e.data)) as Frame
      } catch (error) {
        caught(error, {
          request: 'page source',
          space: space.slug,
          app: app.slug,
        })
        return
      }
      if (frame.refused) {
        close()
        return
      }
      if (index == 0) {
        for (let [id, sub] of subs) {
          if (sub.line === true) out.send({ ...frame, id })
        }
      }
      changed()
    })
    link.addEventListener('close', close)
  }
  for (let link of links) {
    link?.send(JSON.stringify({ subscribe: true, id: 'page' }))
  }

  front.addEventListener('open', out.flush)
  front.addEventListener('close', close)
  front.addEventListener('message', (e) => {
    try {
      let msg = JSON.parse(String(e.data)) as {
        id?: string
        subscribe?: string | true
        unsubscribe?: string
        ack?: string
        acks?: boolean
        relay?: unknown[]
      }
      if (typeof msg.ack == 'string') return out.ack(msg.ack)
      if (msg.acks === true) out.enable()
      if (typeof msg.subscribe == 'string' || msg.subscribe === true) {
        let id = String(msg.id ?? '')
        subs.set(id, { line: msg.subscribe, version: 0 })
        refresh(id)
        return
      }
      if (msg.unsubscribe != null) {
        subs.delete(String(msg.unsubscribe))
        return
      }
      if (Array.isArray(msg.relay)) {
        links[0]?.send(JSON.stringify({ relay: msg.relay }))
        return
      }
      throw new SyntaxError('expected {subscribe}, {unsubscribe} or {relay}')
    } catch (error) {
      out.send({ id: '', refused: refusal(error) })
    }
  })
  return response
}
