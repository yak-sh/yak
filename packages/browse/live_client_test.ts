// The replica over a hand-driven socket: what it asks the host, and what a
// frame the host sends does to the box and to the names that asked.
import { test } from '@yaks/testing'
import { tick } from './testing.ts'
import { assertEquals, assertRejects } from '@std/assert'
import { WriteRefused, WriteUnknown } from '@yaks/client'
import type { Frame, Socket } from '@yaks/sync'
import { liveClient } from './live_client.ts'
import { rowHolds } from './row_holds.ts'

// A socket that is open at once, keeps what is sent on it, and lets the test
// speak for the host. Frames land when the timer turns (T-37445).
let host = () => {
  let sent: Record<string, unknown>[] = []
  let heard: ((e: Event & { data?: unknown }) => void)[] = []
  let socket: Socket = {
    readyState: 1,
    send: (text) => void sent.push(JSON.parse(text)),
    close: () => {},
    addEventListener: (type, fn) => {
      if (type == 'message') heard.push(fn)
    },
  }
  // One message: a frame, or several batched under one acknowledgement.
  let say = (f: Frame | { frames: Frame[]; ack?: string }) => {
    for (let fn of heard) {
      fn({ data: JSON.stringify(f) } as Event & { data: string })
    }
    return tick()
  }
  return { socket, sent, say }
}

let replica = () => {
  let h = host()
  let frames: [string[], Frame, boolean][] = []
  let c = liveClient({
    url: 'http://host.test',
    connect: () => h.socket,
    changed: () => {},
    ready: () => {},
    frame: (subs, f, reset) => void frames.push([subs, f, reset]),
  })
  return { c, frames, ...h }
}

let write = (eid: string, title: string) => ({
  entity: { eid },
  doc: { title },
})
let row = (eid: string, title: string) => ({
  ...write(eid, title),
  entity: { eid, num: 1 },
})

let writing = () => {
  let response = Promise.withResolvers<Response>()
  let c = liveClient({
    url: 'http://host.test',
    connect: () => host().socket,
    fetch: () => response.promise,
    report: () => {},
    changed: () => {},
    ready: () => {},
    frame: () => {},
  })
  return { c, response }
}

// The host never answers this write: the case is its local half alone.
let optimistic = writing()
test('the browser replica writes optimistically and waits for the host', async () => {
  let { c } = optimistic
  try {
    let receipt = Promise.resolve(c.box.mutate([write('write-local', 'local')]))
    assertEquals(c.box.ent('write-local')?.doc, { title: 'local' })
    let settled = false
    receipt.then(() => settled = true, () => {})
    await Promise.resolve()
    assertEquals(settled, false)
  } finally {
    c.box.close()
  }
})

// A write already made as the file loads, its host response held: the case
// is the answer landing.
let stamped = writing()
let applied = [{
  ...row('write-stamps', 'server'),
  created: { by: 'owner', at: '2026-10-11T00:00:00.000Z' },
}]
let stampedResponse = Response.json(applied)
let stampedReceipt = Promise.resolve(
  stamped.c.box.mutate([write('write-stamps', 'local')]),
)
test('the browser replica resolves a write with its stamped server bundles', async () => {
  let { c, response } = stamped
  try {
    response.resolve(stampedResponse)
    assertEquals(await stampedReceipt, applied)
    assertEquals(c.box.ent('write-stamps')?.doc, { title: 'server' })
    assertEquals(c.box.ent('write-stamps')?.created, applied[0].created)
  } finally {
    c.box.close()
  }
})

// Each write is made as the file loads, its host response held: the case is
// the refusal, or the lost response, landing.
for (let refusal of [true, false]) {
  let failed = writing()
  let receipt = Promise.resolve(
    failed.c.box.mutate([write('failed-write', 'keep')]),
  )
  let refused = refusal &&
    Response.json({ error: 'Refused', message: 'no' }, { status: 400 })
  test(`the browser replica rejects ${refusal ? 'refused' : 'unknown'} writes`, async () => {
    let { c, response } = failed
    try {
      if (refused) response.resolve(refused)
      else response.reject(new TypeError('response lost'))
      let error = refusal
        ? await assertRejects(() => receipt, WriteRefused)
        : await assertRejects(() => receipt, WriteUnknown)
      assertEquals(error.outcome, refusal ? 'refused' : 'unknown')
      assertEquals(error.sent[0].doc, { title: 'keep' })
      if (!refusal) {
        assertEquals(c.box.ent('failed-write')?.doc, { title: 'keep' })
      }
    } finally {
      c.box.close()
    }
  })
}

