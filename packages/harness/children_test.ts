// SQLite/daemon integration tests; the fast-tier runner does not collect
// packages. Deferred fake replies exercise concurrency without network calls.
import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import type { Model, Reply, Request } from '@yaks/model'
import {
  deliverChild,
  seqOf,
  sessionTools,
  statusOf,
  textOf,
} from '@yaks/session'
import { type Agent, agent, seed } from './run.ts'
import { open } from './store.ts'

let reply = (text: string): Reply => ({
  id: 'r',
  model: 'fake',
  items: [{ kind: 'assistant', text }],
})
let call = (name: string, args: Record<string, unknown>, id = name): Reply => ({
  id: 'r',
  model: 'fake',
  items: [{ kind: 'call', name, args: JSON.stringify(args), id }],
})
let deferred = <T>() => Promise.withResolvers<T>()
let finish = async (a: Agent, parent: string) => {
  for (let c of await a.children(parent)) await a.idle(c.entity.eid)
  await a.idle(parent)
}

for (let kind of ['fork', 'spawn']) {
  Deno.test(`${kind}: concurrent child, lineage, prefix, settings, delivery and parent reaction`, async () => {
    let childAsked = deferred<Request>()
    let childReply = deferred<Reply>()
    let calls = 0
    let model: Model = (req) => {
      if (
        req.items.at(-1)?.kind == 'user' &&
        (req.items.at(-1) as { text: string }).text == 'child work'
      ) {
        childAsked.resolve(req)
        return childReply.promise
      }
      if (calls++ == 0) {
        return Promise.resolve(call(kind, {
          prompt: 'child work',
          instructions: 'child instructions',
          model: 'other',
          effort: 'high',
        }))
      }
      return Promise.resolve(reply('parent reacted'))
    }
    let h = open(':memory:')
    h.g.apply([{ entity: { eid: 'other' }, model: { name: 'alternate' } }])
    let a = agent({ h, model, tools: sessionTools(h.g) })
    let parent = await a.start('parent context')
    let req = await childAsked.promise
    await a.idle(parent) // parent progresses before child has answered
    let [child] = await a.children(parent)
    assertEquals((child.spawned as Comp).parent, parent)
    assertEquals('fork' in child, kind == 'fork')
    assertEquals(req.model, 'alternate')
    assertEquals(req.effort, 'high')
    assertEquals(req.instructions, 'child instructions')
    assertEquals(
      req.items.filter((i) => i.kind == 'user').map((i) => i.text),
      kind == 'fork' ? ['parent context', 'child work'] : ['child work'],
    )
    // No inherited unanswered delegation call can fork recursively.
    assert(!req.items.some((i) => i.kind == 'call'))
    childReply.resolve(reply('child final'))
    await finish(a, parent)
    let entries = await a.transcript(parent)
    assertEquals(statusOf(entries), 'settled')
    assertEquals(textOf(entries.at(-1)!), 'parent reacted')
    assertEquals(
      entries.filter((b) => textOf(b).includes('child final')).length,
      1,
    )
    assertEquals(new Set(entries.map(seqOf)).size, entries.length)
    // Replaying the settle/restart is idempotent.
    await a.resume()
    await finish(a, parent)
    assertEquals((await a.transcript(parent)).length, entries.length)
    a.close()
  })
}

Deno.test('wait resolves while child completion waits behind the parent tool', async () => {
  let childAsked = deferred<void>()
  let waiting = deferred<void>()
  let childReply = deferred<Reply>()
  let turns = 0
  let h = open(':memory:')
  let tools = sessionTools(h.g)
  let wait = tools.find((t) => t.name == 'wait')!
  let run = wait.run
  wait.run = (args, ctx) => {
    waiting.resolve()
    return run(args, ctx)
  }
  let model: Model = (req) => {
    if (req.items.some((i) => i.kind == 'user' && i.text == 'child')) {
      childAsked.resolve()
      return childReply.promise
    }
    if (turns++ == 0) return Promise.resolve(call('spawn', { prompt: 'child' }))
    if (turns == 2) {
      let result = req.items.findLast((i) => i.kind == 'result')!
      return Promise.resolve(call('wait', {
        children: [(result as { output: string }).output],
        timeout: 1000,
      }))
    }
    return Promise.resolve(reply('done'))
  }
  let a = agent({ h, model, tools })
  let parent = await a.start('parent')
  await childAsked.promise
  await waiting.promise
  childReply.resolve(reply('waited final'))
  await finish(a, parent)
  let entries = await a.transcript(parent)
  assert(entries.some((b) => b.result && textOf(b).includes('waited final')))
  assertEquals(statusOf(entries), 'settled')
  a.close()
})

Deno.test('caps refuse with error entries, spawn nothing, and serialize across parents', async () => {
  let pending = deferred<Reply>()
  let childAsked = deferred<void>()
  let h = open(':memory:')
  let turns = 0
  let model: Model = (req) => {
    if (req.items.some((i) => i.kind == 'user' && i.text == 'child')) {
      childAsked.resolve()
      return pending.promise
    }
    if (turns++ == 0) {
      let first = call('spawn', { prompt: 'child' }, 'one')
      first.items.push(...call('spawn', { prompt: 'child' }, 'two').items)
      return Promise.resolve(first)
    }
    return Promise.resolve(reply('done'))
  }
  let a = agent({ h, model, tools: sessionTools(h.g, { maxChildren: 1 }) })
  let parent = await a.start('parent')
  await childAsked.promise
  await a.idle(parent)
  assertEquals((await a.children(parent)).length, 1)
  assert(
    (await a.transcript(parent)).some((b) =>
      (b.error as Comp)?.code == 'child_cap'
    ),
  )
  pending.resolve(reply('done'))
  await finish(a, parent)
  a.close()

  h = open(':memory:')
  pending = deferred<Reply>()
  a = agent({ h, model: () => pending.promise, tools: [], maxSessions: 1 })
  let results = await Promise.allSettled([a.start('one'), a.start('two')])
  assertEquals(results.filter((r) => r.status == 'fulfilled').length, 1)
  assertEquals((await a.sessions()).length, 1)
  pending.resolve(reply('done'))
  await a.idle(
    (results.find((r) => r.status == 'fulfilled') as PromiseFulfilledResult<
      string
    >).value,
  )
  a.close()
})

