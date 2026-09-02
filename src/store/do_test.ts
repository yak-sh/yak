// The store seam's contract, held in workerd itself: the kernel Worker boots
// under `wrangler dev` (workers/yak/probe.ts), a space and app are born in
// the directory, and that app's Store object is driven through the graph API
// the way a headless client drives the Deno server. Slow tier only — a real
// runtime boots.
import { assert, assertEquals, assertMatch } from '@std/assert'
import { slow } from '../testing.ts'
import { client, kernel, seed, signedIn } from '../../workers/yak/probe.ts'

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
