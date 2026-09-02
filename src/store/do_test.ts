// The store seam's contract, held in workerd itself: the kernel Worker boots
// under `wrangler dev` (workers/yak/probe.ts), a space and app are born in
// the directory, and that app's Store object is driven through the graph API
// the way a headless client drives the Deno server. Slow tier only — a real
// runtime boots.
import { assert, assertEquals, assertMatch } from '@std/assert'
import { slow, until } from '../testing.ts'
import {
  client,
  kernel,
  relay,
  seed,
  signedIn,
} from '../../workers/yak/probe.ts'

slow('the store on Durable Object SQLite serves the wire', async () => {
  let k = await kernel()
  try {
    let person = crypto.randomUUID()
    await seed(k, person, [{ slug: 'lab', apps: ['graph'] }])
    let host = 'lab.yaks.app'
    let { get, post, applied } = client(
      k,
      host,
      'graph',
      await signedIn(k, person),
    )
    // Planted on first touch: the identity door answers with an epoch.
    let serving = await (await k.at(host, '/graph/api/graph')).json()
    assertMatch(serving.epoch, /^[0-9a-f-]{36}$/)
    assertEquals(serving.db, 'do:lab/graph')

    // A batch: a task, a second task it requires, a comment on it.
    let task = crypto.randomUUID(), dep = crypto.randomUUID()
    let note = crypto.randomUUID()
    let batch = await applied([
      { eid: task, name: 'doc', comp: { title: 'planted', body: 'in a DO' } },
      { eid: task, name: 'task', comp: { priority: 1 } },
      { eid: dep, name: 'doc', comp: { title: 'needed' } },
      { eid: dep, name: 'task', comp: {} },
      { eid: task, name: 'dependency', comp: { type: 'requires', child: dep } },
      { eid: note, name: 'doc', comp: { title: 'a comment', body: 'hi' } },
      { eid: note, name: 'comment', comp: { target: task } },
    ])
    assert(batch.ok)
    assert(batch.changes.some((c) => c.eid == task && c.name == 'entity'))

    // Read back: the filter grammar, edges, and FTS search all serve.
    let [hit] = await get(`id=${task}&deps=1`)
    assertEquals(hit.entity.eid, task)
    assertEquals((hit.doc as { title: string }).title, 'planted')
    assertEquals((hit.task as { status: string }).status, 'open')
    assertEquals(hit.deps, [{ parent: task, type: 'requires', child: dep }])
    assertEquals((await get('.kind=task')).length, 2)
    assertEquals((await get('planted')).map((r) => r.entity.eid), [task])
    let [about] = await get(`.comment.target=${task}`)
    assertEquals(about.entity.eid, note)

    // A claim lease bounces a second session and audits the conflict.
    let a = crypto.randomUUID(), b = crypto.randomUUID()
    await applied([
      { eid: a, name: 'session', comp: { id: 'session-a' } },
      { eid: b, name: 'session', comp: { id: 'session-b' } },
      { eid: task, name: 'claim', comp: { session: a } },
    ])
    let bounce = await post([{
      eid: task,
      name: 'claim',
      comp: { session: b },
    }])
    assertEquals(bounce.status, 400)
    assertMatch(await bounce.text(), /already claimed by session-a/)
    assertEquals((await get('.kind=conflict')).length, 1)

    // A bad batch leaves no partial write: the rename before the refusal is
    // rolled back with it.
    let bad = await post([
      { eid: task, name: 'doc', comp: { title: 'renamed' } },
      { eid: task, name: 'dependency', comp: { type: 'requires', child: 'x' } },
      { eid: task, name: 'task', comp: { priority: 'not a number' } },
    ])
    assertEquals(bad.status, 400)
    assertEquals(
      ((await get(`id=${task}`))[0].doc as { title: string }).title,
      'planted',
    )

    // Deleting the task tombstones it and takes the comment about it along;
    // the reply names the casualty so a client cache drops it too.
    let death = await applied([{ eid: task, name: 'entity', comp: null }])
    assert(death.changes.some((c) => c.eid == note && c.name == 'entity'))
    assertEquals(await get(`id=${task},${note}`), [])
    assertEquals((await get('.kind=task')).map((r) => r.entity.eid), [dep])
    // A late patch for the dead eid is void: accepted, and nothing rises.
    await applied([{ eid: task, name: 'doc', comp: { title: 'ghost' } }])
    assertEquals(await get(`id=${task}`), [])
  } finally {
    await k.stop()
  }
})

