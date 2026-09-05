// The standing sync indicator and the durable refusal ledger (T-21441). The
// visibility half of the T-21413 incident hardening: an optimistic cache shows
// a write as landed while it sits unsent, and a refused write vanished with the
// reload that wiped `problem`. Two seams held here — the reactive `outboxWrites`
// signal a view reads to say "N unsynced", and the refusal ledger that keeps a
// rejected write under its stable delivery id across a reload (M-16612). The
// heavy end-to-end (a real /apply refusal, a real reload) is a CDP probe; this
// tier holds the pure client logic.

import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { type Change } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
let uid = () => crypto.randomUUID()

// A stubbed WebSocket so mutate() can route through deliver without a server —
// the same door outbox_test uses.
let stubSockets = async () => {
  let real = (globalThis as { WebSocket: unknown }).WebSocket
  ;(globalThis as { WebSocket: unknown }).WebSocket = class {
    readyState = 0
    onopen: unknown = null
    onmessage: unknown = null
    onclose: unknown = null
    send() {}
    addEventListener() {}
    close() {}
  }
  // A fake transport needs a fake address: live.ts refuses to dial a host
  // nobody named, and `.invalid` resolves nowhere if this stub ever slips.
  let { config } = await import('./live.ts')
  let host = config.host
  config.host = 'stub.invalid'
  return () => {
    ;(globalThis as { WebSocket: unknown }).WebSocket = real
    config.host = host
  }
}

// An in-memory outbox double (no IndexedDB in the fast tier), mirroring idb's
// key = delivery id.
type Parked = { changes: Change[]; at: number }
let fakeOutbox = () => {
  let disk = new Map<string, Parked>()
  return {
    park: (id: string, o: Parked) => void disk.set(id, o),
    unpark: (id: string) => void disk.delete(id),
    parked: () => Promise.resolve([...disk] as [string, Parked][]),
  }
}

Deno.test('the indicator mirrors the outbox: a mutate adds, an ack clears', async () => {
  let restore = await stubSockets()
  let live = await import('./live.ts')
  let prev = live.useOutboxStore(fakeOutbox())
  try {
    let before = live.outboxWrites.value.length
    live.mutate({ eid: uid(), name: 'doc', comp: { title: 'held' } })
    assertEquals(live.outboxWrites.value.length, before + 1)
    let w = live.outboxWrites.value.at(-1)!
    assertEquals(w.count, 1) // one change in the write
    assert(w.since > 0) // and the moment it was first queued, for "how long"
    // Only the ack releases it — and the indicator empties with the outbox.
    for (let id of live.unsent()) live.acked(id)
    assertEquals(live.outboxWrites.value.length, 0)
  } finally {
    live.useOutboxStore(prev)
    restore()
  }
})

// An in-memory refusal ledger double: a real reload throws the signal away, so
// this "disk" is what a fresh boot reads back — keyed by delivery id like the
// localStorage ledger.
let fakeRefusals = () => {
  let disk = new Map<string, import('./live.ts').Refusal>()
  return {
    disk,
    record: (r: import('./live.ts').Refusal) => void disk.set(r.id, r),
    clear: (id: string) => void disk.delete(id),
    all: () => [...disk.values()],
  }
}

Deno.test('a refused write persists under a stable id and survives a reload', async () => {
  let live = await import('./live.ts')
  let store = fakeRefusals()
  let prev = live.useRefusalStore(store)
  try {
    let id = uid()
    live.refuse(id, 'doc T-1 has moved', [
      { eid: uid(), name: 'doc', comp: { body: 'lost edit' } },
    ])
    // Durable and reactive at once: the ledger holds it, the signal shows it.
    assertEquals(store.disk.size, 1)
    assertEquals(live.refused.value.length, 1)
    assertEquals(live.refused.value[0].id, id) // its stable identity
    assertStringIncludes(live.refused.value[0].reason, 'has moved') // why it failed
    assert(live.refused.value[0].summary.length > 0) // what was thrown away

    // Simulate a reload: the in-memory signal boots empty, the durable ledger
    // outlives it, and loadRefusals() reads the refusal straight back — under
    // the SAME id, so the user returns to the very same error.
    live.refused.value = []
    live.loadRefusals()
    assertEquals(live.refused.value.length, 1)
    assertEquals(live.refused.value[0].id, id)

    // The one act that clears it: the user dismisses it, gone from both halves.
    live.clearRefusal(id)
    assertEquals(live.refused.value.length, 0)
    assertEquals(store.disk.size, 0)
  } finally {
    live.useRefusalStore(prev)
  }
})
