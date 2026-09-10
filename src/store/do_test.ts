// The app store's contract in workerd itself: the kernel Worker boots under
// wrangler dev, and a headless client drives its HTTP and live doors. The
// T-33810 package store takes bundles and subscriptions. The public HTTP
// door still wraps its replies as {ok, changes, aliases}, but fleet claim
// leases and cursor/epoch catchup no longer belong to this app store.
import { assert, assertEquals, assertMatch } from '@std/assert'
import type { Frame } from '@yaks/api'
import { edgeEid, link } from '@yaks/edge'
import { slow, until } from '../testing.ts'
import { client, kernel, relay, seed } from '../../workers/yak/probe.ts'

slow('the store on Durable Object SQLite serves the wire', async () => {
  let k = await kernel()
  try {
    let { cookie, eids } = await seed(k, [{ slug: 'lab', apps: ['graph'] }])
    let { get, post, applied } = client(k, 'lab.yaks.app', 'graph', cookie)
    // Identity and storage size, not the retired fleet epoch.
    let serving = await (await k.at('lab.yaks.app', '/graph/api/graph')).json()
    assertEquals(serving.db, `do:lab/graph.${eids['lab/graph'].slice(-6)}`)
    assert(serving.bytes > 0)

    let task = crypto.randomUUID(), dep = crypto.randomUUID()
    let note = crypto.randomUUID()
    let edge = edgeEid(task, 'requires', dep)
    let batch = await applied([
      {
        entity: { eid: task },
        doc: { title: 'planted', body: 'in a DO' },
        task: {},
        filed: { priority: 1 },
      },
      { entity: { eid: dep }, doc: { title: 'needed' }, task: {} },
      link(task, 'requires', dep),
      {
        entity: { eid: note },
        doc: { title: 'a comment', body: 'hi' },
        comment: { target: task },
      },
    ])
    assert(batch.ok)
    assert(batch.changes.some((c) => c.eid == task && c.name == 'doc'))

    // Fresh HTTP reads recover the committed rows, blob body, references,
    // derived status, and full-text index from the object's SQLite.
    let [hit] = await get(`.eid=${task}`)
    assertEquals(hit.entity.eid, task)
    assert(hit.entity.num! > 0)
    assertEquals(hit.doc, { title: 'planted', body: 'in a DO' })
    assertEquals((hit.task as { status: string }).status, 'open')
    let [relation] = await get(`.edge.from=${task}&.requires!`)
    assertEquals(relation.entity.eid, edge)
    assertEquals((relation.edge as { to: string }).to, dep)
    assertEquals((await get('.task!')).length, 2)
    assertEquals((await get('planted')).map((r) => r.entity.eid), [task])
    assertEquals((await get('"in a DO"')).map((r) => r.entity.eid), [task])
    let [about] = await get(`.comment.target=${task}`)
    assertEquals(about.entity.eid, note)

    // A refusal names the bad value and leaves the whole batch untouched.
    let fresh = crypto.randomUUID()
    let bad = await post([
      { entity: { eid: task }, doc: { title: 'renamed' } },
      { entity: { eid: fresh }, doc: { title: 'never committed' } },
      { entity: { eid: dep }, filed: { priority: 'not a number' } },
    ])
    assertEquals(bad.status, 400)
    assertMatch(await bad.text(), /priority/)
    assertEquals((await get(`.eid=${task}`))[0].doc, hit.doc)
    assertEquals(await get(`.eid=${fresh}`), [])

    // A public app is readable by a stranger, but not writable by one.
    let stranger = client(k, 'lab.yaks.app', 'graph')
    let no = await stranger.post([
      { entity: { eid: task }, doc: { title: 'not yours' } },
    ])
    assertEquals(no.status, 401)
    assertEquals((await no.json()).error.code, 'not_a_writer')
    assertEquals((await stranger.get(`.eid=${task}`))[0].doc, hit.doc)

    // Deleting an endpoint tombstones both its comment and its edge; the
    // reply carries the casualties for caches, and the other task survives.
    let death = await applied([{ entity: { eid: task }, tombstone: {} }])
    for (let eid of [task, note, edge]) {
      assert(death.changes.some((c) => c.eid == eid && c.name == 'tombstone'))
    }
    assertEquals(await get(`.eid=${task},${note},${edge}`), [])
    assertEquals((await get('.task!')).map((r) => r.entity.eid), [dep])
    await applied([{ entity: { eid: task }, doc: { title: 'ghost' } }])
    assertEquals(await get(`.eid=${task}`), [])
  } finally {
    await k.stop()
  }
})