// deno-lint-ignore no-explicit-any
type Frame = Record<string, any>

// One socket on an app's live door, and everything it has heard.
let socket = async (origin: string, path: string) => {
  let ws = new WebSocket(`${origin.replace(/^http/, 'ws')}${path}`)
  let heard: Frame[] = []
  ws.onmessage = (e) => heard.push(JSON.parse(String(e.data)))
  await until(() => ws.readyState == WebSocket.OPEN, {
    timeout: 15_000,
    label: 'the socket to open',
  })
  let told = (frame: unknown) => ws.send(JSON.stringify(frame))
  // A frame this socket has heard, or the first one it hears that fits;
  // until() throws rather than answering nothing.
  let hears = async (fits: (f: Frame) => boolean): Promise<Frame> =>
    (await until(() => heard.find(fits), {
      timeout: 15_000,
      label: 'a frame',
    }))!
  let close = async () => {
    ws.close()
    await until(() => ws.readyState == WebSocket.CLOSED, { timeout: 15_000 })
  }
  return { told, hears, close }
}

slow('the store on Durable Object SQLite serves the live wire', async () => {
  let k = await kernel()
  let person = crypto.randomUUID()
  let cookie = await signedIn(k, person)
  // Two devices on one app: one signed in as the owner, one just looking.
  let device = relay(k, 'lab.yaks.app', cookie)
  let onlooker = relay(k, 'lab.yaks.app')
  let sockets: { close(): Promise<void> }[] = []
  try {
    await seed(k, person, [{ slug: 'lab', apps: ['graph'] }])
    let { applied } = client(k, 'lab.yaks.app', 'graph', cookie)

    let a = await socket(device.origin, '/graph/api/ws')
    let b = await socket(onlooker.origin, '/graph/api/ws')
    sockets.push(a, b)

    // The second socket subscribes to a filter; the empty app answers empty.
    b.told({ sub: 'notes', q: '.doc!' })
    let first = await b.hears((f) => f.sub == 'notes')
    assertEquals(first.replace, true)
    assertEquals(first.changes, [])

    // A write on the FIRST socket arrives on the second, unasked.
    let note = crypto.randomUUID()
    a.told([{ eid: note, name: 'doc', comp: { title: 'from the kitchen' } }])
    let live = await b.hears((f) =>
      f.sub == 'notes' && f.changes?.some((c: Frame) => c.eid == note)
    )
    assert(
      live.changes.some((c: Frame) =>
        c.name == 'doc' && c.comp.title == 'from the kitchen'
      ),
    )

    // A batch wearing a delivery id is acked; a socket the kernel never
    // vouched for as a writer is refused in the store's own words.
    a.told({ apply: [{ eid: note, name: 'task', comp: {} }], id: '7' })
    await a.hears((f) => f.ack == '7')
    b.told([{ eid: crypto.randomUUID(), name: 'doc', comp: { title: 'no' } }])
    await b.hears((f) => f.error == 'not_a_writer')

    // A cold socket is seeded with the working set — cursor, epoch and vocab
    // included, which is how it asks for a delta the next time.
    let c = await socket(onlooker.origin, '/graph/api/ws')
    sockets.push(c)
    c.told({ since: 0 })
    let held = (await c.hears((f) => f.reset)).snapshot
    await c.close()

    // While it was away another device wrote — over HTTP this time, the way an
    // agent does. The socket that stayed hears it live; the one that returns
    // asks from the cursor it held and is replayed exactly what it missed.
    let missed = crypto.randomUUID()
    await applied([{ eid: missed, name: 'doc', comp: { title: 'while away' } }])
    await b.hears((f) =>
      f.sub == 'notes' && f.changes?.some((c: Frame) => c.eid == missed)
    )
    let d = await socket(onlooker.origin, '/graph/api/ws')
    sockets.push(d)
    d.told({
      since: held.cursor,
      epoch: held.epoch,
      vocab: held.vocabHash,
      live: 1,
    })
    let back = await d.hears((f) => f.catchup)
    assert(back.catchup.some((c: Frame) => c.eid == missed))
    assert(!back.catchup.some((c: Frame) => c.eid == note))
  } finally {
    for (let s of sockets) await s.close()
    await device.stop()
    await onlooker.stop()
    await k.stop()
  }
})
