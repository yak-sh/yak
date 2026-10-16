/// <reference lib="deno.ns" />
import { clock, equal, match, ok, test, throws } from '@yaks/testing'
import { durableOutbox, type OutboxStore, type Pending } from './outbox.ts'

type Intent = { title: string; nested: { count: number } }
let intent = (): Intent => ({ title: 'Keep this write', nested: { count: 1 } })
let deferred = <T>() => Promise.withResolvers<T>()

// Each disk behaves like committed storage, not a reference to queue memory.
let disk = () => {
  let rows = new Map<string, Pending<Intent>>()
  let store: OutboxStore<Intent> = {
    load: () => Promise.resolve(structuredClone([...rows.values()])),
    put: (entry) => {
      rows.set(entry.key, structuredClone(entry))
      return Promise.resolve()
    },
    remove: (key) => {
      rows.delete(key)
      return Promise.resolve()
    },
  }
  return { rows, store }
}
let fixture = async (
  send: (key: string, sent: Intent) => Promise<string>,
  store = disk().store,
) => {
  let time = clock()
  let reports: unknown[] = []
  let box = durableOutbox({
    scope: 'test/app/credential',
    store,
    send,
    timer: (fn, ms) => time.after(ms, fn),
    cancelTimer: (cancel) => (cancel as () => void)(),
    wait: 100,
    report: (error) => reports.push(error),
  })
  await box.ready
  return { box, time, reports }
}
type Box = Awaited<ReturnType<typeof fixture>>['box']
let changedTo = (box: Box, predicate: () => boolean) => {
  if (predicate()) return Promise.resolve()
  let done = deferred<void>()
  let stop = box.onPending(() => {
    if (!predicate()) return
    stop()
    done.resolve()
  })
  return done.promise
}

let admission = disk()
let admitted = deferred<void>()
let commit = deferred<void>()
let admissionCalls: unknown[] = []
let durable = await fixture((key, sent) => {
  admissionCalls.push([
    key,
    sent,
    structuredClone([...admission.rows.values()]),
  ])
  return Promise.resolve('saved')
}, {
  ...admission.store,
  put: async (entry) => {
    admitted.resolve()
    await commit.promise
    await admission.store.put(entry)
  },
})
test('outbox commits intent before sending it', async () => {
  try {
    let answer = durable.box.submit(intent(), 'durable-key')
    await admitted.promise
    equal(admissionCalls, [])
    commit.resolve()
    equal(await answer, 'saved')
    equal(admissionCalls.length, 1)
    match(admissionCalls, [[
      'durable-key',
      intent(),
      [{ key: 'durable-key', sent: intent(), state: 'pending' }],
    ]])
    equal([...admission.rows.values()], [])
    equal(durable.box.pending(), [])
  } finally {
    commit.resolve()
    durable.box.close()
  }
})

let diskFailure = new Error('disk transaction aborted')
let failedCalls: string[] = []
let failed = await fixture((key) => {
  failedCalls.push(key)
  return Promise.resolve('saved')
}, {
  ...disk().store,
  put: () => Promise.reject(diskFailure),
})
test('outbox sends nothing when durable admission fails', async () => {
  try {
    equal(
      await throws(() => failed.box.submit(intent(), 'disk-failed')),
      diskFailure,
    )
    equal(failedCalls, [])
    equal(failed.box.pending(), [])
  } finally {
    failed.box.close()
  }
})

