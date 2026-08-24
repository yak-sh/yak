// The leader topology as facts: one holder serves, followers buffer until
// hydrated, writes flow inward, canonical frames flow outward, and releasing
// the lease promotes the next queued tab.
import {
  type Channel,
  type Lock,
  type Message,
  stale,
  topology,
} from './leader.ts'
import { assertEquals } from '@std/assert'
import { slow } from './testing.ts'

let channels = <T>() => {
  let all: Channel<T>[] = []
  let open = (): Channel<T> => {
    let bus: Channel<T> = {
      onmessage: null,
      postMessage: (data: Message<T>) => {
        for (let peer of all) {
          if (peer != bus) peer.onmessage?.({ data })
        }
      },
    }
    all.push(bus)
    return bus
  }
  return open
}

let locks = () => {
  let queue: (() => Promise<void>)[] = []
  let busy = false
  let next = () => {
    if (busy) return
    let run = queue.shift()
    if (!run) return
    busy = true
    run().finally(() => {
      busy = false
      next()
    })
  }
  let lock: Lock = {
    request: (_name, run) => {
      queue.push(run)
      next()
      return Promise.resolve()
    },
  }
  return lock
}

let deferred = () => {
  let resolve: () => void
  let promise = new Promise<void>((r) => resolve = r)
  return { promise, resolve: () => resolve() }
}

let tick = () => new Promise((resolve) => setTimeout(resolve, 0))

slow(
  'one holder routes follower writes and fans canonical frames',
  async () => {
    let lock = locks()
    let channel = channels<string>()
    let leases = [deferred(), deferred()]
    let calls = [[], []] as string[][]
    let io = (i: number) => ({
      lead: () => {
        calls[i].push('lead')
        return Promise.resolve()
      },
      follow: () => {
        calls[i].push('follow')
        return Promise.resolve()
      },
      solo: () => {
        calls[i].push('solo')
        return Promise.resolve()
      },
      receive: (frame: string) => {
        calls[i].push(`in:${frame}`)
      },
      send: (frame: string) => {
        calls[i].push(`out:${frame}`)
      },
    })
    let a = topology(lock, channel(), io(0), () => 'a', () => leases[0].promise)
    let b = topology(lock, channel(), io(1), () => 'b', () => leases[1].promise)

    await Promise.all([a.start(), b.start()])
    assertEquals(calls, [['lead'], ['follow']])

    b.route('write')
    a.fan('canonical')
    assertEquals(calls, [
      ['lead', 'out:write'],
      ['follow', 'in:canonical'],
    ])

    leases[0].resolve()
    await tick()
    assertEquals(calls[1], ['follow', 'in:canonical', 'lead'])

    b.route('after')
    assertEquals(calls[1].at(-1), 'out:after')
    leases[1].resolve()
  },
)

Deno.test('a follower drains frames that arrive while it hydrates', async () => {
  let lock = locks()
  let channel = channels<string>()
  let lease = deferred()
  let hydrated = deferred()
  let seen: string[] = []
  let done = () => Promise.resolve()
  let leader = topology(
    lock,
    channel(),
    {
      lead: done,
      follow: done,
      solo: done,
      receive: () => {},
      send: () => {},
    },
    () => 'leader',
    () => lease.promise,
  )
  let follower = topology(
    lock,
    channel(),
    {
      lead: done,
      follow: () => hydrated.promise,
      solo: done,
      receive: (frame) => seen.push(frame),
      send: () => {},
    },
  )

  let first = leader.start()
  let second = follower.start()
  await first
  leader.fan('during')
  assertEquals(seen, [])
  hydrated.resolve()
  await second
  assertEquals(seen, ['during'])
  lease.resolve()
})

Deno.test('writes wait for the holder to finish booting', async () => {
  let lock = locks()
  let channel = channels<string>()
  let boot = deferred()
  let lease = deferred()
  let sent: string[] = []
  let done = () => Promise.resolve()
  let leader = topology(
    lock,
    channel(),
    {
      lead: () => boot.promise,
      follow: done,
      solo: done,
      receive: () => {},
      send: (frame) => {
        sent.push(frame)
      },
    },
    () => 'leader',
    () => lease.promise,
  )
  let follower = topology(
    lock,
    channel(),
    {
      lead: done,
      follow: done,
      solo: done,
      receive: () => {},
      send: () => {},
    },
    () => 'write',
  )

  let first = leader.start()
  let second = follower.start()
  follower.route('during boot')
  assertEquals(sent, [])
  boot.resolve()
  await Promise.all([first, second])
  assertEquals(sent, ['during boot'])
  lease.resolve()
})

// An acked delivery retries the SAME frame under its own stable id (live.ts
// outbox, T-21413) — each retry must replace its queued entry, not add one,
// or a long outage flushes N duplicates when a leader finally serves.
Deno.test('a retried route under one id flushes once', async () => {
  let lock = locks()
  let channel = channels<string>()
  let boot = deferred()
  let lease = deferred()
  let sent: string[] = []
  let done = () => Promise.resolve()
  let leader = topology(
    lock,
    channel(),
    {
      lead: () => boot.promise,
      follow: done,
      solo: done,
      receive: () => {},
      send: (frame) => {
        sent.push(frame)
      },
    },
    () => 'leader',
    () => lease.promise,
  )
  let follower = topology(
    lock,
    channel(),
    {
      lead: done,
      follow: done,
      solo: done,
      receive: () => {},
      send: () => {},
    },
    () => 'retrier',
  )

  let first = leader.start()
  let second = follower.start()
  follower.route('retry', 'delivery-1')
  follower.route('retry', 'delivery-1')
  boot.resolve()
  await Promise.all([first, second])
  assertEquals(sent, ['retry'])
  lease.resolve()
})

