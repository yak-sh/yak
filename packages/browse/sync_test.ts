// The standing sync indicator and the durable refusal ledger (T-21441). The
// visibility half of the T-21413 incident hardening: an optimistic cache shows
// a write as landed while it sits unsent, and a refused write vanished with the
// reload that wiped `problem`. Two seams held here — the reactive `outboxWrites`
// signal a view reads to say "N unsynced", and the refusal ledger that keeps a
// rejected write under its stable delivery id across a reload (M-16612). The
// heavy end-to-end (a real /apply refusal, a real reload) is a CDP probe; this
// tier holds the pure client logic.

import { test } from '@yaks/testing'
import './testing.ts'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import * as live from './live.ts'

let uid = () => crypto.randomUUID()

// Begin one held delivery at file load. The indicator has no reason to pay
// for constructing the replica or admitting a write before its host answers.
let heldDelivery = await (async () => {
  let answer = Promise.withResolvers<Response>()
  let sent = Promise.withResolvers<void>()
  let sends = 0
  let restore = live.useRoute((frame) => {
    if ((frame as { request?: Request }).request) {
      sends++
      sent.resolve()
      return answer.promise
    }
  })
  let receipt = live.apply([{
    entity: { eid: uid() },
    doc: { title: 'held' },
  }])
  await sent.promise
  return { answer, receipt, restore, sends: () => sends }
})()

test('the indicator follows shared delivery until the host answers', async () => {
  let { answer, receipt, restore, sends } = heldDelivery
  try {
    assertEquals(live.outboxWrites.value.length, 1)
    let w = live.outboxWrites.value[0]
    assert(w.id.startsWith('outbox:'))
    assertEquals(w.count, 2) // the entity identity and doc patch
    assert(w.since > 0)
    assertEquals(live.unsent(), [w.id])
    answer.resolve(Response.json([]))
    await receipt
    assertEquals(live.outboxWrites.value.length, 0)
    assertEquals(sends(), 1)
  } finally {
    answer.resolve(Response.json([]))
    live.useRoute(restore)
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

test('a refused write persists under a stable id and survives a reload', () => {
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

    // The user dismisses it, gone from both halves and from the status line.
    live.problem.value = 'doc T-1 has moved'
    live.clearRefusal(id)
    assertEquals(live.refused.value.length, 0)
    assertEquals(store.disk.size, 0)
    assertEquals(live.problem.value, '')
  } finally {
    live.useRefusalStore(prev)
  }
})

test('loading refusals drops entries older than seven days and keeps fresh ones', () => {
  let storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  let before = live.refused.value
  let fresh = { id: uid(), reason: 'moved', at: Date.now(), summary: '' }
  let old = { ...fresh, id: uid(), at: fresh.at - 8 * 24 * 60 * 60 * 1000 }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => {
        assertEquals(key, 'tasks-refused')
        return JSON.stringify([old, fresh])
      },
    },
  })
  try {
    live.loadRefusals()
    assertEquals(live.refused.value, [fresh])
  } finally {
    live.refused.value = before
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
