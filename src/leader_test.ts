// The leader topology as facts: one holder serves, followers buffer until
// hydrated, writes flow inward, canonical frames flow outward, and releasing
// the lease promotes the next queued tab.
import { type Channel, type Lock, type Message, topology } from './leader.ts'
import { assertEquals } from '@std/assert'

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

Deno.test('one holder routes follower writes and fans canonical frames', async () => {
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
})

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