let unknownDisk = disk()
let unknownCalls: unknown[] = []
let lostAnswer = new Error('connection lost after POST')
let unknown = await fixture((key, sent) => {
  unknownCalls.push([key, structuredClone(sent)])
  if (unknownCalls.length === 1) return Promise.reject(lostAnswer)
  return Promise.resolve('saved')
}, unknownDisk.store)
test('outbox retains unknown outcomes and automatically retries the same key and payload', async () => {
  try {
    let sent = intent()
    equal(
      await throws(() => unknown.box.submit(sent, 'unknown-key')),
      lostAnswer,
    )
    sent.nested.count = 99
    let expected: Pending<Intent> = {
      key: 'unknown-key',
      sent: intent(),
      state: 'pending',
    }
    equal(unknown.box.pending().length, 1)
    match(unknown.box.pending(), [expected])
    equal([...unknownDisk.rows.values()], unknown.box.pending())
    equal(unknown.reports, [lostAnswer])
    await unknown.time.advance(99)
    equal(unknownCalls, [['unknown-key', intent()]])
    let drained = changedTo(
      unknown.box,
      () => unknown.box.pending().length === 0,
    )
    await unknown.time.advance(1)
    await drained
    equal(unknownCalls, [['unknown-key', intent()], ['unknown-key', intent()]])
    equal([...unknownDisk.rows.values()], [])
  } finally {
    unknown.box.close()
  }
})

let refusal = Object.assign(new Error('write not allowed'), {
  outcome: 'refused',
})
let refusedDisk = disk()
let refusedCalls: unknown[] = []
let refuse = true
let refused = await fixture((key, sent) => {
  refusedCalls.push([key, structuredClone(sent)])
  if (refuse) return Promise.reject(refusal)
  return Promise.resolve('saved')
}, refusedDisk.store)
test('outbox retains explicit refusals without automatic resubmission', async () => {
  try {
    let retained = changedTo(
      refused.box,
      () => refused.box.pending()[0]?.state === 'refused',
    )
    equal(
      await throws(() => refused.box.submit(intent(), 'refused-key')),
      refusal,
    )
    await retained
    let expected: Pending<Intent> = {
      key: 'refused-key',
      sent: intent(),
      state: 'refused',
      refusal: { name: 'Error', message: 'write not allowed' },
    }
    equal(refused.box.pending().length, 1)
    match(refused.box.pending(), [expected])
    equal([...refusedDisk.rows.values()], refused.box.pending())
    await refused.time.advance(1000)
    equal(refusedCalls, [['refused-key', intent()]])
    await throws(
      () => refused.box.submit(intent(), 'refused-key'),
      'write not allowed',
    )
    equal(refusedCalls.length, 1)
    refuse = false
    let drained = changedTo(
      refused.box,
      () => refused.box.pending().length === 0,
    )
    await refused.box.retry('refused-key')
    await drained
    equal(refusedCalls, [['refused-key', intent()], ['refused-key', intent()]])
    equal([...refusedDisk.rows.values()], [])
  } finally {
    refused.box.close()
  }
})

let replayDisk = disk()
let first = await fixture(() => Promise.reject(lostAnswer), replayDisk.store)
await throws(() => first.box.submit(intent(), 'reopen-key'))
first.box.close()
let replayCalls: unknown[] = []
let replayAnswer = deferred<string>()
let reopened = await fixture(async (key, sent) => {
  replayCalls.push([key, structuredClone(sent)])
  return await replayAnswer.promise
}, replayDisk.store)
test('outbox reopens shared disk and replays the original payload and key', async () => {
  try {
    equal(replayCalls, [['reopen-key', intent()]])
    equal(reopened.box.pending().length, 1)
    match(reopened.box.pending(), [{
      key: 'reopen-key',
      sent: intent(),
      state: 'pending',
    }])
    let drained = changedTo(
      reopened.box,
      () => reopened.box.pending().length === 0,
    )
    replayAnswer.resolve('saved')
    await drained
    equal([...replayDisk.rows.values()], [])
  } finally {
    reopened.box.close()
  }
})

let forgottenDisk = disk()
let forgottenCalls = 0
let forgotten = await fixture(() => {
  forgottenCalls++
  return Promise.reject(lostAnswer)
}, forgottenDisk.store)
await throws(() => forgotten.box.submit(intent(), 'forget-key'))
test('outbox forget removes retained intent from disk and notifies subscribers', async () => {
  let changes = 0
  let stop = forgotten.box.onPending(() => changes++)
  try {
    await forgotten.box.forget('forget-key')
    equal(forgotten.box.pending(), [])
    equal([...forgottenDisk.rows.values()], [])
    equal(changes, 1)
    stop()
    await forgotten.time.advance(100)
    equal(forgottenCalls, 1)
    equal(changes, 1)
  } finally {
    stop()
    forgotten.box.close()
  }
})

