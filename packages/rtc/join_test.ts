/// <reference lib="deno.ns" />
// A stalled recovery must not keep microphone presence or a departed call alive.
import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { join } from './join.ts'

type Sender = {
  replaceTrack: (track: MediaStreamTrack | null) => Promise<void>
}

class Peer {
  static peers: Peer[] = []
  connectionState = 'connected'
  onconnectionstatechange: (() => void) | null = null
  localDescription: unknown = null
  sender: Sender = {
    replaceTrack: (track) => {
      this.track = track
      return Promise.resolve()
    },
  }
  track: MediaStreamTrack | null = null
  constructor() {
    Peer.peers.push(this)
  }
  addTransceiver(_track: unknown) {
    return { mid: '0', sender: this.sender, stop: () => {} }
  }
  createOffer() {
    return Promise.resolve({ type: 'offer', sdp: 'v=0' })
  }
  setLocalDescription(sdp: unknown) {
    this.localDescription = sdp
    return Promise.resolve()
  }
  async setRemoteDescription(_sdp: unknown) {}
  close() {
    this.connectionState = 'closed'
  }
}

// The browser a call runs in, stood in for one test: `document` and
// `RTCPeerConnection` installed, and put back as they were, absent included.
// Defining the old value back instead leaves a read-only global that every
// later test sharing the runtime fails to assign.
let browser = () => {
  let stand = {
    document: { baseURI: 'https://example.test/vale/' },
    RTCPeerConnection: Peer,
  }
  let was = Object.keys(stand).map((name) =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const
  )
  for (let [name, value] of Object.entries(stand)) {
    Object.defineProperty(globalThis, name, { configurable: true, value })
  }
  return () => {
    for (let [name, prior] of was) {
      if (prior) Object.defineProperty(globalThis, name, prior)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}

Deno.test('stalled reconnect cannot delay unpublication or leave; cannot resurrect an old session', async () => {
  let restore = browser()
  let block: ((response: Response) => void) | null = null
  let sessions = 0
  let stalled = false
  let writes: Bundle[] = []
  const fetcher = (async (url: URL | RequestInfo) => {
    let path = new URL(String(url)).pathname
    if (path.endsWith('/ice')) {
      if (stalled) {
        return await new Promise<Response>((resolve) => {
          block = resolve
        })
      }
      return Response.json({ iceServers: [] })
    }
    if (path.endsWith('/sessions/new')) {
      return Response.json({ sessionId: `s${++sessions}`, key: 'key' })
    }
    if (path.endsWith('/tracks/new')) {
      return Response.json({
        sessionDescription: { type: 'answer', sdp: 'v=0' },
      })
    }
    return Response.json({})
  }) as typeof fetch
  try {
    let call = await join({
      entity: 'hero',
      fetch: fetcher,
      write: (bs) => {
        writes.push(...bs)
      },
    })
    let track = { readyState: 'live', enabled: true } as MediaStreamTrack
    let published = await call.publish(track)
    assertEquals(Peer.peers[0].track, track)
    stalled = true
    Peer.peers[0].connectionState = 'failed'
    Peer.peers[0].onconnectionstatechange?.()
    // Let the serialized recovery reach its intentionally unresolved ice request.
    for (let i = 0; !block && i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1))
    }
    assert(block)
    await Promise.race([
      published.stop(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('stop blocked by reconnect')), 100)
      ),
    ])
    assertEquals(
      (writes.at(-1) as unknown as { rtc: { tracks: string[] } }).rtc.tracks,
      [],
    )
    await Promise.race([
      call.leave(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('leave blocked by reconnect')), 100)
      ),
    ])
    assertEquals((writes.at(-1) as unknown as { rtc: unknown }).rtc, null)
    stalled = false
    block!(Response.json({ iceServers: [] }))
    await new Promise((r) => setTimeout(r, 5))
    assertEquals((writes.at(-1) as unknown as { rtc: unknown }).rtc, null)
    assertEquals(call.state, 'left')
    assertEquals(sessions, 1)
  } finally {
    restore()
  }
})