Deno.test('a failed lock cleanly restores the solo path', async () => {
  let calls: string[] = []
  let peer = topology(
    { request: () => Promise.reject(new Error('unsupported')) },
    channels<string>()(),
    {
      lead: () => Promise.resolve(),
      follow: () => Promise.resolve(),
      solo: () => {
        calls.push('solo')
        return Promise.resolve()
      },
      receive: () => {},
      send: (frame) => {
        calls.push(frame)
      },
    },
  )

  await peer.start()
  assertEquals(peer.isSolo(), true)
  peer.route('write')
  assertEquals(calls, ['solo', 'write'])
})

slow('one board name lives until its final tab owner leaves', async () => {
  let lock = locks()
  let channel = channels<string>()
  let leases = [deferred(), deferred()]
  let calls = [[], []] as string[][]
  let io = (i: number) => ({
    lead: () => Promise.resolve(),
    follow: () => Promise.resolve(),
    solo: () => Promise.resolve(),
    receive: () => {},
    send: () => {},
    subscribe: (name: string, q: string) => calls[i].push(`sub:${name}:${q}`),
    unsubscribe: (name: string) => calls[i].push(`unsub:${name}`),
  })
  let a = topology(lock, channel(), io(0), () => 'a', () => leases[0].promise)
  let b = topology(lock, channel(), io(1), () => 'b', () => leases[1].promise)
  await Promise.all([a.start(), b.start()])

  a.use('board:x', '.status=open')
  // b opening the same name is a new owner: the leader refreshes it once so
  // the newcomer is replayed the current set (T-16854), even though a already
  // held it with the same query. a dropping its own hold changes no owner, so
  // it sends nothing.
  b.use('board:x', '.status=open')
  a.drop('board:x')
  assertEquals(calls[0], [
    'sub:board:x:.status=open',
    'sub:board:x:.status=open',
  ])

  b.use('board:x', '.status=done')
  b.drop('board:x')
  assertEquals(calls[0], [
    'sub:board:x:.status=open',
    'sub:board:x:.status=open',
    'sub:board:x:.status=done',
    'unsub:board:x',
  ])

  a.leave()
  b.leave()
  leases[0].resolve()
  leases[1].resolve()
})

slow(
  'a new tab refreshes an installed subscription once; a pulse never does',
  async () => {
    let lock = locks()
    let channel = channels<string>()
    let lease = deferred()
    let calls: string[] = []
    let leader = topology(
      lock,
      channel(),
      {
        lead: () => Promise.resolve(),
        follow: () => Promise.resolve(),
        solo: () => Promise.resolve(),
        receive: () => {},
        send: () => {},
        subscribe: (name, q) => calls.push(`sub:${name}:${q}`),
        unsubscribe: (name) => calls.push(`unsub:${name}`),
      },
      () => 'leader',
      () => lease.promise,
    )
    // A second tab shares the bus, but we drive its ownership frames by hand so
    // the test controls when a pulse — a re-announce with unchanged revs —
    // lands, distinct from a genuine new owner.
    let peer = channel()
    await leader.start()

    leader.use('entries:S-1', '.entry.session=S-1')
    assertEquals(calls, ['sub:entries:S-1:.entry.session=S-1'])

    // A follower opens the same partition: a higher-rev use for the same query.
    // The leader must refresh once so the newcomer receives the current set.
    let use = { name: 'entries:S-1', value: '.entry.session=S-1', rev: 5 }
    peer.postMessage({ kind: 'owned', tab: 'b', uses: [use] })
    assertEquals(calls, [
      'sub:entries:S-1:.entry.session=S-1',
      'sub:entries:S-1:.entry.session=S-1',
    ])

    // A 30s ownership pulse re-announces the SAME use. Ownership is unchanged,
    // so no second refresh goes out.
    peer.postMessage({ kind: 'owned', tab: 'b', uses: [use] })
    assertEquals(calls, [
      'sub:entries:S-1:.entry.session=S-1',
      'sub:entries:S-1:.entry.session=S-1',
    ])

    leader.leave()
    lease.resolve()
  },
)

Deno.test('a hidden tab survives throttling but an abandoned lease expires', () => {
  assertEquals(stale(0, 180_000), false)
  assertEquals(stale(0, 180_001), true)
})

slow('a promoted follower replays the live ownership reduction', async () => {
  let lock = locks()
  let channel = channels<string>()
  let leases = [deferred(), deferred()]
  let calls = [[], []] as string[][]
  let io = (i: number) => ({
    lead: () => {
      calls[i].push('lead')
      return Promise.resolve()
    },
    follow: () => {
      calls[i].push('follow')
      return Promise.resolve()
    },
    solo: () => Promise.resolve(),
    receive: () => {},
    send: () => {},
    subscribe: (name: string, q: string) => calls[i].push(`sub:${name}:${q}`),
    unsubscribe: () => {},
  })
  let a = topology(lock, channel(), io(0), () => 'a', () => leases[0].promise)
  let b = topology(lock, channel(), io(1), () => 'b', () => leases[1].promise)
  await Promise.all([a.start(), b.start()])
  a.use('board:x', '.status=open')
  b.use('board:x', '.status=open')

  a.leave()
  leases[0].resolve()
  await tick()
  assertEquals(calls[1], [
    'follow',
    'lead',
    'sub:board:x:.status=open',
  ])

  b.leave()
  leases[1].resolve()
})
