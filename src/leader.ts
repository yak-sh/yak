// One browser, one sync owner. Every tab queues for the same Web Lock; its
// holder owns the socket, while BroadcastChannel carries canonical frames
// out, follower writes back, and full subscription ownership snapshots flow
// both ways. The lock callback is the lease: destroying its page releases it
// and promotes the next queued tab.

export type Lock = {
  request: (name: string, hold: () => Promise<void>) => Promise<void>
}

export type Message<T> =
  | { kind: 'ready' }
  | { kind: 'hello' }
  | { kind: 'frame'; frame: T }
  | { kind: 'out'; id: string; frame: T }
  | { kind: 'sent'; id: string }
  | { kind: 'owned'; tab: string; uses: Use[] }

export type Use = { name: string; value: string; rev: number }

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
  subscribe?: (name: string, value: string) => void
  unsubscribe?: (name: string) => void
  forget?: (name: string) => void
}

let forever = () => new Promise<void>(() => {})
let PULSE = 30_000
let STALE = 180_000

// Hidden tabs may wake only once a minute. A 30-second pulse with a three-
// minute lease tolerates throttling; abrupt owner loss lingers at most 3m.
export let stale = (seen: number, now = Date.now()) => now - seen > STALE

export let topology = <T>(
  locks: Lock,
  bus: Channel<T>,
  io: IO<T>,
  key: () => string = () => crypto.randomUUID(),
  hold = forever,
) => {
  let tab = key()
  let leader = false
  let serving = false
  let standalone = false
  let landed = false
  let landing: Promise<void> | null = null
  let inbox: T[] = []
  let pending = new Map<string, T>()
  let mine = new Map<string, Use>()
  let peers = new Map<string, { seen: number; uses: Use[] }>()
  let present = new Set<string>()
  let installed = new Map<string, string>()
  let clock = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let resolve: () => void
  let ready = new Promise<void>((r) => resolve = r)

  let announce = () =>
    bus.postMessage({ kind: 'owned', tab, uses: [...mine.values()] })

  let wanted = () => {
    let tabs: [string, Use[]][] = [[tab, [...mine.values()]]]
    if (!standalone) {
      tabs.push(
        ...[...peers].map(([id, state]): [string, Use[]] => [id, state.uses]),
      )
    }
    let found = new Map<string, { tab: string; use: Use }>()
    for (let [id, uses] of tabs) {
      for (let use of uses) {
        let old = found.get(use.name)
        if (
          !old || use.rev > old.use.rev ||
          (use.rev == old.use.rev && id > old.tab)
        ) found.set(use.name, { tab: id, use })
      }
    }
    // Return the winning PICK per name, not just its value: settle() needs to
    // know WHO owns each name and at what rev, not only what to install.
    return found
  }

  // A subscription's owner identity: which tab holds the name, at which rev,
  // for which query. Because a value can only change through a fresh use()
  // (which bumps rev), this token moves exactly when a new tab takes the name
  // or the query itself moves — and stays put across the unchanged 30s
  // ownership pulses. That makes it the trigger for a one-shot refresh.
  let token = (pick: { tab: string; use: Use }) =>
    `${pick.tab}#${pick.use.rev}:${pick.use.value}`

  let settle = (force = false) => {
    let next = wanted()
    for (let name of present) {
      if (!next.has(name)) io.forget?.(name)
    }
    present = new Set(next.keys())
    if (!(standalone || (leader && (serving || force)))) return
    for (let name of installed.keys()) {
      if (!next.has(name)) io.unsubscribe?.(name)
    }
    for (let [name, pick] of next) {
      // Subscribe on a new name, a moved query, OR a new owning tab. The last
      // is the fix for T-16854: a follower opening an already-installed
      // subscription (a shared Session partition) must be replayed the current
      // set, not just future deltas, or its log renders empty forever. The
      // server answers a repeat subscribe with a fresh `replace` frame, which
      // fans through the normal landing path to every tab. The owner token is
      // stable across pulses, so an unchanged pulse refreshes nothing.
      if (installed.get(name) != token(pick)) {
        io.subscribe?.(name, pick.use.value)
      }
    }
    installed = new Map([...next].map(([name, pick]) => [name, token(pick)]))
  }

  let pulse = () => {
    announce()
    let now = Date.now()
    for (let [id, state] of peers) {
      if (stale(state.seen, now)) peers.delete(id)
    }
    settle()
  }

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
      announce()
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
    } else if (data.kind == 'owned' && data.tab != tab) {
      for (let use of data.uses) clock = Math.max(clock, use.rev)
      peers.set(data.tab, { seen: Date.now(), uses: data.uses })
      settle()
    }
  }

  // cede() resolves the CURRENT lease from inside (T-21523): a leader about to
  // be frozen steps down deliberately, the lock manager promotes the next
  // queued tab, and this tab is a plain follower when it thaws. seek() is the
  // way back — re-queue for the lock, usually behind the tab promoted
  // meanwhile. `seeking` spans queued-through-holding, so a follower whose
  // original request still waits never double-queues.
  let vacate: (() => void) | null = null
  let seeking = false

  let lead = async () => {
    leader = true
    if (landing) await landing
    await io.lead()
    if (!landed) finish()
    settle(true)
    serving = true
    bus.postMessage({ kind: 'ready' })
    flush()
    await Promise.race([hold(), new Promise<void>((r) => vacate = r)])
    vacate = null
    serving = false
    leader = false
    seeking = false
    installed.clear()
  }

  let seek = () => {
    if (leader || seeking || standalone) return
    seeking = true
    locks.request('tasks-sync', lead).catch(async () => {
      leader = false
      serving = false
      await io.solo()
      standalone = true
      peers.clear()
      settle(true)
      if (!landed) finish()
    })
  }

  let start = () => {
    seek()
    if (io.subscribe || io.unsubscribe) timer = setInterval(pulse, PULSE)
    announce()
    bus.postMessage({ kind: 'hello' })
    return ready
  }

  // An acked delivery (live.ts outbox) passes its own stable id so a RETRY of
  // the same frame replaces its pending entry instead of queueing a duplicate;
  // anything else gets a fresh key per call, as before.
  let route = (frame: T, id = key()) => {
    if (standalone || (leader && serving)) return io.send(frame)
    pending.set(id, frame)
    bus.postMessage({ kind: 'out', id, frame })
  }

  let use = (name: string, value: string) => {
    if (mine.get(name)?.value == value) return
    let rev = ++clock
    mine.set(name, { name, value, rev })
    announce()
    settle()
  }

  let drop = (name: string) => {
    if (!mine.delete(name)) return
    announce()
    settle()
  }

  let leave = () => {
    mine.clear()
    announce()
    settle()
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }

  let fan = (frame: T) => {
    if (leader && serving) bus.postMessage({ kind: 'frame', frame })
  }

  return {
    cede: () => vacate?.(),
    fan,
    drop,
    isLeader: () => leader && serving,
    isSolo: () => standalone,
    leave,
    route,
    seek,
    start,
    use,
  }
}