Deno.test('completion answers an open delegation call; wait rejects foreign children and times out', async () => {
  let h = open(':memory:')
  h.g.apply(seed())
  let entries: Bundle[] = [
    { entity: { eid: 'p' }, session: {} },
    {
      entity: { eid: 'input' },
      entry: { session: 'p', seq: 1 },
      content: { body: 'hi' },
    },
    {
      entity: { eid: 'ask' },
      entry: { session: 'p', seq: 2 },
      ask: { through: 'input' },
    },
    {
      entity: { eid: 'call' },
      entry: { session: 'p', seq: 3 },
      call: { source: 'ask' },
    },
    {
      entity: { eid: 'c' },
      session: {},
      spawned: { parent: 'p', call: 'call' },
    },
    {
      entity: { eid: 'out' },
      entry: { session: 'c', seq: 1 },
      content: { body: 'final', source: 'ask' },
    },
  ]
  h.g.apply(entries)
  await deliverChild(h.g, 'c')
  let [receipt] = await h.g.read('.result.call=call')
  assertEquals(textOf(receipt), 'child c settled\nfinal')
  let wait = sessionTools(h.g).find((t) => t.name == 'wait')!
  await assertRejects(() =>
    Promise.resolve(wait.run({ children: ['c'] }, {
      session: 'foreign',
      call: entries[3],
      entries: [],
    }))
  )
  let ctx = { session: 'p', call: entries[3], entries: [] }
  assert(
    String(await wait.run({ children: ['c'], timeout: 0 }, ctx)).includes(
      'settled',
    ),
  )
  h.g.apply([{
    entity: { eid: 'more' },
    entry: { session: 'c', seq: 2 },
    content: { body: 'more' },
  }])
  assert(
    String(await wait.run({ children: ['c'], timeout: 0 }, ctx)).includes(
      'pending',
    ),
  )
  h.close()
})

Deno.test('tool admission serializes competing parents, replays a call once, and frees settled slots', async () => {
  let h = open(':memory:')
  h.g.apply([
    ...seed(),
    { entity: { eid: 'p1' }, session: {} },
    { entity: { eid: 'p2' }, session: {} },
    { entity: { eid: 'call1' }, entry: { session: 'p1', seq: 1 }, call: {} },
    { entity: { eid: 'call2' }, entry: { session: 'p2', seq: 1 }, call: {} },
  ])
  let tools = sessionTools(h.g, { maxSessions: 3 })
  let spawn = tools.find((t) => t.name == 'spawn')!
  let ctx = (n: number) => ({
    session: `p${n}`,
    call: { entity: { eid: `call${n}` } },
    entries: [],
  })
  let results = await Promise.allSettled([
    spawn.run({ prompt: 'one', model: 'alternate' }, ctx(1)),
    spawn.run({ prompt: 'two' }, ctx(2)),
  ])
  assertEquals(results[0].status, 'fulfilled')
  assertEquals(results[1].status, 'rejected')
  assertEquals((await h.g.read('.spawned')).length, 1)
  let eid = (results[0] as PromiseFulfilledResult<string>).value
  assertEquals(await spawn.run({ prompt: 'replay' }, ctx(1)), eid)
  assertEquals((await h.g.read('.model.name=alternate')).length, 1)
  h.g.apply([{
    entity: { eid: 'done' },
    entry: { session: eid, seq: 2 },
    content: { body: 'done', source: 'call1' },
  }])
  assertEquals(await spawn.run({ prompt: 'two' }, ctx(2)), 'child:call2')
  h.close()
})

Deno.test('child completion is queued behind an in-flight parent ask without colliding seqs', async () => {
  let childReply = deferred<Reply>()
  let parentReply = deferred<Reply>()
  let parentAsked = deferred<void>()
  let turns = 0
  let h = open(':memory:')
  let a = agent({
    h,
    tools: sessionTools(h.g),
    model: (req) => {
      if (
        req.items.some((i) => i.kind == 'user' && i.text == 'child')
      ) return childReply.promise
      if (turns++ == 0) {
        return Promise.resolve(call('spawn', { prompt: 'child' }))
      }
      if (turns == 2) {
        parentAsked.resolve()
        return parentReply.promise
      }
      return Promise.resolve(reply('reacted'))
    },
  })
  let parent = await a.start('parent')
  await parentAsked.promise
  let [child] = await a.children(parent)
  childReply.resolve(reply('child final'))
  await a.idle(child.entity.eid)
  parentReply.resolve(reply('parent interim'))
  await finish(a, parent)
  let entries = await a.transcript(parent)
  assertEquals(new Set(entries.map(seqOf)).size, entries.length)
  assertEquals(textOf(entries.at(-1)!), 'reacted')
  assertEquals(
    entries.filter((b) => textOf(b).includes('child final')).length,
    1,
  )
  a.close()
})