test('two names on one line share one subscription on the wire', () => {
  let { c, sent } = replica()
  c.open('a', '.doc')
  c.open('b', '.doc')
  assertEquals(sent.filter((m) => 'subscribe' in m).length, 1)
  c.close('a')
  assertEquals(sent.filter((m) => 'unsubscribe' in m).length, 0)
  c.close('b')
  assertEquals(sent.filter((m) => 'unsubscribe' in m).length, 1)
})

test('a frame lands in the box and is reported to every name, first as a reset', async () => {
  let { c, frames, sent, say } = replica()
  c.open('a', '.doc')
  c.open('b', '.doc')
  let id = String(sent[0].id)
  await say({ id, bundles: [row('x', 'One')] })
  assertEquals(c.members('a'), ['x'])
  assertEquals(c.ready('b'), true)
  assertEquals(c.box.ent('x')?.doc, { title: 'One' })
  assertEquals(frames.map(([subs, , reset]) => [subs, reset]), [
    [['a', 'b'], true],
  ])
  await say({ id, bundles: [row('x', 'Two')] })
  assertEquals(frames[1][2], false)
  assertEquals(c.box.ent('x')?.doc, { title: 'Two' })
})

test('frames the host batches into one message are each reported', async () => {
  let { c, frames, sent, say } = replica()
  c.open('a', '.doc')
  c.open('t', '.task&.tally=task.status')
  let [doc, tally] = sent.map((m) => String(m.id))
  await say({
    frames: [
      { id: doc, bundles: [row('x', 'One')] },
      { id: tally, tally: { open: 2 } },
    ],
    ack: 'k1',
  })
  assertEquals(c.box.ent('x')?.doc, { title: 'One' })
  assertEquals(frames.map(([subs, f]) => [subs, f.tally]), [
    [['a'], undefined],
    [['t'], { open: 2 }],
  ])
})

test('a derived value wider than its enum still lands', async () => {
  let { c, sent, say } = replica()
  c.open('a', '.task')
  await say({
    id: String(sent[0].id),
    bundles: [{ entity: { eid: 'x', num: 1 }, task: { status: 'wip' } }],
  })
  assertEquals(c.box.ent('x')?.task, { status: 'wip' })
})

test('a refusal is reported, and lands no rows', async () => {
  let { c, frames, sent, say } = replica()
  c.open('a', '.nope')
  await say({
    id: String(sent[0].id),
    refused: { error: 'Refused', message: 'no' },
  })
  assertEquals(frames[0][1].refused?.message, 'no')
  assertEquals(frames[0][2], false)
  assertEquals(c.members('a'), [])
})

let speaking = replica()
test('a test server speaks through receive, as changes', () => {
  let { c, frames } = speaking
  c.open('a', '.doc')
  c.receive({
    sub: 'a',
    replace: true,
    changes: [{ eid: 'x', name: 'doc', comp: { title: 'One' } }],
  })
  assertEquals(c.members('a'), ['x'])
  assertEquals(frames.length, 1)
})

test('socket refusals reach the page tracker with their reason', async () => {
  let heard: unknown[][] = []
  let original = console.error
  console.error = (...args) => void heard.push(args)
  let { c, sent, say } = replica()
  try {
    c.open('bad', '.doc')
    await say({
      id: String(sent[0].id),
      refused: {
        error: 'Refused',
        message: 'socket message exceeds 65536 bytes',
      },
    })
    assertEquals(heard.length, 1)
    assertEquals(
      heard[0][0],
      'live client — Refused: socket message exceeds 65536 bytes',
    )
    assertEquals(c.ready('bad'), false)
    assertEquals(c.active(), 1)
  } finally {
    c.close('bad')
    console.error = original
  }
})

