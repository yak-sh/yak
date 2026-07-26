// One browser, one sync owner. Every tab queues for the same Web Lock; its
// holder owns the socket, while BroadcastChannel carries canonical frames
// out and follower writes back. The lock callback is the lease: destroying
// its page releases it and promotes the next queued tab.

export type Lock = {
  request: (name: string, hold: () => Promise<void>) => Promise<void>
}

export type Message<T> =
  | { kind: 'ready' }
  | { kind: 'hello' }
  | { kind: 'frame'; frame: T }
  | { kind: 'out'; id: string; frame: T }
  | { kind: 'sent'; id: string }

export type Channel<T> = {
  onmessage: ((event: { data: Message<T> }) => void) | null
  postMessage: (message: Message<T>) => void
}

export type IO<T> = {
  lead: () => Promise<void>
  follow: () => Promise<void>
  solo: () => Promise<void>
  receive: (frame: T) => void
  send: (frame: T) => void
}

let forever = () => new Promise<void>(() => {})

export let topology = <T>(
  locks: Lock,
  bus: Channel<T>,
  io: IO<T>,
  key: () => string = () => crypto.randomUUID(),
  hold = forever,
) => {
  let leader = false
  let serving = false
  let standalone = false
  let landed = false
  let landing: Promise<void> | null = null
  let inbox: T[] = []
  let pending = new Map<string, T>()
  let resolve: () => void
  let ready = new Promise<void>((r) => resolve = r)

  let finish = () => {
    landed = true
    for (let frame of inbox.splice(0)) io.receive(frame)
    resolve()
  }

  let follow = () => {
    if (landed || landing) return landing ?? Promise.resolve()
    return landing = io.follow().then(finish)
  }

  let sent = (id: string, frame: T) => {
    io.send(frame)
    pending.delete(id)
    bus.postMessage({ kind: 'sent', id })
  }

  let flush = () => {
    for (let [id, frame] of pending) sent(id, frame)
  }

  bus.onmessage = ({ data }) => {
    if (data.kind == 'hello') {
      if (leader && serving) bus.postMessage({ kind: 'ready' })
    } else if (data.kind == 'ready') {
      if (!leader) follow()
    } else if (data.kind == 'frame') {
      if (landed) io.receive(data.frame)
      else inbox.push(data.frame)
    } else if (data.kind == 'out') {
      pending.set(data.id, data.frame)
      if (leader && serving) sent(data.id, data.frame)
    } else if (data.kind == 'sent') {
      pending.delete(data.id)
    }
  }

  let lead = async () => {
    leader = true
    if (landing) await landing
    await io.lead()
    if (!landed) finish()
    serving = true
    bus.postMessage({ kind: 'ready' })
    flush()
    await hold()
    serving = false
    leader = false
  }

  let start = () => {
    locks.request('tasks-sync', lead).catch(async () => {
      leader = false
      serving = false
      await io.solo()
      standalone = true
      if (!landed) finish()
    })
    bus.postMessage({ kind: 'hello' })
    return ready
  }

  let route = (frame: T) => {
    if (standalone || (leader && serving)) return io.send(frame)
    let id = key()
    pending.set(id, frame)
    bus.postMessage({ kind: 'out', id, frame })
  }

  let fan = (frame: T) => {
    if (leader && serving) bus.postMessage({ kind: 'frame', frame })
  }

  return {
    fan,
    isLeader: () => leader && serving,
    isSolo: () => standalone,
    route,
    start,
  }
}