// One real socket and the subscription frames it has heard.
let socket = async (origin: string) => {
  let ws = new WebSocket(`${origin.replace(/^http/, 'ws')}/graph/api/ws`)
  let heard: Frame[] = []
  ws.onmessage = (e) => heard.push(JSON.parse(String(e.data)))
  await until(() => ws.readyState == WebSocket.OPEN, {
    timeout: 15_000,
    label: 'the socket to open',
  })
  let told = (frame: unknown) => ws.send(JSON.stringify(frame))
  let hears = async (fits: (f: Frame) => boolean): Promise<Frame> =>
    (await until(() => heard.find(fits), {
      timeout: 15_000,
      label: () => `a subscription frame; heard ${JSON.stringify(heard)}`,
    }))!
  let close = async () => {
    if (ws.readyState == WebSocket.CLOSED) return
    ws.close()
    await until(() => ws.readyState == WebSocket.CLOSED, { timeout: 15_000 })
  }
  return { told, hears, close }
}

slow('the store on Durable Object SQLite serves the live wire', async () => {
  let k = await kernel()
  let onlooker: ReturnType<typeof relay> | undefined
  let sockets: { close(): Promise<void> }[] = []
  try {
    let { cookie } = await seed(k, [{ slug: 'lab', apps: ['graph'] }])
    let { applied } = client(k, 'lab.yaks.app', 'graph', cookie)
    onlooker = relay(k, 'lab.yaks.app')
    let b = await socket(onlooker.origin)
    sockets.push(b)

    // The subscription answers its query immediately, then pushes bundles
    // after HTTP commits. The owner identity itself may carry a doc, so the
    // working set names tasks, with their docs explicitly requested.
    b.told({ subscribe: '.task!&.doc?', id: 'notes' })
    assertEquals(await b.hears((f) => f.id == 'notes'), {
      id: 'notes',
      bundles: [],
    })
    let note = crypto.randomUUID()
    await applied([{
      entity: { eid: note },
      task: {},
      doc: { title: 'from the kitchen' },
    }])
    let live = await b.hears((f) =>
      f.id == 'notes' && !!f.bundles?.some((r) => r.entity.eid == note)
    )
    assertEquals(live.bundles![0].doc, {
      title: 'from the kitchen',
      body: null,
    })

    // A second reader gets the current set, disconnects, and returns after
    // another commit. Re-subscribing recovers the WHOLE working set, not the
    // retired epoch/cursor catchup delta.
    let c = await socket(onlooker.origin)
    sockets.push(c)
    c.told({ subscribe: '.task!&.doc?', id: 'cold' })
    assertEquals(
      (await c.hears((f) => f.id == 'cold')).bundles!.map((r) => r.entity.eid),
      [note],
    )
    await c.close()
    let missed = crypto.randomUUID()
    await applied([{
      entity: { eid: missed },
      task: {},
      doc: { title: 'while away' },
    }])
    await b.hears((f) =>
      f.id == 'notes' && !!f.bundles?.some((r) => r.entity.eid == missed)
    )
    let d = await socket(onlooker.origin)
    sockets.push(d)
    d.told({ subscribe: '.task!&.doc?', id: 'back' })
    assertEquals(
      (await d.hears((f) => f.id == 'back')).bundles!.map((r) => r.entity.eid)
        .sort(),
      [note, missed].sort(),
    )

    // Live caches learn deletions too, including the reader that reconnected.
    await applied([{ entity: { eid: note }, tombstone: {} }])
    for (let [s, id] of [[b, 'notes'], [d, 'back']] as const) {
      let gone = await s.hears((f) => f.id == id && !!f.gone?.includes(note))
      assertEquals(gone.gone, [note])
      assertEquals(gone.bundles, [])
    }
  } finally {
    for (let s of sockets) await s.close()
    await onlooker?.stop()
    await k.stop()
  }
})