test('authored narrow reads reach the wire without widening to whole rows', () => {
  let { c, sent } = replica()
  try {
    for (
      let line of [
        '.task&?doc&?created',
        '.task .fields=doc.title .limit=5',
        '.task&.tally=filed.project',
        '.task&.distinct=filed.priority',
      ]
    ) {
      c.open(line, line)
      assertEquals(sent.at(-1)?.subscribe, line)
    }
  } finally {
    c.box.close()
  }
})

// One immutable group owns its delivered rows even as individual cells leave.
let grouped = replica()
let groupJobs: (() => void)[] = []
let groupName = ''
let groupHold = rowHolds(
  (name, line) => {
    groupName = name
    grouped.c.open(name, line.replace('id=', '.entity.eid='))
  },
  (name) => grouped.c.close(name),
  (run) => groupJobs.push(run),
)
let groupIds = Array.from({ length: 20 }, (_, i) => `group-${i}`)
let groupOff = groupIds.map((eid) => groupHold([eid]))
for (let run of groupJobs.splice(0)) run()
let groupChanges = groupIds.flatMap((eid, i) => [
  { eid, name: 'entity', comp: { eid, num: i + 1 } },
  { eid, name: 'doc', comp: { title: `Row ${i}` } },
])
grouped.c.receive({ sub: groupName, replace: true, changes: groupChanges })
for (let off of groupOff.slice(0, 19)) off()
grouped.c.receive({
  sub: groupName,
  changes: [{ eid: groupIds[19], name: 'doc', comp: { title: 'Updated' } }],
})
test('grouped cell demand delivers all rows and keeps live updates for survivors', () => {
  assertEquals(grouped.sent.filter((m) => 'subscribe' in m).length, 1)
  assertEquals(grouped.c.members(groupName), groupIds)
  assertEquals(grouped.c.box.ent(groupIds[0])?.doc, { title: 'Row 0' })
  assertEquals(grouped.c.box.ent(groupIds[19])?.doc, { title: 'Updated' })
  assertEquals(grouped.sent.filter((m) => 'unsubscribe' in m).length, 0)
  groupOff[19]()
  assertEquals(grouped.sent.filter((m) => 'unsubscribe' in m).length, 1)
  grouped.c.box.close()
})

let refusedGroup = replica()
let refusedJobs: (() => void)[] = []
let refusedName = ''
let refusedHold = rowHolds(
  (name, line) => {
    refusedName = name
    refusedGroup.c.open(name, line.replace('id=', '.entity.eid='))
  },
  (name) => refusedGroup.c.close(name),
  (run) => refusedJobs.push(run),
)
let refusedOff = [refusedHold(['private']), refusedHold(['gone'])]
for (let run of refusedJobs.splice(0)) run()
refusedGroup.c.receive({ sub: refusedName, error: 'not permitted' })
test('a refused group exposes no rows and keeps refusal until replacement', () => {
  assertEquals(refusedGroup.c.members(refusedName), [])
  assertEquals(refusedGroup.c.ready(refusedName), false)
  for (let off of refusedOff) off()
  assertEquals(refusedGroup.sent.filter((m) => 'unsubscribe' in m).length, 1)
  refusedGroup.c.box.close()
})

let replacedGroup = replica()
let replacedJobs: (() => void)[] = []
let replacedName = ''
let replacedHold = rowHolds(
  (name, line) => {
    replacedName = name
    replacedGroup.c.open(name, line.replace('id=', '.entity.eid='))
  },
  (name) => replacedGroup.c.close(name),
  (run) => replacedJobs.push(run),
)
let replacedOff = [replacedHold(['present']), replacedHold(['absent'])]
for (let run of replacedJobs.splice(0)) run()
replacedGroup.c.receive({
  sub: replacedName,
  replace: true,
  changes: [
    { eid: 'present', name: 'entity', comp: { eid: 'present', num: 1 } },
    { eid: 'present', name: 'doc', comp: { title: 'Present' } },
  ],
})
test('a group membership includes only rows the server actually returned', () => {
  assertEquals(replacedGroup.c.members(replacedName), ['present'])
  assertEquals(replacedGroup.c.ready(replacedName), true)
  assertEquals(replacedGroup.c.box.ent('absent'), undefined)
  replacedGroup.c.receive({ sub: replacedName, replace: true, changes: [] })
  assertEquals(replacedGroup.c.members(replacedName), [])
  for (let off of replacedOff) off()
  replacedGroup.c.box.close()
})