let closedDisk = disk()
let closedCalls = 0
let closed = await fixture(() => {
  closedCalls++
  return Promise.reject(lostAnswer)
}, closedDisk.store)
await throws(() => closed.box.submit(intent(), 'close-key'))
test('outbox close cancels retry without forgetting durable intent', async () => {
  closed.box.close()
  await closed.time.advance(1000)
  equal(closedCalls, 1)
  ok(closedDisk.rows.has('close-key'))
  await throws(() => closed.box.submit(intent(), 'after-close'), 'closed')
  equal(closedCalls, 1)
})

// Sending can remain unanswered indefinitely without blocking later disk
// admissions. Read disk in reverse order on reopen, as a key-ordered store may.
let blockedDisk = disk()
let blockedSend = deferred<string>()
let blockedCalls: unknown[] = []
let blocked = await fixture((key, sent) => {
  blockedCalls.push([key, structuredClone(sent)])
  return blockedSend.promise
}, blockedDisk.store)
let replayRows = deferred<Pending<Intent>[]>()
let orderedCalls: unknown[] = []
let orderedOpening = fixture((key, sent) => {
  orderedCalls.push([key, structuredClone(sent)])
  return Promise.resolve('saved')
}, { ...blockedDisk.store, load: () => replayRows.promise })
let orderedIntents = [
  { ...intent(), title: 'first' },
  { ...intent(), title: 'second' },
  { ...intent(), title: 'third' },
]
let orderedKeys = ['z-first', 'a-second', 'm-third']
test('outbox admits later writes while a send is unanswered and reopens in admission order', async () => {
  let reopened: Awaited<typeof orderedOpening> | undefined
  try {
    let admitted = changedTo(
      blocked.box,
      () => blocked.box.pending().length === 3,
    )
    for (let i = 0; i < orderedKeys.length; i++) {
      // No answer is expected from this page: simulate closing it after all
      // three admissions commit, with the first POST still unanswered.
      void blocked.box.submit(orderedIntents[i], orderedKeys[i])
    }
    await admitted
    equal(blockedCalls, [[orderedKeys[0], orderedIntents[0]]])
    let rows = [...blockedDisk.rows.values()]
    equal(
      rows.map((row) => [row.key, row.sent]),
      orderedKeys.map((key, i) => [key, orderedIntents[i]]),
    )
    let [firstAt, secondAt, thirdAt] = rows.map((row) => ok(row.at))
    ok(firstAt < secondAt && secondAt < thirdAt)
    blocked.box.close()
    replayRows.resolve(rows.reverse())
    reopened = await orderedOpening
    await changedTo(reopened.box, () => reopened!.box.pending().length === 0)
    equal(orderedCalls, orderedKeys.map((key, i) => [key, orderedIntents[i]]))
    equal([...blockedDisk.rows.values()], [])
  } finally {
    blocked.box.close()
    reopened?.box.close()
  }
})

let loadFailure = new Error('outbox disk cannot be read')
let unreadableCalls: string[] = []
let unreadablePuts = 0
let unreadable = durableOutbox<Intent, string>({
  scope: 'unreadable/app',
  store: {
    ...disk().store,
    load: () => Promise.reject(loadFailure),
    put: () => {
      unreadablePuts++
      return Promise.resolve()
    },
  },
  send: (key) => {
    unreadableCalls.push(key)
    return Promise.resolve('saved')
  },
})
test('outbox rejects every admission after startup load failure without sending or writing', async () => {
  try {
    equal(await throws(() => unreadable.ready), loadFailure)
    for (let key of ['after-failure-1', 'after-failure-2', 'after-failure-3']) {
      equal(await throws(() => unreadable.submit(intent(), key)), loadFailure)
    }
    equal(unreadableCalls, [])
    equal(unreadablePuts, 0)
    equal(unreadable.pending(), [])
  } finally {
    unreadable.close()
  }
})