Deno.test('rejected initial presence write closes the connection without a call handle', async () => {
  let restore = browser()
  try {
    let failed = false
    try {
      await join({
        entity: 'hero',
        write: () => Promise.reject(new Error('graph unavailable')),
        fetch: ((url: URL | RequestInfo) => {
          let path = new URL(String(url)).pathname
          return Promise.resolve(Response.json(
            path.endsWith('/ice')
              ? { iceServers: [] }
              : path.endsWith('/sessions/new')
              ? { sessionId: 's', key: 'key' }
              : { sessionDescription: { type: 'answer', sdp: 'v=0' } },
          ))
        }) as typeof fetch,
      })
    } catch {
      failed = true
    }
    assert(failed)
    assertEquals(Peer.peers.at(-1)?.connectionState, 'closed')
  } finally {
    restore()
  }
})

Deno.test('rejected asynchronous presence write detaches sender instead of stranding a publication', async () => {
  let restore = browser()
  let rejectWrite = false
  let call: Awaited<ReturnType<typeof join>> | null = null
  try {
    call = await join({
      entity: 'hero',
      write: (bs) => {
        if (rejectWrite && bs[0]?.rtc) {
          return Promise.reject(new Error('write refused'))
        }
      },
      fetch: ((url: URL | RequestInfo) => {
        let path = new URL(String(url)).pathname
        return Promise.resolve(Response.json(
          path.endsWith('/ice')
            ? { iceServers: [] }
            : path.endsWith('/sessions/new')
            ? { sessionId: 's', key: 'key' }
            : { sessionDescription: { type: 'answer', sdp: 'v=0' } },
        ))
      }) as typeof fetch,
    })
    let peer = Peer.peers.at(-1)!
    rejectWrite = true
    let track = { readyState: 'live' } as MediaStreamTrack
    let failed = false
    try {
      await call.publish(track)
    } catch {
      failed = true
    }
    assert(failed)
    assertEquals(peer.track, null)
    assertEquals(await call.diagnose(), null)
  } finally {
    await call?.leave()
    restore()
  }
})

Deno.test('same-hero replacement waits for old asynchronous clear before new presence', async () => {
  let restore = browser()
  let writes: (Bundle['rtc'])[] = []
  let release: (() => void) | null = null
  let delayed = false
  let write = (bs: Bundle[]) => {
    let value = bs[0].rtc
    if (delayed && value === null) {
      return new Promise<void>((resolve) => {
        release = () => {
          writes.push(value)
          resolve()
        }
      })
    }
    writes.push(value)
  }
  let fetcher = ((url: URL | RequestInfo) => {
    let path = new URL(String(url)).pathname
    return Promise.resolve(Response.json(
      path.endsWith('/ice')
        ? { iceServers: [] }
        : path.endsWith('/sessions/new')
        ? { sessionId: crypto.randomUUID(), key: 'key' }
        : { sessionDescription: { type: 'answer', sdp: 'v=0' } },
    ))
  }) as typeof fetch
  let first: Awaited<ReturnType<typeof join>> | null = null
  let second: Awaited<ReturnType<typeof join>> | null = null
  try {
    first = await join({ entity: 'hero', write, fetch: fetcher })
    delayed = true
    // Same sequencing used by voicebox.retire / joined: never create the
    // replacement until the old call's presence deletion has finished.
    let retired = first.leave()
    let fresh = retired.then(() =>
      join({ entity: 'hero', write, fetch: fetcher })
    )
    for (let i = 0; !release && i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1))
    }
    assert(release)
    assertEquals(writes.length, 1)
    delayed = false
    const clear = release as (() => void) | null
    clear?.()
    second = await fresh
    assertEquals(writes.length, 3)
    assertEquals(writes[1], null)
    assert(writes[2] !== null)
  } finally {
    delayed = false
    const clear = release as (() => void) | null
    clear?.()
    await second?.leave()
    await first?.leave()
    restore()
  }
})
